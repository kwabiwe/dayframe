import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileBootstrap, MobileReviewItem } from "../../lib/api";

// The answers hook over the real waiting-record store and correction queue (Codex r14 on #610): every late start of a
// waiting record ends withdrawn, settled or held for Undo, never left held. Synthetic ids only.
vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const storage = vi.hoisted(() => Object.assign(new Map<string, string>(), { paused: null as Promise<void> | null }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    // Reads can be held back (`paused`), to keep a registration in flight across account changes.
    getItem: async (key: string) => {
      if (storage.paused) await storage.paused;
      return storage.get(key) ?? null;
    },
    removeItem: async (key: string) => { storage.delete(key); },
    setItem: async (key: string, value: string) => { storage.set(key, value); }
  }
}));
const appState = vi.hoisted(() => ({ listener: null as ((state: string) => void) | null }));
vi.mock("react-native", () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  Alert: { alert: vi.fn() },
  AppState: {
    currentState: "active",
    addEventListener: (_type: string, listener: (state: string) => void) => {
      appState.listener = listener;
      return { remove: () => { appState.listener = null; } };
    }
  }
}));
vi.mock("../../lib/secure-session", () => ({
  isAuthenticatedSessionSnapshotCurrent: vi.fn(() => true),
  readOwnedAuthenticatedSessionSnapshot: vi.fn(async (owner: unknown) => ({ status: "authenticated", snapshot: { generation: 1, owner, token: "t" } }))
}));
vi.mock("../../lib/reviewSyncStore", () => ({
  enqueueReviewMutation: vi.fn(async () => undefined),
  synchroniseReviewMutations: vi.fn(async () => undefined),
  createReviewClientMutationId: (() => { let next = 0; return () => `6f000000-0000-4000-8000-${String(++next).padStart(12, "0")}`; })(),
  reviewItemIdsDecidedLocally: vi.fn(async () => new Set())
}));
vi.mock("../../lib/friendlyError", () => ({ friendlyMobileErrorMessage: (_error: unknown, fallback: string) => fallback }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("../../lib/haptics", () => ({ playHaptic: vi.fn() }));
vi.mock("../../lib/api", () => ({
  createPlace: vi.fn(async () => ({ ok: true, place: { id: "6f000000-0000-4000-8000-0000000000aa" } })),
  fetchTimelineItemEvidence: vi.fn(async () => ({ segment: { kind: "stay" }, map: { centre: null, stayRadiusMeters: 40, nearbySavedPlaces: [] } }))
}));
vi.mock("./LocationCorrectionSheet", () => ({ LocationCorrectionSheet: "LocationCorrectionSheet" }));

const account = await import("../../lib/mobileAccount");
const outbox = await import("../../lib/timelineCorrectionOutbox");
const answers = await import("../../lib/reviewAnswersAfterCorrections");
const { useCalendarCheckAnswers } = await import("./useCalendarCheckAnswers");
const { useLocationCorrections } = await import("./useLocationCorrections");

const OWNER = { userId: "user-a", workspaceId: "ws-a" };
const C1 = "6f000000-0000-4000-8000-0000000000c1";
const at = (hour: number) => new Date(2026, 9, 22, hour).toISOString();
const item = (id: string): MobileReviewItem => ({
  id, title: "Exampleton Library", eventSource: "location_learning", eventType: "unknown_stay", categoryName: null, placeName: null,
  suggestedCategoryId: null, suggestedPlaceId: null, suggestedStartedAt: at(10), suggestedStoppedAt: at(11), confidence: "medium",
  status: "open", notes: null, rawPayload: { clientSegmentId: `segment-${id}` }, createdAt: at(12)
}) as MobileReviewItem;
const data = { user: { id: "user-a" }, workspace: { id: "ws-a" }, reviewItems: [item("a")] } as unknown as MobileBootstrap;
const NONE: ReadonlySet<string> = new Set();
const flush = () => act(async () => { for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)); });
type Hook = ReturnType<typeof useCalendarCheckAnswers>;

function mount() {
  const result: { current: Hook } = { current: null as unknown as Hook };
  let owner: string | null = "owner-a";
  function Harness({ ownerKey }: { ownerKey: string | null }) {
    result.current = useCalendarCheckAnswers({ data, locallyDecidedIds: NONE, ownerKey, syncStateIds: NONE });
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Harness ownerKey={owner} />); });
  const switchTo = (next: string | null) => act(() => {
    owner = next;
    tree.update(<Harness ownerKey={owner} />);
  });
  return { result, tree, switchTo };
}
const states = async () => (await answers.readAnswersAfterCorrectionsWithState(OWNER)).map((each) => each.state);

describe("late starts of waiting answers, over the real store (Codex r14 on #610)", () => {
  beforeEach(async () => {
    storage.clear();
    account.__resetMobileAccountForTests();
    outbox.__resetTimelineCorrectionOutboxForTests();
    answers.__resetAnswersAfterCorrectionsForTests();
    await account.activateMobileAccount(OWNER);
    // A correction for the "?"'s place, saved offline: its answer waits.
    await outbox.enqueueTimelineCorrections(OWNER, [{ request: { kind: "times", subject: "place", itemId: "segment-a",
      startedAt: at(10), stoppedAt: at(11), clientCorrectionId: C1 } }]);
  });
  afterEach(() => vi.useRealTimers());

  it("settles it quietly when the List goes away right after its registration", async () => {
    const { result, tree } = mount();
    act(() => { result.current.answer("a", true); });
    act(() => { tree.unmount(); });
    await flush();
    expect(await states()).toEqual(["committed"]);
  });

  it("withdraws it when another account signs in right after its registration", async () => {
    const { result, switchTo } = mount();
    act(() => { result.current.answer("a", true); });
    switchTo("owner-b");
    await flush();
    expect(await states()).toEqual([]);
  });

  it("settles an edited sheet's answer quietly when the List went away before its corrections were queued", async () => {
    const shared = await import("../../lib/afterCorrections");
    const { result, tree } = mount();
    const startAfterCorrections = result.current.startAfterCorrections;
    await shared.waitForItemCorrections(OWNER, { id: "6f000000-0000-4000-8000-0000000000e1", itemId: "segment-a", newIds: [C1],
      action: { kind: "answer", reviewItemId: "a", logged: true } });
    expect(await states()).toEqual(["held"]);
    act(() => { tree.unmount(); });
    // The corrections are queued, then its start comes: no List any more.
    act(() => { startAfterCorrections("a", true, "6f000000-0000-4000-8000-0000000000e1", "owner-a", OWNER, account.currentMobileAccountEpoch()); });
    await flush();
    expect(await states()).toEqual(["committed"]);
  });

  it("withdraws an answer whose registration outlived an account change, even back to the same account (Codex r16 on #610)", async () => {
    const { result, switchTo } = mount();
    let resume!: () => void;
    storage.paused = new Promise((resolve) => { resume = resolve; });
    act(() => { result.current.answer("a", true); });
    // A → B → A while its registration is in flight.
    await account.activateMobileAccount({ userId: "user-b", workspaceId: "ws-b" });
    switchTo("owner-b");
    await account.activateMobileAccount(OWNER);
    switchTo("owner-a");
    storage.paused = null;
    resume();
    await flush();
    expect(result.current.held).toBeNull();
    expect(await states()).toEqual([]);
  });

  it("withdraws a Logs as whose registration outlived an account change, even back to the same account (Codex r16 on #610)", async () => {
    const place = { kind: "place", id: "segment-a", status: "finalised", startedAt: at(10), stoppedAt: at(11), placeId: null, learnedPlaceId: null,
      name: null, role: null, matchKind: "unknown", confidence: "low", blockIds: [] };
    const timeline = { items: [place] } as never;
    const placesData = (userId: string) => ({ ...data, user: { id: userId }, workspace: { id: userId === "user-a" ? "ws-a" : "ws-b" },
      categories: [{ id: "6f000000-0000-4000-8000-0000000000c9", name: "Errands", color: "teal", isPinned: true }] }) as unknown as MobileBootstrap;
    const DATA_A = placesData("user-a");
    const DATA_B = placesData("user-b");
    const hookRef: { current: ReturnType<typeof useLocationCorrections> | null } = { current: null };
    function Places({ value }: { value: MobileBootstrap }) {
      hookRef.current = useLocationCorrections({ acknowledged: [], clockFormat: "24h", data: value, pending: [], reduceMotion: false,
        showNotice: () => undefined, theme: {} as never, timeline });
      return hookRef.current.sheet;
    }
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<Places value={DATA_A} />); });
    act(() => { hookRef.current!.openPlace(place as never, "Unknown place"); });
    await flush();
    const logAs = tree.root.findAll((node) => (node.type as unknown) === "LocationCorrectionSheet")[0].props.logAs as { onLog: (id: string) => void };
    let resume!: () => void;
    storage.paused = new Promise((resolve) => { resume = resolve; });
    act(() => { logAs.onLog("6f000000-0000-4000-8000-0000000000c9"); });
    await account.activateMobileAccount({ userId: "user-b", workspaceId: "ws-b" });
    act(() => { tree.update(<Places value={DATA_B} />); });
    await account.activateMobileAccount(OWNER);
    act(() => { tree.update(<Places value={DATA_A} />); });
    storage.paused = null;
    resume();
    await flush();
    expect(hookRef.current!.heldLog).toBeNull();
    expect(await states()).toEqual([]);
    act(() => { tree.unmount(); });
  });

  it("starts its Undo hold when nothing changed, and settles it when the Undo ends", async () => {
    vi.useFakeTimers();
    const { result } = mount();
    act(() => { result.current.answer("a", true); });
    await act(async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); });
    expect(result.current.held).toMatchObject({ itemId: "a" });
    expect(await states()).toEqual(["held"]);
    await act(async () => { vi.advanceTimersByTime(4_800); });
    vi.useRealTimers();
    await flush();
    expect(await states()).toEqual(["committed"]);
  });
});
