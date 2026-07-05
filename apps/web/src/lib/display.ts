import { paletteColorFor } from "@dayframe/shared";
import { formatSourceLabel } from "@/lib/format";

type TimeEntryDisplayFields = {
  id?: string | null;
  projectName?: string | null;
  projectColor?: string | null;
  categoryName?: string | null;
  categoryColor?: string | null;
  placeName?: string | null;
  source?: string | null;
  description?: string | null;
};

export function timeEntryTitle(entry: TimeEntryDisplayFields) {
  return cleanLabel(entry.description) ?? cleanLabel(entry.categoryName) ?? "Time entry";
}

export function timeEntryContextLabel(entry: TimeEntryDisplayFields) {
  const description = cleanLabel(entry.description);
  const category = cleanLabel(entry.categoryName);
  const place = cleanLabel(entry.placeName);

  if (description && category) return category;
  if (place) return place;
  if (entry.source) return formatSourceLabel(entry.source);
  return "Uncategorized";
}

export function timeEntryCategoryLabel(entry: TimeEntryDisplayFields) {
  return cleanLabel(entry.categoryName) ?? "Uncategorized";
}

export function timeEntryAccentColor(entry: TimeEntryDisplayFields) {
  return paletteColorFor(
    entry.projectColor ?? entry.categoryColor,
    entry.projectName ?? entry.categoryName ?? entry.description ?? entry.id ?? "Time entry"
  );
}

export function timeEntryCategoryColor(entry: TimeEntryDisplayFields) {
  return paletteColorFor(entry.categoryColor, entry.categoryName ?? entry.id ?? "Category");
}

function cleanLabel(value?: string | null) {
  const next = value?.trim();
  return next ? next : null;
}
