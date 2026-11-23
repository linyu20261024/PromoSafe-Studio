import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brush,
  Download,
  ImagePlus,
  Redo2,
  RotateCcw,
  Square,
  Undo2,
} from "lucide-react";
import { BACKGROUND_PRESETS } from "../data/defaultDictionary.ts";
import type {
  AspectRatioOption,
  ImageStudioConfig,
  MaskFillMode,
  MaskStroke,
  MaskTool,
  Point2D,
} from "../types/index.ts";
import {
  applyMasksToOffscreenCanvas,
  createSamplePromoImageDataUrl,
  loadImageCached,
  renderRecreatedCanvas,
} from "../utils/imageCanvasEngine.ts";

interface ImageStudioProps {
  sharedSourceDataUrl?: string | null;
  onChangeSharedSourceDataUrl?: (url: string | null) => void;
  onSaveImageSnapshot: (snapshot: {
    outputDataUrl: string;
    aspectRatio: AspectRatioOption;
    backgroundId: string;
  }) => void;
  restoredSnapshot?: {
    outputDataUrl: string;
    aspectRatio: AspectRatioOption;
    backgroundId: string;
  } | null;
}

export function ImageStudio({
  sharedSourceDataUrl,
  onChangeSharedSourceDataUrl,
  onSaveImageSnapshot,
  restoredSnapshot,
}: ImageStudioProps) {
  const [sourceDataUrl, setSourceDataUrl] = useState<string | null>(
    sharedSourceDataUrl ?? null
  );
  const [sourceImg, setSourceImg] = useState<HTMLImageElement | null>(null);

  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  const [redoStack, setRedoStack] = useState<MaskStroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<MaskStroke | null>(null);

  const [tool, setTool] = useState<MaskTool>("rect");
  const [fillMode, setFillMode] = useState<MaskFillMode>("edge_sample");
  const [brushSize, setBrushSize] = useState<number>(0.045);

  const [previewTab, setPreviewTab] = useState<"mask" | "result" | "compare">(
    "mask"
  );
  const [config, setConfig] = useState<ImageStudioConfig>({
    aspectRatio: "3:4",
    backgroundId: BACKGROUND_PRESETS[0].id,
    paddingPercent: 9,
    borderRadius: 24,
    shadowStrength: 22,
    footerText: "活动细则以官方页面展示为准 · 理性消费",
    perturbFingerprint: true,
  });

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [outputPreviewUrl, setOutputPreviewUrl] = useState<string>("");

  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isDrawingRef = useRef(false);

  // Sync with shared screenshot uploaded from CopyWorkbench
  useEffect(() => {
    if (sharedSourceDataUrl && sharedSourceDataUrl !== sourceDataUrl) {
      setSourceDataUrl(sharedSourceDataUrl);
      setStrokes([]);
      setRedoStack([]);
      setPreviewTab("mask");
    }
  }, [sharedSourceDataUrl]);

  // Load restored snapshot if provided from History
  useEffect(() => {
    if (!restoredSnapshot) return;
    setSourceDataUrl(restoredSnapshot.outputDataUrl);
    setConfig((prev) => ({
      ...prev,
      aspectRatio: restoredSnapshot.aspectRatio,
      backgroundId: restoredSnapshot.backgroundId,
    }));
    setStrokes([]);
    setRedoStack([]);
    setPreviewTab("result");
  }, [restoredSnapshot]);

  // Decode source image when URL changes
  useEffect(() => {
    if (!sourceDataUrl) {
      setSourceImg(null);
      setOutputPreviewUrl("");
      return;
    }
    let cancelled = false;
    loadImageCached(sourceDataUrl)
      .then((img) => {
        if (!cancelled) {
          setSourceImg(img);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatusMessage("图片解析失败，请更换 PNG 或 JPG 格式截图。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceDataUrl]);

  // Handle clipboard paste (Ctrl+V / Cmd+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === "string") {
                setSourceDataUrl(reader.result);
                onChangeSharedSourceDataUrl?.(reader.result);
                setStrokes([]);
                setRedoStack([]);
                setPreviewTab("mask");
                setStatusMessage("已从剪贴板导入截图，可直接在右侧框选擦除敏感区域。");
              }
            };
            reader.readAsDataURL(file);
            break;
          }
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [onChangeSharedSourceDataUrl]);

  // Draw interactive masking canvas
  useEffect(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || !sourceImg) return;

    const allStrokes = activeStroke ? [...strokes, activeStroke] : strokes;
    const processed = applyMasksToOffscreenCanvas(sourceImg, allStrokes);

    canvas.width = processed.width;
    canvas.height = processed.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(processed, 0, 0);

    // Draw live selection guide while dragging
    if (activeStroke && activeStroke.tool === "rect" && activeStroke.rect) {
      const rx = Math.min(activeStroke.rect.x, activeStroke.rect.x + activeStroke.rect.w) * canvas.width;
      const ry = Math.min(activeStroke.rect.y, activeStroke.rect.y + activeStroke.rect.h) * canvas.height;
      const rw = Math.abs(activeStroke.rect.w) * canvas.width;
      const rh = Math.abs(activeStroke.rect.h) * canvas.height;

      ctx.save();
      ctx.strokeStyle = "#E11D48";
      ctx.lineWidth = Math.max(2, canvas.width * 0.004);
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }
  }, [sourceImg, strokes, activeStroke, previewTab]);

  // Render final 3:4 / 1:1 / 16:9 composite canvas whenever strokes or config change
  useEffect(() => {
    if (!sourceImg) return;
    let cancelled = false;
    const offscreen = resultCanvasRef.current ?? document.createElement("canvas");
    if (!resultCanvasRef.current) {
      resultCanvasRef.current = offscreen;
    }

    renderRecreatedCanvas(offscreen, sourceImg, strokes, config).then(() => {
      if (!cancelled) {
        try {
          setOutputPreviewUrl(offscreen.toDataURL("image/png"));
        } catch {
          setStatusMessage("生成预览失败，请检查上传图片格式。");
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [sourceImg, strokes, config]);

  const handleFileChange = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatusMessage("请上传 PNG、JPG 或 WebP 格式的图片文件。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setSourceDataUrl(reader.result);
        onChangeSharedSourceDataUrl?.(reader.result);
        setStrokes([]);
        setRedoStack([]);
        setPreviewTab("mask");
        setStatusMessage(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const getNormalizedPointerPos = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): Point2D => {
      const canvas = maskCanvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      return { x, y };
    },
    []
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!sourceImg) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const pt = getNormalizedPointerPos(e);

    const newStroke: MaskStroke = {
      id: `stroke-${Date.now()}`,
      tool,
      fillMode,
      brushSize,
      points: tool === "brush" ? [pt] : [],
      rect: tool === "rect" ? { x: pt.x, y: pt.y, w: 0, h: 0 } : undefined,
      solidColor: "#F8FAFC",
    };
    setActiveStroke(newStroke);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !activeStroke) return;
    const pt = getNormalizedPointerPos(e);

    if (activeStroke.tool === "rect" && activeStroke.rect) {
      setActiveStroke({
        ...activeStroke,
        rect: {
          ...activeStroke.rect,
          w: pt.x - activeStroke.rect.x,
          h: pt.y - activeStroke.rect.y,
        },
      });
    } else if (activeStroke.tool === "brush") {
      setActiveStroke({
        ...activeStroke,
        points: [...activeStroke.points, pt],
      });
    }
  };

  const handlePointerUp = () => {
    if (!isDrawingRef.current || !activeStroke) return;
    isDrawingRef.current = false;

    const validRect =
      activeStroke.tool === "rect" &&
      activeStroke.rect &&
      (Math.abs(activeStroke.rect.w) > 0.01 ||
        Math.abs(activeStroke.rect.h) > 0.01);
    const validBrush =
      activeStroke.tool === "brush" && activeStroke.points.length > 0;

    if (validRect || validBrush) {
      setStrokes((prev) => [...prev, activeStroke]);
      setRedoStack([]);
    }
    setActiveStroke(null);
  };

  const handleUndo = () => {
    if (strokes.length === 0) return;
    const last = strokes[strokes.length - 1];
    setStrokes((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, last]);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setStrokes((prev) => [...prev, next]);
  };

  const handleExport = async (format: "png" | "jpeg") => {
    if (!sourceImg) return;
    const exportCanvas = document.createElement("canvas");
    await renderRecreatedCanvas(exportCanvas, sourceImg, strokes, config);
    const mime = format === "jpeg" ? "image/jpeg" : "image/png";
    const dataUrl = exportCanvas.toDataURL(mime, 0.94);

    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `promosafe-${config.aspectRatio.replace(":", "x")}-${Date.now()}.${
      format === "jpeg" ? "jpg" : "png"
    }`;
    link.click();

    onSaveImageSnapshot({
      outputDataUrl: dataUrl,
      aspectRatio: config.aspectRatio,
      backgroundId: config.backgroundId,
    });
    setStatusMessage("已导出高清二创图并自动保存到历史记录。");
  };

  const ratioButtons: Array<{ id: AspectRatioOption; label: string }> = [
    { id: "3:4", label: "3:4 小红书竖版" },
    { id: "1:1", label: "1:1 方形" },
    { id: "16:9", label: "16:9 横版" },
  ];

  const fillModeButtons: Array<{ id: MaskFillMode; label: string }> = [
    { id: "edge_sample", label: "智能取边色抹除" },
    { id: "blur", label: "马赛克打码" },
    { id: "solid", label: "纯色遮盖" },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Controls */}
      <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              本地 Canvas 去敏重排工具
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              100% 浏览器本地处理 · 零网络依赖 · 零费用
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const sampleUrl = createSamplePromoImageDataUrl();
              if (sampleUrl) {
                setSourceDataUrl(sampleUrl);
                setStrokes([]);
                setRedoStack([]);
                setPreviewTab("mask");
                setStatusMessage("已载入示例活动原图，试试框选顶部银行名称或右下角二维码。");
              }
            }}
            className="px-3 py-1.5 text-xs font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            加载示例原图
          </button>
        </div>

        {/* Upload / Paste Trigger */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleFileChange(e.target.files?.[0])}
            className="hidden"
          />
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFileChange(e.dataTransfer.files?.[0]);
            }}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                fileInputRef.current?.click();
              }
            }}
            className="border border-dashed border-slate-300 hover:border-rose-400 bg-slate-50/60 hover:bg-rose-50/30 rounded-lg p-4 text-center cursor-pointer transition-colors"
          >
            <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white border border-slate-200 text-slate-600 mb-2">
              <ImagePlus className="w-4 h-4" />
            </div>
            <div className="text-sm font-medium text-slate-800">
              点击上传、拖拽图片，或直接 Ctrl+V 粘贴截图
            </div>
            <div className="text-xs text-slate-500 mt-1">
              支持活动长图、手机截图，原图文字清晰度 100% 保留
            </div>
          </div>
        </div>

        {/* 1. Masking / Erasure Tools */}
        <div className="pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              01. 涂抹或框选擦除敏感元素
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleUndo}
                disabled={strokes.length === 0}
                title="撤销"
                className="p-1.5 text-slate-600 hover:text-slate-900 disabled:opacity-35 rounded hover:bg-slate-100 cursor-pointer"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={redoStack.length === 0}
                title="重做"
                className="p-1.5 text-slate-600 hover:text-slate-900 disabled:opacity-35 rounded hover:bg-slate-100 cursor-pointer"
              >
                <Redo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setStrokes([]);
                  setRedoStack([]);
                }}
                disabled={strokes.length === 0}
                title="清空全部涂抹"
                className="p-1.5 text-slate-600 hover:text-rose-600 disabled:opacity-35 rounded hover:bg-slate-100 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              type="button"
              onClick={() => {
                setTool("rect");
                setPreviewTab("mask");
              }}
              className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                tool === "rect"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
            >
              <Square className="w-3.5 h-3.5" />
              矩形框选擦除
            </button>
            <button
              type="button"
              onClick={() => {
                setTool("brush");
                setPreviewTab("mask");
              }}
              className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                tool === "brush"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
            >
              <Brush className="w-3.5 h-3.5" />
              画笔涂抹擦除
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
            {fillModeButtons.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setFillMode(m.id)}
                className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  fillMode === m.id
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {tool === "brush" && (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs text-slate-500 whitespace-nowrap">
                画笔粗细
              </span>
              <input
                type="range"
                min={0.015}
                max={0.12}
                step={0.005}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="flex-1 accent-rose-600"
              />
              <span className="text-xs font-mono text-slate-600 tabular-nums w-10 text-right">
                {Math.round(brushSize * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* 2. Output Aspect Ratio & Background Presets */}
        <div className="pt-4 border-t border-slate-100 space-y-4">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5">
              02. 输出画幅与全新质感背景
            </div>
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
              {ratioButtons.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() =>
                    setConfig((prev) => ({ ...prev, aspectRatio: r.id }))
                  }
                  className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    config.aspectRatio === r.id
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-2">
              选择内置背景底图（静态打包 · 0 运行时费用）
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {BACKGROUND_PRESETS.map((bg) => {
                const selected = config.backgroundId === bg.id;
                return (
                  <button
                    key={bg.id}
                    type="button"
                    onClick={() => {
                      setConfig((prev) => ({ ...prev, backgroundId: bg.id }));
                      if (previewTab === "mask" && sourceImg) {
                        setPreviewTab("result");
                      }
                    }}
                    className={`group text-left rounded-lg border p-1.5 transition-colors cursor-pointer ${
                      selected
                        ? "border-rose-600 bg-rose-50/40"
                        : "border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                  >
                    <div className="h-12 w-full rounded overflow-hidden border border-slate-100">
                      {bg.kind === "image" ? (
                        <img
                          src={bg.value}
                          alt={bg.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : bg.kind === "gradient" ? (
                        <div
                          className="w-full h-full"
                          style={{
                            background: `linear-gradient(135deg, ${bg.value}, ${
                              bg.secondaryValue || bg.value
                            })`,
                          }}
                        />
                      ) : (
                        <div
                          className="w-full h-full"
                          style={{ backgroundColor: bg.value }}
                        />
                      )}
                    </div>
                    <div className="text-[11px] font-medium text-slate-700 mt-1.5 truncate">
                      {bg.name}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 3. Card Styling & Fingerprint Perturbation */}
        <div className="pt-4 border-t border-slate-100 space-y-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            03. 排版与防查重微调
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <div className="flex justify-between text-xs text-slate-600 mb-1 tabular-nums">
                <span>留白边距</span>
                <span className="font-mono">{config.paddingPercent}%</span>
              </div>
              <input
                type="range"
                min={4}
                max={18}
                value={config.paddingPercent}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    paddingPercent: Number(e.target.value),
                  }))
                }
                className="w-full accent-rose-600"
              />
            </label>

            <label className="block">
              <div className="flex justify-between text-xs text-slate-600 mb-1 tabular-nums">
                <span>卡片圆角</span>
                <span className="font-mono">{config.borderRadius}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={48}
                step={2}
                value={config.borderRadius}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    borderRadius: Number(e.target.value),
                  }))
                }
                className="w-full accent-rose-600"
              />
            </label>
          </div>

          <div>
            <label className="block text-xs text-slate-600 mb-1">
              底部安全提示角标（留空则不显示）
            </label>
            <input
              type="text"
              value={config.footerText}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, footerText: e.target.value }))
              }
              placeholder="例如：信息整理自公开渠道 · 具体以官方页面为准"
              className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-900 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/15"
            />
          </div>

          <label className="flex items-center justify-between gap-3 pt-1 cursor-pointer">
            <div>
              <div className="text-xs font-medium text-slate-800">
                开启轻量像素指纹刷新
              </div>
              <div className="text-[11px] text-slate-500">
                微幅重排哈希与像素扰动，降低平台原图查重限流概率
              </div>
            </div>
            <input
              type="checkbox"
              checked={config.perturbFingerprint}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  perturbFingerprint: e.target.checked,
                }))
              }
              className="w-4 h-4 accent-rose-600 rounded"
            />
          </label>
        </div>

        {/* Export Actions */}
        <div className="pt-4 border-t border-slate-100 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!sourceImg}
            onClick={() => handleExport("png")}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            导出高清成图 (PNG)
          </button>
          <button
            type="button"
            disabled={!sourceImg}
            onClick={() => handleExport("jpeg")}
            className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            导出 JPG
          </button>
        </div>

        {statusMessage && (
          <div className="px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
            {statusMessage}
          </div>
        )}
      </section>

      {/* Right Preview / Masking Canvas */}
      <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 min-h-[620px]">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
            <span className="font-semibold text-slate-900">交互画布工作区</span>
            <span aria-hidden="true">·</span>
            <span>画幅 {config.aspectRatio}</span>
            <span aria-hidden="true">·</span>
            <span>已涂抹 {strokes.length} 处</span>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setPreviewTab("mask")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                previewTab === "mask"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              1. 框选/涂抹去敏
            </button>
            <button
              type="button"
              onClick={() => setPreviewTab("result")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                previewTab === "result"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              2. 换底成图预览
            </button>
            <button
              type="button"
              onClick={() => setPreviewTab("compare")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                previewTab === "compare"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              3. 原图对比
            </button>
          </div>
        </div>

        {!sourceImg ? (
          <div className="h-[520px] flex flex-col items-center justify-center text-center px-6">
            <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mb-4">
              <ImagePlus className="w-5 h-5" />
            </div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              尚未导入活动原图
            </h3>
            <p className="text-sm text-slate-500 max-w-md mt-2 leading-relaxed">
              上传或直接 Ctrl+V 粘贴活动截图，即可在画布上框选抹除银行 Logo、二维码和限流文字，并套用内置 3:4 小红书质感背景重排导出。
            </p>
            <button
              type="button"
              onClick={() => {
                const sampleUrl = createSamplePromoImageDataUrl();
                if (sampleUrl) {
                  setSourceDataUrl(sampleUrl);
                  setStrokes([]);
                  setRedoStack([]);
                  setPreviewTab("mask");
                }
              }}
              className="mt-5 px-4 py-2 text-sm font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              载入示例活动原图试玩
            </button>
          </div>
        ) : previewTab === "mask" ? (
          <div className="pt-5">
            <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
              <span>
                在下方原图上按住鼠标拖动，即可用「
                {fillMode === "edge_sample"
                  ? "智能取边色"
                  : fillMode === "blur"
                    ? "马赛克打码"
                    : "纯色遮盖"}
                」抹除敏感区域
              </span>
              <button
                type="button"
                onClick={() => setPreviewTab("result")}
                className="font-medium text-rose-600 hover:text-rose-700 cursor-pointer whitespace-nowrap"
              >
                查看 3:4 换底效果 →
              </button>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-100/70 p-4 flex items-center justify-center overflow-hidden">
              <canvas
                ref={maskCanvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className="max-h-[540px] max-w-full w-auto h-auto rounded shadow-sm cursor-crosshair touch-none select-none"
              />
            </div>
          </div>
        ) : previewTab === "result" ? (
          <div className="pt-5 flex flex-col items-center">
            <div className="rounded-lg border border-slate-200 bg-slate-100/70 p-4 w-full flex items-center justify-center">
              {outputPreviewUrl ? (
                <img
                  src={outputPreviewUrl}
                  alt="二创成图预览"
                  referrerPolicy="no-referrer"
                  className="max-h-[560px] max-w-full w-auto h-auto rounded shadow-sm"
                />
              ) : (
                <div className="h-[460px] w-[345px] bg-slate-200 animate-pulse rounded" />
              )}
            </div>
          </div>
        ) : (
          <div className="pt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-medium text-slate-500 mb-2">
                原图（含敏感信息与原背景）
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-center justify-center h-[460px]">
                <img
                  src={sourceDataUrl || ""}
                  alt="活动原图"
                  referrerPolicy="no-referrer"
                  className="max-h-full max-w-full object-contain rounded"
                />
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-emerald-700 mb-2">
                二创成图（已脱敏 · {config.aspectRatio} 新背景）
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-center justify-center h-[460px]">
                {outputPreviewUrl && (
                  <img
                    src={outputPreviewUrl}
                    alt="二创成图"
                    referrerPolicy="no-referrer"
                    className="max-h-full max-w-full object-contain rounded shadow-sm"
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
