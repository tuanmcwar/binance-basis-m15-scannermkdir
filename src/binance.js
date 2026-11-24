import axios from "axios";
import { config, log } from "./config.js";

const api = axios.create({
  baseURL: config.BINANCE_BASE_URL,
  timeout: config.API_TIMEOUT_MS
});

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

let requestCount = 0;
let usedWeight = 0;
let weightHistory = [];
let limiter = Promise.resolve();
let blockedUntil = 0;

// ========================================
// RATE LIMITER
// ========================================

function reserveWeight(weight) {
  if (weight > config.API_WEIGHT_PER_MINUTE) {
    return Promise.reject(
      new Error("Request weight vượt giới hạn cấu hình")
    );
  }

  const task = limiter.then(async () => {
    let waiting = false;

    while (true) {
      const now = Date.now();

      weightHistory = weightHistory.filter(
        item => now - item.time < 60000
      );

      const total = weightHistory.reduce(
        (sum, item) => sum + item.weight,
        0
      );

      if (now < blockedUntil) {
        const delay = blockedUntil - now;

        if (!waiting) {
          log(
            `[API WAIT] Binance Weight: ${usedWeight} | ` +
            `Chờ ${Math.ceil(delay / 1000)}s`
          );

          waiting = true;
        }

        await sleep(delay);
        continue;
      }

      if (
        total + weight <=
        config.API_WEIGHT_PER_MINUTE
      ) {
        weightHistory.push({
          time: now,
          weight
        });

        if (waiting) {
          log("[API RESUME] Tiếp tục quét");
        }

        return;
      }

      const delay = Math.max(
        100,
        weightHistory[0].time + 60000 - now
      );

      if (!waiting) {
        log(
          `[API LIMIT] Local Weight: ${total}/` +
          `${config.API_WEIGHT_PER_MINUTE} | ` +
          `Chờ ${Math.ceil(delay / 1000)}s`
        );

        waiting = true;
      }

      await sleep(delay);
    }
  });

  limiter = task.catch(() => {});

  return task;
}

// ========================================
// API REQUEST
// ========================================

async function request(
  path,
  params = {},
  weight = 1
) {
  const target =
    params.symbol ||
    params.pair ||
    path;

  for (
    let attempt = 0;
    attempt <= config.API_RETRIES;
    attempt++
  ) {
    await reserveWeight(weight);

    try {
      requestCount++;

      const response = await api.get(path, {
        params
      });

      const headerWeight = Number(
        response.headers["x-mbx-used-weight-1m"]
      );

      if (Number.isFinite(headerWeight)) {
        usedWeight = headerWeight;
      }

      if (
        usedWeight >=
        config.API_WEIGHT_PER_MINUTE
      ) {
        const wasBlocked =
          Date.now() < blockedUntil;

        blockedUntil = Math.max(
          blockedUntil,
          Date.now() + 60000
        );

        if (!wasBlocked) {
          log(
            `[API LIMIT] Binance Weight: ` +
            `${usedWeight}/${config.API_WEIGHT_PER_MINUTE}`
          );
        }
      }

      return response.data;

    } catch (error) {
      const status = error.response?.status;

      const message =
        error.response?.data?.msg ||
        error.message;

      if (status === 451) {
        throw new Error(
          "Binance API bị giới hạn khu vực (HTTP 451)"
        );
      }

      if (status === 418 || status === 429) {
        const retryAfter = Number(
          error.response?.headers?.["retry-after"] ||
          60
        );

        const delay =
          Math.max(60, retryAfter || 60) * 1000;

        blockedUntil = Math.max(
          blockedUntil,
          Date.now() + delay
        );

        log(
          `[RATE LIMIT] HTTP ${status} | ` +
          `Chờ ${delay / 1000}s`
        );

      } else if (
        status &&
        status >= 400 &&
        status < 500
      ) {
        throw error;

      } else if (
        error.code === "ECONNABORTED" ||
        error.code === "ETIMEDOUT"
      ) {
        log(
          `[API TIMEOUT] ${target} | ` +
          `${config.API_TIMEOUT_MS}ms`
        );

      } else {
        log(
          `[API ERROR] ${target} | ${message}`
        );
      }

      if (attempt === config.API_RETRIES) {
        throw error;
      }

      log(
        `[API RETRY] ${target} | ` +
        `${attempt + 1}/${config.API_RETRIES}`
      );

      await sleep(
        1000 * (attempt + 1)
      );
    }
  }
}

// ========================================
// API STATS
// ========================================

export function resetApiStats() {
  requestCount = 0;
}

export function getApiStats() {
  return {
    requestCount,
    usedWeight
  };
}

// ========================================
// SERVER TIME
// ========================================

export async function getServerTime() {
  const data = await request(
    "/fapi/v1/time"
  );

  return Number(data.serverTime);
}

// ========================================
// SYMBOLS
// ========================================

export async function getSymbols() {
  const data = await request(
    "/fapi/v1/exchangeInfo"
  );

  return data.symbols
    .filter(item =>
      item.status === "TRADING" &&
      item.contractType === "PERPETUAL" &&
      item.quoteAsset === "USDT" &&
      item.marginAsset === "USDT"
    )
    .map(item => ({
      symbol: item.symbol,
      pair: item.pair || item.symbol
    }));
}

// ========================================
// KLINE WEIGHT
// ========================================

function klineWeight(limit) {
  if (limit < 100) return 1;
  if (limit < 500) return 2;
  if (limit <= 1000) return 5;

  return 10;
}

// ========================================
// BASIS CANDLES
// ========================================

export async function getBasisCandles(
  instrument,
  endTime,
  limit = config.CHART_CANDLE_COUNT,
  startTime
) {
  const params = {
    interval: config.TIMEFRAME,
    limit,
    endTime
  };

  if (startTime !== undefined) {
    params.startTime = startTime;
  }

  const weight = klineWeight(limit);

  const [futures, index] = await Promise.all([
    request(
      "/fapi/v1/klines",
      {
        ...params,
        symbol: instrument.symbol
      },
      weight
    ),

    request(
      "/fapi/v1/indexPriceKlines",
      {
        ...params,
        pair: instrument.pair
      },
      weight
    )
  ]);

  const indexMap = new Map(
    index.map(candle => [
      Number(candle[0]),
      candle
    ])
  );

  const result = [];

  for (const candle of futures) {
    const openTime = Number(candle[0]);
    const closeTime = Number(candle[6]);

    if (closeTime > endTime) continue;

    const indexCandle =
      indexMap.get(openTime);

    if (!indexCandle) continue;

    const futuresPrice = Number(candle[4]);
    const indexPrice = Number(indexCandle[4]);

    if (
      !Number.isFinite(futuresPrice) ||
      !Number.isFinite(indexPrice) ||
      futuresPrice <= 0 ||
      indexPrice <= 0
    ) {
      continue;
    }

    const basisRate =
      ((futuresPrice - indexPrice) /
        indexPrice) * 100;

    result.push({
      openTime,
      closeTime,
      futuresPrice,
      indexPrice,
      basisRate
    });
  }

  return result.sort(
    (a, b) => a.openTime - b.openTime
  );
}

// ========================================
// RECOVER MISSING CANDLES
// ========================================

export async function getMissingCandles(
  instrument,
  startTime,
  endTime
) {
  const result = [];

  let cursor = startTime;

  log(
    `[BACKFILL] ${instrument.symbol} | ` +
    `Đang tải nến lịch sử`
  );

  while (cursor <= endTime) {
    const remaining = Math.floor(
      (endTime - cursor + 1) /
      config.INTERVAL_MS
    );

    if (remaining <= 0) break;

    const limit = Math.min(
      500,
      remaining
    );

    const pageEnd = Math.min(
      endTime,
      cursor + limit * config.INTERVAL_MS - 1
    );

    const candles = await getBasisCandles(
      instrument,
      pageEnd,
      limit,
      cursor
    );

    if (!candles.length) break;

    result.push(...candles);

    const next =
      candles.at(-1).openTime +
      config.INTERVAL_MS;

    if (next <= cursor) break;

    cursor = next;
  }

  log(
    `[BACKFILL DONE] ${instrument.symbol} | ` +
    `${result.length} nến`
  );

  return result;
}

// ========================================
// GET ALL FUNDING RATES
// ========================================

export async function getAllFundingRates() {
  const data = await request(
    "/fapi/v1/premiumIndex",
    {},
    10
  );

  const fundingMap = new Map();

  for (const item of data) {
    const fundingRate = Number(item.lastFundingRate);

    if (!Number.isFinite(fundingRate)) {
      continue;
    }

    fundingMap.set(item.symbol, {
      fundingRate: fundingRate * 100,
      nextFundingTime: Number(item.nextFundingTime),
      timestamp: Number(item.time)
    });
  }

  return fundingMap;
}