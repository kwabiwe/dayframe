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

  it("shortens the block, then adds its second half with the same details", async () => {
    const fetcher = vi.fn<Fetcher>(async () => ok());
    expect(await splitTimeEntry(fetcher, block(), ms("2026-03-02T10:24:00.000Z"))).toEqual({ ok: true });
    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method, JSON.parse(init?.body as string)])).toEqual([
      ["/api/time-entries/entry-1", "PATCH", { stoppedAt: "2026-03-02T10:24:00.000Z" }],
      ["/api/time-entries", "POST", { mode: "manual", startedAt: "2026-03-02T10:24:00.000Z", stoppedAt: "2026-03-02T11:00:00.000Z",
        categoryId: "cat-1", projectId: null, placeId: "place-1", description: "Chapter four", tagNames: ["deep"] }]
    ]);
  });

  it("puts the block back when its second half is refused, and says why", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => init?.method === "POST" ? refused("That place no longer exists.") : ok());
    expect(await splitTimeEntry(fetcher, block(), ms("2026-03-02T10:30:00.000Z"))).toEqual({ ok: false, error: "That place no longer exists." });
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string)).toEqual({ stoppedAt: "2026-03-02T11:00:00.000Z" });
  });

  it("changes nothing when the block can't be shortened", async () => {
    const fetcher = vi.fn<Fetcher>(async () => refused("Times overlap a locked block."));
    expect(await splitTimeEntry(fetcher, block(), ms("2026-03-02T10:30:00.000Z"))).toEqual({ ok: false, error: "Times overlap a locked block." });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("duplicating a block (card G)", () => {
  it("adds a block with the same details right after it", async () => {
    const fetcher = vi.fn<Fetcher>(async () => ok());
    expect(await duplicateTimeEntry(fetcher, block())).toEqual({ ok: true });
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({ mode: "manual",
      startedAt: "2026-03-02T11:00:00.000Z", stoppedAt: "2026-03-02T12:00:00.000Z", categoryId: "cat-1", tagNames: ["deep"] });
    expect(await duplicateTimeEntry(fetcher, block({ stoppedAt: null }))).toEqual({ ok: false, error: "Stop this block before duplicating it." });
  });
});
