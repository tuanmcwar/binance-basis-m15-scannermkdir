
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

// ==========================================
// FUNDING STORAGE
// ==========================================

const DATA_DIR = path.resolve(
  config.DATA_DIR || process.env.DATA_DIR || "./data"
);

const FUNDING_FILE = path.join(
  DATA_DIR,
  `funding-history-${config.TIMEFRAME}.json`
);

const MAX_HISTORY = Math.max(
  1,
  Math.trunc(config.FUNDING_HISTORY_LIMIT || 20)
);

let history = {};
let loaded = false;
let dirty = false;

// ==========================================
// LOAD HISTORY
// ==========================================

function loadFundingHistory() {
  if (loaded) return;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(FUNDING_FILE)) {
  history = {};

  fs.writeFileSync(
    FUNDING_FILE,
    JSON.stringify(history),
    "utf8"
  );

  loaded = true;

  console.log(
    `[FUNDING] Đã tạo file: ${FUNDING_FILE}`
  );

  return;
}

  try {
    history = JSON.parse(
      fs.readFileSync(FUNDING_FILE, "utf8")
    );

    if (
      !history ||
      typeof history !== "object" ||
      Array.isArray(history)
    ) {
      throw new Error("Funding history không hợp lệ");
    }

    for (const symbol of Object.keys(history)) {
      const item = history[symbol];

      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item)
      ) {
        delete history[symbol];
        dirty = true;
        continue;
      }

      trimHistory(symbol);
    }

    loaded = true;

    console.log(
      `[FUNDING] Đã tải lịch sử ${Object.keys(history).length} coin`
    );

  } catch (error) {
    console.error(
      `[FUNDING LOAD ERROR] ${error.message}`
    );

    // Giữ lại file lỗi để kiểm tra.
    fs.copyFileSync(
      FUNDING_FILE,
      `${FUNDING_FILE}.corrupt-${Date.now()}`
    );

    history = {};
    loaded = true;
  }
}

// ==========================================
// KEEP LAST 20 CANDLES
// ==========================================

function trimHistory(symbol) {
  const symbolHistory = history[symbol];

  if (!symbolHistory) return;

  const timestamps = Object.keys(symbolHistory)
    .sort((a, b) => Number(a) - Number(b));

  while (timestamps.length > MAX_HISTORY) {
    const oldest = timestamps.shift();

    delete symbolHistory[oldest];

    dirty = true;
  }
}

// ==========================================
// SAVE HISTORY
// ==========================================

export function saveFundingHistory() {
  loadFundingHistory();

  if (!dirty) return;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const tempFile =
    `${FUNDING_FILE}.${process.pid}.tmp`;

  try {
    fs.writeFileSync(
      tempFile,
      JSON.stringify(history),
      "utf8"
    );

    fs.renameSync(tempFile, FUNDING_FILE);

    dirty = false;

  } catch (error) {
    console.error(
      `[FUNDING SAVE ERROR] ${error.message}`
    );
  }
}

// ==========================================
// STORE CLOSED CANDLE FUNDING
// ==========================================

export function storeFundingBatch(
  candleOpenTime,
  fundingMap
) {
  loadFundingHistory();

  let savedCount = 0;

  for (const [symbol, funding] of fundingMap) {
    const rate = Number(funding.rate);
    const sampledAt = Number(funding.sampledAt);

    if (!Number.isFinite(rate)) continue;
    if (!Number.isFinite(sampledAt)) continue;

    if (!history[symbol]) {
      history[symbol] = {};
    }

    const key = String(candleOpenTime);

    const existing = history[symbol][key];

    if (
      existing &&
      Number(existing.sampledAt) >= sampledAt
    ) {
      continue;
    }

    history[symbol][key] = {
      rate,
      sampledAt,
      source: "websocket"
    };

    dirty = true;

    trimHistory(symbol);

    savedCount++;
  }

  saveFundingHistory();

  return savedCount;
}

// ==========================================
// GET FUNDING FOR CHART
// ==========================================

export function getFundingRate(
  symbol,
  candleOpenTime
) {
  loadFundingHistory();

  const item =
    history[symbol]?.[String(candleOpenTime)];

  if (!item) return null;

  const value = Number(item.rate);

  return Number.isFinite(value)
    ? value
    : null;
}

// ==========================================
// FUNDING STATISTICS
// ==========================================

export function getFundingStats() {
  loadFundingHistory();

  const symbols = Object.keys(history);

  let totalRecords = 0;
  let completedSymbols = 0;

  for (const symbol of symbols) {
    const count = Object.keys(
      history[symbol]
    ).length;

    totalRecords += count;

    if (count >= MAX_HISTORY) {
      completedSymbols++;
    }
  }

  let fileSizeKB = 0;

  if (fs.existsSync(FUNDING_FILE)) {
    fileSizeKB =
      fs.statSync(FUNDING_FILE).size / 1024;
  }

  return {
    symbols: symbols.length,
    totalRecords,
    completedSymbols,
    maxHistory: MAX_HISTORY,
    fileSizeKB: fileSizeKB.toFixed(2)
  };
}
