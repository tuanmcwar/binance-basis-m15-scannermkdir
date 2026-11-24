import { createCanvas } from "@napi-rs/canvas";
import { config } from "../config.js";
import { getFundingRate } from "../funding.js";

// ========================================
// COLORS
// ========================================

const COLORS = {
  background: "#000000",
  futures: "#38BDF8",
  index: "#FFFFFF",
  grid: "#303744",
  text: "#CBD5E1",

  positive: "#4ADE80",
  negative: "#F87171",
  neutral: "#FFFFFF",

  running: "#FACC15",

  fundingPositive: "#4ADE80",
  fundingNegative: "#F87171",
  fundingZero: "#CBD5E1",
  fundingMissing: "#64748B"
};

// ========================================
// FORMAT TIME
// ========================================

function formatLabel(timestamp) {

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: config.TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(timestamp));
}

// ========================================
// EXTREME BASIS COLOR
// ========================================

function getBasisColor(basisRate) {

  if (
    basisRate >
    config.BASIS_POSITIVE_THRESHOLD
  ) {

    return COLORS.positive;
  }

  if (
    basisRate <
    config.BASIS_NEGATIVE_THRESHOLD
  ) {

    return COLORS.negative;
  }

  return COLORS.neutral;
}

// ========================================
// CREATE EXTREME CHART
// ========================================

export function createExtremeChart(
  symbol,
  inputCandles
) {

  const candles = inputCandles.slice(
    -config.CHART_CANDLE_COUNT
  );

  if (candles.length < 2) {

    throw new Error(
      "Không đủ dữ liệu vẽ biểu đồ Extreme"
    );
  }

  const showFunding =
    config.SHOW_FUNDING_CHART === true;

  // ========================================
  // FIXED CANVAS SIZE
  // ========================================

  const width = config.CHART_WIDTH;

  const height = config.CHART_HEIGHT;

  const canvas = createCanvas(
    width,
    height
  );

  const ctx = canvas.getContext("2d");

  // ========================================
  // CHART LAYOUT
  // ========================================

  const headerHeight =
    config.CHART_HEADER_HEIGHT;

  const priceHeight =
    config.CHART_PRICE_HEIGHT;

  const fundingHeight = showFunding
    ? config.FUNDING_CHART_HEIGHT
    : 0;

  const left = 100;

  const right = width - 45;

  const top = headerHeight;

  const bottom = showFunding
    ? headerHeight + priceHeight
    : height - 30;

  const chartWidth =
    right - left;

  const chartHeight =
    bottom - top;

  // ========================================
  // FUNDING PANEL POSITION
  // ========================================

  const fundingTop = bottom;

  const fundingBottom = showFunding
    ? fundingTop + fundingHeight
    : bottom;

  const fundingPlotTop =
    fundingTop + 5;

  const fundingPlotBottom =
    fundingBottom - 30;

  const timeAxisY = showFunding
    ? fundingBottom - 12
    : height - 12;

  // ========================================
  // BACKGROUND
  // ========================================

  ctx.fillStyle = COLORS.background;

  ctx.fillRect(
    0,
    0,
    width,
    height
  );

  // ========================================
  // PRICE RANGE
  // ========================================

  const prices = candles.flatMap(candle => [

    Number(candle.futuresPrice),

    Number(candle.indexPrice)
  ]);

  const rawMin = Math.min(...prices);

  const rawMax = Math.max(...prices);

  const padding = Math.max(

    (rawMax - rawMin) * 0.12,

    rawMax * 0.002,

    Number.EPSILON
  );

  const minPrice = Math.max(
    0,
    rawMin - padding
  );

  const maxPrice =
    rawMax + padding;

  const x = index =>
    left +
    index * chartWidth / candles.length;

  const y = price =>
    bottom -
    (
      (price - minPrice) /
      (maxPrice - minPrice)
    ) * chartHeight;

  const digits = Math.min(
    10,
    Math.max(
      2,
      Math.ceil(
        -Math.log10(
          (maxPrice - minPrice) / 6
        )
      ) + 1
    )
  );

  // ========================================
  // TITLE
  // ========================================

  ctx.textAlign = "center";

  ctx.textBaseline = "middle";

  ctx.fillStyle = COLORS.index;

  ctx.font = "bold 32px sans-serif";

  ctx.fillText(
    `${symbol}.P - BASIS PUMP ${config.TIMEFRAME.toUpperCase()}`,
    width / 2,
    headerHeight * 0.38
  );

  // ========================================
  // LEGEND
  // ========================================

  const legends = [

    {
      color: COLORS.futures,
      label: "Futures Price"
    },

    {
      color: COLORS.index,
      label: "Index Price"
    },

    {
      color: COLORS.positive,
      label: `Positive Basis > +${config.BASIS_POSITIVE_THRESHOLD}%`
    },

    {
      color: COLORS.negative,
      label: `Negative Basis < ${config.BASIS_NEGATIVE_THRESHOLD}%`
    },

    {
      color: COLORS.running,
      label: "? Running Candle"
    }
  ];

  ctx.font = "18px sans-serif";

  const legendWidths = legends.map(item =>

    ctx.measureText(item.label).width + 48
  );

  const legendTotal = legendWidths.reduce(
    (sum, value) => sum + value,
    0
  );

  let legendX =
    (width - legendTotal) / 2;

  const legendY =
    headerHeight * 0.78;

  ctx.textAlign = "left";

  ctx.textBaseline = "middle";

  legends.forEach((item, i) => {

    ctx.fillStyle = item.color;

    ctx.fillRect(
      legendX,
      legendY - 7,
      20,
      14
    );

    ctx.fillStyle = COLORS.index;

    ctx.fillText(
      item.label,
      legendX + 27,
      legendY
    );

    legendX += legendWidths[i];
  });

  // ========================================
  // PRICE LABELS - NO HORIZONTAL GRID
  // ========================================

  ctx.font = "13px sans-serif";

  for (let i = 0; i <= 6; i++) {

    const price =
      minPrice +
      (maxPrice - minPrice) * i / 6;

    const py = y(price);

    ctx.fillStyle = COLORS.text;

    ctx.textAlign = "right";

    ctx.textBaseline = "middle";

    ctx.fillText(
      price.toFixed(digits),
      left - 10,
      py
    );
  }

  // ========================================
  // FUTURES GRID BORDER
  // ========================================

  ctx.save();

  ctx.strokeStyle = COLORS.grid;

  ctx.lineWidth = 1;

  ctx.strokeRect(
    left,
    top,
    chartWidth,
    chartHeight
  );

  ctx.restore();

  // ========================================
  // DRAW PRICE LINES
  // ========================================

  function drawLine(key, color) {

    ctx.strokeStyle = color;

    ctx.lineWidth = 3;

    ctx.lineJoin = "round";

    ctx.beginPath();

    candles.forEach((candle, i) => {

      const px = x(i);

      const py = y(candle[key]);

      if (i === 0) {

        ctx.moveTo(px, py);

      } else {

        ctx.lineTo(px, py);
      }
    });

    ctx.stroke();

    // ========================================
    // PRICE POINTS
    // ========================================

    candles.forEach((candle, i) => {

      ctx.beginPath();

      ctx.arc(
        x(i),
        y(candle[key]),
        6,
        0,
        Math.PI * 2
      );

      ctx.fillStyle = color;

      ctx.fill();
    });
  }

  drawLine(
    "indexPrice",
    COLORS.index
  );

  drawLine(
    "futuresPrice",
    COLORS.futures
  );

  // ========================================
  // BASIS PERCENT LABELS
  // ========================================

  ctx.save();

  ctx.font = "bold 15px sans-serif";

  ctx.textAlign = "center";

  ctx.textBaseline = "middle";

  candles.forEach((candle, i) => {

    const basis = Number(
      candle.basisRate
    );

    if (!Number.isFinite(basis)) {

      return;
    }

    const label =
      `${basis > 0 ? "+" : ""}${basis.toFixed(2)}%`;

    const labelColor =
      getBasisColor(basis);

    // ========================================
    // CENTER BETWEEN TWO PRICE POINTS
    // ========================================

    const futuresY = y(
      candle.futuresPrice
    );

    const indexY = y(
      candle.indexPrice
    );

    const labelX = x(i);

    const labelY =
      (futuresY + indexY) / 2;

    // ========================================
    // EXTREME DOTTED LINE
    // ========================================

    if (
      labelColor === COLORS.positive ||
      labelColor === COLORS.negative
    ) {

      ctx.save();

      ctx.strokeStyle = labelColor;

      ctx.lineWidth = 2;

      ctx.lineCap = "round";

      ctx.setLineDash([1, 6]);

      const upperY = Math.min(
        futuresY,
        indexY
      );

      const lowerY = Math.max(
        futuresY,
        indexY
      );

      if (lowerY - upperY > 12) {

        ctx.beginPath();

        ctx.moveTo(
          labelX,
          upperY + 6
        );

        ctx.lineTo(
          labelX,
          lowerY - 6
        );

        ctx.stroke();
      }

      ctx.restore();
    }

    // ========================================
    // BASIS LABEL
    // ========================================

    ctx.strokeStyle = COLORS.background;

    ctx.lineWidth = 4;

    ctx.lineJoin = "round";

    ctx.strokeText(
      label,
      labelX,
      labelY
    );

    ctx.fillStyle = labelColor;

    ctx.fillText(
      label,
      labelX,
      labelY
    );
  });

  ctx.restore();

  // ========================================
  // RUNNING CANDLE
  // ========================================

  const latest = candles.at(-1);

  ctx.font = "bold 28px sans-serif";

  ctx.textAlign = "center";

  ctx.textBaseline = "middle";

  ctx.fillStyle = COLORS.running;

  ctx.fillText(
    "?",
    x(candles.length),
    y(latest.futuresPrice)
  );

  // ========================================
  // FUNDING RATE HISTOGRAM
  // ========================================

  if (showFunding) {

    const fundingValues = candles.map(

      candle =>
        getFundingRate(
          symbol,
          candle.openTime
        )
    );

    const validFunding =
      fundingValues.filter(

        value =>
          value !== null &&
          Number.isFinite(value)
      );

    const fundingDecimals = Math.min(
      8,
      Math.max(
        0,
        Math.trunc(
          Number(config.FUNDING_DECIMALS) || 0
        )
      )
    );

    // ========================================
    // FUNDING RANGE
    // ========================================

    const maxPositive = Math.max(
      0,
      ...validFunding
    );

    const minNegative = Math.min(
      0,
      ...validFunding
    );

    const maxAbs = Math.max(

      Math.abs(maxPositive),

      Math.abs(minNegative),

      0.0001
    );

    const fundingMax = maxPositive > 0

      ? maxPositive + maxAbs * 0.25

      : maxAbs * 0.15;

    const fundingMin = minNegative < 0

      ? minNegative - maxAbs * 0.25

      : -maxAbs * 0.15;

    const panelHeight =
      fundingPlotBottom - fundingPlotTop;

    const fy = value =>
      fundingPlotBottom -
      (
        (value - fundingMin) /
        (fundingMax - fundingMin)
      ) * panelHeight;

    const zeroY = fy(0);

    // ========================================
    // FUNDING WATERMARK
    // ========================================

    ctx.save();

    ctx.globalAlpha = 0.2;

    ctx.font = "bold 13px sans-serif";

    ctx.fillStyle = COLORS.text;

    ctx.textAlign = "center";

    ctx.textBaseline = "middle";

    ctx.fillText(
      `FUNDING RATE - ${config.TIMEFRAME.toUpperCase()} SNAPSHOT`,
      (left + right) / 2,
      (fundingTop + fundingBottom) / 2
    );

    ctx.restore();

    // ========================================
    // FUNDING PANEL BORDER
    // ========================================

    ctx.strokeStyle = COLORS.grid;

    ctx.lineWidth = 1;

    ctx.strokeRect(
      left,
      fundingTop,
      chartWidth,
      fundingHeight - 1
    );

    // ========================================
    // ZERO LINE
    // ========================================

    ctx.strokeStyle = COLORS.text;

    ctx.lineWidth = 1;

    ctx.beginPath();

    ctx.moveTo(left, zeroY);

    ctx.lineTo(right, zeroY);

    ctx.stroke();

    ctx.font = "12px sans-serif";

    ctx.textAlign = "right";

    ctx.textBaseline = "middle";

    ctx.fillStyle = COLORS.text;

    ctx.fillText(
      "0%",
      left - 10,
      zeroY
    );

    // ========================================
    // FUNDING BARS
    // ========================================

    const candleSpacing =
      chartWidth / candles.length;

    const barWidth = Math.min(
      38,
      candleSpacing * 0.55
    );

    fundingValues.forEach((value, i) => {

      const px = x(i);

      // ========================================
      // MISSING HISTORICAL FUNDING
      // ========================================

      if (
        value === null ||
        !Number.isFinite(value)
      ) {

        ctx.font = "12px sans-serif";

        ctx.textAlign = "center";

        ctx.textBaseline = "middle";

        ctx.fillStyle = COLORS.fundingMissing;

        ctx.fillText(
          "--",
          px,
          Math.min(
            zeroY + 12,
            fundingPlotBottom - 3
          )
        );

        return;
      }

      // ========================================
      // FUNDING COLOR
      // ========================================

      const color =
        value > 0

          ? COLORS.fundingPositive

          : value < 0

            ? COLORS.fundingNegative

            : COLORS.fundingZero;

      const valueY = fy(value);

      const barTop = Math.min(
        zeroY,
        valueY
      );

      const barHeight = Math.max(
        1,
        Math.abs(valueY - zeroY)
      );

      // ========================================
      // DRAW FUNDING COLUMN
      // ========================================

      ctx.fillStyle = color;

      ctx.fillRect(
        px - barWidth / 2,
        barTop,
        barWidth,
        barHeight
      );

      // ========================================
      // FUNDING PERCENT LABEL
      // ========================================

      const label =
        `${value > 0 ? "+" : ""}${value.toFixed(fundingDecimals)}%`;

      ctx.font = "bold 12px sans-serif";

      ctx.textAlign = "center";

      ctx.textBaseline =
        value >= 0 ? "bottom" : "top";

      ctx.fillStyle = color;

      const labelY =
        value >= 0

          ? Math.max(
              valueY - 5,
              fundingTop + 31
            )

          : Math.min(
              valueY + 5,
              fundingBottom - 42
            );

      ctx.strokeStyle = COLORS.background;

      ctx.lineWidth = 3;

      ctx.strokeText(
        label,
        px,
        labelY
      );

      ctx.fillText(
        label,
        px,
        labelY
      );
    });

    // ========================================
    // FUNDING RUNNING CANDLE
    // ========================================

    ctx.font = "bold 20px sans-serif";

    ctx.textAlign = "center";

    ctx.textBaseline = "middle";

    ctx.fillStyle = COLORS.running;

    ctx.fillText(
      "?",
      x(candles.length),
      zeroY
    );
  }

  // ========================================
  // TIME LABELS INSIDE BOTTOM GRID
  // ========================================

  ctx.font = "12px sans-serif";

  ctx.textAlign = "center";

  ctx.textBaseline = "middle";

  for (let i = 0; i <= candles.length; i++) {

    const timestamp =
      i < candles.length

        ? Number(candles[i].openTime)

        : Number(candles.at(-1).openTime) +
          Number(config.INTERVAL_MS);

    ctx.fillStyle = COLORS.text;

    ctx.fillText(
      formatLabel(timestamp),
      x(i),
      timeAxisY
    );
  }

  // ========================================
  // PRICE AXIS TITLE
  // ========================================

  ctx.font = "13px sans-serif";

  ctx.fillStyle = COLORS.text;

  ctx.textAlign = "center";

  ctx.textBaseline = "middle";

  ctx.save();

  ctx.translate(
    20,
    (top + bottom) / 2
  );

  ctx.rotate(-Math.PI / 2);

  ctx.fillText(
    "Price (USDT)",
    0,
    0
  );

  ctx.restore();

  // ========================================
  // BOLD GRID SEPARATOR
  // ========================================

  if (showFunding) {

    ctx.save();

    ctx.strokeStyle = "#d6d876";

    ctx.lineWidth = 4;

    ctx.beginPath();

    ctx.moveTo(
      left,
      fundingTop
    );

    ctx.lineTo(
      right,
      fundingTop
    );

    ctx.stroke();

    ctx.restore();
  }

  // ========================================
  // EXPORT PNG
  // ========================================

  return canvas.toBuffer("image/png");
}