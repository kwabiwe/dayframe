import { paletteColorFor, type DayframeThemeMode } from "@dayframe/shared";
import { displayTimerDescription } from "./timerPresentation";

/**
 * Copy and swatches for the iPhone Blocks toasts (UIA-003/004): "Deleted Deep work",
 * "Switched to Work · 42m logged to Client Work", "Already recording Deep work".
 */
type ToastEntry = {
  categoryColor?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  description?: string | null;
  startedAt: string;
  tagNames?: readonly string[] | null;
  tags?: readonly { name: string }[] | null;
};

/** The block's name as its row shows it: the description, else the activity. */
export function toastBlockName(entry: Pick<ToastEntry, "categoryName" | "description">) {
  return displayTimerDescription({ description: entry.description ?? null })?.trim() || entry.categoryName || "No activity";
}

/** The activity's colour for the toast swatch; null (a neutral swatch) without an activity. */
export function toastSwatchColor(
  entry: Pick<ToastEntry, "categoryColor" | "categoryId" | "categoryName">,
  mode: DayframeThemeMode
) {
  if (!entry.categoryId && !entry.categoryColor) return null;
  return paletteColorFor(entry.categoryColor ?? entry.categoryId, entry.categoryName ?? "", mode);
}

function compactDuration(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${minutes}m`;
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function deletedToastMessage(entries: readonly Pick<ToastEntry, "categoryName" | "description">[]) {
  if (entries.length === 1) return `Deleted ${toastBlockName(entries[0])}`;
  return `Deleted ${entries.length} blocks`;
}

export function deletedToastAnnouncement(entries: readonly Pick<ToastEntry, "categoryName" | "description">[]) {
  return `${deletedToastMessage(entries)}. Undo available.`;
}

export function undoDeleteAccessibilityLabel(entries: readonly Pick<ToastEntry, "categoryName" | "description">[]) {
  return entries.length === 1 ? `Undo deleting ${toastBlockName(entries[0])}` : `Undo deleting ${entries.length} blocks`;
}

/**
 * "Switched to Work · 42m logged to Client Work": what is recording now, and where the time of
 * the block it replaced went. A previous block under a minute says "under a minute".
 */
export function switchedToastMessage(
  nextName: string,
  previous: Pick<ToastEntry, "categoryName" | "description" | "startedAt">,
  nowMs: number
) {
  const seconds = Math.max(0, (nowMs - Date.parse(previous.startedAt)) / 1000);
  const logged = seconds < 60 ? "under a minute" : compactDuration(seconds);
  return `Switched to ${nextName} · ${logged} logged to ${toastBlockName(previous)}`;
}

export function alreadyRecordingToastMessage(active: Pick<ToastEntry, "categoryName" | "description">) {
  return `Already recording ${toastBlockName(active)}`;
}

function tagKey(entry: Pick<ToastEntry, "tagNames" | "tags">) {
  const names = entry.tagNames ?? entry.tags?.map((tag) => tag.name) ?? [];
  return [...names].map((name) => name.trim().toLowerCase()).sort().join("\u0000");
}

/**
 * True when a Start asks for exactly what is recording (same activity, description and tags),
 * which would only stop and restart the same block. A bare Start never matches (it opens the
 * running block instead).
 */
export function startMatchesRunning(
  active: Pick<ToastEntry, "categoryId" | "description" | "tagNames" | "tags"> | null | undefined,
  request: { categoryId: string | null; description: string; tagNames: readonly string[] }
) {
  if (!active) return false;
  const description = request.description.trim();
  if (!request.categoryId && !description) return false;
  return (active.categoryId ?? null) === request.categoryId &&
    (displayTimerDescription({ description: active.description ?? null })?.trim() ?? "").toLowerCase() === description.toLowerCase() &&
    tagKey(active) === tagKey({ tagNames: request.tagNames });
}
