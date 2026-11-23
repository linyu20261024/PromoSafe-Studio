import { useMemo, useState } from "react";
import { ArrowUpRight, Clock, Search, Trash2 } from "lucide-react";
import type { HistoryEntry } from "../types/index.ts";

interface HistoryViewProps {
  entries: HistoryEntry[];
  onRestoreEntry: (entry: HistoryEntry) => void;
  onDeleteEntry: (id: string) => void;
  onClearAll: () => void;
  onGoToWorkbench: () => void;
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export function HistoryView({
  entries,
  onRestoreEntry,
  onDeleteEntry,
  onClearAll,
  onGoToWorkbench,
}: HistoryViewProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q)
    );
  }, [entries, query]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-100">
        <div>
          <h1 className="font-display text-lg font-semibold text-slate-900">
            本地创作历史记录
          </h1>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            共保存 {entries.length} 条记录 · 仅保存在当前浏览器本地，隐私安全不上传
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-56 sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索历史标题或摘要..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-rose-500 focus:outline-none"
            />
          </div>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="px-3 py-2 text-xs font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              清空全部
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mb-4">
            <Clock className="w-5 h-5" />
          </div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            {entries.length === 0 ? "暂无历史创作记录" : "未搜索到匹配记录"}
          </h2>
          <p className="text-sm text-slate-500 max-w-md mt-2">
            {entries.length === 0
              ? "在工作台完成文案提炼点击「存至历史」，或导出二创图片时，系统会自动将本次快照保存于此。"
              : "尝试更换搜索关键词以查看其他记录。"}
          </p>
          {entries.length === 0 && (
            <button
              type="button"
              onClick={onGoToWorkbench}
              className="mt-5 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors cursor-pointer"
            >
              前往创作工作台
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 mt-2">
          {filtered.map((entry) => (
            <article
              key={entry.id}
              className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="flex items-start gap-4 min-w-0">
                {entry.imageSnapshot?.outputDataUrl && (
                  <img
                    src={entry.imageSnapshot.outputDataUrl}
                    alt={entry.title}
                    referrerPolicy="no-referrer"
                    className="w-16 h-20 rounded-lg border border-slate-200 object-cover shrink-0 bg-slate-50"
                  />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums mb-1">
                    <span className="font-mono">
                      {formatDateTime(entry.createdAt)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {entry.copyResult
                        ? entry.copyResult.engineMode === "ai_enhanced"
                          ? "AI润色 + 词库校验"
                          : "本地文案引擎"
                        : "图片二创快照"}
                    </span>
                    {entry.imageSnapshot && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>画幅 {entry.imageSnapshot.aspectRatio}</span>
                      </>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 truncate">
                    {entry.title}
                  </h3>
                  <p className="text-xs text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                    {entry.summary}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onRestoreEntry(entry)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  载入工作台
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteEntry(entry.id)}
                  aria-label="删除此条记录"
                  className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
