import fs from "node:fs";
import path from "node:path";

import {
  fileURLToPath
} from "node:url";

import {
  GlobalFonts
} from "@napi-rs/canvas";

const __dirname = path.dirname(
  fileURLToPath(import.meta.url)
);

const FONT_DIR = path.resolve(
  __dirname,
  "../assets/fonts"
);

export const FONT_FAMILY = "Noto Sans";

const fonts = [
  "NotoSans-Regular.ttf",
  "NotoSans-Bold.ttf"
];

for (const filename of fonts) {

  const fontPath = path.join(
    FONT_DIR,
    filename
  );

  if (!fs.existsSync(fontPath)) {

    throw new Error(
      `[FONT ERROR] Không tìm thấy ${fontPath}`
    );
  }

  const registered =
    GlobalFonts.registerFromPath(
      fontPath,
      FONT_FAMILY
    );

  if (!registered) {

    throw new Error(
      `[FONT ERROR] Không đăng ký được ${filename}`
    );
  }

  console.log(
    `[FONT] Registered: ${filename}`
  );
}

console.log(
  `[FONT] Font family: ${FONT_FAMILY}`
);