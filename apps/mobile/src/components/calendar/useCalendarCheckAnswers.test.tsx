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
  reviewItemsDecidedLocally: vi.fn(async (_bootstrap: unknown, _ids: readonly string[]) => false),
  // Item by item (the List reads which parts are decided): every id, or none, as the flag above says.
  reviewItemIdsDecidedLocally: vi.fn(async (bootstrap: unknown, ids: readonly string[]): Promise<Set<string>> =>
    (await store.reviewItemsDecidedLocally(bootstrap, ids)) ? new Set(ids) : new Set())
}));
vi.mock("../../lib/reviewSyncStore", () => store);
const waiting = vi.hoisted(() => ({ commitAnswerAfterCorrections: vi.fn(async (_id: string) => undefined), cancelAnswerAfterCorrections: vi.fn(async (_id: string) => undefined) }));
vi.mock("../../lib/reviewAnswersAfterCorrections", () => waiting);
// The one gate every answer goes through (Codex r7 on #610): by default nothing is queued for its item.
const gate = vi.hoisted(() => ({ waitForItemCorrections: vi.fn(async (..._args: unknown[]): Promise<unknown> => null) }));
vi.mock("../../lib/afterCorrections", () => gate);
vi.mock("../../lib/friendlyError", () => ({ friendlyMobileErrorMessage: (_error: unknown, fallback: string) => fallback }));
vi.mock("expo-secure-store", () => ({}));
const haptics = vi.hoisted(() => ({ playHaptic: vi.fn() }));
vi.mock("../../lib/haptics", () => haptics);

import { AccessibilityInfo, Alert } from "react-native";
import { calendarCheckOutings, calendarCheckRoute, useCalendarCheckAnswers } from "./useCalendarCheckAnswers";
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

  it("lets an answer after corrections go only through its waiting record, after Undo; Undo removes the record (Codex r2 on #610)", async () => {
    waiting.commitAnswerAfterCorrections.mockClear();
    waiting.cancelAnswerAfterCorrections.mockClear();
    const { result } = mount(bootstrap([suggestion("a"), suggestion("b")]));
    let taken = false;
    act(() => { taken = result.current.answer("a", true, null, { afterCorrections: "m-1" }); });
    expect(taken).toBe(true);
    expect(result.current.hiddenIds.has("a")).toBe(true);
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(waiting.commitAnswerAfterCorrections).toHaveBeenCalledWith("m-1");
    // Never into the Review outbox from here: the record goes once its corrections are acknowledged.
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
    expect(result.current.hiddenIds.has("a")).toBe(true);
    act(() => { result.current.answer("b", false, null, { afterCorrections: "m-2" }); });
    act(() => { result.current.undo(); });
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(waiting.cancelAnswerAfterCorrections).toHaveBeenCalledWith("m-2");
    expect(waiting.commitAnswerAfterCorrections).not.toHaveBeenCalledWith("m-2");
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
  });

  it("brings a dropped waiting answer's “?” back at once (Codex r3 on #610)", async () => {
    const { result } = mount(bootstrap([suggestion("a")]));
    act(() => { result.current.answer("a", true, null, { afterCorrections: "m-1" }); });
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(result.current.hiddenIds.has("a")).toBe(true);
    act(() => { result.current.restoreAnswered(["a"]); });
    expect(result.current.hiddenIds.has("a")).toBe(false);
  });

  it("ends a waiting answer's Undo too when its change is refused before Undo runs out, so the “?” stays back (Codex r4 on #610)", async () => {
    waiting.commitAnswerAfterCorrections.mockClear();
    const { result } = mount(bootstrap([suggestion("a")]));
    act(() => { result.current.answer("a", true, null, { afterCorrections: "m-1" }); });
    expect(result.current.hiddenIds.has("a")).toBe(true);
    act(() => { result.current.restoreAnswered(["a"]); });
    expect(result.current.hiddenIds.has("a")).toBe(false);
    expect(result.current.held).toBeNull();
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(result.current.hiddenIds.has("a")).toBe(false);
    expect(waiting.commitAnswerAfterCorrections).not.toHaveBeenCalled();
  });

  it("makes a row's Yes wait for a correction still queued for its place: no confirmation until it is accepted (Codex r7 on #610)", async () => {
    waiting.commitAnswerAfterCorrections.mockClear();
    gate.waitForItemCorrections.mockClear();
    const withAccount = (items: MobileReviewItem[]) => ({ user: { id: "user-a" }, workspace: { id: "ws-a" }, reviewItems: items } as unknown as MobileBootstrap);
    // A correction saved offline for its place, the sheet closed: the gate makes it wait.
    gate.waitForItemCorrections.mockImplementationOnce(async (_owner, input) => ({ id: (input as { id: string }).id }));
    const { result } = mount(withAccount([suggestion("a")]));
    await act(async () => { result.current.answer("a", true); await Promise.resolve(); });
    expect(gate.waitForItemCorrections).toHaveBeenCalledWith({ userId: "user-a", workspaceId: "ws-a" },
      expect.objectContaining({ itemId: "segment-a", newIds: [], action: { kind: "answer", reviewItemId: "a", logged: true } }));
    const recordId = (gate.waitForItemCorrections.mock.calls[0][1] as { id: string }).id;
    expect(result.current.held).toMatchObject({ itemId: "a", afterCorrections: recordId });
    await act(async () => { vi.advanceTimersByTime(4_800); });
    // Its Undo ended: only its waiting record lets it go, once the correction is accepted; never the Review outbox now.
    expect(waiting.commitAnswerAfterCorrections).toHaveBeenCalledWith(recordId);
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
    // Nothing queued for its place: held at once, and saved as before.
    const second = mount(withAccount([suggestion("b")]));
    await act(async () => { second.result.current.answer("b", false); await Promise.resolve(); });
    expect(second.result.current.held).toMatchObject({ itemId: "b" });
    expect((second.result.current.held as { afterCorrections?: string }).afterCorrections).toBeUndefined();
  });

  describe("while the gate answers (Codex r8 on #610)", () => {
    const withAccount = (items: MobileReviewItem[]) => ({ user: { id: "user-a" }, workspace: { id: "ws-a" }, reviewItems: items } as unknown as MobileBootstrap);
    // The gate's registration, finished by hand.
    const deferGate = () => {
      let finish!: (record: unknown) => void;
      gate.waitForItemCorrections.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      return (record: unknown) => act(async () => { finish(record); await Promise.resolve(); await Promise.resolve(); });
    };

    it("never confirms a proposal that changed while it registered: Yes for 10–11, a refresh brings 10–13", async () => {
      waiting.cancelAnswerAfterCorrections.mockClear();
      const finish = deferGate();
      const { result, rerender } = mount(withAccount([suggestion("a")]));
      act(() => { result.current.answer("a", true); });
      rerender(withAccount([suggestion("a", { suggestedStoppedAt: at(13) })]));
      await finish(null);
      expect(result.current.held).toBeNull();
      await act(async () => { vi.advanceTimersByTime(10_000); });
      expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
      // Waiting for a correction too: its record goes, never confirmed.
      const finishWaiting = deferGate();
      const other = mount(withAccount([suggestion("b")]));
      act(() => { other.result.current.answer("b", true); });
      other.rerender(withAccount([suggestion("b", { suggestedStoppedAt: at(13) })]));
      await finishWaiting({ id: "client-id" });
      expect(other.result.current.held).toBeNull();
      expect(waiting.cancelAnswerAfterCorrections).toHaveBeenCalledWith("client-id");
    });

    it("never queues confirm_outing when an outing's trip changed while it registered (Codex r9 on #610)", async () => {
      // The outing's stay has its segment, so its Yes goes through the gate.
      const withSegment = (items: MobileReviewItem[]) => items.map((item) => item.id === "stay"
        ? { ...item, rawPayload: { ...(item.rawPayload as object), clientSegmentId: "segment-stay" } } : item);
      const finish = deferGate();
      const { result, rerender } = mount(withAccount(withSegment(outing())));
      act(() => { result.current.answer("stay", true); });
      // The inbound trip's start moves 10:04 → 09:30 meanwhile.
      rerender(withAccount(withSegment(outing()).map((item) => item.id === "there" ? { ...item, suggestedStartedAt: "2026-10-17T09:30:00.000Z" } : item)));
      await finish(null);
      expect(result.current.held).toBeNull();
      await act(async () => { vi.advanceTimersByTime(10_000); });
      expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
      // Unchanged, the same tap decides the outing as the deck does.
      const again = deferGate();
      const steady = mount(withAccount(withSegment(outing())));
      act(() => { steady.result.current.answer("stay", true); });
      await again(null);
      expect(steady.result.current.held).toMatchObject({ itemId: "stay", outing: { key: "outing:a" } });
    });

    it("an edited sheet's answer settling while away or gone is saved at once, with nothing said (Codex r9 on #610)", async () => {
      waiting.commitAnswerAfterCorrections.mockClear();
      // Away: committed at once, no hold, no haptic, nothing said.
      const away = mount(withAccount([suggestion("a")]));
      act(() => { appState.listener?.("background"); });
      vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
      haptics.playHaptic.mockClear();
      act(() => { away.result.current.answer("a", true, null, { afterCorrections: "m-away" }); });
      expect(away.result.current.held).toBeNull();
      expect(waiting.commitAnswerAfterCorrections).toHaveBeenCalledWith("m-away");
      expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
      expect(haptics.playHaptic).not.toHaveBeenCalled();
      act(() => { appState.listener?.("active"); });
      // Gone: the same.
      const gone = mount(withAccount([suggestion("b")]));
      const answer = gone.result.current.answer;
      act(() => { gone.tree.unmount(); });
      vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
      act(() => { answer("b", false, null, { afterCorrections: "m-gone" }); });
      expect(waiting.commitAnswerAfterCorrections).toHaveBeenCalledWith("m-gone");
      expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    });

    it("says nothing through the save of an answer the gate settles while the app is away (Codex r9 on #610)", async () => {
      const finish = deferGate();
      const { result } = mount(withAccount([suggestion("a")]));
      act(() => { result.current.answer("a", true); });
      act(() => { appState.listener?.("background"); });
      vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
      haptics.playHaptic.mockClear();
      await finish(null);
      await act(async () => { for (let index = 0; index < 5; index += 1) await Promise.resolve(); });
      expect(store.enqueueReviewMutation).toHaveBeenCalledOnce();
      expect(result.current.held).toBeNull();
      expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
      expect(haptics.playHaptic).not.toHaveBeenCalled();
      act(() => { appState.listener?.("active"); });
    });

    it("gates an outing on its trips' queued corrections too, and its record answers the trips with it (Codex r10 on #610)", async () => {
      waiting.commitAnswerAfterCorrections.mockClear();
      gate.waitForItemCorrections.mockClear();
      const segments = (items: MobileReviewItem[]) => items.map((item) => ({ ...item, rawPayload: { ...(item.rawPayload as object), clientSegmentId: `segment-${item.id}` } }));
      // The inbound trip was corrected offline: the gate makes the outing wait.
      gate.waitForItemCorrections.mockImplementationOnce(async (_owner, input) => ({ id: (input as { id: string }).id }));
      const { result } = mount(withAccount(segments(outing())));
      await act(async () => { result.current.answer("stay", true); await Promise.resolve(); await Promise.resolve(); });
      expect(gate.waitForItemCorrections).toHaveBeenCalledWith({ userId: "user-a", workspaceId: "ws-a" }, expect.objectContaining({
        itemId: "segment-stay", memberItemIds: ["segment-there", "segment-back"],
        action: { kind: "answer", reviewItemId: "stay", logged: true, outingMemberIds: ["there", "back"] }
      }));
      expect(result.current.held).toMatchObject({ itemId: "stay", afterCorrections: "client-id", outing: { key: "outing:a" } });
      expect([...result.current.hiddenIds].sort()).toEqual(["back", "stay", "there"]);
      await act(async () => { vi.advanceTimersByTime(4_800); });
      // Only its record lets confirm_outing go, once every correction is accepted; never the Review outbox now.
      expect(waiting.commitAnswerAfterCorrections).toHaveBeenCalledWith("client-id");
      expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
    });

    it("never leaves a waiting answer hidden when its record can't be let go: tried again, then given up (Codex r10 on #610)", async () => {
      const flush = () => act(async () => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); });
      // A failure, then success: tried again at once, and stays answered.
      waiting.commitAnswerAfterCorrections.mockReset();
      waiting.commitAnswerAfterCorrections.mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
      const retried = mount(withAccount([suggestion("a")]));
      act(() => { retried.result.current.answer("a", true, null, { afterCorrections: "m-1" }); });
      await act(async () => { vi.advanceTimersByTime(4_800); });
      await flush();
      expect(waiting.commitAnswerAfterCorrections).toHaveBeenCalledTimes(2);
      expect(retried.result.current.hiddenIds.has("a")).toBe(true);
      expect(Alert.alert).not.toHaveBeenCalled();
      // Failing twice in front: given up — its record goes, its "?" comes back, the not-saved words are said.
      waiting.commitAnswerAfterCorrections.mockReset();
      waiting.commitAnswerAfterCorrections.mockRejectedValue(new Error("disk full"));
      waiting.cancelAnswerAfterCorrections.mockClear();
      const given = mount(withAccount([suggestion("b")]));
      act(() => { given.result.current.answer("b", true, null, { afterCorrections: "m-2" }); });
      await act(async () => { vi.advanceTimersByTime(4_800); });
      await flush();
      expect(waiting.cancelAnswerAfterCorrections).toHaveBeenCalledWith("m-2");
      expect(given.result.current.held).toBeNull();
      expect(given.result.current.hiddenIds.has("b")).toBe(false);
      expect(given.result.current.abandonedIds.has("b")).toBe(true);
      expect(Alert.alert).toHaveBeenCalledWith("Calendar", "Couldn’t save this answer on this iPhone.");
      // Away: quiet, and tried again on the next return to the front.
      vi.mocked(Alert.alert).mockClear();
      waiting.commitAnswerAfterCorrections.mockReset();
      waiting.commitAnswerAfterCorrections.mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
      const away = mount(withAccount([suggestion("c")]));
      act(() => { away.result.current.answer("c", true, null, { afterCorrections: "m-3" }); });
      act(() => { appState.listener?.("background"); });
      await flush();
      expect(Alert.alert).not.toHaveBeenCalled();
      expect(away.result.current.hiddenIds.has("c")).toBe(true);
      act(() => { appState.listener?.("active"); });
      await flush();
      expect(waiting.commitAnswerAfterCorrections).toHaveBeenCalledTimes(2);
      expect(Alert.alert).not.toHaveBeenCalled();
      waiting.commitAnswerAfterCorrections.mockReset();
      waiting.commitAnswerAfterCorrections.mockResolvedValue(undefined);
    });

    it("saves at once, with no Undo hold, when the app went to the background while it registered", async () => {
      waiting.commitAnswerAfterCorrections.mockClear();
      const finish = deferGate();
      const { result } = mount(withAccount([suggestion("a")]));
      act(() => { result.current.answer("a", true); });
      act(() => { appState.listener?.("background"); });
      await finish({ id: "client-id" });
      expect(result.current.held).toBeNull();
      expect(waiting.commitAnswerAfterCorrections).toHaveBeenCalledWith("client-id");
    });

    it("saves at once and says nothing when the List went away while it registered", async () => {
      waiting.commitAnswerAfterCorrections.mockClear();
      const finish = deferGate();
      const { result, tree } = mount(withAccount([suggestion("a")]));
      act(() => { result.current.answer("a", true); });
      act(() => { tree.unmount(); });
      vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
      haptics.playHaptic.mockClear();
      await finish({ id: "client-id" });
      expect(waiting.commitAnswerAfterCorrections).toHaveBeenCalledWith("client-id");
      expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
      expect(haptics.playHaptic).not.toHaveBeenCalled();
    });
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
    // Nor skipped: the outbox refuses every answer without a whole window (Codex r3 on #582).
    act(() => { result.current.answer("b", false); });
    expect(result.current.held).toBeNull();
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
    // A listed suggestion is read for too (Codex r6 on #582), and saved while undecided.
    store.reviewItemsDecidedLocally.mockImplementation(async () => false);
    act(() => { result.current.answer("b", true); });
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.reviewItemsDecidedLocally).toHaveBeenLastCalledWith(expect.anything(), ["b"]);
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

  it("checks a paged-out answer as its suggestion was last seen, and again after the outbox read (Codex r3 on #582)", async () => {
    const other = suggestion("b", { suggestedStartedAt: at(14), suggestedStoppedAt: at(15) });
    const { result, rerender } = mount(bootstrap([suggestion("a"), other]));
    act(() => { result.current.answer("a", true); });
    // A refresh changes its times, and a later one pages it out: the answer was about something else.
    rerender(bootstrap([suggestion("a", { suggestedStoppedAt: at(11, 30) }), other]));
    rerender(bootstrap([other]));
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith("Exampleton Library changed, so it was not saved. Check it again.");

    // A refresh while the outbox is read: checked again after it, as it is now.
    let finishRead!: (decided: boolean) => void;
    store.reviewItemsDecidedLocally.mockImplementation(() => new Promise<boolean>((resolve) => { finishRead = resolve; }));
    const again = mount(bootstrap([suggestion("c"), other]));
    act(() => { again.result.current.answer("c", true); });
    again.rerender(bootstrap([other]));
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.reviewItemsDecidedLocally).toHaveBeenCalledOnce();
    again.rerender(bootstrap([suggestion("c", { status: "confirmed" }), other]));
    await act(async () => { finishRead(false); });
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
  });

  it("treats an outbox it could not read as a failed save: the answer comes back with an alert (Codex r3 on #582)", async () => {
    const { result, rerender } = mount(bootstrap([suggestion("a")]));
    act(() => { result.current.answer("a", false); });
    rerender(bootstrap([]));
    store.reviewItemsDecidedLocally.mockImplementation(async () => { throw new Error("database locked"); });
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
    expect(result.current.hiddenIds.size).toBe(0);
    expect(result.current.data?.reviewItems.map((item) => item.id)).toEqual(["a"]);
    expect(Alert.alert).toHaveBeenCalledWith("Calendar", "Couldn’t save this answer on this iPhone.");
  });

  it("ignores a repeat answer to the same question, so Undo still saves nothing (Codex r4 on #582)", async () => {
    const { result } = mount(bootstrap([suggestion("a")]));
    act(() => { result.current.answer("a", true); });
    act(() => { result.current.answer("a", false); });
    expect(result.current.held).toMatchObject({ itemId: "a", logged: true });
    act(() => { result.current.undo(); });
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
  });

  it("still saves a held answer when the List goes away, but says nothing afterwards (Codex r4 on #582)", async () => {
    let fail!: (error: Error) => void;
    store.enqueueReviewMutation.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    const { result, tree } = mount(bootstrap([suggestion("a")]));
    act(() => { result.current.answer("a", true); });
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
    vi.mocked(Alert.alert).mockClear();
    await act(async () => { tree.unmount(); });
    expect(store.enqueueReviewMutation).toHaveBeenCalledOnce();
    await act(async () => { fail(new Error("disk full")); });
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  });

  it("never folds a trip answered on its own into a later outing answer, and plays the deck's answer haptic once (Codex r5 on #582)", async () => {
    haptics.playHaptic.mockClear();
    const [there, stay, back] = outing();
    const { result, rerender } = mount(bootstrap([there]));
    act(() => { result.current.answer("there", false); });
    expect(haptics.playHaptic).toHaveBeenCalledOnce();
    expect(haptics.playHaptic).toHaveBeenLastCalledWith("reviewSkip");
    // A refresh brings its Stay and the trip back; the Stay is answered while the first trip is held.
    rerender(bootstrap([there, stay, back]));
    await act(async () => { result.current.answer("stay", true); });
    expect(haptics.playHaptic).toHaveBeenLastCalledWith("reviewLog");
    expect(result.current.held).toMatchObject({ itemId: "stay", outing: { members: [{ itemId: "back" }] } });
    await act(async () => { vi.advanceTimersByTime(4_800); });
    const mutations = store.enqueueReviewMutation.mock.calls.map((call) => (call[0] as { mutation: unknown }).mutation);
    expect(mutations).toEqual([
      { action: "ignore_once" },
      { action: "confirm_outing", memberReviewItemIds: ["back"] }
    ]);
  });

  it("holds the shared claim across a delayed outbox read, so the deck can neither start nor finish a save inside it (Codex r6 on #582)", async () => {
    let finishRead!: (decided: boolean) => void;
    store.reviewItemsDecidedLocally.mockImplementation(() => new Promise<boolean>((resolve) => { finishRead = resolve; }));
    const { result } = mount(bootstrap([suggestion("a")]));
    act(() => { result.current.answer("a", false); });
    await act(async () => { vi.advanceTimersByTime(4_800); });
    // The List's read is in flight: the deck's claim for the same suggestion is refused.
    expect(store.reviewItemsDecidedLocally).toHaveBeenCalledOnce();
    expect(claimReviewAnswer(["a"])).toBe(false);
    await act(async () => { finishRead(false); });
    expect(store.enqueueReviewMutation).toHaveBeenCalledOnce();
    // Released once its own write is in the outbox.
    expect(claimReviewAnswer(["a"])).toBe(true);
    releaseReviewAnswer(["a"]);

    // The other way round: the deck holds its claim while it saves; the List leaves the answer to it and
    // reads nothing. Once the deck's write is in, the List's next read says it is decided.
    store.enqueueReviewMutation.mockClear();
    store.reviewItemsDecidedLocally.mockReset();
    const other = mount(bootstrap([suggestion("b")]));
    act(() => { other.result.current.answer("b", false); });
    claimReviewAnswer(["b"]);
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.reviewItemsDecidedLocally).not.toHaveBeenCalled();
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
    expect(other.result.current.hiddenIds.has("b")).toBe(false);
    releaseReviewAnswer(["b"]);
  });

  it("brings back the parts of a paged-out outing still open when another was decided meanwhile (Codex r8 on #582)", async () => {
    const items = outing();
    const { result, rerender } = mount(bootstrap(items));
    act(() => { result.current.answer("stay", true); });
    rerender(bootstrap([]));
    store.reviewItemIdsDecidedLocally.mockImplementationOnce(async () => new Set(["there"]));
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
    expect(result.current.hiddenIds.size).toBe(0);
    expect(result.current.data?.reviewItems.map((item) => item.id).sort()).toEqual(["back", "stay"]);
  });

  it("answers nothing without an account to answer for (Codex r8 on #582)", async () => {
    const { result, update } = mount(bootstrap([suggestion("a")]));
    update({ owner: null });
    act(() => { result.current.answer("a", true); });
    expect(result.current.held).toBeNull();
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
  });

  it("brings back an outing's open parts when its stay was decided elsewhere while held, even paged out (Codex r9 on #582)", async () => {
    const { result, update } = mount(bootstrap(outing()));
    act(() => { result.current.answer("stay", false); });
    // The outbox's record says the stay is decided (the deck), and a refresh pages the outing out.
    update({ value: bootstrap([]), decided: new Set(["stay"]) });
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
    expect(result.current.hiddenIds.size).toBe(0);
    expect(result.current.data?.reviewItems.map((item) => item.id).sort()).toEqual(["back", "there"]);
  });

  it("yields a paged-out outing to a save on the deck without losing its open parts (Codex r10 on #582)", async () => {
    const { result, rerender } = mount(bootstrap(outing()));
    act(() => { result.current.answer("stay", true); });
    rerender(bootstrap([]));
    // The deck claims one trip before the List's answer is saved.
    claimReviewAnswer(["back"]);
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
    expect(result.current.hiddenIds.size).toBe(0);
    expect(result.current.data?.reviewItems.map((item) => item.id).sort()).toEqual(["back", "stay", "there"]);
    releaseReviewAnswer(["back"]);
  });

  it("answers nothing with a waiting or rejected change of its own, as the deck locks it (Codex r10 on #582)", async () => {
    const { result, update } = mount(bootstrap([suggestion("a")]));
    update({ states: new Set(["a"]) });
    act(() => { result.current.answer("a", false); });
    expect(result.current.held).toBeNull();
    await act(async () => { vi.advanceTimersByTime(4_800); });
    expect(store.enqueueReviewMutation).not.toHaveBeenCalled();
  });

  it("opens a place's evidence on its details screen and anything else on the deck, focused on it (Codex r10 on #582)", () => {
    const place = suggestion("a");
    expect(calendarCheckRoute(place, "a")).toEqual({ pathname: "/review/[id]", params: { id: "a" } });
    const sleep = suggestion("s", { eventSource: "health_sleep", eventType: "health_sleep_import", rawPayload: null });
    expect(calendarCheckRoute(sleep, "s")).toEqual({ pathname: "/review", params: { focusReviewId: "s" } });
    // Not loaded here (paged out): the deck finds it.
    expect(calendarCheckRoute(undefined, "x")).toEqual({ pathname: "/review", params: { focusReviewId: "x" } });
  });
});
