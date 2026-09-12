import {
  addLocalDays,
  buildReportRange,
  formatLocalDateKey,
  parseLocalDate,
  validateCustomRange,
  type ReportRangeChoice,
} from "./reportsRanges";
export type ReportDateDraft = {
  choice: ReportRangeChoice | null;
  firstDay: string | null;
  displayedMonth: string;
};
const monthKey = (key: string) => `${key.slice(0, 7)}-01`;
export function openReportDateDraft(
  choice: ReportRangeChoice,
  nowMs: number,
): ReportDateDraft {
  return {
    choice,
    firstDay: null,
    displayedMonth: monthKey(
      typeof choice === "string"
        ? formatLocalDateKey(new Date(nowMs))
        : choice.start,
    ),
  };
}
export function selectReportDraftDay(
  draft: ReportDateDraft,
  key: string,
  nowMs: number,
): ReportDateDraft {
  if (!parseLocalDate(key) || key > formatLocalDateKey(new Date(nowMs)))
    return draft;
  if (draft.choice || !draft.firstDay)
    return { ...draft, choice: null, firstDay: key };
  return {
    ...draft,
    choice: {
      start: key < draft.firstDay ? key : draft.firstDay,
      end: key < draft.firstDay ? draft.firstDay : key,
    },
    firstDay: null,
  };
}
export function reportDraftResult(draft: ReportDateDraft, nowMs: number) {
  if (!draft.choice) return { error: "Choose the end date", value: undefined };
  if (typeof draft.choice === "string")
    return { value: draft.choice, error: undefined };
  return validateCustomRange(draft.choice.start, draft.choice.end, nowMs);
}
export function reportDraftHighlight(draft: ReportDateDraft, nowMs: number) {
  if (!draft.choice) return { start: draft.firstDay, end: draft.firstDay };
  if (typeof draft.choice !== "string") return draft.choice;
  const range = buildReportRange(draft.choice, nowMs);
  return {
    start: formatLocalDateKey(range.start),
    end: formatLocalDateKey(addLocalDays(range.end, -1)),
  };
}
