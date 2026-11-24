import fs from "node:fs";
import path from "node:path";
import { config, log } from "../config.js";

// ========================================
// STATE FILES
// ========================================

const STATE_FILE = path.join(
  config.DATA_DIR,
  "recovery-state.json"
);

const LEGACY_STATE_FILE = path.join(
  config.DATA_DIR,
  "basis-state.json"
);

const TEMP_FILE =
  `${STATE_FILE}.${process.pid}.tmp`;

let states = {};

const waitBuffer = new Int32Array(
  new SharedArrayBuffer(4)
);

// ========================================
// MIGRATE OLD STATE
// ========================================

function migrateOldState() {

  if (fs.existsSync(STATE_FILE)) {
    return;
  }

  if (!fs.existsSync(LEGACY_STATE_FILE)) {
    return;
  }

  const raw = fs.readFileSync(
    LEGACY_STATE_FILE,
    "utf8"
  );

  const parsed = JSON.parse(raw);

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "Recovery state cũ không hợp lệ"
    );
  }

  states = parsed;

  saveState();

  log(
    "[RECOVERY STATE] Đã chuyển dữ liệu từ basis-state.json"
  );

  log(
    `[RECOVERY STATE] Đã chuyển ${Object.keys(states).length} coin`
  );
}

// ========================================
// LOAD STATE
// ========================================

export function loadState() {

  fs.mkdirSync(config.DATA_DIR, {
    recursive: true
  });

  migrateOldState();

  if (!fs.existsSync(STATE_FILE)) {

    saveState();

    log(
      "[RECOVERY STATE] Tạo dữ liệu mới"
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
        "Recovery state không hợp lệ"
      );
    }

    states = parsed;

    log(
      `[RECOVERY STATE] Đã tải ${Object.keys(states).length} coin`
    );

  } catch (error) {

    throw new Error(
      `Không đọc được Recovery state: ${error.message}`
    );
  }
}

// ========================================
// SAVE STATE
// ========================================

export function saveState() {

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
        `[RECOVERY STATE RETRY] ${attempt}/5 | ${error.code}`
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

export function getState(symbol) {

  if (!states[symbol]) {

    states[symbol] = {

      consecutiveCount: 0,

      direction: null,

      armed: false,

      armedAt: 0,

      peakBasis: 0,

      lastProcessedOpenTime: 0,

      lastAlertAt: 0,

      pendingAlert: null
    };
  }

  return states[symbol];
}

// ========================================
// RESET RECOVERY CYCLE
// ========================================

export function resetCycle(state) {

  state.consecutiveCount = 0;

  state.direction = null;

  state.armed = false;

  state.armedAt = 0;

  state.peakBasis = 0;
}

// ========================================
// CHECK RECOVERY COOLDOWN
// ========================================

export function isCooldown(state) {

  if (!state.lastAlertAt) {
    return false;
  }

  return (
    Date.now() - state.lastAlertAt <
    config.COOLDOWN_MS
  );
}

// ========================================
// MARK ALERT SENT
// ========================================

export function markAlertSent(state) {

  state.lastAlertAt = Date.now();

  state.pendingAlert = null;

  saveState();
}

// ========================================
// RECOVERY STATE STATISTICS
// ========================================

export function getStateStats() {

  const values = Object.values(states);

  return {

    total: values.length,

    watching: values.filter(
      item => item.armed
    ).length,

    cooldown: values.filter(
      item => isCooldown(item)
    ).length,

    pending: values.filter(
      item => item.pendingAlert
    ).length
  };
}