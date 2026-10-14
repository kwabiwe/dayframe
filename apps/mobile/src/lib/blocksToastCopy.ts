import { formatDuration } from "@dayframe/shared";
import { paletteColorFor, type DayframeThemeMode } from "@dayframe/shared";
import { spokenDuration } from "../components/today/todayBlocksLayout";
import { displayTimerDescription } from "./timerPresentation";

/**
 * Copy and swatches for the iPhone Blocks toasts (UIA-003/004): "Deleted Deep work",
 * "Switched to Work" (with "42m logged to Client Work" under it), "Already recording Deep work".
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
  return formatDuration(seconds);
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
 * A toast's words: the sentence it shows, an optional muted second line under it, and the one
 * sentence VoiceOver reads (and hears announced) for both.
 */
export type BlocksToastCopy = {
  message: string;
  detail?: string | null;
  accessibilityLabel?: string;
};

/**
 * "Switched to School run" over a muted "42m logged to Client Work" (Trello "That message is too
 * long"): what is recording now on the first line, where the replaced block's time went on the
 * second. The duration is the shared `formatDuration` ("<1m", "42m", "2h 5m"); VoiceOver hears one
 * sentence with the spoken duration ("Switched to School run, 42 minutes logged to Client Work.").
 * Without a previous block there is no second line.
 */
export function switchedToastCopy(
  nextName: string,
  previous: Pick<ToastEntry, "categoryName" | "description" | "startedAt"> | null | undefined,
  nowMs: number
): BlocksToastCopy {
  const message = `Switched to ${nextName}`;
  if (!previous) return { message, detail: null, accessibilityLabel: `${message}.` };
  const startedMs = Date.parse(previous.startedAt);
  // A block switched away from in the same second (or with a clock skew) still logged under a minute.
  const seconds = Number.isFinite(startedMs) ? Math.max(1, (nowMs - startedMs) / 1000) : 1;
  const previousName = toastBlockName(previous);
  return {
    message,
    detail: `${compactDuration(seconds)} logged to ${previousName}`,
    accessibilityLabel: `${message}, ${spokenDuration(seconds)} logged to ${previousName}.`
  };
}

/** The sentence VoiceOver reads for a toast's copy: its label, else the visible lines joined. */
export function toastAccessibilityText(copy: string | BlocksToastCopy) {
  if (typeof copy === "string") return copy;
  return copy.accessibilityLabel ?? (copy.detail ? `${copy.message}. ${copy.detail}` : copy.message);
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
