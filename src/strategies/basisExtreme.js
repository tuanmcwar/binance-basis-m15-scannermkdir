import {
  config,
  log
} from "../config.js";

import {
  getBasisCandles
} from "../binance.js";

import {
  getExtremeState,
  isExtremeProcessed,
  isExtremeAlertSent,
  markExtremeProcessed,
  addExtremePendingAlert,
  getExtremePendingAlerts,
  markExtremeAlertSent
} from "../states/extremeState.js";

import {
  createExtremeChart
} from "../charts/extremeChart.js";

import {
  sendPhoto
} from "../telegram.js";

// ========================================
// FORMAT PERCENT
// ========================================

function percent(value) {

  return `${value > 0 ? "+" : ""}${value.toFixed(4)}%`;
}

// ========================================
// CHECK EXTREME DIRECTION
// ========================================

function getExtremeDirection(basisRate) {

  if (
    basisRate >
    config.BASIS_POSITIVE_THRESHOLD
  ) {
    return "positive";
  }

  if (
    basisRate <
    config.BASIS_NEGATIVE_THRESHOLD
  ) {
    return "negative";
  }

  return null;
}

// ========================================
// PROCESS EXTREME STRATEGY
// ========================================

export function processExtreme(
  instrument,
  recentCandles,
  endTime
) {

  if (!config.BASIS_EXTREME_ENABLED) {

    return {
      enabled: false,
      missing: false,
      pending: false,
      triggered: false
    };
  }

  const symbol = instrument.symbol;

  const state = getExtremeState(symbol);

  // ========================================
  // CHECK CANDLE DATA
  // ========================================

  if (!recentCandles?.length) {

    return {
      enabled: true,
      missing: true,
      pending: state.pendingAlerts.length > 0,
      triggered: false
    };
  }

  const expectedOpenTime =
    endTime + 1 - config.INTERVAL_MS;

  const latest =
    recentCandles.at(-1);

  // ========================================
  // ONLY CLOSED CANDLE
  // ========================================

  if (
    latest.openTime !== expectedOpenTime ||
    latest.closeTime > endTime
  ) {

    return {
      enabled: true,
      missing: true,
      pending: state.pendingAlerts.length > 0,
      triggered: false
    };
  }

  // ========================================
  // CHECK DUPLICATE CANDLE
  // ========================================

  if (
    isExtremeProcessed(
      state,
      latest.openTime
    )
  ) {

    return {
      enabled: true,
      missing: false,
      pending: state.pendingAlerts.length > 0,
      triggered: false
    };
  }

  // ========================================
  // GET BASIS RATE
  // ========================================

  const basisRate =
    Number(latest.basisRate);

  if (!Number.isFinite(basisRate)) {

    throw new Error(
      `Basis Rate không hợp lệ: ${symbol}`
    );
  }

  // ========================================
  // CHECK EXTREME CONDITION
  // ========================================

  const direction =
    getExtremeDirection(basisRate);

  let triggered = false;

  if (direction) {

    const alert = {

      symbol,

      direction,

      basisRate,

      futuresPrice:
        Number(latest.futuresPrice),

      indexPrice:
        Number(latest.indexPrice),

      candleOpenTime:
        latest.openTime,

      candleCloseTime:
        latest.closeTime,

      detectedAt:
        Date.now()
    };

    triggered = addExtremePendingAlert(
      state,
      alert
    );

    if (triggered) {

      log(
        `[EXTREME ${direction.toUpperCase()}] ${symbol} | ` +
        `Basis: ${percent(basisRate)}`
      );

      log(
        `[EXTREME QUEUE] ${symbol}`
      );
    }
  }

  // ========================================
  // MARK CANDLE PROCESSED
  // ========================================

  markExtremeProcessed(
    state,
    latest.openTime
  );

  return {

    enabled: true,

    missing: false,

    pending:
      state.pendingAlerts.length > 0,

    triggered
  };
}

// ========================================
// CHECK PENDING EXTREME ALERT
// ========================================

export function hasExtremePending(symbol) {

  if (!config.BASIS_EXTREME_ENABLED) {
    return false;
  }

  const state =
    getExtremeState(symbol);

  return (
    state.pendingAlerts.length > 0
  );
}

// ========================================
// SEND PENDING EXTREME ALERTS
// ========================================

export async function deliverExtremePending(
  instrument,
  recentCandles = []
) {

  if (!config.BASIS_EXTREME_ENABLED) {
    return 0;
  }

  const symbol =
    instrument.symbol;

  const state =
    getExtremeState(symbol);

  const pendingAlerts =
    getExtremePendingAlerts(state);

  if (!pendingAlerts.length) {
    return 0;
  }

  // Gửi cảnh báo từ nến cũ đến nến mới.

  pendingAlerts.sort(
    (a, b) =>
      a.candleOpenTime -
      b.candleOpenTime
  );

  let sentCount = 0;

  for (const pending of pendingAlerts) {

    // ========================================
    // CHECK DUPLICATE ALERT
    // ========================================

    if (
      isExtremeAlertSent(
        state,
        pending.candleOpenTime
      )
    ) {
      continue;
    }

    // ========================================
    // CREATE CHART DATA
    // ========================================

    log(
      `[EXTREME CHART] ${symbol} | ` +
      `${pending.direction.toUpperCase()} | ` +
      `Basis: ${percent(pending.basisRate)}`
    );

    let chartCandles =
      recentCandles.filter(

        candle =>
          candle.closeTime <=
          pending.candleCloseTime
      );

    // ========================================
    // FETCH MISSING CHART DATA
    // ========================================

    if (
      chartCandles.length <
        config.CHART_CANDLE_COUNT ||

      chartCandles.at(-1)?.openTime !==
        pending.candleOpenTime
    ) {

      chartCandles = await getBasisCandles(

        instrument,

        pending.candleCloseTime,

        config.CHART_CANDLE_COUNT
      );
    }

    // ========================================
    // VALIDATE CHART DATA
    // ========================================

    if (
      chartCandles.length < 2 ||

      chartCandles.at(-1)?.openTime !==
        pending.candleOpenTime
    ) {

      throw new Error(
        "Chưa có đủ dữ liệu biểu đồ Extreme"
      );
    }

    // ========================================
    // CREATE EXTREME CHART
    // ========================================

    const image = createExtremeChart(

      symbol,

      chartCandles
    );

    // ========================================
    // SEND TELEGRAM - EXTREME CAPTION
    // ========================================

    log(
      `[EXTREME TELEGRAM SEND] ${symbol}`
    );

    await sendPhoto(

      symbol,

      image,

      "EXTREME"
    );

    // ========================================
    // SAVE ALERT SUCCESS
    // ========================================

    markExtremeAlertSent(

      state,

      pending
    );

    sentCount++;

    log(
      `[EXTREME TELEGRAM SENT] ${symbol}`
    );
  }

  return sentCount;
}