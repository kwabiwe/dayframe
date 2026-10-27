import { describe, expect, it, vi } from "vitest";
import type { TimeEntryRow } from "./queries";
import { clampSplit, defaultSplit, duplicateTimeEntry, splitBounds, splitTimeEntry } from "./time-entry-split";

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
