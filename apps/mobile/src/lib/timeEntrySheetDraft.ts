export type TimeEntrySheetDraftSnapshot = {
  categoryId: string | null;
  dateText: string;
  description: string;
  stoppedDateText: string;
  stoppedTimeText: string;
  tagNames: string[];
  timeText: string;
};

export function timeEntrySheetDraftHasChanges({
  baseline,
  current,
  includeStoppedTime
}: {
  baseline: TimeEntrySheetDraftSnapshot | null;
  current: TimeEntrySheetDraftSnapshot;
  includeStoppedTime: boolean;
}) {
  if (!baseline) return false;
  return current.categoryId !== baseline.categoryId ||
    current.description !== baseline.description ||
    current.dateText !== baseline.dateText ||
    current.timeText !== baseline.timeText ||
    normalizedTagSignature(current.tagNames) !== normalizedTagSignature(baseline.tagNames) ||
    (includeStoppedTime && (
      current.stoppedDateText !== baseline.stoppedDateText ||
      current.stoppedTimeText !== baseline.stoppedTimeText
    ));
}

export type TimeEntrySheetLayoutDensity = "regular" | "compact" | "condensed";

export function timeEntrySheetLayoutDensity({
  fontScale,
  windowHeight
}: {
  fontScale: number;
  windowHeight: number;
}): TimeEntrySheetLayoutDensity {
  if (windowHeight < 700 || fontScale >= 1.6) return "condensed";
  if (windowHeight < 780 || fontScale >= 1.3) return "compact";
  return "regular";
}

export function selectionAfterDescriptionChange({
  nextText,
  previousSelection,
  previousText
}: {
  nextText: string;
  previousSelection: { start: number; end: number };
  previousText: string;
}) {
  let prefixLength = 0;
  const prefixLimit = Math.min(previousText.length, nextText.length);
  while (
    prefixLength < prefixLimit &&
    previousText[prefixLength] === nextText[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const suffixLimit = Math.min(
    previousText.length - prefixLength,
    nextText.length - prefixLength
  );
  while (
    suffixLength < suffixLimit &&
    previousText[previousText.length - 1 - suffixLength] ===
      nextText[nextText.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const inferredCaret = nextText.length - suffixLength;
  const selectionFallback = Math.max(
    0,
    Math.min(
      nextText.length,
      previousSelection.start + nextText.length - previousText.length
    )
  );
  const caret = Number.isFinite(inferredCaret) ? inferredCaret : selectionFallback;
  return { start: caret, end: caret };
}

function normalizedTagSignature(tagNames: string[]) {
  return tagNames
    .map((name) => name.trim().toLowerCase())
    .join("\u0000");
}
