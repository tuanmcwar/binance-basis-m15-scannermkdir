import fs from "node:fs";
import path from "node:path";
import { config, log } from "../config.js";

// ========================================
// STATE FILES
// ========================================

const STATE_FILE = path.join(
  config.DATA_DIR,
  "extreme-state.json"
);

const TEMP_FILE =
  `${STATE_FILE}.${process.pid}.tmp`;

let states = {};

const waitBuffer = new Int32Array(
  new SharedArrayBuffer(4)
);

// ========================================
// LOAD EXTREME STATE
// ========================================

export function loadExtremeState() {

  fs.mkdirSync(config.DATA_DIR, {
    recursive: true
  });

  if (!fs.existsSync(STATE_FILE)) {

    saveExtremeState();

    log(
      "[EXTREME STATE] Tạo dữ liệu mới"
    );

    return;
  }

  try {

    const raw = fs.readFileSync(
      STATE_FILE,
      "utf8"
    );

    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error(
        "Extreme state không hợp lệ"
      );
    }

    states = parsed;

    log(
      `[EXTREME STATE] Đã tải ${Object.keys(states).length} coin`
    );

  } catch (error) {

    throw new Error(
      `Không đọc được Extreme state: ${error.message}`
    );
  }
}

// ========================================
// SAVE EXTREME STATE
// ========================================

export function saveExtremeState() {

  fs.mkdirSync(config.DATA_DIR, {
    recursive: true
  });

  fs.writeFileSync(
    TEMP_FILE,
    JSON.stringify(states, null, 2),
    "utf8"
  );

  for (
    let attempt = 1;
    attempt <= 5;
    attempt++
  ) {

    try {

      fs.renameSync(
        TEMP_FILE,
        STATE_FILE
      );

      return;

    } catch (error) {

      const retryable = [
        "EPERM",
        "EBUSY",
        "EACCES"
      ].includes(error.code);

      if (
        !retryable ||
        attempt === 5
      ) {
        throw error;
      }

      log(
        `[EXTREME STATE RETRY] ${attempt}/5 | ${error.code}`
      );

      Atomics.wait(
        waitBuffer,
        0,
        0,
        100 * attempt
      );
    }
  }
}

// ========================================
// GET SYMBOL STATE
// ========================================

export function getExtremeState(symbol) {

  if (!states[symbol]) {

    states[symbol] = {

      lastProcessedOpenTime: 0,

      lastAlertOpenTime: 0,

      lastAlertAt: 0,

      lastBasisRate: null,

      lastDirection: null,

      totalAlerts: 0,

      pendingAlerts: []
    };
  }

  return states[symbol];
}

// ========================================
// CHECK DUPLICATE CANDLE
// ========================================

export function isExtremeProcessed(
  state,
  candleOpenTime
) {

  return (
    Number(candleOpenTime) <=
    Number(state.lastProcessedOpenTime)
  );
}

// ========================================
// CHECK ALERT ALREADY SENT
// ========================================

export function isExtremeAlertSent(
  state,
  candleOpenTime
) {

  return (
    Number(candleOpenTime) <=
    Number(state.lastAlertOpenTime)
  );
}

// ========================================
// MARK CANDLE PROCESSED
// ========================================

export function markExtremeProcessed(
  state,
  candleOpenTime
) {

  state.lastProcessedOpenTime = Math.max(
    Number(state.lastProcessedOpenTime),
    Number(candleOpenTime)
  );
}

// ========================================
// ADD PENDING ALERT
// ========================================

export function addExtremePendingAlert(
  state,
  alert
) {

  const candleOpenTime = Number(
    alert.candleOpenTime
  );

  if (
    !Number.isFinite(candleOpenTime) ||
    candleOpenTime <= 0
  ) {
    throw new Error(
      "Extreme candleOpenTime không hợp lệ"
    );
  }

  if (
    isExtremeAlertSent(
      state,
      candleOpenTime
    )
  ) {
    return false;
  }

  const exists = state.pendingAlerts.some(
    item =>
      Number(item.candleOpenTime) ===
      candleOpenTime
  );

  if (exists) {
    return false;
  }

  state.pendingAlerts.push({
    ...alert,
    candleOpenTime
  });

  state.pendingAlerts.sort(
    (a, b) =>
      a.candleOpenTime -
      b.candleOpenTime
  );

  return true;
}

// ========================================
// GET PENDING ALERTS
// ========================================

export function getExtremePendingAlerts(
  state
) {

  return [...state.pendingAlerts];
}

// ========================================
// MARK ALERT SENT
// ========================================

export function markExtremeAlertSent(
  state,
  alert
) {

  const candleOpenTime = Number(
    alert.candleOpenTime
  );

  if (
    !Number.isFinite(candleOpenTime) ||
    candleOpenTime <= 0
  ) {
    throw new Error(
      "Extreme candleOpenTime không hợp lệ"
    );
  }

  if (
    isExtremeAlertSent(
      state,
      candleOpenTime
    )
  ) {
    return false;
  }

  state.lastAlertOpenTime =
    candleOpenTime;

  state.lastAlertAt =
    Date.now();

  state.lastBasisRate =
    Number(alert.basisRate);

  state.lastDirection =
    alert.direction;

  state.totalAlerts += 1;

  state.pendingAlerts =
    state.pendingAlerts.filter(
      item =>
        Number(item.candleOpenTime) !==
        candleOpenTime
    );

  saveExtremeState();

  return true;
}

// ========================================
// EXTREME STATE STATISTICS
// ========================================

export function getExtremeStateStats() {

  const values = Object.values(states);

  return {

    total: values.length,

    alerted: values.filter(
      item => item.lastAlertOpenTime > 0
    ).length,

    positive: values.filter(
      item => item.lastDirection === "positive"
    ).length,

    negative: values.filter(
      item => item.lastDirection === "negative"
    ).length,

    pending: values.reduce(
      (sum, item) =>
        sum + item.pendingAlerts.length,
      0
    ),

    totalAlerts: values.reduce(
      (sum, item) =>
        sum + Number(item.totalAlerts || 0),
      0
    )
  };
}