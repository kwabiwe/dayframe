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

/**
 * Where a running block can be split (owner 28 Oct 2026, as Toggl): on whole minutes, never within its first
 * minute or the last minute before now. `nowMs` is the bar's growing end. Null when it is too short yet.
 */
export function runningSplitBounds(entry: Pick<TimeEntryRow, "startedAt">, nowMs: number): SplitBounds | null {
  const startMs = Date.parse(entry.startedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return null;
  const minMs = Math.ceil((startMs + MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  const maxMs = Math.floor((nowMs - MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  return maxMs >= minMs ? { startMs, stopMs: nowMs, minMs, maxMs } : null;
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
type SentOutcome = { ok: true; body: Record<string, unknown> | null } | { ok: false; error: string; changed?: boolean };

const CHANGED_ELSEWHERE = "This block changed somewhere else. Open it again to see it as it is now.";

const UNKNOWN = "Couldn't confirm this with Dayframe, so it may or may not have saved. Check the day before trying again.";

async function send(fetcher: Fetch, body: Record<string, unknown>, fallback: string, commandId?: string): Promise<SentOutcome> {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", [TIME_ENTRY_CLIENT_COMMAND_ID_HEADER]: commandId ?? newBlockCommandId(String(body.mode)) },
    body: JSON.stringify(body)
  };
  // A dropped connection or a server error (5xx) may follow a commit: the same command once more is safe, as
  // the server answers a repeat with what it already did (Codex r1 and r2 on #596).
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetcher("/api/time-entries", init);
    } catch {
      response = null;
      continue;
    }
    if (response.status < 500) break;
  }
  if (!response || response.status >= 500) return { ok: false, error: UNKNOWN, changed: true };
  if (response.ok) return { ok: true, body: await response.json().catch(() => null) as Record<string, unknown> | null };
  if (response.status === 409) return { ok: false, error: CHANGED_ELSEWHERE, changed: true };
  const json = await response.json().catch(() => null) as { error?: unknown } | null;
  return { ok: false, error: typeof json?.error === "string" && json.error.trim() ? json.error : fallback };
}

/** Splits a finished block at `atMs` (snapped and clamped): two blocks with the same details. */
export async function splitTimeEntry(fetcher: Fetch, entry: TimeEntryRow, atMs: number): Promise<BlockMutationOutcome> {
  const bounds = splitBounds(entry);
  if (!bounds) return { ok: false, error: "This block is too short to split." };
  return plain(await send(fetcher, {
    mode: "split", entryId: entry.id, splitAt: new Date(clampSplit(bounds, atMs)).toISOString(), expectedUpdatedAt: entry.updatedAt
  }, "Couldn't split this block."));
}

function plain(outcome: SentOutcome): BlockMutationOutcome {
  return outcome.ok ? { ok: true } : outcome;
}

/** One command id for one intent: Undo's Try again sends the same one, so the server knows it already did it. */
export function newBlockCommandId(mode: string) {
  return `web-${mode}-${crypto.randomUUID()}`;
}

/**
 * `running`: the second part runs. False when the block had stopped by the time the split arrived: the server
 * then split it as a finished block, and nothing runs.
 */
export type RunningSplitOutcome = { ok: true; newEntryId: string; running: boolean } | { ok: false; error: string; changed?: boolean };

/**
 * Splits the running block `entryId` at `atMs` (already snapped by the dialog): it ends there and its second
 * part, with every detail, keeps running. `expectedUpdatedAt` is the block's version as this tab has it.
 */
export async function splitRunningTimeEntry(
  fetcher: Fetch,
  input: { entryId: string; atMs: number; expectedUpdatedAt?: string }
): Promise<RunningSplitOutcome> {
  const outcome = await send(fetcher, {
    mode: "split", entryId: input.entryId, splitAt: new Date(input.atMs).toISOString(),
    ...(input.expectedUpdatedAt ? { expectedUpdatedAt: input.expectedUpdatedAt } : {})
  }, "Couldn't split this block.");
  if (!outcome.ok) return outcome;
  const newEntryId = outcome.body?.newEntryId;
  return typeof newEntryId === "string"
    ? { ok: true, newEntryId, running: outcome.body?.running !== false }
    : { ok: false, error: UNKNOWN, changed: true };
}

/** Undo of a split: `splitEntryId` goes and `entryId` takes its end again (running again if it ran). */
export async function joinSplitTimeEntries(
  fetcher: Fetch,
  input: { entryId: string; splitEntryId: string; commandId?: string }
): Promise<BlockMutationOutcome> {
  return plain(await send(
    fetcher, { mode: "join", entryId: input.entryId, splitEntryId: input.splitEntryId }, "Couldn't put this block back together.", input.commandId
  ));
}

/** Duplicates a finished block: a new block with the same details, starting where the original ends. */
export async function duplicateTimeEntry(fetcher: Fetch, entry: TimeEntryRow): Promise<BlockMutationOutcome> {
  if (!entry.stoppedAt) return { ok: false, error: "Stop this block before duplicating it." };
  return plain(await send(fetcher, { mode: "duplicate", entryId: entry.id, expectedUpdatedAt: entry.updatedAt }, "Couldn't duplicate this block."));
}
