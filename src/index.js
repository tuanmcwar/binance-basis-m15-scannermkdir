import {
  config,
  log
} from "./config.js";

// ========================================
// FUNDING WEBSOCKET
// ========================================

import {
  startFundingStream,
  stopFundingStream
} from "./fundingStream.js";

// ========================================
// RECOVERY STATE
// ========================================

import {
  loadState,
  saveState
} from "./states/recoveryState.js";

// ========================================
// EXTREME STATE
// ========================================

import {
  loadExtremeState,
  saveExtremeState
} from "./states/extremeState.js";

// ========================================
// SCHEDULER
// ========================================

import {
  startScheduler,
  stopScheduler
} from "./scheduler.js";

// ========================================
// APPLICATION STATUS
// ========================================

let shuttingDown = false;

// ========================================
// MAIN
// ========================================

async function main() {

  console.log("");
  console.log("========================================");
  console.log("       BINANCE BASIS SCANNER");
  console.log("       RECOVERY + EXTREME");
  console.log("========================================");

  // ========================================
  // GENERAL CONFIGURATION
  // ========================================

  console.log(
    `PID             : ${process.pid}`
  );

  console.log(
    `Timeframe       : ${config.TIMEFRAME}`
  );

  console.log(
    `Scan Delay      : ${config.SCAN_DELAY_SECONDS}s`
  );

  console.log(
    `Scan On Start   : ${config.SCAN_ON_START}`
  );

  console.log(
    `Chart Candles   : ${config.CHART_CANDLE_COUNT}`
  );

  console.log(
    `Concurrency     : ${config.CONCURRENCY}`
  );

  console.log(
    `Timezone        : ${config.TIMEZONE}`
  );

  console.log(
    `Data Directory  : ${config.DATA_DIR}`
  );

  // ========================================
  // RECOVERY CONFIGURATION
  // ========================================

  console.log("----------------------------------------");
  console.log("           BASIS RECOVERY");
  console.log("----------------------------------------");

  console.log(
    `Status          : ${
      config.BASIS_RECOVERY_ENABLED
        ? "ENABLED"
        : "DISABLED"
    }`
  );

  if (config.BASIS_RECOVERY_ENABLED) {

    console.log(
      `Trigger Basis   : >= ${config.BASIS_TRIGGER_PERCENT}%`
    );

    console.log(
      `Min Candles     : ${config.BASIS_TRIGGER_MIN_CANDLES}`
    );

    console.log(
      `Consecutive     : ${config.BASIS_TRIGGER_CONSECUTIVE}`
    );

    console.log(
      `Recovery Basis  : < ${config.BASIS_RECOVERY_PERCENT}%`
    );

    console.log(
      `Direction       : ${config.BASIS_DIRECTION}`
    );

    console.log(
      `Cooldown        : ${config.ALERT_COOLDOWN_HOURS}h`
    );
  }

  // ========================================
  // EXTREME CONFIGURATION
  // ========================================

  console.log("----------------------------------------");
  console.log("           BASIS EXTREME");
  console.log("----------------------------------------");

  console.log(
    `Status          : ${
      config.BASIS_EXTREME_ENABLED
        ? "ENABLED"
        : "DISABLED"
    }`
  );

  if (config.BASIS_EXTREME_ENABLED) {

    console.log(
      `Positive Basis  : > +${config.BASIS_POSITIVE_THRESHOLD}%`
    );

    console.log(
      `Negative Basis  : < ${config.BASIS_NEGATIVE_THRESHOLD}%`
    );

    console.log(
      "Cooldown        : DISABLED"
    );

    console.log(
      "Consecutive     : NOT REQUIRED"
    );
  }

  // ========================================
  // CHART CONFIGURATION
  // ========================================

  console.log("----------------------------------------");
  console.log("         CHART CONFIGURATION");
  console.log("----------------------------------------");

  console.log(
    `Chart Size      : ${config.CHART_WIDTH} x ${config.CHART_HEIGHT}`
  );

  console.log(
    `Header          : ${config.CHART_HEADER_PERCENT}%`
  );

  console.log(
    `Futures Chart   : ${config.CHART_PRICE_PERCENT}%`
  );

  console.log(
    `Funding Chart   : ${config.CHART_FUNDING_PERCENT}%`
  );

  console.log(
    `Show Funding    : ${config.SHOW_FUNDING_CHART}`
  );

  // ========================================
  // FUNDING CONFIGURATION
  // ========================================

  console.log("----------------------------------------");
  console.log("         FUNDING WEBSOCKET");
  console.log("----------------------------------------");

  console.log(
    `Status          : ${
      config.FUNDING_WS_ENABLED
        ? "ENABLED"
        : "DISABLED"
    }`
  );

  console.log(
    `History Limit   : ${config.FUNDING_HISTORY_LIMIT} candles`
  );

  console.log(
    `Reconnect       : ${config.FUNDING_WS_RECONNECT_SECONDS}s`
  );

  console.log(
    `Stale Timeout   : ${config.FUNDING_WS_STALE_SECONDS}s`
  );

  console.log("========================================");
  console.log("");

  // ========================================
  // LOAD RECOVERY STATE
  // ========================================

  if (config.BASIS_RECOVERY_ENABLED) {

    loadState();

    log(
      "[RECOVERY STATE] READY"
    );
  }

  // ========================================
  // LOAD EXTREME STATE
  // ========================================

  if (config.BASIS_EXTREME_ENABLED) {

    loadExtremeState();

    log(
      "[EXTREME STATE] READY"
    );
  }

  // ========================================
  // REGISTER SHUTDOWN EVENTS
  // ========================================

  process.on(
    "SIGINT",
    shutdown
  );

  process.on(
    "SIGTERM",
    shutdown
  );

  // ========================================
  // START FUNDING WEBSOCKET
  // ========================================

  startFundingStream();

  // ========================================
  // START SCHEDULER
  // ========================================

  await startScheduler();
}

// ========================================
// GRACEFUL SHUTDOWN
// ========================================

function shutdown() {

  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  log("========================================");

  log(
    "[SHUTDOWN] Đang dừng bot"
  );

  let exitCode = 0;

  // ========================================
  // STOP SCHEDULER
  // ========================================

  try {

    stopScheduler();

    log(
      "[SCHEDULER] STOPPED"
    );

  } catch (error) {

    exitCode = 1;

    log(
      `[SCHEDULER ERROR] ${error.message}`
    );
  }

  // ========================================
  // SAVE RECOVERY STATE
  // ========================================

  if (config.BASIS_RECOVERY_ENABLED) {

    try {

      saveState();

      log(
        "[RECOVERY STATE] Đã lưu dữ liệu"
      );

    } catch (error) {

      exitCode = 1;

      log(
        `[RECOVERY STATE ERROR] ${error.message}`
      );
    }
  }

  // ========================================
  // SAVE EXTREME STATE
  // ========================================

  if (config.BASIS_EXTREME_ENABLED) {

    try {

      saveExtremeState();

      log(
        "[EXTREME STATE] Đã lưu dữ liệu"
      );

    } catch (error) {

      exitCode = 1;

      log(
        `[EXTREME STATE ERROR] ${error.message}`
      );
    }
  }

  // ========================================
  // STOP FUNDING WEBSOCKET
  // ========================================

  try {

    stopFundingStream();

  } catch (error) {

    exitCode = 1;

    log(
      `[FUNDING STOP ERROR] ${error.message}`
    );
  }

  // ========================================
  // EXIT
  // ========================================

  log(
    `[SHUTDOWN] Bot đã dừng | Exit code: ${exitCode}`
  );

  log("========================================");

  process.exit(exitCode);
}

// ========================================
// START APPLICATION
// ========================================

main().catch(error => {

  console.error(
    "[FATAL]",
    error.stack || error.message
  );

  try {

    stopScheduler();

  } catch (stopError) {

    console.error(
      "[SCHEDULER STOP ERROR]",
      stopError.message
    );
  }

  try {

    stopFundingStream();

  } catch (stopError) {

    console.error(
      "[FUNDING STOP ERROR]",
      stopError.message
    );
  }

  process.exit(1);
});