export const UNCATEGORIZED_REPORT_KEY = "uncategorized";
export type ReportCategorySelection =
  | { mode: "all" }
  | { mode: "none" }
  | { mode: "include"; keys: readonly string[] };
export type ReportCategoryOption = {
  key: string;
  name: string;
  color: string;
  isUncategorized: boolean;
  isUnavailable: boolean;
};
export type ReportFilterDraft = ReportCategorySelection & {
  universe: readonly string[];
};
export function normalizeReportSelection(
  selection: ReportCategorySelection,
  universe: readonly string[] = [],
): ReportCategorySelection {
  if (selection.mode !== "include") return { mode: selection.mode };
  const keys = [...new Set(selection.keys.filter(Boolean))];
  if (!keys.length) return { mode: "none" };
  if (
    universe.length &&
    keys.length === new Set(universe).size &&
    universe.every((key) => keys.includes(key))
  )
    return { mode: "all" };
  return { mode: "include", keys };
}
export function reportSelectionIncludes(
  selection: ReportCategorySelection,
  key: string,
) {
  return (
    selection.mode === "all" ||
    (selection.mode === "include" && selection.keys.includes(key))
  );
}
export function toggleReportCategory(
  selection: ReportCategorySelection,
  key: string,
  universe: readonly string[] = [],
): ReportCategorySelection {
  const keys =
    selection.mode === "all"
      ? [...universe]
      : selection.mode === "none"
        ? []
        : [...selection.keys];
  return normalizeReportSelection(
    {
      mode: "include",
      keys: keys.includes(key)
        ? keys.filter((item) => item !== key)
        : [...keys, key],
    },
    universe,
  );
}
export function openReportFilterDraft(
  selection: ReportCategorySelection,
  universe: readonly string[],
): ReportFilterDraft {
  return { ...selection, universe: [...new Set(universe)] };
}
export function toggleReportFilterDraftKey(
  draft: ReportFilterDraft,
  key: string,
): ReportFilterDraft {
  return {
    ...toggleReportCategory(draft, key, draft.universe),
    universe: draft.universe,
  };
}
export function selectAllReportFilterDraft(
  draft: ReportFilterDraft,
): ReportFilterDraft {
  return {
    mode: draft.mode === "all" ? "none" : "all",
    universe: draft.universe,
  };
}
export function refreshReportFilterDraft(
  draft: ReportFilterDraft,
  universe: readonly string[],
): ReportFilterDraft {
  return { ...draft, universe: [...new Set(universe)] };
}
export function applyReportFilterDraft(
  draft: ReportFilterDraft,
): ReportCategorySelection {
  return normalizeReportSelection(draft, draft.universe);
}
