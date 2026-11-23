import { useMemo, useRef, useState } from "react";
import { Download, Plus, RotateCcw, Search, Trash2, Upload } from "lucide-react";
import {
  CATEGORY_LABELS,
  DEFAULT_SENSITIVE_RULES,
} from "../data/defaultDictionary.ts";
import type { SensitiveCategory, SensitiveRule } from "../types/index.ts";

interface DictionaryViewProps {
  rules: SensitiveRule[];
  onChangeRules: (next: SensitiveRule[]) => void;
}

export function DictionaryView({ rules, onChangeRules }: DictionaryViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<SensitiveCategory | "all">(
    "all"
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formPattern, setFormPattern] = useState("");
  const [formReplacement, setFormReplacement] = useState("");
  const [formCategory, setFormCategory] = useState<SensitiveCategory>("custom");
  const [formNote, setFormNote] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);

  const filteredRules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rules.filter((rule) => {
      if (categoryFilter !== "all" && rule.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        rule.pattern.toLowerCase().includes(q) ||
        rule.replacement.toLowerCase().includes(q) ||
        (rule.note ?? "").toLowerCase().includes(q)
      );
    });
  }, [rules, searchQuery, categoryFilter]);

  const enabledCount = useMemo(
    () => rules.filter((r) => r.enabled).length,
    [rules]
  );

  const openNewForm = () => {
    setEditingId(null);
    setFormPattern("");
    setFormReplacement("");
    setFormCategory("custom");
    setFormNote("");
    setShowAddForm(true);
    setFeedback(null);
  };

  const openEditForm = (rule: SensitiveRule) => {
    setEditingId(rule.id);
    setFormPattern(rule.pattern);
    setFormReplacement(rule.replacement);
    setFormCategory(rule.category);
    setFormNote(rule.note ?? "");
    setShowAddForm(true);
    setFeedback(null);
  };

  const handleSaveRule = (e: React.FormEvent) => {
    e.preventDefault();
    const pat = formPattern.trim();
    const rep = formReplacement.trim();
    if (!pat || !rep) {
      setFeedback("请填写敏感原词和安全替换词。");
      return;
    }

    if (editingId) {
      onChangeRules(
        rules.map((r) =>
          r.id === editingId
            ? {
                ...r,
                pattern: pat,
                replacement: rep,
                category: formCategory,
                note: formNote.trim() || undefined,
              }
            : r
        )
      );
      setFeedback("已更新替换规则。");
    } else {
      const newRule: SensitiveRule = {
        id: `custom-${Date.now()}`,
        pattern: pat,
        replacement: rep,
        category: formCategory,
        isBuiltin: false,
        enabled: true,
        note: formNote.trim() || undefined,
      };
      onChangeRules([newRule, ...rules]);
      setFeedback("已新增个人敏感词替换规则。");
    }

    setShowAddForm(false);
    setEditingId(null);
  };

  const handleToggleRule = (id: string) => {
    onChangeRules(
      rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const handleDeleteRule = (id: string) => {
    onChangeRules(rules.filter((r) => r.id !== id));
    setFeedback("已删除该条规则。");
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(rules, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `promosafe-dictionary-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFeedback("已导出个人词库 JSON 文件，可用于备份或迁移。");
  };

  const handleImportJson = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed)) {
          setFeedback("导入失败：JSON 格式应为规则数组。");
          return;
        }
        const valid: SensitiveRule[] = parsed
          .filter(
            (item) =>
              item &&
              typeof item.pattern === "string" &&
              typeof item.replacement === "string"
          )
          .map((item, idx) => ({
            id: String(item.id || `imported-${Date.now()}-${idx}`),
            pattern: item.pattern.trim(),
            replacement: item.replacement.trim(),
            category: item.category in CATEGORY_LABELS ? item.category : "custom",
            isBuiltin: Boolean(item.isBuiltin),
            enabled: item.enabled !== false,
            note: typeof item.note === "string" ? item.note : undefined,
          }));

        if (valid.length === 0) {
          setFeedback("未在文件中检测到有效替换规则。");
          return;
        }
        onChangeRules(valid);
        setFeedback(`成功导入 ${valid.length} 条敏感词替换规则。`);
      } catch {
        setFeedback("导入失败：无法解析所选 JSON 文件。");
      }
    };
    reader.readAsText(file);
  };

  const categories: Array<{ id: SensitiveCategory | "all"; label: string }> = [
    { id: "all", label: "全部" },
    { id: "redirect", label: CATEGORY_LABELS.redirect },
    { id: "financial_abs", label: CATEGORY_LABELS.financial_abs },
    { id: "brand", label: CATEGORY_LABELS.brand },
    { id: "promo_risk", label: CATEGORY_LABELS.promo_risk },
    { id: "custom", label: CATEGORY_LABELS.custom },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-100">
        <div>
          <h1 className="font-display text-lg font-semibold text-slate-900">
            小红书敏感词替换词库
          </h1>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">
            共 <span className="font-mono font-medium text-slate-800">{rules.length}</span> 条规则
            <span className="mx-1.5" aria-hidden="true">·</span>
            已启用 <span className="font-mono font-medium text-emerald-700">{enabledCount}</span> 条
            <span className="mx-1.5" aria-hidden="true">·</span>
            支持用「/」批量填写同义敏感词
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            onChange={(e) => handleImportJson(e.target.files?.[0])}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            导入 JSON
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            导出备份
          </button>
          <button
            type="button"
            onClick={() => {
              onChangeRules(DEFAULT_SENSITIVE_RULES);
              setFeedback("已恢复为内置默认小红书风控词库。");
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            恢复默认
          </button>
          <button
            type="button"
            onClick={openNewForm}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            新增规则
          </button>
        </div>
      </div>

      {/* Add / Edit Inline Form */}
      {showAddForm && (
        <form
          onSubmit={handleSaveRule}
          className="mt-5 p-4 rounded-lg border border-slate-200 bg-slate-50/70 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              {editingId ? "编辑敏感词规则" : "新增敏感词规则"}
            </h2>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              取消
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-slate-600 mb-1">
                敏感原词（可用 / 分隔多个）
              </label>
              <input
                type="text"
                value={formPattern}
                onChange={(e) => setFormPattern(e.target.value)}
                placeholder="例如：加微信/私信领"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-rose-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">
                安全替换词
              </label>
              <input
                type="text"
                value={formReplacement}
                onChange={(e) => setFormReplacement(e.target.value)}
                placeholder="例如：看主页置顶"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-rose-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">
                风险分类
              </label>
              <select
                value={formCategory}
                onChange={(e) =>
                  setFormCategory(e.target.value as SensitiveCategory)
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-rose-500 focus:outline-none"
              >
                {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">
                备注说明（可选）
              </label>
              <input
                type="text"
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                placeholder="限流原因简述"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-rose-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              保存规则
            </button>
          </div>
        </form>
      )}

      {feedback && (
        <div className="mt-4 px-3.5 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
          {feedback}
        </div>
      )}

      {/* Search & Category Filter */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategoryFilter(cat.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                categoryFilter === cat.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索敏感词或替换词..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-rose-500 focus:outline-none"
          />
        </div>
      </div>

      {/* High-Density Rules Table */}
      <div className="mt-5 overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
              <th className="py-2.5 px-4">敏感原词</th>
              <th className="py-2.5 px-4">安全替换词</th>
              <th className="py-2.5 px-4">风险分类</th>
              <th className="py-2.5 px-4">备注</th>
              <th className="py-2.5 px-4 text-center">启用</th>
              <th className="py-2.5 px-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {filteredRules.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="py-10 text-center text-slate-500 text-sm"
                >
                  未找到匹配的敏感词规则，可调整筛选条件或点击上方「新增规则」。
                </td>
              </tr>
            ) : (
              filteredRules.map((rule) => (
                <tr
                  key={rule.id}
                  className="hover:bg-slate-50/70 transition-colors"
                >
                  <td className="py-2.5 px-4 font-medium text-slate-900">
                    {rule.pattern}
                  </td>
                  <td className="py-2.5 px-4 font-medium text-emerald-700">
                    {rule.replacement}
                  </td>
                  <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                    {CATEGORY_LABELS[rule.category]}
                  </td>
                  <td className="py-2.5 px-4 text-slate-500 max-w-xs truncate">
                    {rule.note || "—"}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <button
                      type="button"
                      onClick={() => handleToggleRule(rule.id)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded border cursor-pointer ${
                        rule.enabled
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                          : "bg-slate-50 border-slate-200 text-slate-500"
                      }`}
                    >
                      {rule.enabled ? "已启用" : "已停用"}
                    </button>
                  </td>
                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openEditForm(rule)}
                      className="text-slate-600 hover:text-slate-900 font-medium mr-3 cursor-pointer"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteRule(rule.id)}
                      aria-label={`删除规则 ${rule.pattern}`}
                      className="text-slate-400 hover:text-rose-600 inline-flex items-center cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
