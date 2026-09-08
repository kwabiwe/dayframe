export const UNCATEGORIZED_REPORT_KEY = "uncategorized";

export type ReportCategoryKey = string;

export type ReportCategorySelection =
  | { mode: "all" }
  | { mode: "include"; keys: readonly ReportCategoryKey[] };

export type ReportCategoryOption = {
  key: ReportCategoryKey;
  name: string;
  color: string;
  isUncategorized: boolean;
  isUnavailable: boolean;
};

export type ReportFilterDraft =
  | { mode: "all"; universe: readonly ReportCategoryKey[] }
  | {
      mode: "include";
      keys: readonly ReportCategoryKey[];
      universe: readonly ReportCategoryKey[];
    };

export function normalizeReportSelection(
  selection: ReportCategorySelection
): ReportCategorySelection {
  if (selection.mode === "all") return selection;
  const keys = uniqueKeys(selection.keys);
  return keys.length > 0 ? { mode: "include", keys } : { mode: "all" };
}

export function toggleReportCategory(
  selection: ReportCategorySelection,
  key: ReportCategoryKey
): ReportCategorySelection {
  if (!key) return selection;
  if (selection.mode === "all") return { mode: "include", keys: [key] };
  const keys = uniqueKeys(selection.keys);
  if (!keys.includes(key)) return { mode: "include", keys: [...keys, key] };
  const remaining = keys.filter((candidate) => candidate !== key);
  return remaining.length > 0 ? { mode: "include", keys: remaining } : { mode: "all" };
}

export function reportSelectionIncludes(
  selection: ReportCategorySelection,
  key: ReportCategoryKey
) {
  return selection.mode === "all" || selection.keys.includes(key);
}

export function openReportFilterDraft(
  selection: ReportCategorySelection,
  optionKeys: readonly ReportCategoryKey[]
): ReportFilterDraft {
  const universe = uniqueKeys(optionKeys);
  return selection.mode === "all"
    ? { mode: "all", universe }
    : { mode: "include", keys: uniqueKeys(selection.keys), universe };
}

export function toggleReportFilterDraftKey(
  draft: ReportFilterDraft,
  key: ReportCategoryKey
): ReportFilterDraft {
  if (!key) return draft;
  if (draft.mode === "all") {
    return {
      mode: "include",
      keys: draft.universe.filter((candidate) => candidate !== key),
      universe: draft.universe
    };
  }
  const keys = draft.keys.includes(key)
    ? draft.keys.filter((candidate) => candidate !== key)
    : [...draft.keys, key];
  return { ...draft, keys: uniqueKeys(keys) };
}

export function selectAllReportFilterDraft(
  draft: ReportFilterDraft
): ReportFilterDraft {
  return { mode: "all", universe: draft.universe };
}

export function refreshReportFilterDraft(
  draft: ReportFilterDraft,
  optionKeys: readonly ReportCategoryKey[]
): ReportFilterDraft {
  const universe = uniqueKeys(optionKeys);
  if (draft.mode === "include") return { mode: "include", keys: draft.keys, universe };
  const previousUniverse = new Set(draft.universe);
  const hasNewOption = universe.some((key) => !previousUniverse.has(key));
  return hasNewOption
    ? { mode: "include", keys: draft.universe, universe }
    : { mode: "all", universe };
}

export function applyReportFilterDraft(
  draft: ReportFilterDraft
): ReportCategorySelection | null {
  if (draft.mode === "all") return { mode: "all" };
  const keys = uniqueKeys(draft.keys);
  return keys.length > 0 ? { mode: "include", keys } : null;
}

function uniqueKeys(keys: readonly ReportCategoryKey[]) {
  return [...new Set(keys.filter(Boolean))];
}
