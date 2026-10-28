import { describe, expect, it, vi } from "vitest";
import type { TimeEntryRow } from "./queries";
import {
  clampSplit, defaultSplit, duplicateTimeEntry, joinSplitTimeEntries, runningSplitBounds, splitBounds, splitRunningTimeEntry, splitTimeEntry
} from "./time-entry-split";
import { applyOptimisticTimerSplit } from "./timer-runtime";
import type { BootstrapData } from "./queries";

// Card G: synthetic block, made-up names and ids.
const block = (patch: Partial<TimeEntryRow> = {}): TimeEntryRow => ({
  id: "entry-1", projectId: null, projectName: null, projectColor: null, clientName: null, categoryId: "cat-1", categoryName: "Reading",
  categoryColor: null, placeId: "place-1", placeName: "Exampleton Library", source: "manual_web", confidence: "1", reviewStatus: "accepted",
  description: "Chapter four", startedAt: "2026-03-02T10:00:00.000Z", stoppedAt: "2026-03-02T11:00:00.000Z", updatedAt: "2026-03-02T11:00:00.000Z",
  durationSeconds: 3_600, tagNames: ["deep"], tags: [{ id: "t1", name: "deep", normalizedName: "deep" }], ...patch
}) as TimeEntryRow;
const ms = (iso: string) => Date.parse(iso);
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const refused = (error: string) => new Response(JSON.stringify({ error }), { status: 422 });

describe("splitting a block (card G)", () => {
  it("splits on whole minutes, leaving each half a minute or more", () => {
    const bounds = splitBounds(block())!;
    expect(bounds.minMs).toBe(ms("2026-03-02T10:01:00.000Z"));
    expect(bounds.maxMs).toBe(ms("2026-03-02T10:59:00.000Z"));
    expect(defaultSplit(bounds)).toBe(ms("2026-03-02T10:30:00.000Z"));
    expect(clampSplit(bounds, ms("2026-03-02T10:24:40.000Z"))).toBe(ms("2026-03-02T10:25:00.000Z"));
    expect(clampSplit(bounds, ms("2026-03-02T09:00:00.000Z"))).toBe(bounds.minMs);
    expect(splitBounds(block({ stoppedAt: null }))).toBeNull();
    expect(splitBounds(block({ stoppedAt: "2026-03-02T10:01:30.000Z" }))).toBeNull();
  });

  it("asks the server to split it, fenced to the block's version, with a command id", async () => {
    const fetcher = vi.fn<Fetcher>(async () => ok());
    expect(await splitTimeEntry(fetcher, block(), ms("2026-03-02T10:24:20.000Z"))).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect([url, init?.method, JSON.parse(init?.body as string)]).toEqual(["/api/time-entries", "POST",
      { mode: "split", entryId: "entry-1", splitAt: "2026-03-02T10:24:00.000Z", expectedUpdatedAt: "2026-03-02T11:00:00.000Z" }]);
    expect((init?.headers as Record<string, string>)["X-Dayframe-Client-Command-Id"]).toMatch(/^web-split-[0-9a-f-]{36}$/);
  });

  it("sends the same command once more when the connection drops, and says when it can't tell (Codex r1 on #596)", async () => {
    const dropped = vi.fn<Fetcher>().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(ok());
    expect(await splitTimeEntry(dropped, block(), ms("2026-03-02T10:30:00.000Z"))).toEqual({ ok: true });
    const ids = dropped.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)["X-Dayframe-Client-Command-Id"]);
    expect(ids[0]).toBe(ids[1]);
    const gone = vi.fn<Fetcher>(async () => { throw new TypeError("Failed to fetch"); });
    expect(await splitTimeEntry(gone, block(), ms("2026-03-02T10:30:00.000Z"))).toMatchObject({ ok: false, changed: true });
    // A server error may follow a commit: the same command once more, then an unknown outcome (Codex r2 on #596).
    const lost = vi.fn<Fetcher>().mockResolvedValueOnce(new Response("", { status: 502 })).mockResolvedValueOnce(ok());
    expect(await duplicateTimeEntry(lost, block())).toEqual({ ok: true });
    const lostIds = lost.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)["X-Dayframe-Client-Command-Id"]);
    expect(lostIds[0]).toBe(lostIds[1]);
    const down = vi.fn<Fetcher>(async () => new Response("", { status: 504 }));
    expect(await duplicateTimeEntry(down, block())).toMatchObject({ ok: false, changed: true });
    expect(down).toHaveBeenCalledTimes(2);
  });

  it("says when the block changed elsewhere, so the day shows again, and passes a refusal on", async () => {
    const conflict = vi.fn<Fetcher>(async () => new Response(JSON.stringify({ error: "changed" }), { status: 409 }));
    expect(await splitTimeEntry(conflict, block(), ms("2026-03-02T10:30:00.000Z"))).toEqual({ ok: false, changed: true,
      error: "This block changed somewhere else. Open it again to see it as it is now." });
    const refusedSplit = vi.fn<Fetcher>(async () => refused("Choose a split time inside the block."));
    expect(await splitTimeEntry(refusedSplit, block(), ms("2026-03-02T10:30:00.000Z"))).toEqual({ ok: false, error: "Choose a split time inside the block." });
    expect(await splitTimeEntry(refusedSplit, block({ stoppedAt: "2026-03-02T10:01:00.000Z" }), ms("2026-03-02T10:00:30.000Z")))
      .toEqual({ ok: false, error: "This block is too short to split." });
  });
});

describe("duplicating a block (card G)", () => {
  it("asks the server to add the same block right after it, fenced to its version", async () => {
    const fetcher = vi.fn<Fetcher>(async () => ok());
    expect(await duplicateTimeEntry(fetcher, block())).toEqual({ ok: true });
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({ mode: "duplicate", entryId: "entry-1", expectedUpdatedAt: "2026-03-02T11:00:00.000Z" });
    expect(await duplicateTimeEntry(fetcher, block({ stoppedAt: null }))).toEqual({ ok: false, error: "Stop this block before duplicating it." });
  });
});

describe("splitting the running block (owner 28 Oct 2026)", () => {
  it("never splits within its first minute or the last minute before now, and grows with now", () => {
    const running = block({ stoppedAt: null });
    const bounds = runningSplitBounds(running, ms("2026-03-02T10:40:30.000Z"))!;
    expect([bounds.minMs, bounds.maxMs, bounds.stopMs]).toEqual([
      ms("2026-03-02T10:01:00.000Z"), ms("2026-03-02T10:39:00.000Z"), ms("2026-03-02T10:40:30.000Z")
    ]);
    expect(runningSplitBounds(running, ms("2026-03-02T10:45:00.000Z"))!.maxMs).toBe(ms("2026-03-02T10:44:00.000Z"));
    expect(runningSplitBounds(running, ms("2026-03-02T10:01:59.000Z"))).toBeNull();
  });

  it("splits it by id, fenced and with a command id, and answers with the running second part; Undo joins them", async () => {
    const fetcher = vi.fn<Fetcher>(async () => new Response(JSON.stringify({ ok: true, newEntryId: "entry-2", running: true }), { status: 201 }));
    expect(await splitRunningTimeEntry(fetcher, { entryId: "entry-1", atMs: ms("2026-03-02T10:30:00.000Z"), expectedUpdatedAt: "2026-03-02T10:00:00.000Z" }))
      .toEqual({ ok: true, newEntryId: "entry-2", running: true });
    const [, init] = fetcher.mock.calls[0];
    expect(JSON.parse(init!.body as string)).toEqual({ mode: "split", entryId: "entry-1", splitAt: "2026-03-02T10:30:00.000Z", expectedUpdatedAt: "2026-03-02T10:00:00.000Z" });
    expect((init!.headers as Record<string, string>)["X-Dayframe-Client-Command-Id"]).toMatch(/^web-split-/);

    const join = vi.fn<Fetcher>(async () => ok());
    expect(await joinSplitTimeEntries(join, { entryId: "entry-1", splitEntryId: "entry-2" })).toEqual({ ok: true });
    expect(JSON.parse(join.mock.calls[0][1]!.body as string)).toEqual({ mode: "join", entryId: "entry-1", splitEntryId: "entry-2" });
    const refusedJoin = vi.fn<Fetcher>(async () => refused("These blocks are no longer one split block, so they can't be put back together."));
    expect(await joinSplitTimeEntries(refusedJoin, { entryId: "entry-1", splitEntryId: "entry-2" }))
      .toEqual({ ok: false, error: "These blocks are no longer one split block, so they can't be put back together." });
  });

  it("shows the first part finished and the second running from the split, never two running blocks", () => {
    const running = block({ stoppedAt: null, durationSeconds: 4_000 });
    const data = {
      activeEntry: running, entries: [running], historyEntries: [running], dayEntries: [running], weekEntries: [running],
      dateRange: { dayStart: "2026-03-02T00:00:00.000Z", dayEnd: "2026-03-03T00:00:00.000Z", weekStart: "2026-03-02T00:00:00.000Z", weekEnd: "2026-03-09T00:00:00.000Z" }
    } as unknown as BootstrapData;
    const next = applyOptimisticTimerSplit(data, "2026-03-02T10:30:00.000Z", "entry-2");
    expect(next.activeEntry).toMatchObject({ id: "entry-2", startedAt: "2026-03-02T10:30:00.000Z", stoppedAt: null, description: "Chapter four", tagNames: ["deep"] });
    expect(next.dayEntries.map((entry) => [entry.id, entry.startedAt, entry.stoppedAt, entry.durationSeconds])).toEqual([
      ["entry-2", "2026-03-02T10:30:00.000Z", null, 0],
      ["entry-1", "2026-03-02T10:00:00.000Z", "2026-03-02T10:30:00.000Z", 1_800]
    ]);
    expect(next.entries.filter((entry) => !entry.stoppedAt)).toHaveLength(1);
  });
});
