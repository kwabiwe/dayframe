import { formatDuration as formatSharedDuration } from "@dayframe/shared";
/**
 * Copy for the web Blocks switch toasts (UIA-209, the same wording as the iPhone's UIA-004):
 * "Switched to Work" over a muted "42m logged to Client Work", and "Already recording Deep work".
 * Neither has Undo: there is no un-switch contract.
 */
type ToastEntry = {
  categoryId: string | null;
  categoryName: string | null;
  description: string | null;
  startedAt: string;
  tagNames: readonly string[];
};

/**
 * The block's name as its row shows it: the description, else the activity. The legacy
 * "Start activity" placeholder is no description, as on iPhone (`displayTimerDescription`).
 */
export function toastBlockName(entry: Pick<ToastEntry, "categoryName" | "description">) {
  const description = entry.description?.trim();
  return (description && description !== "Start activity" ? description : null) || entry.categoryName || "No activity";
}

function compactDuration(seconds: number) {
  return formatSharedDuration(seconds);
}

/**
 * "Switched to Work" over a muted "42m logged to Client Work" (owner decision 15 Oct 2026: back to
 * TestFlight 120's two lines, #400, on iPhone and web): what is recording now on the first line,
 * where the replaced block's time went on the second. The duration is the shared `formatDuration`
 * ("<1m", "42m", "2h 5m"), as on iPhone.
 */
export function switchedToastCopy(
  nextName: string,
  previous: Pick<ToastEntry, "categoryName" | "description" | "startedAt">,
  nowMs: number
) {
  const startedMs = Date.parse(previous.startedAt);
  // A block switched away from in the same second (or with a clock skew) still logged under a minute.
  const seconds = Number.isFinite(startedMs) ? Math.max(1, (nowMs - startedMs) / 1000) : 1;
  return {
    message: `Switched to ${nextName}`,
    detail: `${compactDuration(seconds)} logged to ${toastBlockName(previous)}`
  };
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
