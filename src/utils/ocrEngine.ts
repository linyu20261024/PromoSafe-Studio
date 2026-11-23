import { createWorker } from "tesseract.js";

export type OcrPreprocessMode = "adaptive_contrast" | "denoise_binary";

function loadHtmlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("无法加载截图文件，请确认格式为 PNG 或 JPG。"));
    img.src = dataUrl;
  });
}

/**
 * Preprocess promo screenshots before OCR:
 * - Upscale small text for sharper CJK stroke recognition
 * - adaptive_contrast: luminance + 5%-95% contrast stretch + mild unsharp sharpening (keeps white-on-red banners & dark-on-white cards)
 * - denoise_binary: local 16x16 block thresholding to strip patterned/gradient poster backgrounds
 */
export async function preprocessScreenshotForOcr(
  imageDataUrl: string,
  mode: OcrPreprocessMode
): Promise<string> {
  const img = await loadHtmlImage(imageDataUrl);
  const maxSide = 2200;
  const minWidth = 1400;

  let targetW = img.naturalWidth;
  let targetH = img.naturalHeight;

  if (targetW < minWidth) {
    const upScale = Math.min(2.2, minWidth / targetW);
    targetW = Math.round(targetW * upScale);
    targetH = Math.round(targetH * upScale);
  }
  if (Math.max(targetW, targetH) > maxSide) {
    const downScale = maxSide / Math.max(targetW, targetH);
    targetW = Math.round(targetW * downScale);
    targetH = Math.round(targetH * downScale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return imageDataUrl;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  const data = imgData.data;
  const pixelCount = targetW * targetH;
  const gray = new Uint8Array(pixelCount);

  // Convert to perceptual luminance grayscale + build histogram
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    gray[p] = lum;
    hist[lum]++;
  }

  // Find 3rd and 97th percentile bounds for contrast stretching
  let low = 0;
  let high = 255;
  let cum = 0;
  const lowTarget = pixelCount * 0.03;
  const highTarget = pixelCount * 0.97;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (cum >= lowTarget && low === 0) low = v;
    if (cum >= highTarget) {
      high = v;
      break;
    }
  }
  const span = Math.max(16, high - low);

  const stretched = new Uint8Array(pixelCount);
  for (let p = 0; p < pixelCount; p++) {
    const norm = Math.round(((gray[p] - low) * 255) / span);
    stretched[p] = norm < 0 ? 0 : norm > 255 ? 255 : norm;
  }

  if (mode === "denoise_binary") {
    // Local block adaptive threshold (strip complex colored/patterned poster backgrounds)
    const blockSize = 24;
    const cols = Math.ceil(targetW / blockSize);
    const rows = Math.ceil(targetH / blockSize);
    const blockMeans = new Float32Array(cols * rows);

    for (let br = 0; br < rows; br++) {
      for (let bc = 0; bc < cols; bc++) {
        let sum = 0;
        let cnt = 0;
        const yEnd = Math.min(targetH, (br + 1) * blockSize);
        const xEnd = Math.min(targetW, (bc + 1) * blockSize);
        for (let y = br * blockSize; y < yEnd; y++) {
          for (let x = bc * blockSize; x < xEnd; x++) {
            sum += stretched[y * targetW + x];
            cnt++;
          }
        }
        blockMeans[br * cols + bc] = cnt > 0 ? sum / cnt : 128;
      }
    }

    for (let y = 0; y < targetH; y++) {
      const br = Math.floor(y / blockSize);
      for (let x = 0; x < targetW; x++) {
        const bc = Math.floor(x / blockSize);
        const p = y * targetW + x;
        const mean = blockMeans[br * cols + bc];
        // Determine whether this block is light-on-dark or dark-on-light
        const isDarkBanner = mean < 115;
        const val = isDarkBanner
          ? stretched[p] > mean + 14
            ? 0
            : 255
          : stretched[p] < mean - 12
            ? 0
            : 255;
        const idx = p * 4;
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
        data[idx + 3] = 255;
      }
    }
  } else {
    // Adaptive contrast + mild 3x3 edge sharpening (keeps both light & colored cards crisp)
    for (let y = 1; y < targetH - 1; y++) {
      for (let x = 1; x < targetW - 1; x++) {
        const p = y * targetW + x;
        const center = stretched[p] * 5;
        const neighbors =
          stretched[p - 1] +
          stretched[p + 1] +
          stretched[p - targetW] +
          stretched[p + targetW];
        const sharp = Math.min(255, Math.max(0, center - neighbors));
        const idx = p * 4;
        data[idx] = sharp;
        data[idx + 1] = sharp;
        data[idx + 2] = sharp;
        data[idx + 3] = 255;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL("image/png");
}

export function cleanChineseOcrText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .trim()
        // Collapse multiple spaces between CJK characters
        .replace(/([\u4e00-\u9fa5，。！？、：；【】（）])\s+(?=[\u4e00-\u9fa5，。！？、：；【】（）])/g, "$1")
        .replace(/\s{2,}/g, " ")
    )
    .filter((line) => line.length >= 2)
    .join("\n");
}

export async function runLocalImageOcr(
  imageDataUrl: string,
  mode: OcrPreprocessMode,
  onProgress?: (progressPct: number, statusText: string) => void
): Promise<string> {
  onProgress?.(5, "正在进行截图抗背景预处理...");
  const preparedUrl = await preprocessScreenshotForOcr(imageDataUrl, mode);

  onProgress?.(15, "正在加载本地中文识别引擎（首次需缓存语言包）...");
  const worker = await createWorker(["chi_sim", "eng"], 1, {
    logger: (msg) => {
      if (typeof msg.progress === "number") {
        const mapped = Math.min(98, Math.round(15 + msg.progress * 82));
        const label =
          msg.status === "recognizing text"
            ? "正在识别截图文字..."
            : msg.status === "loading language traineddata"
              ? "正在下载中文语言包（完成后自动本地缓存）..."
              : "正在初始化识别引擎...";
        onProgress?.(mapped, label);
      }
    },
  });

  try {
    const result = await worker.recognize(preparedUrl);
    onProgress?.(100, "识别完成");
    return cleanChineseOcrText(result.data.text || "");
  } finally {
    await worker.terminate();
  }
}
