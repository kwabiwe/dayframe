// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewItemRow } from "@/lib/queries";

const clientFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch }));

const { useReviewDecisions } = await import("./useReviewDecisions");

// Review decisions per owner lifetime (Codex r4, r5 on #609). Synthetic ids only.
const item = (id: string): ReviewItemRow => ({
  id, type: "suggestion", title: "Visited a place", eventSource: "location_learning", eventType: "unknown_stay", projectName: null,
  categoryName: null, categoryColor: null, placeName: null, suggestedProjectId: null, suggestedCategoryId: null, suggestedPlaceId: null,
  suggestedStartedAt: "2026-10-28T09:00:00.000Z", suggestedStoppedAt: "2026-10-28T10:00:00.000Z", confidence: "medium", status: "open",
  notes: null, rawPayload: { clientSegmentId: `seg-${id}` }, createdAt: "2026-10-28T12:00:00.000Z"
});
const decision = (id: string) => ({ itemId: id, kind: "skip" as const, mutation: { action: "ignore_once_location" as const }, signature: id,
  label: `Skipped ${id}`, durationMs: 0, color: null, colorName: "" });

afterEach(() => {
  vi.useRealTimers();
  clientFetch.mockReset();
});

describe("useReviewDecisions owner lifetimes (Codex r5 on #609)", () => {
  it("drops a previous owner's restore that runs late, after a new owner answered", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    clientFetch.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: "Old workspace refused it" }), { status: 500 }));
    // The List's transition runs restores later: here, when the test releases them.
    const queued: Array<() => void> = [];
    const applyRestore = (update: () => void) => { queued.push(update); };
    const refresh = vi.fn(async () => undefined);
    const { result, rerender } = renderHook(({ owner, items }) => useReviewDecisions(items, refresh, () => undefined, applyRestore, owner),
      { initialProps: { owner: "w1:u1", items: [item("a")] } });
    act(() => { result.current.decide(decision("a")); });
    // Its save is refused: the restore is queued, not yet applied.
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(queued.length).toBeGreaterThan(0);
    // The owner changes, and the new one answers its own question.
    rerender({ owner: "w2:u1", items: [item("b")] });
    act(() => { result.current.decide(decision("b")); });
    expect(result.current.state.hiddenIds.has("b")).toBe(true);
    // The old restore runs now: the new owner's answer, its Undo and its state are untouched.
    act(() => { queued.splice(0).forEach((update) => update()); });
    expect(result.current.state.hiddenIds.has("b")).toBe(true);
    expect(result.current.state.notice?.label).toBe("Skipped b");
    expect(result.current.state.error).toBeNull();
  });
});
