import { paletteColorFor, type DayframeThemeMode } from "@dayframe/shared";
import { displayTimerDescription } from "./timerPresentation";

/**
 * Copy and swatches for the iPhone Blocks toasts (UIA-003/004): "Deleted Deep work",
 * "Switched to Work", "Already recording Deep work".
 */
type ToastEntry = {
  categoryColor?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  description?: string | null;
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
 * A toast's words: the sentence it shows and the one sentence VoiceOver reads (and hears
 * announced). A toast that names something may split its one line into a fixed `lead`
 * ("Switched to") and the `name`: then only the name ends in "…" when it is too long, and the
 * lead is never cut.
 */
export type BlocksToastCopy = {
  message: string;
  lead?: string | null;
  name?: string | null;
  accessibilityLabel?: string;
};

/**
 * "Switched to School run" (owner decision 14 Oct, option A): one line naming what is recording
 * now, nothing about the replaced block. "Switched to" is always shown whole; only a very long
 * name ends in "…". VoiceOver hears "Switched to School run." once, as one element.
 */
export function switchedToastCopy(nextName: string): BlocksToastCopy {
  const lead = "Switched to";
  const message = `${lead} ${nextName}`;
  return { message, lead, name: nextName, accessibilityLabel: `${message}.` };
}

/** The sentence VoiceOver reads for a toast's copy: its label, else the visible sentence. */
export function toastAccessibilityText(copy: string | BlocksToastCopy) {
  if (typeof copy === "string") return copy;
  return copy.accessibilityLabel ?? copy.message;
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
