import { useState } from "react";
import {
  Check,
  Copy,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Zap,
} from "lucide-react";
import { CATEGORY_LABELS, SAMPLE_DEAL_PRESETS } from "../data/defaultDictionary.ts";
import type { CopyResult, CopyStyle, SensitiveRule } from "../types/index.ts";
import {
  applySensitiveDictionary,
  reapplyDictionaryToResult,
  runLocalCopyEngine,
} from "../utils/copyEngine.ts";

interface CopyWorkbenchProps {
  rules: SensitiveRule[];
  rawText: string;
  onChangeRawText: (val: string) => void;
  style: CopyStyle;
  onChangeStyle: (style: CopyStyle) => void;
  result: CopyResult | null;
  onUpdateResult: (res: CopyResult | null) => void;
  onSaveSnapshot: (copyResult: CopyResult) => void;
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
}: CopyWorkbenchProps) {
  const [viewMode, setViewMode] = useState<"diff" | "clean">("diff");
  const [aiLoading, setAiLoading] = useState(false);
  const [notice, setNotice] = useState<{
    type: "info" | "warning" | "error";
    text: string;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

  const handleLocalExtract = () => {
    const trimmed = rawText.trim();
    if (!trimmed) {
      setNotice({ type: "warning", text: "请先在左侧输入或粘贴活动公告原文。" });
      return;
    }
    setNotice(null);
    const localResult = runLocalCopyEngine(trimmed, style, rules);
    onUpdateResult(localResult);
  };

  const handleAiEnhance = async () => {
    const trimmed = rawText.trim();
    if (!trimmed) {
      setNotice({ type: "warning", text: "请先在左侧输入或粘贴活动公告原文。" });
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
      {/* Left Column: Input & Controls */}
      <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              活动原文输入
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              粘贴银行卡、支付平台或政府消费券公告全文
            </p>
          </div>
          {rawText && (
            <button
              type="button"
              onClick={() => {
                onChangeRawText("");
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

        {/* Sample Presets */}
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-500 mb-2">
            快速填入测试样例
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

        {/* Raw Textarea */}
        <div className="mt-4">
          <textarea
            value={rawText}
            onChange={(e) => onChangeRawText(e.target.value)}
            placeholder="在此粘贴活动规则原文，例如满减金额、银行卡要求、时间段、领取方式等..."
            rows={9}
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3.5 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/15 resize-y leading-relaxed"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500 tabular-nums">
            <span>本地规则引擎 100% 离线免费运行</span>
            <span className="font-mono">{rawText.length} 字</span>
          </div>
        </div>

        {/* Copy Style Selector */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <div className="text-xs font-medium text-slate-500 mb-2">
            输出文案风格
          </div>
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
            {styleOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeStyle(opt.id)}
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
            disabled={aiLoading}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Zap className="w-4 h-4" />
            本地极速提炼去敏
          </button>
          <button
            type="button"
            onClick={handleAiEnhance}
            disabled={aiLoading}
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
      <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 min-h-[540px]">
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
          <div className="h-[480px] flex flex-col items-center justify-center text-center px-6">
            <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mb-4">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              等待提炼活动文案
            </h3>
            <p className="text-sm text-slate-500 max-w-md mt-2 leading-relaxed">
              在左侧粘贴活动原文（或点击上方测试样例），点击「本地极速提炼去敏」，即可零费用生成小红书吸睛标题、结构化要点清单与敏感词高亮对比正文。
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
            {/* Output Meta Line (Zero-pill unboxed metadata) */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                <span className="font-semibold text-slate-900">
                  {result.engineMode === "ai_enhanced"
                    ? "云端 AI 润色 + 词库校验"
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

            {/* 2. Extracted Highlights (Flat grid with hairline dividers, no nested cards) */}
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

              {/* Replacement Audit Summary */}
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
