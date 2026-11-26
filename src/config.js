import "dotenv/config";

function num(name, fallback) {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isFinite(value)) {
    throw new Error(`Config không hợp lệ: ${name}`);
  }

  return value;
}

function bool(name, fallback) {
  return String(
    process.env[name] ?? fallback
  ).toLowerCase() === "true";
}

export const config = {

  // ========================================
  // BINANCE API
  // ========================================

  BINANCE_BASE_URL: (
    process.env.BINANCE_BASE_URL ||
    "https://fapi.binance.com"
  ).replace(/\/+$/, ""),

  // ========================================
  // TELEGRAM
  // ========================================

  TELEGRAM_BOT_TOKEN:
    process.env.TELEGRAM_BOT_TOKEN,

  TELEGRAM_CHAT_ID:
    process.env.TELEGRAM_CHAT_ID,

  // ========================================
  // TIMEFRAME
  // ========================================

  TIMEFRAME:
    process.env.TIMEFRAME || "15m",

  TIMEZONE:
    process.env.TIMEZONE || "Asia/Ho_Chi_Minh",

  // ========================================
  // STRATEGY 1 - BASIS RECOVERY
  // ========================================

  BASIS_RECOVERY_ENABLED:
    bool("BASIS_RECOVERY_ENABLED", true),

  BASIS_TRIGGER_PERCENT:
    num("BASIS_TRIGGER_PERCENT", 3),

  BASIS_TRIGGER_MIN_CANDLES:
    num("BASIS_TRIGGER_MIN_CANDLES", 2),

  BASIS_TRIGGER_CONSECUTIVE:
    bool("BASIS_TRIGGER_CONSECUTIVE", true),

  BASIS_RECOVERY_PERCENT:
    num("BASIS_RECOVERY_PERCENT", 2),

  BASIS_DIRECTION:
    (process.env.BASIS_DIRECTION || "both")
      .toLowerCase(),

  ALERT_COOLDOWN_HOURS:
    num("ALERT_COOLDOWN_HOURS", 10),

  // ========================================
  // STRATEGY 2 - BASIS EXTREME
  // ========================================

  BASIS_EXTREME_ENABLED:
    bool("BASIS_EXTREME_ENABLED", true),

  // POSITIVE BASIS

  BASIS_POSITIVE_THRESHOLD:
    num("BASIS_POSITIVE_THRESHOLD", 2),

  BASIS_POSITIVE_RESET_PERCENT:
    num("BASIS_POSITIVE_RESET_PERCENT", 1),

  // NEGATIVE BASIS

  BASIS_NEGATIVE_THRESHOLD:
    num("BASIS_NEGATIVE_THRESHOLD", -5),

  BASIS_NEGATIVE_RESET_PERCENT:
    num("BASIS_NEGATIVE_RESET_PERCENT", 2),

  // ========================================
  // SCANNER
  // ========================================

  SCAN_DELAY_SECONDS:
    num("SCAN_DELAY_SECONDS", 30),

  SCAN_ON_START:
    bool("SCAN_ON_START", true),

  CONCURRENCY:
    num("CONCURRENCY", 5),

  // ========================================
  // API SETTINGS
  // ========================================

  API_TIMEOUT_MS:
    num("API_TIMEOUT_MS", 15000),

  API_RETRIES:
    num("API_RETRIES", 3),

  API_WEIGHT_PER_MINUTE:
    num("API_WEIGHT_PER_MINUTE", 1800),

  // ========================================
  // CHART SETTINGS
  // ========================================

  CHART_CANDLE_COUNT:
    num("CHART_CANDLE_COUNT", 20),

  CHART_GAP_PERCENT:
    num("CHART_GAP_PERCENT", 1),

  CHART_WIDTH:
    num("CHART_WIDTH", 1600),

  CHART_HEIGHT:
    num("CHART_HEIGHT", 900),

  // ========================================
  // CHART LAYOUT
  // ========================================

  CHART_HEADER_PERCENT:
    num("CHART_HEADER_PERCENT", 15),

  CHART_PRICE_PERCENT:
    num("CHART_PRICE_PERCENT", 70),

  CHART_FUNDING_PERCENT:
    num("CHART_FUNDING_PERCENT", 15),

  // ========================================
  // FUNDING RATE CHART
  // ========================================

  SHOW_FUNDING_CHART:
    bool("SHOW_FUNDING_CHART", true),

  FUNDING_DECIMALS:
    num("FUNDING_DECIMALS", 4),

  // ========================================
  // DATA STORAGE
  // ========================================

  DATA_DIR:
    process.env.DATA_DIR || "./data",

  // ========================================
  // FUNDING WEBSOCKET
  // ========================================

  FUNDING_WS_ENABLED:
    bool("FUNDING_WS_ENABLED", true),

  FUNDING_WS_URL:
    process.env.FUNDING_WS_URL ||
    "wss://fstream.binance.com/market/ws/!markPrice@arr@1s",

  FUNDING_WS_RECONNECT_SECONDS:
    num("FUNDING_WS_RECONNECT_SECONDS", 5),

  FUNDING_WS_STALE_SECONDS:
    num("FUNDING_WS_STALE_SECONDS", 30),

  FUNDING_HISTORY_LIMIT:
    num("FUNDING_HISTORY_LIMIT", 20),
};

// ========================================
// TIMEFRAME INTERVALS
// ========================================

const intervals = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000
};

config.INTERVAL_MS =
  intervals[config.TIMEFRAME];

config.COOLDOWN_MS =
  config.ALERT_COOLDOWN_HOURS *
  60 * 60 * 1000;

// ========================================
// VALIDATE TELEGRAM
// ========================================

if (!config.TELEGRAM_BOT_TOKEN) {
  throw new Error("Thiếu TELEGRAM_BOT_TOKEN");
}

if (!config.TELEGRAM_CHAT_ID) {
  throw new Error("Thiếu TELEGRAM_CHAT_ID");
}

// ========================================
// VALIDATE TIMEFRAME
// ========================================

if (!config.INTERVAL_MS) {
  throw new Error("TIMEFRAME không hợp lệ");
}

// ========================================
// VALIDATE STRATEGIES
// ========================================

if (
  !config.BASIS_RECOVERY_ENABLED &&
  !config.BASIS_EXTREME_ENABLED
) {
  throw new Error(
    "Phải bật ít nhất một chiến lược Basis"
  );
}

// ========================================
// VALIDATE BASIS RECOVERY
// ========================================

if (config.BASIS_RECOVERY_ENABLED) {

  if (
    config.BASIS_RECOVERY_PERCENT <= 0 ||
    config.BASIS_RECOVERY_PERCENT >=
      config.BASIS_TRIGGER_PERCENT
  ) {
    throw new Error(
      "Ngưỡng Basis Recovery không hợp lệ"
    );
  }

  if (
    !["both", "positive", "negative"].includes(
      config.BASIS_DIRECTION
    )
  ) {
    throw new Error(
      "BASIS_DIRECTION không hợp lệ"
    );
  }

  if (!config.BASIS_TRIGGER_CONSECUTIVE) {
    throw new Error(
      "Basis Recovery yêu cầu các nến liên tiếp"
    );
  }

  if (
    !Number.isInteger(
      config.BASIS_TRIGGER_MIN_CANDLES
    ) ||
    config.BASIS_TRIGGER_MIN_CANDLES < 1
  ) {
    throw new Error(
      "BASIS_TRIGGER_MIN_CANDLES không hợp lệ"
    );
  }

  if (config.ALERT_COOLDOWN_HOURS < 0) {
    throw new Error(
      "ALERT_COOLDOWN_HOURS không hợp lệ"
    );
  }
}

// ========================================
// VALIDATE BASIS EXTREME
// ========================================

if (config.BASIS_EXTREME_ENABLED) {

  // POSITIVE THRESHOLD

  if (config.BASIS_POSITIVE_THRESHOLD <= 0) {
    throw new Error(
      "BASIS_POSITIVE_THRESHOLD phải lớn hơn 0"
    );
  }

  // NEGATIVE THRESHOLD

  if (config.BASIS_NEGATIVE_THRESHOLD >= 0) {
    throw new Error(
      "BASIS_NEGATIVE_THRESHOLD phải bé hơn 0"
    );
  }

  // POSITIVE RESET

  if (
    config.BASIS_POSITIVE_RESET_PERCENT <= 0 ||

    config.BASIS_POSITIVE_RESET_PERCENT >=
      config.BASIS_POSITIVE_THRESHOLD
  ) {
    throw new Error(
      "BASIS_POSITIVE_RESET_PERCENT không hợp lệ"
    );
  }

  // NEGATIVE RESET

  if (
    config.BASIS_NEGATIVE_RESET_PERCENT <= 0 ||

    config.BASIS_NEGATIVE_RESET_PERCENT >=
      Math.abs(config.BASIS_NEGATIVE_THRESHOLD)
  ) {
    throw new Error(
      "BASIS_NEGATIVE_RESET_PERCENT không hợp lệ"
    );
  }
}

// ========================================
// VALIDATE SCANNER
// ========================================

if (
  !Number.isInteger(config.CONCURRENCY) ||

  config.CONCURRENCY < 1 ||

  !Number.isInteger(config.CHART_CANDLE_COUNT) ||

  config.CHART_CANDLE_COUNT < 2 ||

  config.CHART_CANDLE_COUNT > 500 ||

  config.API_WEIGHT_PER_MINUTE < 20 ||

  config.SCAN_DELAY_SECONDS < 0 ||

  config.SCAN_DELAY_SECONDS * 1000 >=
    config.INTERVAL_MS
) {
  throw new Error(
    "Thông số scanner không hợp lệ"
  );
}

// ========================================
// VALIDATE CHART SIZE
// ========================================

if (
  !Number.isInteger(config.CHART_WIDTH) ||
  !Number.isInteger(config.CHART_HEIGHT) ||
  config.CHART_WIDTH < 800 ||
  config.CHART_HEIGHT < 600
) {
  throw new Error(
    "Kích thước biểu đồ không hợp lệ"
  );
}

// ========================================
// VALIDATE CHART LAYOUT
// ========================================

const chartTotalPercent =
  config.CHART_HEADER_PERCENT +
  config.CHART_PRICE_PERCENT +
  config.CHART_FUNDING_PERCENT;

if (
  config.CHART_HEADER_PERCENT <= 0 ||
  config.CHART_PRICE_PERCENT <= 0 ||
  config.CHART_FUNDING_PERCENT <= 0 ||
  Math.abs(chartTotalPercent - 100) > 0.000001
) {
  throw new Error(
    "Tổng tỷ lệ các phần biểu đồ phải bằng 100%"
  );
}

// ========================================
// CALCULATE CHART HEIGHTS
// ========================================

config.CHART_HEADER_HEIGHT = Math.round(
  config.CHART_HEIGHT *
  config.CHART_HEADER_PERCENT / 100
);

config.CHART_PRICE_HEIGHT = Math.round(
  config.CHART_HEIGHT *
  config.CHART_PRICE_PERCENT / 100
);

config.FUNDING_CHART_HEIGHT =
  config.CHART_HEIGHT -
  config.CHART_HEADER_HEIGHT -
  config.CHART_PRICE_HEIGHT;

// ========================================
// VALIDATE FUNDING CHART
// ========================================

if (
  !Number.isInteger(config.FUNDING_DECIMALS) ||
  config.FUNDING_DECIMALS < 0 ||
  config.FUNDING_DECIMALS > 8
) {
  throw new Error(
    "FUNDING_DECIMALS không hợp lệ"
  );
}

if (
  config.SHOW_FUNDING_CHART &&
  config.FUNDING_CHART_HEIGHT < 120
) {
  throw new Error(
    "Chiều cao Funding Chart phải >= 120px"
  );
}

// ========================================
// FORMAT TIME
// ========================================

export function formatTime(
  timestamp = Date.now()
) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: config.TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hourCycle: "h23"
  }).format(new Date(timestamp));
}

// ========================================
// LOGGER
// ========================================

export function log(message) {
  console.log(
    `[${formatTime()}] ${message}`
  );
}