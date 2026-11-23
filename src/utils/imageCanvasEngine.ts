import { BACKGROUND_PRESETS } from "../data/defaultDictionary.ts";
import type { AspectRatioOption, ImageStudioConfig, MaskStroke } from "../types/index.ts";

export function getCanvasDimensions(aspect: AspectRatioOption): {
  width: number;
  height: number;
} {
  switch (aspect) {
    case "1:1":
      return { width: 1080, height: 1080 };
    case "16:9":
      return { width: 1440, height: 810 };
    case "3:4":
    default:
      return { width: 1080, height: 1440 };
  }
}

const imageCache = new Map<string, HTMLImageElement>();

export function loadImageCached(src: string): Promise<HTMLImageElement> {
  const existing = imageCache.get(src);
  if (existing && existing.complete && existing.naturalWidth > 0) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function samplePerimeterColors(
  imgData: ImageData,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): { topColor: string; bottomColor: string; avgColor: string } {
  const { width, height, data } = imgData;
  const x0 = Math.max(0, Math.floor(rx));
  const y0 = Math.max(0, Math.floor(ry));
  const x1 = Math.min(width - 1, Math.ceil(rx + rw));
  const y1 = Math.min(height - 1, Math.ceil(ry + rh));

  const ring = 4;
  let tr = 0, tg = 0, tb = 0, tc = 0;
  let br = 0, bg = 0, bb = 0, bc = 0;
  let ar = 0, ag = 0, ab = 0, ac = 0;

  const samplePixel = (px: number, py: number, target: "top" | "bottom" | "side") => {
    if (px < 0 || px >= width || py < 0 || py >= height) return;
    const idx = (py * width + px) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    ar += r;
    ag += g;
    ab += b;
    ac++;
    if (target === "top") {
      tr += r;
      tg += g;
      tb += b;
      tc++;
    } else if (target === "bottom") {
      br += r;
      bg += g;
      bb += b;
      bc++;
    }
  };

  for (let x = Math.max(0, x0 - ring); x <= Math.min(width - 1, x1 + ring); x += 2) {
    for (let offset = 1; offset <= ring; offset++) {
      samplePixel(x, y0 - offset, "top");
      samplePixel(x, y1 + offset, "bottom");
    }
  }

  for (let y = y0; y <= y1; y += 2) {
    for (let offset = 1; offset <= ring; offset++) {
      samplePixel(x0 - offset, y, "side");
      samplePixel(x1 + offset, y, "side");
    }
  }

  const avg = ac > 0 ? [Math.round(ar / ac), Math.round(ag / ac), Math.round(ab / ac)] : [248, 250, 252];
  const top = tc > 0 ? [Math.round(tr / tc), Math.round(tg / tc), Math.round(tb / tc)] : avg;
  const bot = bc > 0 ? [Math.round(br / bc), Math.round(bg / bc), Math.round(bb / bc)] : avg;

  return {
    topColor: `rgb(${top[0]}, ${top[1]}, ${top[2]})`,
    bottomColor: `rgb(${bot[0]}, ${bot[1]}, ${bot[2]})`,
    avgColor: `rgb(${avg[0]}, ${avg[1]}, ${avg[2]})`,
  };
}

function getStrokeBounds(
  stroke: MaskStroke,
  imgW: number,
  imgH: number
): { x: number; y: number; w: number; h: number; radiusPx: number } {
  const minDim = Math.min(imgW, imgH);
  const radiusPx = Math.max(8, stroke.brushSize * minDim);

  if (stroke.tool === "rect" && stroke.rect) {
    const x = Math.min(stroke.rect.x, stroke.rect.x + stroke.rect.w) * imgW;
    const y = Math.min(stroke.rect.y, stroke.rect.y + stroke.rect.h) * imgH;
    const w = Math.abs(stroke.rect.w) * imgW;
    const h = Math.abs(stroke.rect.h) * imgH;
    return { x, y, w: Math.max(4, w), h: Math.max(4, h), radiusPx };
  }

  let minX = imgW;
  let minY = imgH;
  let maxX = 0;
  let maxY = 0;
  for (const pt of stroke.points) {
    const px = pt.x * imgW;
    const py = pt.y * imgH;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  const pad = radiusPx / 2;
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    w: Math.max(4, maxX - minX + pad * 2),
    h: Math.max(4, maxY - minY + pad * 2),
    radiusPx,
  };
}

export function applyMasksToOffscreenCanvas(
  sourceImg: HTMLImageElement,
  strokes: MaskStroke[]
): HTMLCanvasElement {
  const offscreen = document.createElement("canvas");
  offscreen.width = sourceImg.naturalWidth;
  offscreen.height = sourceImg.naturalHeight;
  const ctx = offscreen.getContext("2d");
  if (!ctx) return offscreen;

  ctx.drawImage(sourceImg, 0, 0);
  if (strokes.length === 0) return offscreen;

  const imgW = offscreen.width;
  const imgH = offscreen.height;
  const baseImageData = ctx.getImageData(0, 0, imgW, imgH);

  for (const stroke of strokes) {
    const bounds = getStrokeBounds(stroke, imgW, imgH);

    ctx.save();
    if (stroke.tool === "rect") {
      drawRoundedRectPath(ctx, bounds.x, bounds.y, bounds.w, bounds.h, 6);
      ctx.clip();
    } else if (stroke.points.length > 0) {
      ctx.beginPath();
      // Create clip region along brush path using offscreen mask or thick stroke
      // For clean crisp masking with blur/gradient, draw a stroked path region:
      if (stroke.fillMode === "solid" || stroke.fillMode === "edge_sample") {
        const sampled =
          stroke.fillMode === "edge_sample"
            ? samplePerimeterColors(baseImageData, bounds.x, bounds.y, bounds.w, bounds.h)
            : null;
        ctx.strokeStyle = sampled
          ? sampled.avgColor
          : stroke.solidColor || "#F8FAFC";
        ctx.lineWidth = bounds.radiusPx;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x * imgW, stroke.points[0].y * imgH);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x * imgW, stroke.points[i].y * imgH);
        }
        if (stroke.points.length === 1) {
          ctx.lineTo(stroke.points[0].x * imgW + 0.5, stroke.points[0].y * imgH + 0.5);
        }
        ctx.stroke();
        ctx.restore();
        continue;
      }
      // For brush + blur: clip to bounding rounded box of each segment
      drawRoundedRectPath(ctx, bounds.x, bounds.y, bounds.w, bounds.h, bounds.radiusPx / 2);
      ctx.clip();
    }

    if (stroke.fillMode === "edge_sample") {
      const { topColor, bottomColor } = samplePerimeterColors(
        baseImageData,
        bounds.x,
        bounds.y,
        bounds.w,
        bounds.h
      );
      const grad = ctx.createLinearGradient(0, bounds.y, 0, bounds.y + bounds.h);
      grad.addColorStop(0, topColor);
      grad.addColorStop(1, bottomColor);
      ctx.fillStyle = grad;
      ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
    } else if (stroke.fillMode === "blur") {
      const mosaicCanvas = document.createElement("canvas");
      const blockSize = Math.max(10, Math.round(Math.min(bounds.w, bounds.h) / 6));
      const mw = Math.max(2, Math.round(bounds.w / blockSize));
      const mh = Math.max(2, Math.round(bounds.h / blockSize));
      mosaicCanvas.width = mw;
      mosaicCanvas.height = mh;
      const mctx = mosaicCanvas.getContext("2d");
      if (mctx) {
        mctx.drawImage(
          offscreen,
          bounds.x,
          bounds.y,
          bounds.w,
          bounds.h,
          0,
          0,
          mw,
          mh
        );
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          mosaicCanvas,
          0,
          0,
          mw,
          mh,
          bounds.x,
          bounds.y,
          bounds.w,
          bounds.h
        );
        ctx.imageSmoothingEnabled = true;
      }
    } else {
      ctx.fillStyle = stroke.solidColor || "#F8FAFC";
      ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
    }

    ctx.restore();
  }

  return offscreen;
}

export async function renderRecreatedCanvas(
  canvas: HTMLCanvasElement,
  sourceImg: HTMLImageElement,
  strokes: MaskStroke[],
  config: ImageStudioConfig
): Promise<void> {
  const { width, height } = getCanvasDimensions(config.aspectRatio);
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const preset =
    BACKGROUND_PRESETS.find((b) => b.id === config.backgroundId) ?? BACKGROUND_PRESETS[0];

  // 1. Draw Background
  if (preset.kind === "image") {
    try {
      const bgImg = await loadImageCached(preset.value);
      const scale = Math.max(width / bgImg.naturalWidth, height / bgImg.naturalHeight);
      const drawW = bgImg.naturalWidth * scale;
      const drawH = bgImg.naturalHeight * scale;
      const dx = (width - drawW) / 2;
      const dy = (height - drawH) / 2;
      ctx.drawImage(bgImg, dx, dy, drawW, drawH);
    } catch {
      ctx.fillStyle = "#F1F5F9";
      ctx.fillRect(0, 0, width, height);
    }
  } else if (preset.kind === "gradient") {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, preset.value);
    grad.addColorStop(1, preset.secondaryValue ?? preset.value);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = preset.value;
    ctx.fillRect(0, 0, width, height);
  }

  // 2. Prepare masked foreground image
  const maskedCanvas = applyMasksToOffscreenCanvas(sourceImg, strokes);

  // 3. Calculate centered card placement inside padding & footer allowance
  const padX = (width * config.paddingPercent) / 100;
  const footerReserve = config.footerText.trim() ? 78 : 0;
  const padTop = (height * config.paddingPercent) / 100;
  const padBottom = padTop + footerReserve;

  const availW = Math.max(120, width - padX * 2);
  const availH = Math.max(120, height - padTop - padBottom);

  const imgRatio = maskedCanvas.width / maskedCanvas.height;
  let cardW = availW;
  let cardH = cardW / imgRatio;
  if (cardH > availH) {
    cardH = availH;
    cardW = cardH * imgRatio;
  }

  const cardX = (width - cardW) / 2;
  const cardY = padTop + (availH - cardH) / 2;

  // 4. Draw drop shadow + rounded card
  ctx.save();
  if (config.shadowStrength > 0) {
    ctx.shadowColor = `rgba(15, 23, 42, ${(config.shadowStrength * 0.008).toFixed(3)})`;
    ctx.shadowBlur = config.shadowStrength * 1.4;
    ctx.shadowOffsetY = Math.round(config.shadowStrength * 0.45);
  }
  drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, config.borderRadius);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.restore();

  ctx.save();
  drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, config.borderRadius);
  ctx.clip();
  ctx.drawImage(maskedCanvas, cardX, cardY, cardW, cardH);
  ctx.restore();

  // Hairline inner frame for crispness
  ctx.save();
  drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, config.borderRadius);
  ctx.strokeStyle = "rgba(15, 23, 42, 0.08)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // 5. Optional Safe Footer Note
  const footer = config.footerText.trim();
  if (footer) {
    ctx.save();
    ctx.font = '500 24px "DM Sans", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = preset.textColor || "#475569";
    const textY = height - padTop * 0.5 - 18;
    ctx.fillText(footer, width / 2, textY, width - padX * 1.5);
    ctx.restore();
  }

  // 6. Optional subtle pixel fingerprint perturbation to prevent duplicate-image detection
  if (config.perturbFingerprint) {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    // Sparse deterministic-like lightweight RGB perturbation (±1..2 on every 17th pixel)
    const seedShift = (Date.now() % 7) + 1;
    for (let i = seedShift * 4; i < data.length; i += 68) {
      const delta = ((i >> 2) % 3) - 1; // -1, 0, +1
      if (delta !== 0) {
        data[i] = Math.min(255, Math.max(0, data[i] + delta));
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] - delta));
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }
}

export function createSamplePromoImageDataUrl(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 960;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // Clean poster background
  ctx.fillStyle = "#FFF7ED";
  ctx.fillRect(0, 0, 720, 960);

  // Header brand banner (contains sample bank name & promo risk words to erase!)
  ctx.fillStyle = "#DC2626";
  ctx.fillRect(0, 0, 720, 150);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = 'bold 42px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText("招商银行 × 支付宝 周六福利", 48, 78);
  ctx.font = '500 24px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = "#FEE2E2";
  ctx.fillText("零门槛 100%必中 免费领立减金", 48, 122);

  // Main white promo card
  ctx.fillStyle = "#FFFFFF";
  drawRoundedRectPath(ctx, 48, 190, 624, 520, 24);
  ctx.fill();

  ctx.fillStyle = "#0F172A";
  ctx.font = 'bold 58px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText("单笔消费满 100 减 18 元", 88, 290);

  ctx.fillStyle = "#475569";
  ctx.font = '400 28px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText("活动时间：每周六 10:00 起", 88, 365);
  ctx.fillText("参与路径：支付时选绑卡直接抵扣", 88, 415);
  ctx.fillText("名额说明：每日限量 5000 份，先到先得", 88, 465);

  ctx.fillStyle = "#E11D48";
  ctx.font = '600 26px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText("全网最低！私信领攻略 / 切勿套现", 88, 550);

  // Mock QR block in bottom right to demonstrate mosaic/erasure
  ctx.fillStyle = "#F1F5F9";
  ctx.fillRect(460, 560, 160, 120);
  ctx.fillStyle = "#0F172A";
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      if ((row + col) % 2 === 0 || row === 0 || col === 0) {
        ctx.fillRect(476 + col * 24, 574 + row * 18, 16, 12);
      }
    }
  }
  ctx.fillStyle = "#64748B";
  ctx.font = '500 18px "PingFang SC", sans-serif';
  ctx.fillText("扫码加微信进群", 468, 702);

  // Footer watermark
  ctx.fillStyle = "#64748B";
  ctx.font = '500 22px "PingFang SC", sans-serif';
  ctx.fillText("示例活动原图（可直接用左侧画笔/框选测试去敏擦除）", 48, 860);

  return canvas.toDataURL("image/png");
}
