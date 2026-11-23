import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  ImagePlus,
  RefreshCw,
  RotateCcw,
  ScanText,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { CATEGORY_LABELS, SAMPLE_DEAL_PRESETS } from "../data/defaultDictionary.ts";
import type { CopyResult, CopyStyle, SensitiveRule } from "../types/index.ts";
import {
  applySensitiveDictionary,
  reapplyDictionaryToResult,
  runLocalCopyEngine,
} from "../utils/copyEngine.ts";
import { createSamplePromoImageDataUrl } from "../utils/imageCanvasEngine.ts";
import { type OcrPreprocessMode, runLocalImageOcr } from "../utils/ocrEngine.ts";

interface CopyWorkbenchProps {
  rules: SensitiveRule[];
  rawText: string;
  onChangeRawText: (val: string) => void;
  style: CopyStyle;
  onChangeStyle: (style: CopyStyle) => void;
  result: CopyResult | null;
  onUpdateResult: (res: CopyResult | null) => void;
  onSaveSnapshot: (copyResult: CopyResult) => void;
  screenshotDataUrl: string | null;
  onChangeScreenshotDataUrl: (url: string | null) => void;
  onSendScreenshotToImageStudio: () => void;
}

export function CopyWorkbench({
  rules,
  rawText,
  onChangeRawText,
  style,
  onChangeStyle,
  result,
  onUpdateResult,
  onSaveSnapshot,
  screenshotDataUrl,
  onChangeScreenshotDataUrl,
  onSendScreenshotToImageStudio,
}: CopyWorkbenchProps) {
  const [viewMode, setViewMode] = useState<"diff" | "clean">("diff");
  const [aiLoading, setAiLoading] = useState(false);
  const [ocrMode, setOcrMode] = useState<OcrPreprocessMode>("adaptive_contrast");
  const [ocrStatus, setOcrStatus] = useState<{
    progress: number;
    text: string;
  } | null>(null);
  const [notice, setNotice] = useState<{
    type: "info" | "warning" | "error";
    text: string;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Support Ctrl+V / Cmd+V screenshot paste directly into CopyWorkbench
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
                onChangeScreenshotDataUrl(reader.result);
                setNotice({
                  type: "info",
                  text: "已从剪贴板导入活动截图，点击「识字并提炼」即可提取文字并按所选风格生成文案。",
                });
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
  }, [onChangeScreenshotDataUrl]);

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1800);
    } catch {
      setNotice({ type: "error", text: "剪贴板写入受限，请手动选中复制。" });
    }
  };

  const handleScreenshotFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice({ type: "warning", text: "请上传 PNG、JPG 或 WebP 格式的活动截图。" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onChangeScreenshotDataUrl(reader.result);
        setNotice(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleLocalOcrExtract = async () => {
    if (!screenshotDataUrl) {
      setNotice({ type: "warning", text: "请先上传或粘贴一张活动截图。" });
      return;
    }
    setNotice(null);
    setOcrStatus({ progress: 5, text: "正在预处理活动截图..." });

    try {
      const recognized = await runLocalImageOcr(
        screenshotDataUrl,
        ocrMode,
        (progress, text) => {
          setOcrStatus({ progress, text });
        }
      );

      if (!recognized.trim()) {
        setNotice({
          type: "warning",
          text: "本地未能从该图中识别出清晰文字，可尝试切换「复杂花底强去噪」模式或手动补充原文。",
        });
        return;
      }

      onChangeRawText(recognized);
      const localResult = runLocalCopyEngine(recognized, style, rules);
      onUpdateResult(localResult);
      setNotice({
        type: "info",
        text: "已完成截图预处理识字并按所选风格生成文案；如背景干扰导致个别金额或日期偏差，可在下方原文框微调后点「本地极速提炼去敏」刷新。",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "本地识字加载失败";
      setNotice({
        type: "error",
        text: `本地离线识字引擎异常（${msg}），请检查网络能否加载语言包，或直接粘贴活动文本。`,
      });
    } finally {
      setOcrStatus(null);
    }
  };

  const handleAiImageExtract = async () => {
    if (!screenshotDataUrl) {
      setNotice({ type: "warning", text: "请先上传或粘贴一张活动截图。" });
      return;
    }

    if (
      typeof window !== "undefined" &&
      window.location.hostname.endsWith("github.io")
    ) {
      await handleLocalOcrExtract();
      return;
    }

    setAiLoading(true);
    setNotice(null);

    try {
      const [header, base64Data] = screenshotDataUrl.split(",");
      const mimeMatch = header?.match(/^data:(image\/[^;]+);base64$/);
      const mimeType = mimeMatch?.[1] || "image/png";
      const enabledSummary = rules
        .filter((r) => r.enabled)
        .map((r) => ({ pattern: r.pattern, replacement: r.replacement }));

      const res = await fetch("/api/copy/extract-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64Data || "",
          mimeType,
          style,
          dictionarySummary: enabledSummary,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.body) {
        setAiLoading(false);
        setNotice({
          type: "info",
          text:
            data?.error ||
            "当前环境无法连接云端识图接口，已自动切换本地预处理识别引擎提取文案。",
        });
        await handleLocalOcrExtract();
        return;
      }

      const extractedRawText = String(data.extractedRawText || "").trim();
      if (extractedRawText) {
        onChangeRawText(extractedRawText);
      }

      const bodyProcessed = applySensitiveDictionary(String(data.body), rules);
      const titles = Array.isArray(data.titles)
        ? data.titles.map((t: { styleLabel?: string; text?: string }) => ({
            styleLabel: String(t.styleLabel || "推荐标题"),
            text: applySensitiveDictionary(String(t.text || ""), rules).cleanText,
          }))
        : [];

      const highlights = {
        institutionAlias: applySensitiveDictionary(
          String(data.highlights?.institutionAlias || "优惠活动"),
          rules
        ).cleanText,
        benefitAmount: applySensitiveDictionary(
          String(data.highlights?.benefitAmount || "详见活动说明"),
          rules
        ).cleanText,
        threshold: applySensitiveDictionary(
          String(data.highlights?.threshold || "以页面规则为准"),
          rules
        ).cleanText,
        validityPeriod: applySensitiveDictionary(
          String(data.highlights?.validityPeriod || "近期开放"),
          rules
        ).cleanText,
        claimPath: applySensitiveDictionary(
          String(data.highlights?.claimPath || "官方入口参与"),
          rules
        ).cleanText,
        quotaNote: applySensitiveDictionary(
          String(data.highlights?.quotaNote || "名额有限先到先得"),
          rules
        ).cleanText,
      };

      onUpdateResult({
        sourceText: extractedRawText || rawText,
        style,
        engineMode: "ai_enhanced",
        highlights,
        titles,
        cleanBody: bodyProcessed.cleanText,
        rawBeforeDictBody: String(data.body),
        diffSegments: bodyProcessed.diffSegments,
        matches: bodyProcessed.matches,
        timestamp: Date.now(),
      });
    } catch {
      setAiLoading(false);
      await handleLocalOcrExtract();
    } finally {
      setAiLoading(false);
    }
  };

  const handleLocalExtract = () => {
    const trimmed = rawText.trim();
    if (!trimmed) {
      setNotice({
        type: "warning",
        text: "请先在下方输入原文，或先上传一张活动截图提取文字。",
      });
      return;
    }
    setNotice(null);
    const localResult = runLocalCopyEngine(trimmed, style, rules);
    onUpdateResult(localResult);
  };

  const handleAiEnhance = async () => {
    const trimmed = rawText.trim();
    if (!trimmed) {
      if (screenshotDataUrl) {
        await handleAiImageExtract();
        return;
      }
      setNotice({ type: "warning", text: "请先输入活动公告原文或上传活动截图。" });
      return;
    }

    if (
      typeof window !== "undefined" &&
      window.location.hostname.endsWith("github.io")
    ) {
      const fallback = runLocalCopyEngine(trimmed, style, rules);
      onUpdateResult(fallback);
      setNotice({
        type: "info",
        text: "当前运行在 GitHub Pages 纯静态托管环境（无后端代理），已直接使用本地免费引擎完成提炼与去敏。",
      });
      return;
    }

    setAiLoading(true);
    setNotice(null);

    try {
      const enabledSummary = rules
        .filter((r) => r.enabled)
        .map((r) => ({ pattern: r.pattern, replacement: r.replacement }));

      const res = await fetch("/api/copy/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText: trimmed,
          style,
          dictionarySummary: enabledSummary,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.body) {
        const fallback = runLocalCopyEngine(trimmed, style, rules);
        onUpdateResult(fallback);
        setNotice({
          type: "info",
          text:
            data?.error ||
            "当前网络或静态环境无法连接云端润色接口，已自动使用本地免费引擎完成提炼与去敏。",
        });
        return;
      }

      const bodyProcessed = applySensitiveDictionary(String(data.body), rules);
      const titles = Array.isArray(data.titles)
        ? data.titles.map((t: { styleLabel?: string; text?: string }) => ({
            styleLabel: String(t.styleLabel || "推荐标题"),
            text: applySensitiveDictionary(String(t.text || ""), rules).cleanText,
          }))
        : [];

      const highlights = {
        institutionAlias: applySensitiveDictionary(
          String(data.highlights?.institutionAlias || "优惠活动"),
          rules
        ).cleanText,
        benefitAmount: applySensitiveDictionary(
          String(data.highlights?.benefitAmount || "详见活动说明"),
          rules
        ).cleanText,
        threshold: applySensitiveDictionary(
          String(data.highlights?.threshold || "以页面规则为准"),
          rules
        ).cleanText,
        validityPeriod: applySensitiveDictionary(
          String(data.highlights?.validityPeriod || "近期开放"),
          rules
        ).cleanText,
        claimPath: applySensitiveDictionary(
          String(data.highlights?.claimPath || "官方入口参与"),
          rules
        ).cleanText,
        quotaNote: applySensitiveDictionary(
          String(data.highlights?.quotaNote || "名额有限先到先得"),
          rules
        ).cleanText,
      };

      onUpdateResult({
        sourceText: trimmed,
        style,
        engineMode: "ai_enhanced",
        highlights,
        titles,
        cleanBody: bodyProcessed.cleanText,
        rawBeforeDictBody: String(data.body),
        diffSegments: bodyProcessed.diffSegments,
        matches: bodyProcessed.matches,
        timestamp: Date.now(),
      });
    } catch {
      const fallback = runLocalCopyEngine(trimmed, style, rules);
      onUpdateResult(fallback);
      setNotice({
        type: "info",
        text: "当前处于纯静态或离线网络环境，已无缝切换至本地免费引擎完成提炼与去敏。",
      });
    } finally {
      setAiLoading(false);
    }
  };

  const handleReapplyDict = () => {
    if (!result) return;
    const updated = reapplyDictionaryToResult(result, rules);
    onUpdateResult(updated);
    setNotice({ type: "info", text: "已按最新敏感词库重新校验并更新替换结果。" });
  };

  const styleOptions: Array<{ id: CopyStyle; label: string }> = [
    { id: "step_by_step", label: "保姆级攻略" },
    { id: "value_highlight", label: "省钱干货" },
    { id: "minimal_list", label: "极简清单" },
  ];

  const highlightFields = result
    ? [
        { label: "活动主体（已脱敏）", value: result.highlights.institutionAlias },
        { label: "补贴与优惠力度", value: result.highlights.benefitAmount },
        { label: "参与条件 / 门槛", value: result.highlights.threshold },
        { label: "活动时间周期", value: result.highlights.validityPeriod },
        { label: "参与入口路径", value: result.highlights.claimPath },
        { label: "名额与次数说明", value: result.highlights.quotaNote },
      ]
    : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column: Screenshot OCR + Text Input & Style Controls */}
      <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              活动截图识字 / 原文输入
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              支持直接贴入活动截图提取初步文案，或粘贴公告原文
            </p>
          </div>
          {(rawText || screenshotDataUrl) && (
            <button
              type="button"
              onClick={() => {
                onChangeRawText("");
                onChangeScreenshotDataUrl(null);
                onUpdateResult(null);
                setNotice(null);
              }}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              清空
            </button>
          )}
        </div>

        {/* Screenshot Upload / Paste Zone */}
        <div className="mt-4 pb-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-600">
              01. 活动截图提字（可选 · 支持 Ctrl+V 粘贴）
            </span>
            {!screenshotDataUrl && (
              <button
                type="button"
                onClick={() => {
                  const sampleUrl = createSamplePromoImageDataUrl();
                  if (sampleUrl) {
                    onChangeScreenshotDataUrl(sampleUrl);
                    setNotice(null);
                  }
                }}
                className="text-xs font-medium text-rose-600 hover:text-rose-700 cursor-pointer whitespace-nowrap"
              >
                载入示例活动图
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleScreenshotFile(e.target.files?.[0])}
            className="hidden"
          />

          {!screenshotDataUrl ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleScreenshotFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  fileInputRef.current?.click();
                }
              }}
              className="border border-dashed border-slate-300 hover:border-rose-400 bg-slate-50/70 hover:bg-rose-50/30 rounded-lg px-4 py-3.5 flex items-center gap-3 cursor-pointer transition-colors"
            >
              <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 text-slate-500 flex items-center justify-center shrink-0">
                <ImagePlus className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-800">
                  点击上传、拖拽或直接 Ctrl+V 粘贴活动截图
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  内置抗背景对比增强，自动提取文字后按右侧所选风格出稿
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-3">
              <div className="flex items-start gap-3">
                <img
                  src={screenshotDataUrl}
                  alt="待提字的活动截图"
                  referrerPolicy="no-referrer"
                  className="w-16 h-20 object-cover rounded border border-slate-200 bg-white shrink-0"
                />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-800">
                      已导入活动截图
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                      >
                        换图
                      </button>
                      <button
                        type="button"
                        onClick={() => onChangeScreenshotDataUrl(null)}
                        aria-label="移除截图"
                        className="text-slate-400 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Background preprocessing mode selector */}
                  <div className="grid grid-cols-2 gap-1 p-0.5 bg-slate-200/70 rounded-md">
                    <button
                      type="button"
                      onClick={() => setOcrMode("adaptive_contrast")}
                      className={`py-1 px-2 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                        ocrMode === "adaptive_contrast"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      常规对比增强
                    </button>
                    <button
                      type="button"
                      onClick={() => setOcrMode("denoise_binary")}
                      className={`py-1 px-2 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                        ocrMode === "denoise_binary"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      复杂花底强去噪
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={onSendScreenshotToImageStudio}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:text-rose-700 cursor-pointer"
                  >
                    将此图直接带入「图片去敏与 3:4 换底」
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {ocrStatus && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-600 tabular-nums">
                    <span>{ocrStatus.text}</span>
                    <span className="font-mono">{ocrStatus.progress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-rose-600 transition-all duration-150"
                      style={{ width: `${ocrStatus.progress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={Boolean(ocrStatus) || aiLoading}
                  onClick={handleLocalOcrExtract}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  <ScanText className="w-3.5 h-3.5" />
                  {ocrStatus ? "识别中..." : "本地离线识字并提炼"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(ocrStatus) || aiLoading}
                  onClick={handleAiImageExtract}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-rose-600" />
                  {aiLoading ? "识图生成中..." : "AI 精准识图提炼"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sample Text Presets */}
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-500 mb-2">
            或快速填入文本测试样例
          </div>
          <div className="flex flex-wrap gap-2">
            {SAMPLE_DEAL_PRESETS.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => {
                  onChangeRawText(sample.text);
                  setNotice(null);
                }}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200/80 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {sample.label}
              </button>
            ))}
          </div>
        </div>

        {/* Raw / OCR Extracted Textarea */}
        <div className="mt-3">
          <textarea
            value={rawText}
            onChange={(e) => onChangeRawText(e.target.value)}
            placeholder="截图识别出的初步文字会自动回填至此（方便核对金额与日期），也可直接粘贴公告原文..."
            rows={7}
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3.5 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/15 resize-y leading-relaxed"
          />
          <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500 tabular-nums">
            <span>本地规则与识字引擎均在浏览器运行（0 费用）</span>
            <span className="font-mono">{rawText.length} 字</span>
          </div>
        </div>

        {/* Copy Style Selector */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="text-xs font-medium text-slate-500 mb-2">
            输出文案风格
          </div>
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
            {styleOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onChangeStyle(opt.id);
                  if (rawText.trim() && result?.engineMode === "local") {
                    onUpdateResult(runLocalCopyEngine(rawText.trim(), opt.id, rules));
                  }
                }}
                className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  style === opt.id
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={handleLocalExtract}
            disabled={aiLoading || Boolean(ocrStatus)}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Zap className="w-4 h-4" />
            本地极速提炼去敏
          </button>
          <button
            type="button"
            onClick={handleAiEnhance}
            disabled={aiLoading || Boolean(ocrStatus)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200/80 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-rose-600" />
            {aiLoading ? "润色中..." : "AI 深度润色"}
          </button>
        </div>

        {notice && (
          <div
            role="status"
            className={`mt-4 px-3.5 py-2.5 rounded-lg border text-xs leading-relaxed ${
              notice.type === "error"
                ? "bg-red-50 border-red-200 text-red-700"
                : notice.type === "warning"
                  ? "bg-amber-50 border-amber-200 text-amber-800"
                  : "bg-slate-50 border-slate-200 text-slate-600"
            }`}
          >
            {notice.text}
          </div>
        )}
      </section>

      {/* Right Column: Structured Output & Diff Review */}
      <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 min-h-[580px]">
        {aiLoading ? (
          <div className="space-y-6 animate-pulse">
            <div className="h-5 w-48 bg-slate-200 rounded" />
            <div className="space-y-3">
              <div className="h-11 bg-slate-100 rounded-lg" />
              <div className="h-11 bg-slate-100 rounded-lg" />
              <div className="h-11 bg-slate-100 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
              <div className="h-14 bg-slate-100 rounded-lg" />
              <div className="h-14 bg-slate-100 rounded-lg" />
              <div className="h-14 bg-slate-100 rounded-lg" />
              <div className="h-14 bg-slate-100 rounded-lg" />
            </div>
            <div className="h-44 bg-slate-100 rounded-lg" />
          </div>
        ) : !result ? (
          <div className="h-[520px] flex flex-col items-center justify-center text-center px-6">
            <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mb-4">
              <ScanText className="w-5 h-5" />
            </div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              等待提炼活动截图或文案
            </h3>
            <p className="text-sm text-slate-500 max-w-md mt-2 leading-relaxed">
              在左侧直接上传 / Ctrl+V 粘贴活动截图，或填入活动原文，即可按所选风格自动生成小红书吸睛标题、6 项重点清单与敏感词高亮对比正文。
            </p>
            <button
              type="button"
              onClick={() => {
                const sample = SAMPLE_DEAL_PRESETS[0];
                onChangeRawText(sample.text);
                onUpdateResult(runLocalCopyEngine(sample.text, style, rules));
              }}
              className="mt-5 px-4 py-2 text-sm font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              立即用银行卡样例试运行
            </button>
          </div>
        ) : (
          <div>
            {/* Output Meta Line */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                <span className="font-semibold text-slate-900">
                  {result.engineMode === "ai_enhanced"
                    ? "云端 AI + 词库校验"
                    : "本地离线引擎"}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  已拦截替换{" "}
                  <strong className="font-mono text-emerald-700">
                    {result.matches.reduce((acc, m) => acc + m.count, 0)}
                  </strong>{" "}
                  处高危词
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{result.cleanBody.length} 字</span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleReapplyDict}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  同步最新词库
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSaveSnapshot(result);
                    setCopiedKey("saved-hist");
                    setTimeout(() => {
                      setCopiedKey((prev) =>
                        prev === "saved-hist" ? null : prev
                      );
                    }, 1800);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedKey === "saved-hist" ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      已存历史
                    </>
                  ) : (
                    "存至历史"
                  )}
                </button>
              </div>
            </div>

            {/* 1. Catchy Titles */}
            <div className="pt-5">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                01. 小红书爆款标题候选
              </h3>
              <div className="divide-y divide-slate-100 border-y border-slate-100">
                {result.titles.map((t, idx) => {
                  const key = `title-${idx}`;
                  const isCopied = copiedKey === key;
                  return (
                    <div
                      key={key}
                      className="py-2.5 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <div className="text-xs text-slate-400 mb-0.5">
                          {t.styleLabel}
                        </div>
                        <div className="text-sm font-semibold text-slate-900 break-words">
                          {t.text}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(t.text, key)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            已复制
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            复制
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. Extracted Highlights */}
            <div className="pt-6">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                02. 关键活动要素提炼
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 border-b border-slate-100 pb-5">
                {highlightFields.map((field) => (
                  <div key={field.label} className="min-w-0">
                    <div className="text-xs text-slate-500">{field.label}</div>
                    <div className="text-sm font-medium text-slate-900 mt-0.5 tabular-nums break-words">
                      {field.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. Compliant Body Copy + Diff Reviewer */}
            <div className="pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  03. 合规改写正文
                </h3>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setViewMode("diff")}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        viewMode === "diff"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      脱敏高亮审阅
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("clean")}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        viewMode === "clean"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      纯净复制文本
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopy(result.cleanBody, "full-body")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copiedKey === "full-body" ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        已复制正文
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        复制完整正文
                      </>
                    )}
                  </button>
                </div>
              </div>

              {viewMode === "diff" ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-800 leading-7 whitespace-pre-wrap">
                  {result.diffSegments.map((seg, i) =>
                    seg.type === "replaced" ? (
                      <span
                        key={i}
                        title={`原词「${seg.original}」(${
                          seg.category ? CATEGORY_LABELS[seg.category] : "风控词"
                        })`}
                        className="inline-flex items-baseline gap-1 mx-0.5 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-900"
                      >
                        <span className="line-through text-rose-500 text-xs">
                          {seg.original}
                        </span>
                        <span aria-hidden="true" className="text-slate-400 text-xs">
                          →
                        </span>
                        <span className="font-semibold">{seg.text}</span>
                      </span>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    )
                  )}
                </div>
              ) : (
                <textarea
                  value={result.cleanBody}
                  onChange={(e) =>
                    onUpdateResult({
                      ...result,
                      cleanBody: e.target.value,
                    })
                  }
                  rows={10}
                  className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 leading-7 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/15"
                />
              )}

              {result.matches.length > 0 && (
                <div className="mt-3 text-xs text-slate-500 leading-relaxed">
                  本次命中规则：
                  {result.matches
                    .map(
                      (m) =>
                        `「${m.original}」替换为「${m.replacement}」(${m.count}次)`
                    )
                    .join(" · ")}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
