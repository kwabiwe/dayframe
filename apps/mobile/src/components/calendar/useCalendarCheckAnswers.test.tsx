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
  createReviewClientMutationId: () => "client-id",
  reviewItemsDecidedLocally: vi.fn(async (_bootstrap: unknown, _ids: readonly string[]) => false)
}));
vi.mock("../../lib/reviewSyncStore", () => store);
vi.mock("../../lib/friendlyError", () => ({ friendlyMobileErrorMessage: (_error: unknown, fallback: string) => fallback }));
vi.mock("expo-secure-store", () => ({}));

import { AccessibilityInfo } from "react-native";
import { calendarCheckOutings, useCalendarCheckAnswers } from "./useCalendarCheckAnswers";
import { claimReviewAnswer, releaseReviewAnswer } from "../../lib/reviewAnswerClaims";

// Synthetic suggestions in Exampleton (made-up names and ids).
const at = (hour: number, minute = 0) => new Date(2026, 9, 22, hour, minute).toISOString();
const suggestion = (id: string, overrides: Partial<MobileReviewItem> = {}): MobileReviewItem => ({
  id, title: "Exampleton Library", eventSource: "location_learning", eventType: "unknown_stay", categoryName: null, placeName: null,
  suggestedCategoryId: null, suggestedPlaceId: null, suggestedStartedAt: at(10), suggestedStoppedAt: at(11), confidence: "medium",
  status: "open", notes: null, rawPayload: { clientSegmentId: `segment-${id}` }, createdAt: at(12), ...overrides
});
const bootstrap = (reviewItems: MobileReviewItem[]) => ({ reviewItems } as unknown as MobileBootstrap);

// The deck's own outing fixture (reviewDeckOutings.test.ts): a Stay with a Move there and back.
const part = (id: string, start: string | null, stop: string | null, role: string) => suggestion(id, {
  title: id, eventType: role === "stay" ? "unknown_stay" : "commute_detected", suggestedStartedAt: start, suggestedStoppedAt: stop,
  rawPayload: { outingKey: "outing:a", outingRole: role, ...(role === "stay" ? {} : { travelMode: "automotive" }) }
});
const outing = (stayStart: string | null = "2026-10-17T10:10:00.000Z") => [
  part("there", "2026-10-17T10:04:00.000Z", "2026-10-17T10:10:00.000Z", "in"),
  part("stay", stayStart, "2026-10-17T10:25:00.000Z", "stay"),
  part("back", "2026-10-17T10:25:00.000Z", "2026-10-17T10:30:00.000Z", "out")
];

type Hook = ReturnType<typeof useCalendarCheckAnswers>;
const NONE: ReadonlySet<string> = new Set();
function mount(data: MobileBootstrap) {
  const result: { current: Hook } = { current: null as unknown as Hook };
  let props = { value: data, decided: NONE, owner: "owner-a" as string | null, states: NONE };
  function Harness({ value, decided, owner, states }: typeof props) {
    result.current = useCalendarCheckAnswers({ data: value, locallyDecidedIds: decided, ownerKey: owner, syncStateIds: states });
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Harness {...props} />); });
  const update = (next: Partial<typeof props>) => act(() => {
    props = { ...props, ...next };
    tree.update(<Harness {...props} />);
  });
  return { result, rerender: (next: MobileBootstrap) => update({ value: next }), update, tree };
}

describe("Calendar › List answers (location v4 step 14, iPhone part 3b)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.enqueueReviewMutation.mockReset();
    store.enqueueReviewMutation.mockImplementation(async () => undefined);
    store.reviewItemsDecidedLocally.mockReset();
    store.reviewItemsDecidedLocally.mockImplementation(async () => false);
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
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
    const items = outing();
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

  it("drops a held answer unsaved when the account changes, and shows nothing of it there (Codex r1 on #582)", async () => {
    const { result, update } = mount(bootstrap([suggestion("a")]));
    act(() => { result.current.answer("a", true); });
    update({ owner: "owner-b" });
    expect(result.current.held).toBeNull();
    expect(result.current.hiddenIds.size).toBe(0);
    await act(async () => { vi.advanceTimersByTime(10_000); appState.listener?.("background"); });
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
  });

  it("saves from the copy it showed when a capped refresh only pages the suggestion out (Codex r1 on #582)", async () => {
    const item = suggestion("a");
    const { result, rerender } = mount(bootstrap([item, suggestion("b", { suggestedStartedAt: at(14), suggestedStoppedAt: at(15) })]));
    act(() => { result.current.answer("a", true); });
    rerender(bootstrap([suggestion("b", { suggestedStartedAt: at(14), suggestedStoppedAt: at(15) })]));
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.enqueueReviewMutation).toHaveBeenCalledOnce();
    const input = store.enqueueReviewMutation.mock.calls[0][0] as { item: MobileReviewItem; bootstrap: MobileBootstrap };
    expect(input.item).toEqual(item);
    expect(input.bootstrap.reviewItems.map((candidate) => candidate.id).sort()).toEqual(["a", "b"]);
  });

  it("hands a saved answer over at the outbox record's next read, even when that record does not hide it (Codex r1 on #582)", async () => {
    const { result, update } = mount(bootstrap([suggestion("a")]));
    act(() => { result.current.answer("a", false); });
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(result.current.hiddenIds.has("a")).toBe(true);
    // The next read of the outbox's record (a new set) does not hide it: a rejected answer restored. It shows again.
    update({ decided: new Set() });
    expect(result.current.hiddenIds.has("a")).toBe(false);
  });

  it("never saves a suggestion the Review deck is already saving, and needs a whole window to log (Codex r1 on #582)", async () => {
    const { result } = mount(bootstrap([suggestion("a"), suggestion("b", { suggestedStartedAt: null, suggestedStoppedAt: null })]));
    claimReviewAnswer(["a"]);
    act(() => { result.current.answer("a", true); });
    expect(result.current.held).toBeNull();
    releaseReviewAnswer(["a"]);
    act(() => { result.current.answer("b", true); });
    expect(result.current.held).toBeNull();
    act(() => { result.current.answer("b", false); });
    expect(result.current.held).toMatchObject({ itemId: "b", logged: false });
  });

  it("never saves a remembered copy this phone decided meanwhile, as on the deck (Codex r2 on #582)", async () => {
    const { result, rerender } = mount(bootstrap([suggestion("a"), suggestion("b", { suggestedStartedAt: at(14), suggestedStoppedAt: at(15) })]));
    act(() => { result.current.answer("a", false); });
    // A refresh pages it out while the deck logs the same suggestion: the outbox now has its decision.
    rerender(bootstrap([suggestion("b", { suggestedStartedAt: at(14), suggestedStoppedAt: at(15) })]));
    store.reviewItemsDecidedLocally.mockImplementation(async () => true);
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.reviewItemsDecidedLocally).toHaveBeenCalledWith(expect.anything(), ["a"]);
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
    expect(result.current.hiddenIds.has("a")).toBe(false);
    // A listed suggestion needs no outbox read: it is saved as before.
    act(() => { result.current.answer("b", true); });
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.enqueueReviewMutation).toHaveBeenCalledOnce();
  });

  it("brings a paged-out answer back to the List on Undo and after a failed save, outing whole (Codex r2 on #582)", async () => {
    const items = outing();
    const { result, rerender } = mount(bootstrap(items));
    act(() => { result.current.answer("stay", true); });
    const pagedOut = bootstrap([]);
    rerender(pagedOut);
    act(() => { result.current.undo(); });
    expect(result.current.data?.reviewItems.map((item) => item.id).sort()).toEqual(["back", "stay", "there"]);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith("stay is back.");
    // The next read replaces the copies like any other loaded item.
    rerender(bootstrap([]));
    expect(result.current.data?.reviewItems).toEqual([]);

    // A save that fails brings the paged-out copies back too.
    const again = mount(bootstrap(items));
    act(() => { again.result.current.answer("stay", false); });
    again.rerender(pagedOut);
    store.enqueueReviewMutation.mockImplementation(async () => { throw new Error("disk full"); });
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(again.result.current.hiddenIds.size).toBe(0);
    expect(again.result.current.data?.reviewItems.map((item) => item.id).sort()).toEqual(["back", "stay", "there"]);
  });

  it("folds, asks and saves outings with one map: the deck's eligibility (Codex r2 on #582)", async () => {
    // A Stay without a complete window is no outing: its trips are asked on their own, from the start.
    expect(calendarCheckOutings(outing(null), NONE).folded.size).toBe(0);
    // Nor is one with a waiting or rejected change of a part.
    expect(calendarCheckOutings(outing(), new Set(["back"])).outings.get("stay")?.members.map((member) => member.id)).toEqual(["there"]);
    expect([...calendarCheckOutings(outing(), NONE).folded].sort()).toEqual(["back", "there"]);
    const { result, update } = mount(bootstrap(outing()));
    update({ states: new Set(["back"]) });
    act(() => { result.current.answer("stay", true); });
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.enqueueReviewMutation.mock.calls[0][0]).toMatchObject({ mutation: { action: "confirm_outing", memberReviewItemIds: ["there"] } });
    // A trip of it already saving on the deck: the List leaves the answer to it.
    const other = mount(bootstrap(outing()));
    claimReviewAnswer(["there"]);
    act(() => { other.result.current.answer("stay", true); });
    expect(other.result.current.held).toBeNull();
    releaseReviewAnswer(["there"]);
  });

  it("tells VoiceOver the answer and its Undo, then that it is back, as the deck does (Codex r2 on #582)", () => {
    const { result } = mount(bootstrap([suggestion("a")]));
    act(() => { result.current.answer("a", true); });
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith("Logged Exampleton Library. Undo is available for a few seconds.");
    act(() => { result.current.undo(); });
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith("Exampleton Library is back.");
  });
});
