import type { TimeEntryRow } from "./queries";

/**
 * Split and Duplicate a finished block (card G, Toggl #261). Event-first through the normal entry endpoints:
 * a split shortens the block (PATCH) and adds its second half as a manual block (POST) with the same activity,
 * project, place, description and tags; if the second write fails, the first is put back. A duplicate is one
 * manual block with the same details.
 */

const MINUTE_MS = 60_000;

export type SplitBounds = { startMs: number; stopMs: number; minMs: number; maxMs: number };

/** Where a finished block can be split: on whole minutes, leaving each half a minute or more. Null when it can't. */
export function splitBounds(entry: Pick<TimeEntryRow, "startedAt" | "stoppedAt">): SplitBounds | null {
  if (!entry.stoppedAt) return null;
  const startMs = Date.parse(entry.startedAt);
  const stopMs = Date.parse(entry.stoppedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(stopMs)) return null;
  const minMs = Math.ceil((startMs + MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  const maxMs = Math.floor((stopMs - MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  return maxMs >= minMs ? { startMs, stopMs, minMs, maxMs } : null;
}

/** A split time snapped to the minute and kept inside the bounds. */
export function clampSplit(bounds: SplitBounds, atMs: number) {
  const snapped = Math.round(atMs / MINUTE_MS) * MINUTE_MS;
  return Math.min(bounds.maxMs, Math.max(bounds.minMs, snapped));
}

/** The middle of the block, on a minute: where the line starts. */
export function defaultSplit(bounds: SplitBounds) {
  return clampSplit(bounds, (bounds.startMs + bounds.stopMs) / 2);
}

/** The manual block that copies an entry's details over a window. */
export function manualCopy(entry: TimeEntryRow, startedAt: string, stoppedAt: string) {
  return {
    mode: "manual" as const,
    startedAt,
    stoppedAt,
    categoryId: entry.categoryId,
    projectId: entry.projectId,
    placeId: entry.placeId,
    description: entry.description,
    tagNames: entry.tags.map((tag) => tag.name)
  };
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export type BlockMutationOutcome = { ok: true } | { ok: false; error: string };

async function failure(response: Response, fallback: string): Promise<BlockMutationOutcome> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return { ok: false, error: typeof body?.error === "string" && body.error.trim() ? body.error : fallback };
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (body: unknown): RequestInit => ({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Splits a finished block at `atMs` (snapped and clamped): two blocks with the same details. */
export async function splitTimeEntry(fetcher: Fetch, entry: TimeEntryRow, atMs: number): Promise<BlockMutationOutcome> {
  const bounds = splitBounds(entry);
  if (!bounds) return { ok: false, error: "This block is too short to split." };
  const at = new Date(clampSplit(bounds, atMs)).toISOString();
  const shortened = await fetcher(`/api/time-entries/${entry.id}`, patch({ stoppedAt: at }));
  if (!shortened.ok) return failure(shortened, "Couldn't split this block.");
  const second = await fetcher("/api/time-entries", json(manualCopy(entry, at, entry.stoppedAt!)));
  if (second.ok) return { ok: true };
  const outcome = await failure(second, "Couldn't split this block.");
  // Put the block back as it was, so a failed split changes nothing.
  await fetcher(`/api/time-entries/${entry.id}`, patch({ stoppedAt: entry.stoppedAt })).catch(() => undefined);
  return outcome;
}

/** Duplicates a finished block: a new block with the same details, starting where the original ends. */
export async function duplicateTimeEntry(fetcher: Fetch, entry: TimeEntryRow): Promise<BlockMutationOutcome> {
  if (!entry.stoppedAt) return { ok: false, error: "Stop this block before duplicating it." };
  const lengthMs = Date.parse(entry.stoppedAt) - Date.parse(entry.startedAt);
  const startedAt = entry.stoppedAt;
  const stoppedAt = new Date(Date.parse(entry.stoppedAt) + lengthMs).toISOString();
  const response = await fetcher("/api/time-entries", json(manualCopy(entry, startedAt, stoppedAt)));
  return response.ok ? { ok: true } : failure(response, "Couldn't duplicate this block.");
}
