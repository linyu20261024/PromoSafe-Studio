import type { ActiveTab } from "../types/index.ts";

interface TopBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onResetWorkspace: () => void;
  ruleCount: number;
  historyCount: number;
}

export function TopBar({
  activeTab,
  onSelectTab,
  onResetWorkspace,
  ruleCount,
  historyCount,
}: TopBarProps) {
  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: "workbench", label: "创作工作台" },
    { id: "dictionary", label: `敏感词库 (${ruleCount})` },
    { id: "history", label: `历史记录 (${historyCount})` },
  ];

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element Brand Wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab("workbench")}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 rounded"
        >
          PromoSafe Studio
        </button>

        {/* Zone 2: Clean single-line navigation links */}
        <nav
          aria-label="主导航"
          className="flex items-center gap-6 overflow-x-auto"
        >
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
                  isActive
                    ? "text-rose-600"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-rose-600"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={onResetWorkspace}
            className="px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
          >
            新建创作
          </button>
        </div>
      </div>
    </header>
  );
}
