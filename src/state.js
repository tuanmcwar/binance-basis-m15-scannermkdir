import fs from "node:fs";
import path from "node:path";
import { config, log } from "./config.js";

const STATE_FILE = path.join(
  config.DATA_DIR,
  "basis-state.json"
);

const TEMP_FILE = `${STATE_FILE}.${process.pid}.tmp`;

let states = {};

const waitBuffer = new Int32Array(
  new SharedArrayBuffer(4)
);

export function loadState() {
  fs.mkdirSync(config.DATA_DIR, {
    recursive: true
  });

  if (!fs.existsSync(STATE_FILE)) {
    saveState();
    log("[STATE] Tạo dữ liệu mới");
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
      throw new Error("State không hợp lệ");
    }

    states = parsed;

    log(
      `[STATE] Đã tải ${Object.keys(states).length} coin`
    );

  } catch (error) {
    throw new Error(
      `Không đọc được state: ${error.message}`
    );
  }
}

export function saveState() {
  fs.mkdirSync(config.DATA_DIR, {
    recursive: true
  });

  fs.writeFileSync(
    TEMP_FILE,
    JSON.stringify(states, null, 2),
    "utf8"
  );

  for (let attempt = 1; attempt <= 5; attempt++) {
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

      if (!retryable || attempt === 5) {
        throw error;
      }

      log(
        `[STATE RETRY] ${attempt}/5 | ${error.code}`
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

export function resetCycle(state) {
  state.consecutiveCount = 0;
  state.direction = null;
  state.armed = false;
  state.armedAt = 0;
  state.peakBasis = 0;
}

export function isCooldown(state) {
  if (!state.lastAlertAt) return false;

  return (
    Date.now() - state.lastAlertAt <
    config.COOLDOWN_MS
  );
}

export function markAlertSent(state) {
  state.lastAlertAt = Date.now();
  state.pendingAlert = null;

  saveState();
}

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