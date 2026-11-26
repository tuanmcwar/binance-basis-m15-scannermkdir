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
// CREATE DEFAULT STATE
// ========================================

function createDefaultState() {

  return {

    lastProcessedOpenTime: 0,

    lastAlertOpenTime: 0,

    lastAlertAt: 0,

    lastBasisRate: null,

    lastDirection: null,

    totalAlerts: 0,

    pendingAlerts: [],

    // ========================================
    // POSITIVE LOCK STATE
    // ========================================

    positiveLocked: false,

    positiveLockedAt: 0,

    positiveLockedBasisRate: null,

    positiveLastResetAt: 0,

    positiveLastResetBasisRate: null,

    positiveTotalResets: 0,

    // ========================================
    // NEGATIVE LOCK STATE
    // ========================================

    negativeLocked: false,

    negativeLockedAt: 0,

    negativeLockedBasisRate: null,

    negativeLastResetAt: 0,

    negativeLastResetBasisRate: null,

    negativeTotalResets: 0
  };
}

// ========================================
// VALIDATE DIRECTION
// ========================================

function validateDirection(direction) {

  if (
    direction !== "positive" &&
    direction !== "negative"
  ) {
    throw new Error(
      `Extreme direction không hợp lệ: ${direction}`
    );
  }
}

// ========================================
// MIGRATE OLD STATE
// ========================================

function migrateExtremeState() {

  let migrated = 0;

  for (const symbol of Object.keys(states)) {

    const oldState = states[symbol];

    if (
      !oldState ||
      typeof oldState !== "object" ||
      Array.isArray(oldState)
    ) {
      throw new Error(
        `Extreme state không hợp lệ: ${symbol}`
      );
    }

    const defaultState =
      createDefaultState();

    const newState = {
      ...defaultState,
      ...oldState
    };

    if (!Array.isArray(newState.pendingAlerts)) {

      throw new Error(
        `Extreme pendingAlerts không hợp lệ: ${symbol}`
      );
    }

    const needsMigration =
      Object.keys(defaultState).some(
        key => !(key in oldState)
      );

    if (!needsMigration) {
      continue;
    }

    // ========================================
    // MIGRATE OLD COMMON LOCK
    // ========================================

    if (
      typeof oldState.positiveLocked !== "boolean" ||
      typeof oldState.negativeLocked !== "boolean"
    ) {

      const pendingAlert =
        newState.pendingAlerts.at(-1);

      let oldDirection = null;

      let oldBasisRate = null;

      let oldLockedAt = 0;

      // Phiên bản có khóa chung.

      if (oldState.locked === true) {

        oldDirection =
          oldState.lockedDirection ||
          pendingAlert?.direction ||
          oldState.lastDirection;

        oldBasisRate =
          oldState.lockedBasisRate ??
          pendingAlert?.basisRate ??
          oldState.lastBasisRate ??
          null;

        oldLockedAt =
          oldState.lockedAt ||
          pendingAlert?.detectedAt ||
          oldState.lastAlertAt ||
          Date.now();

      // Phiên bản chưa có hệ thống khóa.

      } else if (
        typeof oldState.locked !== "boolean" &&
        (
          pendingAlert ||
          Number(oldState.lastAlertOpenTime) > 0
        )
      ) {

        oldDirection =
          pendingAlert?.direction ||
          oldState.lastDirection;

        oldBasisRate =
          pendingAlert?.basisRate ??
          oldState.lastBasisRate ??
          null;

        oldLockedAt =
          pendingAlert?.detectedAt ||
          oldState.lastAlertAt ||
          Date.now();
      }

      // MIGRATE POSITIVE LOCK

      if (oldDirection === "positive") {

        newState.positiveLocked = true;

        newState.positiveLockedAt =
          Number(oldLockedAt);

        newState.positiveLockedBasisRate =
          oldBasisRate;
      }

      // MIGRATE NEGATIVE LOCK

      if (oldDirection === "negative") {

        newState.negativeLocked = true;

        newState.negativeLockedAt =
          Number(oldLockedAt);

        newState.negativeLockedBasisRate =
          oldBasisRate;
      }
    }

    // Giữ lại tổng số lần Reset của phiên bản cũ.

    if (
      Object.hasOwn(oldState, "totalResets") &&
      !Object.hasOwn(oldState, "legacyTotalResets")
    ) {

      newState.legacyTotalResets =
        Number(oldState.totalResets || 0);
    }

    // ========================================
    // REMOVE OLD COMMON LOCK FIELDS
    // ========================================

    delete newState.locked;

    delete newState.lockedAt;

    delete newState.lockedBasisRate;

    delete newState.lockedDirection;

    delete newState.lastResetAt;

    delete newState.lastResetBasisRate;

    delete newState.totalResets;

    states[symbol] = newState;

    migrated++;
  }

  return migrated;
}

// ========================================
// LOAD EXTREME STATE
// ========================================

export function loadExtremeState() {

  fs.mkdirSync(config.DATA_DIR, {
    recursive: true
  });

  if (!fs.existsSync(STATE_FILE)) {

    states = {};

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

    const migrated =
      migrateExtremeState();

    if (migrated > 0) {

      saveExtremeState();

      log(
        `[EXTREME STATE MIGRATE] Đã cập nhật ${migrated} coin`
      );
    }

    const stats =
      getExtremeStateStats();

    log(
      `[EXTREME STATE] Đã tải ${stats.total} coin`
    );

    log(
      `[EXTREME STATE] Positive Locked: ${stats.lockedPositive}`
    );

    log(
      `[EXTREME STATE] Negative Locked: ${stats.lockedNegative}`
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

    states[symbol] =
      createDefaultState();
  }

  return states[symbol];
}

// ========================================
// CHECK EXTREME LOCK
// ========================================

export function isExtremeLocked(
  state,
  direction
) {

  validateDirection(direction);

  if (direction === "positive") {

    return state.positiveLocked === true;
  }

  return state.negativeLocked === true;
}

// ========================================
// LOCK EXTREME SYMBOL
// ========================================

export function lockExtremeState(
  state,
  alert
) {

  const direction =
    alert.direction;

  validateDirection(direction);

  if (
    isExtremeLocked(
      state,
      direction
    )
  ) {
    return false;
  }

  const basisRate =
    Number(alert.basisRate);

  if (!Number.isFinite(basisRate)) {

    throw new Error(
      "Extreme lockedBasisRate không hợp lệ"
    );
  }

  const lockedAt = Number(
    alert.detectedAt || Date.now()
  );

  // ========================================
  // LOCK POSITIVE
  // ========================================

  if (direction === "positive") {

    state.positiveLocked = true;

    state.positiveLockedAt =
      lockedAt;

    state.positiveLockedBasisRate =
      basisRate;

    return true;
  }

  // ========================================
  // LOCK NEGATIVE
  // ========================================

  state.negativeLocked = true;

  state.negativeLockedAt =
    lockedAt;

  state.negativeLockedBasisRate =
    basisRate;

  return true;
}

// ========================================
// UNLOCK EXTREME SYMBOL
// ========================================

export function unlockExtremeState(
  state,
  direction,
  basisRate,
  timestamp = Date.now()
) {

  validateDirection(direction);

  if (
    !isExtremeLocked(
      state,
      direction
    )
  ) {
    return false;
  }

  if (
    basisRate === null ||
    basisRate === undefined
  ) {
    return false;
  }

  const rate =
    Number(basisRate);

  if (!Number.isFinite(rate)) {

    return false;
  }

  // ========================================
  // RESET POSITIVE
  // ========================================

  if (direction === "positive") {

    // Reset khi Basis < +1%

    if (
      rate >=
      config.BASIS_POSITIVE_RESET_PERCENT
    ) {
      return false;
    }

    state.positiveLocked = false;

    state.positiveLockedAt = 0;

    state.positiveLockedBasisRate = null;

    state.positiveLastResetAt =
      Number(timestamp);

    state.positiveLastResetBasisRate =
      rate;

    state.positiveTotalResets =
      Number(state.positiveTotalResets || 0) + 1;

    return true;
  }

  // ========================================
  // RESET NEGATIVE
  // ========================================

  // Reset khi Basis > -2%

  if (
    rate <=
    -config.BASIS_NEGATIVE_RESET_PERCENT
  ) {
    return false;
  }

  state.negativeLocked = false;

  state.negativeLockedAt = 0;

  state.negativeLockedBasisRate = null;

  state.negativeLastResetAt =
    Number(timestamp);

  state.negativeLastResetBasisRate =
    rate;

  state.negativeTotalResets =
    Number(state.negativeTotalResets || 0) + 1;

  return true;
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

  const direction =
    alert.direction;

  validateDirection(direction);

  const candleOpenTime =
    Number(alert.candleOpenTime);

  if (
    !Number.isFinite(candleOpenTime) ||
    candleOpenTime <= 0
  ) {
    throw new Error(
      "Extreme candleOpenTime không hợp lệ"
    );
  }

  // ========================================
  // CHECK DIRECTION LOCK
  // ========================================

  if (
    isExtremeLocked(
      state,
      direction
    )
  ) {
    return false;
  }

  // ========================================
  // CHECK ALERT ALREADY SENT
  // ========================================

  if (
    isExtremeAlertSent(
      state,
      candleOpenTime
    )
  ) {
    return false;
  }

  // ========================================
  // CHECK DUPLICATE PENDING ALERT
  // ========================================

  const exists = state.pendingAlerts.some(
    item =>
      Number(item.candleOpenTime) ===
      candleOpenTime
  );

  if (exists) {

    return false;
  }

  // ========================================
  // VALIDATE BASIS RATE
  // ========================================

  const basisRate =
    Number(alert.basisRate);

  if (!Number.isFinite(basisRate)) {

    throw new Error(
      "Extreme Basis Rate không hợp lệ"
    );
  }

  // ========================================
  // ADD ALERT TO QUEUE
  // ========================================

  state.pendingAlerts.push({

    ...alert,

    candleOpenTime,

    basisRate
  });

  state.pendingAlerts.sort(
    (a, b) =>
      a.candleOpenTime -
      b.candleOpenTime
  );

  // ========================================
  // LOCK DIRECTION IMMEDIATELY
  // ========================================

  lockExtremeState(
    state,
    alert
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

  const candleOpenTime =
    Number(alert.candleOpenTime);

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

  state.totalAlerts =
    Number(state.totalAlerts || 0) + 1;

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

  const values =
    Object.values(states);

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

    // ========================================
    // LOCK STATISTICS
    // ========================================

    locked: values.filter(
      item =>
        item.positiveLocked === true ||
        item.negativeLocked === true
    ).length,

    unlocked: values.filter(
      item =>
        item.positiveLocked !== true &&
        item.negativeLocked !== true
    ).length,

    lockedPositive: values.filter(
      item =>
        item.positiveLocked === true
    ).length,

    lockedNegative: values.filter(
      item =>
        item.negativeLocked === true
    ).length,

    // ========================================
    // RESET STATISTICS
    // ========================================

    positiveResets: values.reduce(
      (sum, item) =>
        sum + Number(item.positiveTotalResets || 0),
      0
    ),

    negativeResets: values.reduce(
      (sum, item) =>
        sum + Number(item.negativeTotalResets || 0),
      0
    ),

    totalResets: values.reduce(
      (sum, item) =>
        sum +
        Number(item.positiveTotalResets || 0) +
        Number(item.negativeTotalResets || 0) +
        Number(item.legacyTotalResets || 0),
      0
    ),

    // ========================================
    // ALERT STATISTICS
    // ========================================

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