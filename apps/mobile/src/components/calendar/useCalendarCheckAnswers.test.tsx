import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileBootstrap, MobileReviewItem } from "../../lib/api";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const appState = vi.hoisted(() => ({ listener: null as ((state: string) => void) | null }));
vi.mock("react-native", () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  Alert: { alert: vi.fn() },
  AppState: {
    addEventListener: (_type: string, listener: (state: string) => void) => {
      appState.listener = listener;
      return { remove: () => { appState.listener = null; } };
    }
  }
}));
const store = vi.hoisted(() => ({
  enqueueReviewMutation: vi.fn(async (_input: Record<string, unknown>) => undefined),
  synchroniseReviewMutations: vi.fn(async () => undefined),
  createReviewClientMutationId: () => "client-id"
}));
vi.mock("../../lib/reviewSyncStore", () => store);
vi.mock("../../lib/friendlyError", () => ({ friendlyMobileErrorMessage: (_error: unknown, fallback: string) => fallback }));
vi.mock("expo-secure-store", () => ({}));

import { useCalendarCheckAnswers } from "./useCalendarCheckAnswers";

// Synthetic suggestions in Exampleton (made-up names and ids).
const at = (hour: number, minute = 0) => new Date(2026, 9, 22, hour, minute).toISOString();
const suggestion = (id: string, overrides: Partial<MobileReviewItem> = {}): MobileReviewItem => ({
  id, title: "Exampleton Library", eventSource: "location_learning", eventType: "unknown_stay", categoryName: null, placeName: null,
  suggestedCategoryId: null, suggestedPlaceId: null, suggestedStartedAt: at(10), suggestedStoppedAt: at(11), confidence: "medium",
  status: "open", notes: null, rawPayload: { clientSegmentId: `segment-${id}` }, createdAt: at(12), ...overrides
});
const bootstrap = (reviewItems: MobileReviewItem[]) => ({ reviewItems } as unknown as MobileBootstrap);

type Hook = ReturnType<typeof useCalendarCheckAnswers>;
function mount(data: MobileBootstrap) {
  const result: { current: Hook } = { current: null as unknown as Hook };
  function Harness({ value }: { value: MobileBootstrap }) {
    result.current = useCalendarCheckAnswers({ data: value, locallyDecidedIds: new Set() });
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Harness value={data} />); });
  return { result, rerender: (next: MobileBootstrap) => act(() => { tree.update(<Harness value={next} />); }), tree };
}

describe("Calendar › List answers (location v4 step 14, iPhone part 3b)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.enqueueReviewMutation.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds an answer for Undo, hides its “?” meanwhile, then saves the deck's mutation", async () => {
    const item = suggestion("a");
    const { result } = mount(bootstrap([item]));
    act(() => { result.current.answer("a", true); });
    expect(result.current.held).toMatchObject({ itemId: "a", logged: true, title: "Exampleton Library" });
    expect(result.current.hiddenIds.has("a")).toBe(true);
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.enqueueReviewMutation).toHaveBeenCalledOnce();
    expect(store.enqueueReviewMutation.mock.calls[0][0]).toMatchObject({ item, mutation: { action: "confirm" }, clientMutationId: "client-id" });
    // Saved, not yet in the outbox's own record: still out of the List.
    expect(result.current.held).toBeNull();
    expect(result.current.hiddenIds.has("a")).toBe(true);
  });

  it("Undo brings the “?” back and saves nothing", async () => {
    const { result } = mount(bootstrap([suggestion("a")]));
    act(() => { result.current.answer("a", false); });
    act(() => { result.current.undo(); });
    expect(result.current.held).toBeNull();
    expect(result.current.hiddenIds.size).toBe(0);
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
  });

  it("a second answer saves the first at once; backgrounding saves the held one", async () => {
    const { result } = mount(bootstrap([suggestion("a"), suggestion("b", { suggestedStartedAt: at(14), suggestedStoppedAt: at(15) })]));
    act(() => { result.current.answer("a", false); });
    await act(async () => { result.current.answer("b", true); });
    expect(store.enqueueReviewMutation).toHaveBeenCalledOnce();
    expect(store.enqueueReviewMutation.mock.calls[0][0]).toMatchObject({ mutation: { action: "ignore_once_location" } });
    await act(async () => { appState.listener?.("background"); });
    expect(store.enqueueReviewMutation).toHaveBeenCalledTimes(2);
    expect(store.enqueueReviewMutation.mock.calls[1][0]).toMatchObject({ mutation: { action: "confirm" } });
  });

  it("does not save a suggestion that changed, or was decided elsewhere, while held", async () => {
    const { result, rerender } = mount(bootstrap([suggestion("a"), suggestion("b", { suggestedStartedAt: at(14), suggestedStoppedAt: at(15) })]));
    act(() => { result.current.answer("a", true); });
    rerender(bootstrap([suggestion("a", { suggestedStoppedAt: at(11, 30) }), suggestion("b", { suggestedStartedAt: at(14), suggestedStoppedAt: at(15) })]));
    await act(async () => { vi.advanceTimersByTime(4_800); });
    act(() => { result.current.answer("b", true); });
    rerender(bootstrap([suggestion("a", { suggestedStoppedAt: at(11, 30) }), suggestion("b", { status: "confirmed", suggestedStartedAt: at(14), suggestedStoppedAt: at(15) })]));
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
  });

  it("decides an outing with its trips in one row, as the deck does", async () => {
    // The deck's own outing fixture (reviewDeckOutings.test.ts): a Stay with a Move there and back.
    const part = (id: string, start: string, stop: string, role: string) => suggestion(id, {
      title: id, eventType: role === "stay" ? "unknown_stay" : "commute_detected", suggestedStartedAt: start, suggestedStoppedAt: stop,
      rawPayload: { outingKey: "outing:a", outingRole: role, ...(role === "stay" ? {} : { travelMode: "automotive" }) }
    });
    const items = [
      part("there", "2026-10-17T10:04:00.000Z", "2026-10-17T10:10:00.000Z", "in"),
      part("stay", "2026-10-17T10:10:00.000Z", "2026-10-17T10:25:00.000Z", "stay"),
      part("back", "2026-10-17T10:25:00.000Z", "2026-10-17T10:30:00.000Z", "out")
    ];
    const { result } = mount(bootstrap(items));
    act(() => { result.current.answer("stay", false); });
    expect([...result.current.hiddenIds].sort()).toEqual(["back", "stay", "there"]);
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.enqueueReviewMutation.mock.calls[0][0]).toMatchObject({
      item: items[1],
      mutation: { action: "ignore_outing", memberReviewItemIds: ["there", "back"] },
      affectedItems: [items[1], items[0], items[2]]
    });
  });
});
