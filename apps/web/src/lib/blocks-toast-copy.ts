import { formatDuration as formatSharedDuration } from "@dayframe/shared";
/**
 * Copy for the web Blocks switch toasts (UIA-209, the same wording as the iPhone's UIA-004):
 * "Switched to Work · 42m logged to Client Work" and "Already recording Deep work". Neither has
 * Undo: there is no un-switch contract.
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

function compactDuration(seconds: number) {
  return formatSharedDuration(seconds);
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
