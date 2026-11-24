import {
  config,
  log
} from "../config.js";

import {
  getBasisCandles,
  getMissingCandles
} from "../binance.js";

import {
  getState,
  resetCycle,
  isCooldown,
  markAlertSent
} from "../states/recoveryState.js";

import {
  createBasisChart
} from "../charts/recoveryChart.js";

import {
  sendPhoto
} from "../telegram.js";

// ========================================
// BASIS DIRECTION
// ========================================

function getDirection(basisRate) {

  if (
    basisRate >= config.BASIS_TRIGGER_PERCENT &&
    config.BASIS_DIRECTION !== "negative"
  ) {
    return "positive";
  }

  if (
    basisRate <= -config.BASIS_TRIGGER_PERCENT &&
    config.BASIS_DIRECTION !== "positive"
  ) {
    return "negative";
  }

  return null;
}

// ========================================
// FORMAT PERCENT
// ========================================

function percent(value) {

  return `${value > 0 ? "+" : ""}${value.toFixed(4)}%`;
}

// ========================================
// PROCESS RECOVERY CANDLE
// ========================================

function processCandle(
  symbol,
  candle,
  state,
  allowAlert
) {

  const basis = candle.basisRate;

  const absBasis = Math.abs(basis);

  if (
    candle.openTime <=
    state.lastProcessedOpenTime
  ) {
    return;
  }

  // ========================================
  // CHECK MISSING CANDLES
  // ========================================

  if (
    state.lastProcessedOpenTime &&
    candle.openTime -
      state.lastProcessedOpenTime !==
      config.INTERVAL_MS
  ) {

    log(
      `[RECOVERY DATA GAP] ${symbol}`
    );

    resetCycle(state);
  }

  state.lastProcessedOpenTime =
    candle.openTime;

  const direction = getDirection(basis);

  // ========================================
  // ALREADY WATCHING
  // ========================================

  if (state.armed) {

    if (
      absBasis <
      config.BASIS_RECOVERY_PERCENT
    ) {

      log(
        `[RECOVERY] ${symbol} | ` +
        `Basis: ${percent(basis)} | ` +
        `Peak: ${percent(state.peakBasis)}`
      );

      if (!allowAlert) {

        log(
          `[RECOVERY HISTORY] ${symbol} Bỏ qua tín hiệu cũ`
        );

      } else if (isCooldown(state)) {

        log(
          `[RECOVERY COOLDOWN] ${symbol} Bỏ qua`
        );

      } else if (!state.pendingAlert) {

        state.pendingAlert = {

          symbol,

          direction:
            state.direction,

          peakBasis:
            state.peakBasis,

          recoveryBasis:
            basis,

          armedAt:
            state.armedAt,

          recoveryOpenTime:
            candle.openTime,

          recoveryCloseTime:
            candle.closeTime
        };

        log(
          `[RECOVERY QUEUE] ${symbol}`
        );
      }

      resetCycle(state);

      return;
    }

    // ========================================
    // CHECK DIRECTION REVERSAL
    // ========================================

    const reversed =
      (
        state.direction === "positive" &&
        basis < 0
      ) ||
      (
        state.direction === "negative" &&
        basis > 0
      );

    if (reversed) {

      resetCycle(state);

    } else {

      if (
        absBasis >
        Math.abs(state.peakBasis)
      ) {

        state.peakBasis = basis;
      }

      return;
    }
  }

  // ========================================
  // COUNT CONSECUTIVE CANDLES
  // ========================================

  if (!direction) {

    resetCycle(state);

    return;
  }

  if (state.direction === direction) {

    state.consecutiveCount++;

    if (
      absBasis >
      Math.abs(state.peakBasis)
    ) {

      state.peakBasis = basis;
    }

  } else {

    state.direction = direction;

    state.consecutiveCount = 1;

    state.peakBasis = basis;
  }

  // ========================================
  // ACTIVATE WATCHING
  // ========================================

  if (
    state.consecutiveCount >=
    config.BASIS_TRIGGER_MIN_CANDLES
  ) {

    state.armed = true;

    state.armedAt =
      candle.closeTime;

    log(
      `[RECOVERY WATCHING] ${symbol} | ` +
      `${state.direction.toUpperCase()} | ` +
      `${state.consecutiveCount} nến | ` +
      `Basis: ${percent(basis)}`
    );
  }
}

// ========================================
// PROCESS RECOVERY STRATEGY
// ========================================

export async function processRecovery(
  instrument,
  recentCandles,
  endTime
) {

  if (!config.BASIS_RECOVERY_ENABLED) {

    return {
      enabled: false,
      missing: false,
      deferred: false,
      pending: false
    };
  }

  const symbol = instrument.symbol;

  const state = getState(symbol);

  // ========================================
  // CHECK CANDLE DATA
  // ========================================

  if (!recentCandles?.length) {

    return {
      enabled: true,
      missing: true,
      deferred: false,
      pending: Boolean(state.pendingAlert)
    };
  }

  const expectedOpenTime =
    endTime + 1 - config.INTERVAL_MS;

  const latest =
    recentCandles.at(-1);

  if (
    latest.openTime !== expectedOpenTime
  ) {

    return {
      enabled: true,
      missing: true,
      deferred: false,
      pending: Boolean(state.pendingAlert)
    };
  }

  // ========================================
  // KEEP UNSENT ALERT
  // ========================================

  if (state.pendingAlert) {

    return {
      enabled: true,
      missing: false,
      deferred: true,
      pending: true
    };
  }

  let candles = recentCandles;

  // ========================================
  // RECOVER MISSED CANDLES
  // ========================================

  if (
    state.lastProcessedOpenTime &&
    recentCandles[0].openTime >
      state.lastProcessedOpenTime +
        config.INTERVAL_MS
  ) {

    log(
      `[RECOVERY BACKFILL] ${symbol}`
    );

    candles = await getMissingCandles(

      instrument,

      state.lastProcessedOpenTime +
        config.INTERVAL_MS,

      endTime
    );
  }

  // ========================================
  // PROCESS CANDLES
  // ========================================

  for (const candle of candles) {

    const allowAlert =
      candle.openTime === expectedOpenTime;

    processCandle(
      symbol,
      candle,
      state,
      allowAlert
    );
  }

  return {

    enabled: true,

    missing: false,

    deferred: false,

    pending:
      Boolean(state.pendingAlert)
  };
}

// ========================================
// CHECK PENDING RECOVERY ALERT
// ========================================

export function hasRecoveryPending(symbol) {

  if (!config.BASIS_RECOVERY_ENABLED) {
    return false;
  }

  const state = getState(symbol);

  return Boolean(
    state.pendingAlert
  );
}

// ========================================
// SEND PENDING RECOVERY ALERT
// ========================================

export async function deliverRecoveryPending(
  instrument,
  recentCandles = []
) {

  if (!config.BASIS_RECOVERY_ENABLED) {
    return false;
  }

  const symbol =
    instrument.symbol;

  const state =
    getState(symbol);

  const pending =
    state.pendingAlert;

  if (!pending) {
    return false;
  }

  // ========================================
  // CREATE CHART DATA
  // ========================================

  log(
    `[RECOVERY CHART] ${symbol} | Đang tạo biểu đồ`
  );

  let chartCandles =
    recentCandles.filter(

      candle =>
        candle.closeTime <=
        pending.recoveryCloseTime
    );

  // ========================================
  // FETCH MISSING CHART DATA
  // ========================================

  if (
    chartCandles.length <
      config.CHART_CANDLE_COUNT ||

    chartCandles.at(-1)?.openTime !==
      pending.recoveryOpenTime
  ) {

    chartCandles = await getBasisCandles(

      instrument,

      pending.recoveryCloseTime,

      config.CHART_CANDLE_COUNT
    );
  }

  // ========================================
  // VALIDATE CHART DATA
  // ========================================

  if (
    chartCandles.length < 2 ||

    chartCandles.at(-1)?.openTime !==
      pending.recoveryOpenTime
  ) {

    throw new Error(
      "Chưa có đủ dữ liệu biểu đồ Recovery"
    );
  }

  // ========================================
  // CREATE RECOVERY CHART
  // ========================================

  const image = createBasisChart(

    symbol,

    chartCandles
  );

  // ========================================
  // SEND TELEGRAM - RECOVERY CAPTION
  // ========================================

  log(
    `[RECOVERY TELEGRAM SEND] ${symbol}`
  );

  await sendPhoto(

    symbol,

    image,

    "RECOVERY"
  );

  // ========================================
  // SAVE ALERT SUCCESS
  // ========================================

  markAlertSent(state);

  log(
    `[RECOVERY TELEGRAM SENT] ${symbol}`
  );

  return true;
}