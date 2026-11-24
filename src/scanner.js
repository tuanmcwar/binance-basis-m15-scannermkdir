import pLimit from "p-limit";

import {
  config,
  log,
  formatTime
} from "./config.js";

import {
  getSymbols,
  getBasisCandles,
  getApiStats,
  resetApiStats
} from "./binance.js";

import {
  setFundingSymbols
} from "./fundingStream.js";

// ========================================
// RECOVERY STRATEGY
// ========================================

import {
  processRecovery,
  hasRecoveryPending,
  deliverRecoveryPending
} from "./strategies/basisRecovery.js";

import {
  saveState,
  getStateStats
} from "./states/recoveryState.js";

// ========================================
// EXTREME STRATEGY
// ========================================

import {
  processExtreme,
  hasExtremePending,
  deliverExtremePending
} from "./strategies/basisExtreme.js";

import {
  saveExtremeState,
  getExtremeStateStats
} from "./states/extremeState.js";

// ========================================
// SCANNER STATUS
// ========================================

let scanning = false;

// ========================================
// SAVE ALL STATES
// ========================================

function saveAllStates() {

  if (config.BASIS_RECOVERY_ENABLED) {

    saveState();
  }

  if (config.BASIS_EXTREME_ENABLED) {

    saveExtremeState();
  }
}

// ========================================
// FORMAT ERROR
// ========================================

function getErrorMessage(error) {

  return (
    error.response?.data?.description ||
    error.response?.data?.msg ||
    error.message ||
    String(error)
  );
}

// ========================================
// SCAN SINGLE SYMBOL
// ========================================

async function scanSymbol(
  instrument,
  endTime
) {

  const symbol =
    instrument.symbol;

  // ========================================
  // FETCH SHARED BINANCE DATA
  // ========================================

  const recentCandles =
    await getBasisCandles(

      instrument,

      endTime,

      config.CHART_CANDLE_COUNT
    );

  const result = {

    recentCandles,

    missing: false,

    errors: 0,

    recoveryDeferred: false,

    recoveryPending: false,

    extremePending: false,

    extremeTriggered: false
  };

  // ========================================
  // VALIDATE CANDLE DATA
  // ========================================

  if (!recentCandles.length) {

    result.missing = true;

    return result;
  }

  const expectedOpenTime =
    endTime + 1 - config.INTERVAL_MS;

  const latest =
    recentCandles.at(-1);

  if (
    latest.openTime !== expectedOpenTime ||
    latest.closeTime > endTime
  ) {

    result.missing = true;

    return result;
  }

  // ========================================
  // STRATEGY 1: BASIS RECOVERY
  // ========================================

  if (config.BASIS_RECOVERY_ENABLED) {

    try {

      const recoveryResult =
        await processRecovery(

          instrument,

          recentCandles,

          endTime
        );

      result.recoveryDeferred =
        recoveryResult.deferred;

      result.recoveryPending =
        recoveryResult.pending;

      if (recoveryResult.missing) {

        result.missing = true;
      }

    } catch (error) {

      result.errors++;

      log(
        `[RECOVERY ERROR] ${symbol} | ` +
        getErrorMessage(error)
      );
    }
  }

  // ========================================
  // STRATEGY 2: BASIS EXTREME
  // ========================================

  if (config.BASIS_EXTREME_ENABLED) {

    try {

      const extremeResult =
        processExtreme(

          instrument,

          recentCandles,

          endTime
        );

      result.extremePending =
        extremeResult.pending;

      result.extremeTriggered =
        extremeResult.triggered;

      if (extremeResult.missing) {

        result.missing = true;
      }

    } catch (error) {

      result.errors++;

      log(
        `[EXTREME ERROR] ${symbol} | ` +
        getErrorMessage(error)
      );
    }
  }

  return result;
}

// ========================================
// MAIN SCANNER
// ========================================

export async function runScan(boundary) {

  // ========================================
  // PREVENT OVERLAPPING SCANS
  // ========================================

  if (scanning) {

    log(
      "[SCAN] Kỳ quét trước chưa hoàn thành"
    );

    return;
  }

  scanning = true;

  const startedAt =
    Date.now();

  resetApiStats();

  // ========================================
  // SCAN STATISTICS
  // ========================================

  let scanned = 0;

  let recoveryAlerts = 0;

  let extremeAlerts = 0;

  let extremeTriggered = 0;

  let errors = 0;

  let missing = 0;

  let total = 0;

  let phase = "STARTING";

  let heartbeat = null;

  const activeSymbols =
    new Set();

  // ========================================
  // SEPARATE ALERT QUEUES
  // ========================================

  const recoveryQueue = [];

  const extremeQueue = [];

  try {

    const endTime =
      boundary - 1;

    log("========================================");

    log(
      `[SCAN START] Nến đóng: ${formatTime(boundary)}`
    );

    log(
      `[TIMEFRAME] ${config.TIMEFRAME.toUpperCase()}`
    );

    // ========================================
    // STRATEGY STATUS
    // ========================================

    log(
      `[RECOVERY] ${
        config.BASIS_RECOVERY_ENABLED
          ? "ENABLED"
          : "DISABLED"
      }`
    );

    log(
      `[EXTREME] ${
        config.BASIS_EXTREME_ENABLED
          ? "ENABLED"
          : "DISABLED"
      }`
    );

    if (config.BASIS_RECOVERY_ENABLED) {

      log(
        `[RECOVERY CONFIG] ` +
        `Trigger: ${config.BASIS_TRIGGER_PERCENT}% | ` +
        `Candles: ${config.BASIS_TRIGGER_MIN_CANDLES} | ` +
        `Recovery: ${config.BASIS_RECOVERY_PERCENT}% | ` +
        `Cooldown: ${config.ALERT_COOLDOWN_HOURS}h`
      );
    }

    if (config.BASIS_EXTREME_ENABLED) {

      log(
        `[EXTREME CONFIG] ` +
        `Positive > +${config.BASIS_POSITIVE_THRESHOLD}% | ` +
        `Negative < ${config.BASIS_NEGATIVE_THRESHOLD}%`
      );
    }

    // ========================================
    // GET BINANCE SYMBOLS
    // ========================================

    const symbols =
      await getSymbols();

    setFundingSymbols(symbols);

    total =
      symbols.length;

    log(
      `[SYMBOLS] ${total} USDT Perpetual`
    );

    log(
      `[CONCURRENCY] ${config.CONCURRENCY}`
    );

    phase = "BINANCE SCAN";

    // ========================================
    // HEARTBEAT
    // ========================================

    heartbeat = setInterval(() => {

      const apiStats =
        getApiStats();

      const elapsed = (
        (Date.now() - startedAt) / 1000
      ).toFixed(1);

      log(
        `[HEARTBEAT] ${phase} | ` +
        `${scanned}/${total} | ` +
        `Requests: ${apiStats.requestCount} | ` +
        `Weight: ${apiStats.usedWeight} | ` +
        `${elapsed}s`
      );

      if (activeSymbols.size) {

        log(
          `[ACTIVE] ${[...activeSymbols].join(", ")}`
        );
      }

    }, 10000);

    // ========================================
    // CONCURRENCY LIMIT
    // ========================================

    const limit =
      pLimit(config.CONCURRENCY);

    // ========================================
    // PHASE 1: SCAN BINANCE
    // ========================================

    await Promise.all(

      symbols.map(instrument =>

        limit(async () => {

          const symbol =
            instrument.symbol;

          activeSymbols.add(symbol);

          let result = null;

          try {

            result = await scanSymbol(

              instrument,

              endTime
            );

            if (result.missing) {

              missing++;
            }

            errors += result.errors;

            if (result.extremeTriggered) {

              extremeTriggered++;
            }

          } catch (error) {

            errors++;

            log(
              `[BINANCE ERROR] ${symbol} | ` +
              getErrorMessage(error)
            );

          } finally {

            // ========================================
            // RECOVERY PENDING QUEUE
            // ========================================

            if (
              config.BASIS_RECOVERY_ENABLED &&
              hasRecoveryPending(symbol)
            ) {

              recoveryQueue.push({

                instrument,

                recentCandles:
                  result?.recentCandles || [],

                deferred:
                  result?.recoveryDeferred || false
              });
            }

            // ========================================
            // EXTREME PENDING QUEUE
            // ========================================

            if (
              config.BASIS_EXTREME_ENABLED &&
              hasExtremePending(symbol)
            ) {

              extremeQueue.push({

                instrument,

                recentCandles:
                  result?.recentCandles || []
              });
            }

            // ========================================
            // PROGRESS
            // ========================================

            activeSymbols.delete(symbol);

            scanned++;

            if (
              scanned === 1 ||
              scanned % 10 === 0 ||
              scanned === total
            ) {

              log(
                `[PROGRESS] ${scanned}/${total} | ` +
                `Recovery: ${recoveryQueue.length} | ` +
                `Extreme: ${extremeQueue.length} | ` +
                `Errors: ${errors}`
              );
            }
          }
        })
      )
    );

    // ========================================
    // SAVE STATES BEFORE TELEGRAM
    // ========================================

    saveAllStates();

    log(
      "[STATE] Đã lưu dữ liệu các chiến lược đang bật"
    );

    log(
      `[BINANCE DONE] ${scanned}/${total}`
    );

    log(
      `[RECOVERY QUEUE] ${recoveryQueue.length} coin`
    );

    log(
      `[EXTREME QUEUE] ${extremeQueue.length} coin`
    );

    // ========================================
    // PHASE 2: SEND RECOVERY ALERTS
    // ========================================

    phase = "RECOVERY TELEGRAM";

    if (config.BASIS_RECOVERY_ENABLED) {

      log("========================================");

      log("[RECOVERY TELEGRAM START]");

      for (const item of recoveryQueue) {

        const {

          instrument,

          recentCandles,

          deferred

        } = item;

        const symbol =
          instrument.symbol;

        activeSymbols.add(symbol);

        try {

          // ========================================
          // SEND PENDING RECOVERY
          // ========================================

          const sent =
            await deliverRecoveryPending(

              instrument,

              recentCandles
            );

          if (sent) {

            recoveryAlerts++;
          }

          // ========================================
          // PROCESS DEFERRED CANDLES
          // ========================================

          if (
            deferred &&
            !hasRecoveryPending(symbol)
          ) {

            log(
              `[RECOVERY DEFERRED] ${symbol}`
            );

            await processRecovery(

              instrument,

              recentCandles,

              endTime
            );

            // Lưu trạng thái trước khi gửi.

            saveState();

            // ========================================
            // SEND NEW RECOVERY ALERT
            // ========================================

            if (hasRecoveryPending(symbol)) {

              const newSent =
                await deliverRecoveryPending(

                  instrument,

                  recentCandles
                );

              if (newSent) {

                recoveryAlerts++;
              }
            }
          }

        } catch (error) {

          errors++;

          log(
            `[RECOVERY TELEGRAM ERROR] ${symbol} | ` +
            getErrorMessage(error)
          );

        } finally {

          activeSymbols.delete(symbol);
        }
      }

      log(
        `[RECOVERY TELEGRAM DONE] ${recoveryAlerts} cảnh báo`
      );
    }

    // ========================================
    // PHASE 3: SEND EXTREME ALERTS
    // ========================================

    phase = "EXTREME TELEGRAM";

    if (config.BASIS_EXTREME_ENABLED) {

      log("========================================");

      log("[EXTREME TELEGRAM START]");

      for (const item of extremeQueue) {

        const {

          instrument,

          recentCandles

        } = item;

        const symbol =
          instrument.symbol;

        activeSymbols.add(symbol);

        // Đếm số cảnh báo đã lưu thành công
        // kể cả khi một cảnh báo tiếp theo bị lỗi.

        const alertsBefore =
          getExtremeStateStats().totalAlerts;

        try {

          await deliverExtremePending(

            instrument,

            recentCandles
          );

        } catch (error) {

          errors++;

          log(
            `[EXTREME TELEGRAM ERROR] ${symbol} | ` +
            getErrorMessage(error)
          );

        } finally {

          const alertsAfter =
            getExtremeStateStats().totalAlerts;

          extremeAlerts += Math.max(

            0,

            alertsAfter - alertsBefore
          );

          activeSymbols.delete(symbol);
        }
      }

      log(
        `[EXTREME TELEGRAM DONE] ${extremeAlerts} cảnh báo`
      );
    }

    // ========================================
    // PHASE 4: FINAL STATE
    // ========================================

    phase = "FINALIZING";

    saveAllStates();

    // ========================================
    // RECOVERY STATISTICS
    // ========================================

    const recoveryStats =
      config.BASIS_RECOVERY_ENABLED

        ? getStateStats()

        : {
            total: 0,
            watching: 0,
            cooldown: 0,
            pending: 0
          };

    // ========================================
    // EXTREME STATISTICS
    // ========================================

    const extremeStats =
      config.BASIS_EXTREME_ENABLED

        ? getExtremeStateStats()

        : {
            total: 0,
            alerted: 0,
            positive: 0,
            negative: 0,
            pending: 0,
            totalAlerts: 0
          };

    // ========================================
    // API STATISTICS
    // ========================================

    const apiStats =
      getApiStats();

    const elapsed = (
      (Date.now() - startedAt) / 1000
    ).toFixed(2);

    // ========================================
    // FINAL SCAN REPORT
    // ========================================

    log("========================================");

    log("[SCAN DONE]");

    log(
      `Scanned: ${scanned}/${total}`
    );

    // ========================================
    // RECOVERY REPORT
    // ========================================

    if (config.BASIS_RECOVERY_ENABLED) {

      log("----------------------------------------");

      log("[BASIS RECOVERY]");

      log(
        `Watching: ${recoveryStats.watching}`
      );

      log(
        `Cooldown: ${recoveryStats.cooldown}`
      );

      log(
        `Alerts: ${recoveryAlerts}`
      );

      log(
        `Pending: ${recoveryStats.pending}`
      );
    }

    // ========================================
    // EXTREME REPORT
    // ========================================

    if (config.BASIS_EXTREME_ENABLED) {

      log("----------------------------------------");

      log("[BASIS EXTREME]");

      log(
        `Triggered: ${extremeTriggered}`
      );

      log(
        `Alerts: ${extremeAlerts}`
      );

      log(
        `Pending: ${extremeStats.pending}`
      );

      log(
        `Positive symbols: ${extremeStats.positive}`
      );

      log(
        `Negative symbols: ${extremeStats.negative}`
      );

      log(
        `Lifetime alerts: ${extremeStats.totalAlerts}`
      );
    }

    // ========================================
    // TOTAL REPORT
    // ========================================

    log("----------------------------------------");

    log("[TOTAL]");

    log(
      `Total alerts: ${recoveryAlerts + extremeAlerts}`
    );

    log(
      `Missing candles: ${missing}`
    );

    log(
      `Errors: ${errors}`
    );

    log(
      `API Requests: ${apiStats.requestCount}`
    );

    log(
      `API Weight: ${apiStats.usedWeight}`
    );

    log(
      `Duration: ${elapsed}s`
    );

    log("========================================");

  } finally {

    // ========================================
    // CLEAR HEARTBEAT
    // ========================================

    if (heartbeat) {

      clearInterval(heartbeat);
    }

    scanning = false;
  }
}