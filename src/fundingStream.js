
import WebSocket from "ws";

import { config } from "./config.js";

import {
  storeFundingBatch,
  saveFundingHistory,
  getFundingStats
} from "./funding.js";

// ==========================================
// SETTINGS
// ==========================================

const WS_URL = config.FUNDING_WS_URL;

const INTERVAL_MS = config.INTERVAL_MS;

const RECONNECT_MS = Math.max(
  1000,
  config.FUNDING_WS_RECONNECT_SECONDS * 1000
);

const STALE_MS = Math.max(
  5000,
  config.FUNDING_WS_STALE_SECONDS * 1000
);

// Chờ thêm 3 giây để nhận các event
// cuối nến có thể đến trễ.

const FINALIZE_DELAY_MS = 3000;

// ==========================================
// RUNTIME
// ==========================================

let ws = null;

let running = false;

let reconnectTimer = null;
let monitorTimer = null;

let lastMessageAt = 0;
let totalUpdates = 0;

let connectedAt = 0;

// Map theo thời gian mở nến.
//
// candleOpenTime => Map(
//   symbol => { rate, sampledAt }
// )

const candleBuckets = new Map();

let allowedSymbols = new Set();

// ==========================================
// TIME FORMAT
// ==========================================

function formatTime(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleString(
    "vi-VN",
    {
      timeZone:
        config.TIMEZONE || "Asia/Ho_Chi_Minh",

      hour12: false
    }
  );
}

function log(message) {
  console.log(
    `[${formatTime()}] ${message}`
  );
}

// ==========================================
// UPDATE SYMBOL FILTER
// ==========================================

export function setFundingSymbols(instruments) {
  allowedSymbols = new Set(
    instruments.map(item =>
      typeof item === "string"
        ? item
        : item.symbol
    )
  );

  log(
    `[FUNDING WS] Theo dõi ${allowedSymbols.size} coin`
  );
}

// ==========================================
// SYMBOL VALIDATION
// ==========================================

function isValidSymbol(symbol) {
  if (typeof symbol !== "string") {
    return false;
  }

  if (allowedSymbols.size > 0) {
    return allowedSymbols.has(symbol);
  }

  // Dùng tạm trước khi scanner tải exchangeInfo.
  return symbol.endsWith("USDT");
}

// ==========================================
// PROCESS FUNDING UPDATE
// ==========================================

function processFundingUpdate(item) {
  if (!item || item.e !== "markPriceUpdate") {
    return;
  }

  const symbol = item.s;

  if (!isValidSymbol(symbol)) {
    return;
  }

  if (
    item.r === undefined ||
    item.r === null ||
    item.r === ""
  ) {
    return;
  }

  const rate = Number(item.r) * 100;

  const eventTime = Number(item.E);

  if (!Number.isFinite(rate)) return;
  if (!Number.isFinite(eventTime)) return;

  // Xác định nến dựa trên thời gian Binance,
  // không dựa trên thời điểm nhận message.

  const candleOpenTime =
    Math.floor(eventTime / INTERVAL_MS) *
    INTERVAL_MS;

  const candleCloseTime =
    candleOpenTime + INTERVAL_MS;

  // Bỏ event quá cũ hoặc timestamp bất thường.

  if (
    Date.now() >
    candleCloseTime + FINALIZE_DELAY_MS
  ) {
    return;
  }

  if (eventTime > Date.now() + 10000) {
    return;
  }

  let bucket =
    candleBuckets.get(candleOpenTime);

  if (!bucket) {
    bucket = new Map();

    candleBuckets.set(
      candleOpenTime,
      bucket
    );
  }

  const previous = bucket.get(symbol);

  // Chỉ giữ Funding mới nhất trong nến.

  if (
    previous &&
    previous.sampledAt >= eventTime
  ) {
    return;
  }

  bucket.set(symbol, {
    rate,
    sampledAt: eventTime
  });

  totalUpdates++;

if (
  totalUpdates === 1 ||
  totalUpdates % 10000 === 0
) {
  log(
    `[FUNDING WS DATA] ` +
    `Updates: ${totalUpdates} | ` +
    `Coin: ${symbol} | ` +
    `Funding: ${rate.toFixed(6)}% | ` +
    `Buckets: ${candleBuckets.size}`
  );
}
}

// ==========================================
// FINALIZE CLOSED CANDLES
// ==========================================

function finalizeClosedCandles() {
  const now = Date.now();

  for (
    const [candleOpenTime, bucket]
    of candleBuckets
  ) {
    const candleCloseTime =
      candleOpenTime + INTERVAL_MS;

    if (
      now <
      candleCloseTime + FINALIZE_DELAY_MS
    ) {
      continue;
    }

    const validFunding = new Map();

    for (const [symbol, funding] of bucket) {

      if (!isValidSymbol(symbol)) {
        continue;
      }

      const ageAtClose =
        candleCloseTime - funding.sampledAt;

      // Không lưu Funding quá cũ nếu WS mất
      // kết nối trước khi nến đóng.

      if (
        ageAtClose < 0 ||
        ageAtClose > STALE_MS
      ) {
        continue;
      }

      validFunding.set(symbol, funding);
    }

    const savedCount = storeFundingBatch(
      candleOpenTime,
      validFunding
    );

    candleBuckets.delete(candleOpenTime);

    const stats = getFundingStats();

    log(
      `[FUNDING SAVE] ${formatTime(candleOpenTime)}`
    );

    log(
      `[FUNDING] Đã lưu ${savedCount}/${allowedSymbols.size || bucket.size} coin`
    );

    log(
      `[FUNDING HISTORY] ${stats.totalRecords} bản ghi`
    );

    log(
      `[FUNDING READY] ${stats.completedSymbols}/${stats.symbols} coin đủ ${stats.maxHistory} nến`
    );

    log(
      `[FUNDING SIZE] ${stats.fileSizeKB} KB`
    );
  }

  // Thử lưu lại nếu lần ghi file trước thất bại.
  saveFundingHistory();
}

// ==========================================
// RECONNECT
// ==========================================

function scheduleReconnect() {
  if (!running) return;
  if (reconnectTimer) return;

  log(
    `[FUNDING WS] Reconnect sau ${RECONNECT_MS / 1000}s`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    connectWebSocket();

  }, RECONNECT_MS);
}

// ==========================================
// CONNECT WEBSOCKET
// ==========================================

function connectWebSocket() {
  if (!running) return;

  if (
    ws &&
    (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  log("[FUNDING WS] Đang kết nối Binance...");

  const socket = new WebSocket(WS_URL, {
    handshakeTimeout: 15000
  });

  ws = socket;

  socket.on("open", () => {
    if (ws !== socket) return;

    connectedAt = Date.now();
    lastMessageAt = Date.now();

    log("[FUNDING WS] CONNECTED");
  });

  socket.on("message", raw => {
    if (ws !== socket || !running) return;

    lastMessageAt = Date.now();

    try {
      const payload = JSON.parse(
        raw.toString()
      );

      const data = payload.data ?? payload;

      if (Array.isArray(data)) {
        for (const item of data) {
          processFundingUpdate(item);
        }

      } else {
        processFundingUpdate(data);
      }

    } catch (error) {
      log(
        `[FUNDING WS ERROR] ${error.message}`
      );
    }
  });

  // Thư viện ws tự phản hồi pong
  // khi nhận ping từ Binance.

  socket.on("error", error => {
    if (ws !== socket) return;

    log(
      `[FUNDING WS ERROR] ${error.message}`
    );

    socket.terminate();
  });

  socket.on("close", (code, reason) => {
    if (ws !== socket) return;

    ws = null;

    log(
      `[FUNDING WS] DISCONNECTED | Code: ${code}`
    );

    if (reason?.length) {
      log(
        `[FUNDING WS] ${reason.toString()}`
      );
    }

    scheduleReconnect();
  });
}

// ==========================================
// MONITOR
// ==========================================

function monitor() {
  try {
    finalizeClosedCandles();

    if (
      ws &&
      ws.readyState === WebSocket.OPEN
    ) {
      const inactiveTime =
        Date.now() - lastMessageAt;

      if (inactiveTime > STALE_MS) {
        log(
          "[FUNDING WS] Mất dữ liệu, đang reconnect..."
        );

        ws.terminate();
      }
    }

  } catch (error) {
    log(
      `[FUNDING MONITOR ERROR] ${error.message}`
    );
  }
}

// ==========================================
// START
// ==========================================

export function startFundingStream() {
  if (!config.FUNDING_WS_ENABLED) {
    log("[FUNDING WS] DISABLED");
    return;
  }

  if (running) return;

  if (
    !Number.isFinite(INTERVAL_MS) ||
    INTERVAL_MS <= 0
  ) {
    throw new Error(
      "Funding INTERVAL_MS không hợp lệ"
    );
  }

  running = true;

  const stats = getFundingStats();

  log("====================================");
  log("[FUNDING WS] START");
  log(`[TIMEFRAME] ${config.TIMEFRAME}`);
  log(`[HISTORY LIMIT] ${stats.maxHistory}`);
  log(`[SAVED SYMBOLS] ${stats.symbols}`);
  log(`[SAVED RECORDS] ${stats.totalRecords}`);
  log(`[FILE SIZE] ${stats.fileSizeKB} KB`);
  log("====================================");

  connectWebSocket();

  monitorTimer = setInterval(
    monitor,
    1000
  );
}

// ==========================================
// STOP
// ==========================================

export function stopFundingStream() {
  running = false;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }

  // Chỉ lưu các nến đã đóng.
  // Không lưu nến đang chạy thành nến hoàn chỉnh.

  finalizeClosedCandles();

  if (ws) {
    const socket = ws;

    ws = null;

    socket.terminate();
  }

  saveFundingHistory();

  candleBuckets.clear();

  log("[FUNDING WS] STOPPED");
}

// ==========================================
// STATUS
// ==========================================

export function getFundingStreamStatus() {
  const stats = getFundingStats();

  return {
    enabled: config.FUNDING_WS_ENABLED,

    connected:
      ws?.readyState === WebSocket.OPEN,

    connectedAt,

    lastMessageAt,

    totalUpdates,

    activeBuckets: candleBuckets.size,

    trackedSymbols: allowedSymbols.size,

    ...stats
  };
}
