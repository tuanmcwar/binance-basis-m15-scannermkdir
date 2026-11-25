import axios from "axios";
import FormData from "form-data";
import { config, log } from "./config.js";

const telegram = axios.create({
  baseURL:
    `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`,

  timeout: 60000
});

let queue = Promise.resolve();

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// PHOTO CAPTION
// ==========================================

function getCaption(symbol, strategy) {
  const timeframe = config.TIMEFRAME.toUpperCase();

  if (strategy === "EXTREME") {
    return `💰 ${symbol}.P || BASIS PUMP ${timeframe}`;
  }

  return `💰 ${symbol}.P || FUTURES VS INDEX ${timeframe}`;
}

// ==========================================
// SEND PHOTO
// ==========================================

export async function sendPhoto(
  symbol,
  imageBuffer,
  strategy = "RECOVERY"
) {
  const task = queue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const form = new FormData();

      form.append(
        "chat_id",
        config.TELEGRAM_CHAT_ID
      );

      form.append(
        "photo",
        imageBuffer,
        {
          filename: `${symbol}-basis.png`,
          contentType: "image/png"
        }
      );

      form.append(
        "caption",
        getCaption(symbol, strategy)
      );

      try {
        const { data } = await telegram.post(
          "/sendPhoto",
          form,
          {
            headers: form.getHeaders(),
            maxBodyLength: Infinity
          }
        );

        if (!data.ok) {
          throw new Error(
            data.description ||
            "Telegram gửi ảnh thất bại"
          );
        }

        log(`[TELEGRAM] Đã gửi ảnh ${symbol}`);

        return data.result;

      } catch (error) {
        const retryAfter =
          error.response?.data?.parameters?.retry_after;

        if (
          error.response?.status === 429 &&
          retryAfter &&
          attempt < 2
        ) {
          await sleep(
            (Number(retryAfter) + 1) * 1000
          );

          continue;
        }

        throw error;
      }
    }
  });

  queue = task
    .catch(() => {})
    .then(() => sleep(3100));

  return task;
}