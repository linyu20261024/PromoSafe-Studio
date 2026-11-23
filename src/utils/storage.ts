import { DEFAULT_SENSITIVE_RULES } from "../data/defaultDictionary.ts";
import type { HistoryEntry, SensitiveRule } from "../types/index.ts";

const DICTIONARY_STORAGE_KEY = "promosafe_sensitive_rules_v1";
const HISTORY_STORAGE_KEY = "promosafe_history_entries_v1";
const MAX_HISTORY_ITEMS = 30;

export function loadSensitiveRules(): SensitiveRule[] {
  try {
    const raw = localStorage.getItem(DICTIONARY_STORAGE_KEY);
    if (!raw) return DEFAULT_SENSITIVE_RULES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return DEFAULT_SENSITIVE_RULES;
  } catch {
    return DEFAULT_SENSITIVE_RULES;
  }
}

export function saveSensitiveRules(rules: SensitiveRule[]): void {
  try {
    localStorage.setItem(DICTIONARY_STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // Ignore quota errors gracefully
  }
}

export function loadHistoryEntries(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistoryEntries(entries: HistoryEntry[]): void {
  const trimmed = entries.slice(0, MAX_HISTORY_ITEMS);
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // If thumbnail data exceeds quota, strip heavy image snapshots from older entries
    const lightweight = trimmed.map((item, idx) =>
      idx > 4 ? { ...item, imageSnapshot: undefined } : item
    );
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(lightweight));
    } catch {
      // Ignore if still unable to persist
    }
  }
}
