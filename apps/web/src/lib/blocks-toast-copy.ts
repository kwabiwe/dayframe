/**
 * Copy for the web Blocks switch toasts, the same as the iPhone's: "Switched to Work" (owner
 * option A, 14 Oct 2026: one line, no logged-time detail) and "Already recording Deep work".
 * Neither has Undo: there is no un-switch contract (owner decision, 7 and 14 Oct 2026).
 */
type ToastEntry = {
  categoryId: string | null;
  categoryName: string | null;
  description: string | null;
  startedAt: string;
  tagNames: readonly string[];
};

/** The block's name as its row shows it: the description, else the activity. */
export function toastBlockName(entry: Pick<ToastEntry, "categoryName" | "description">) {
  return entry.description?.trim() || entry.categoryName || "No activity";
}

/** The fixed lead of a switch toast; it never truncates, only the activity name does. */
export const SWITCHED_TOAST_LEAD = "Switched to";

/** "Switched to Work": the full sentence, as announced and as the toast's accessible text. */
export function switchedToastMessage(nextName: string) {
  return `${SWITCHED_TOAST_LEAD} ${nextName}`;
}

export function alreadyRecordingToastMessage(active: Pick<ToastEntry, "categoryName" | "description">) {
  return `Already recording ${toastBlockName(active)}`;
}

function tagKey(names: readonly string[]) {
  return [...names].map((name) => name.trim().toLowerCase()).sort().join("\u0000");
}

/**
 * True when a Start asks for exactly what is recording (same activity, description and tags),
 * which would only stop and restart the same block. A bare Start never matches.
 */
export function startMatchesRunning(
  active: Pick<ToastEntry, "categoryId" | "description" | "tagNames"> | null | undefined,
  request: { categoryId: string | null; description: string; tagNames: readonly string[] }
) {
  if (!active) return false;
  const description = request.description.trim();
  if (!request.categoryId && !description) return false;
  return (active.categoryId ?? null) === request.categoryId &&
    (active.description?.trim() ?? "").toLowerCase() === description.toLowerCase() &&
    tagKey(active.tagNames) === tagKey(request.tagNames);
}
