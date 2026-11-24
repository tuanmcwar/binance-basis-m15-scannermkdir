import {
  config,
  log,
  formatTime
} from "./config.js";

import {
  getServerTime
} from "./binance.js";

import {
  runScan
} from "./scanner.js";

let timer = null;
let stopped = false;
let lastBoundary = 0;

function getReadyBoundary(now) {
  const delay =
    config.SCAN_DELAY_SECONDS * 1000;

  return (
    Math.floor(
      (now - delay) / config.INTERVAL_MS
    ) * config.INTERVAL_MS
  );
}

async function scheduleNext() {
  if (stopped) return;

  try {
    const serverTime = await getServerTime();

    if (stopped) return;

    const readyBoundary =
      getReadyBoundary(serverTime);

    const nextBoundary =
      readyBoundary + config.INTERVAL_MS;

    const nextScan =
      nextBoundary +
      config.SCAN_DELAY_SECONDS * 1000;

    const wait = Math.max(
      100,
      nextScan - serverTime
    );

    log(
      `[NEXT SCAN] ${formatTime(nextScan)}`
    );

    timer = setTimeout(async () => {
      if (stopped) return;

      try {
        const now = await getServerTime();

        const boundary =
          getReadyBoundary(now);

        if (boundary > lastBoundary) {
          await runScan(boundary);

          lastBoundary = boundary;
        }

      } catch (error) {
        log(
          `[SCHEDULER ERROR] ${error.message}`
        );
      }

      await scheduleNext();

    }, wait);

  } catch (error) {
    log(
      `[SCHEDULE ERROR] ${error.message}`
    );

    if (!stopped) {
      timer = setTimeout(
        scheduleNext,
        10000
      );
    }
  }
}

export async function startScheduler() {
  stopped = false;

  if (config.SCAN_ON_START) {
    try {
      const now = await getServerTime();

      const boundary =
        getReadyBoundary(now);

      await runScan(boundary);

      lastBoundary = boundary;

    } catch (error) {
      log(
        `[INITIAL SCAN ERROR] ${error.message}`
      );
    }
  }

  await scheduleNext();
}

export function stopScheduler() {
  stopped = true;

  if (timer) {
    clearTimeout(timer);
  }

  log("[SCHEDULER] Đã dừng");
}
