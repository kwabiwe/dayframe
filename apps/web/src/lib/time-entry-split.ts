import { TIME_ENTRY_CLIENT_COMMAND_ID_HEADER } from "@dayframe/shared";
import type { TimeEntryRow } from "./queries";

/**
 * Split and Duplicate a finished block (card G, Toggl #261), each one request to the normal entries endpoint
 * (`POST /api/time-entries`, modes `split` and `duplicate`), which does it in one transaction with every
 * detail of the block. The block's version (`expectedUpdatedAt`) refuses a block changed elsewhere since the
 * editor read it; the client command id makes the one retry after a dropped connection safe.
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

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
/**
 * `changed`: the request may have changed the day although it failed (the block changed elsewhere, or the
 * outcome is unknown), so the caller shows the day again.
 */
export type BlockMutationOutcome = { ok: true } | { ok: false; error: string; changed?: boolean };

const CHANGED_ELSEWHERE = "This block changed somewhere else. Open it again to see it as it is now.";

async function send(fetcher: Fetch, body: Record<string, unknown>, fallback: string): Promise<BlockMutationOutcome> {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", [TIME_ENTRY_CLIENT_COMMAND_ID_HEADER]: `web-${body.mode}-${crypto.randomUUID()}` },
    body: JSON.stringify(body)
  };
  let response: Response;
  try {
    response = await fetcher("/api/time-entries", init);
  } catch {
    // The connection dropped: the same command again is safe (the server answers a repeat with what it did).
    try {
      response = await fetcher("/api/time-entries", init);
    } catch {
      return { ok: false, error: "Couldn't reach Dayframe, so this may not have saved. Check the day before trying again.", changed: true };
    }
  }
  if (response.ok) return { ok: true };
  if (response.status === 409) return { ok: false, error: CHANGED_ELSEWHERE, changed: true };
  const json = await response.json().catch(() => null) as { error?: unknown } | null;
  return { ok: false, error: typeof json?.error === "string" && json.error.trim() ? json.error : fallback };
}

/** Splits a finished block at `atMs` (snapped and clamped): two blocks with the same details. */
export async function splitTimeEntry(fetcher: Fetch, entry: TimeEntryRow, atMs: number): Promise<BlockMutationOutcome> {
  const bounds = splitBounds(entry);
  if (!bounds) return { ok: false, error: "This block is too short to split." };
  return send(fetcher, {
    mode: "split", entryId: entry.id, splitAt: new Date(clampSplit(bounds, atMs)).toISOString(), expectedUpdatedAt: entry.updatedAt
  }, "Couldn't split this block.");
}

/** Duplicates a finished block: a new block with the same details, starting where the original ends. */
export async function duplicateTimeEntry(fetcher: Fetch, entry: TimeEntryRow): Promise<BlockMutationOutcome> {
  if (!entry.stoppedAt) return { ok: false, error: "Stop this block before duplicating it." };
  return send(fetcher, { mode: "duplicate", entryId: entry.id, expectedUpdatedAt: entry.updatedAt }, "Couldn't duplicate this block.");
}
