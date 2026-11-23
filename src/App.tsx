import { useEffect, useState } from "react";
import { FileText, Image as ImageIcon } from "lucide-react";
import { CopyWorkbench } from "./components/CopyWorkbench.tsx";
import { DictionaryView } from "./components/DictionaryView.tsx";
import { HistoryView } from "./components/HistoryView.tsx";
import { ImageStudio } from "./components/ImageStudio.tsx";
import { TopBar } from "./components/TopBar.tsx";
import type {
  ActiveTab,
  AspectRatioOption,
  CopyResult,
  CopyStyle,
  HistoryEntry,
  SensitiveRule,
} from "./types/index.ts";
import {
  loadHistoryEntries,
  loadSensitiveRules,
  saveHistoryEntries,
  saveSensitiveRules,
} from "./utils/storage.ts";

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("workbench");
  const [workbenchMode, setWorkbenchMode] = useState<"copy" | "image">("copy");

  const [rules, setRules] = useState<SensitiveRule[]>(() => loadSensitiveRules());
  const [history, setHistory] = useState<HistoryEntry[]>(() =>
    loadHistoryEntries()
  );

  // Workbench shared state
  const [rawText, setRawText] = useState("");
  const [copyStyle, setCopyStyle] = useState<CopyStyle>("step_by_step");
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);
  const [sharedScreenshotUrl, setSharedScreenshotUrl] = useState<string | null>(
    null
  );

  const [restoredImageSnapshot, setRestoredImageSnapshot] = useState<{
    outputDataUrl: string;
    aspectRatio: AspectRatioOption;
    backgroundId: string;
  } | null>(null);

  useEffect(() => {
    saveSensitiveRules(rules);
  }, [rules]);

  useEffect(() => {
    saveHistoryEntries(history);
  }, [history]);

  const handleResetWorkspace = () => {
    setRawText("");
    setCopyResult(null);
    setSharedScreenshotUrl(null);
    setRestoredImageSnapshot(null);
    setActiveTab("workbench");
  };

  const handleSaveCopySnapshot = (res: CopyResult) => {
    const newEntry: HistoryEntry = {
      id: `hist-${Date.now()}`,
      createdAt: Date.now(),
      title: res.titles[0]?.text || res.highlights.institutionAlias || "文案提炼记录",
      summary: res.cleanBody.slice(0, 140),
      copyResult: res,
    };
    setHistory((prev) => [newEntry, ...prev]);
  };

  const handleSaveImageSnapshot = (snapshot: {
    outputDataUrl: string;
    aspectRatio: AspectRatioOption;
    backgroundId: string;
  }) => {
    const newEntry: HistoryEntry = {
      id: `hist-img-${Date.now()}`,
      createdAt: Date.now(),
      title: copyResult?.titles[0]?.text || `配图二创（${snapshot.aspectRatio}）`,
      summary:
        copyResult?.cleanBody.slice(0, 120) ||
        `已完成 ${snapshot.aspectRatio} 竖版去敏换底成图导出`,
      copyResult: copyResult ?? undefined,
      imageSnapshot: snapshot,
    };
    setHistory((prev) => [newEntry, ...prev]);
  };

  const handleRestoreEntry = (entry: HistoryEntry) => {
    if (entry.copyResult) {
      setRawText(entry.copyResult.sourceText);
      setCopyStyle(entry.copyResult.style);
      setCopyResult(entry.copyResult);
      setWorkbenchMode("copy");
    }
    if (entry.imageSnapshot) {
      setRestoredImageSnapshot(entry.imageSnapshot);
      if (!entry.copyResult) {
        setWorkbenchMode("image");
      }
    }
    setActiveTab("workbench");
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onResetWorkspace={handleResetWorkspace}
        ruleCount={rules.filter((r) => r.enabled).length}
        historyCount={history.length}
      />

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-7">
        {activeTab === "workbench" && (
          <div>
            <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
                  小红书优惠笔记合规二创工作台
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                  支持活动截图识字提炼 · 精准规避导流与金融限流词 · 3:4 竖版涂抹去敏换底
                </p>
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
                <button
                  type="button"
                  onClick={() => setWorkbenchMode("copy")}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    workbenchMode === "copy"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <FileText className="w-4 h-4 text-rose-600" />
                  文案提炼与去敏
                </button>
                <button
                  type="button"
                  onClick={() => setWorkbenchMode("image")}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    workbenchMode === "image"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <ImageIcon className="w-4 h-4 text-rose-600" />
                  图片去敏与 3:4 换底
                </button>
              </div>
            </div>

            {workbenchMode === "copy" ? (
              <CopyWorkbench
                rules={rules}
                rawText={rawText}
                onChangeRawText={setRawText}
                style={copyStyle}
                onChangeStyle={setCopyStyle}
                result={copyResult}
                onUpdateResult={setCopyResult}
                onSaveSnapshot={handleSaveCopySnapshot}
                screenshotDataUrl={sharedScreenshotUrl}
                onChangeScreenshotDataUrl={setSharedScreenshotUrl}
                onSendScreenshotToImageStudio={() => setWorkbenchMode("image")}
              />
            ) : (
              <ImageStudio
                sharedSourceDataUrl={sharedScreenshotUrl}
                onChangeSharedSourceDataUrl={setSharedScreenshotUrl}
                onSaveImageSnapshot={handleSaveImageSnapshot}
                restoredSnapshot={restoredImageSnapshot}
              />
            )}
          </div>
        )}

        {activeTab === "dictionary" && (
          <DictionaryView rules={rules} onChangeRules={setRules} />
        )}

        {activeTab === "history" && (
          <HistoryView
            entries={history}
            onRestoreEntry={handleRestoreEntry}
            onDeleteEntry={(id) =>
              setHistory((prev) => prev.filter((item) => item.id !== id))
            }
            onClearAll={() => setHistory([])}
            onGoToWorkbench={() => setActiveTab("workbench")}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 px-6 mt-auto">
        <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span>PromoSafe Studio · 金融优惠自媒体合规二创工作台</span>
          <span>词库与历史记录均保存于本地浏览器 · 支持纯静态离线运行</span>
        </div>
      </footer>
    </div>
  );
}
