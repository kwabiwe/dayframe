import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { LocationTimeline, TimelinePlace } from "@dayframe/shared";
import type { MobileBootstrap, MobileReviewItem } from "../../lib/api";

// Randomised interleavings over the real waiting-record store and correction queue (Codex r15 on #610): answers, Logs
// as, Undo, unmount/remount, background/foreground, account switches, acknowledgements and refusals, in seeded random
// orders. After each run settles: no record is held without a live hold, no foreign record was touched, and every
// "?" is visible or resolved (its record waits for corrections that are still to come). Synthetic ids only.
vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const env = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  appState: "active",
  listeners: new Set<(state: string) => void>(),
  reply: 200
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => env.storage.get(key) ?? null,
    removeItem: async (key: string) => { env.storage.delete(key); },
    setItem: async (key: string, value: string) => { env.storage.set(key, value); }
  }
}));
vi.mock("react-native", () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  Alert: { alert: vi.fn() },
  AppState: {
    get currentState() { return env.appState; },
    addEventListener: (_type: string, listener: (state: string) => void) => {
      env.listeners.add(listener);
      return { remove: () => env.listeners.delete(listener) };
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
vi.mock("../../lib/api", () => ({
  createPlace: vi.fn(async () => ({ ok: true, place: { id: "6f000000-0000-4000-8000-0000000000aa" } })),
  fetchTimelineItemEvidence: vi.fn(async () => ({ segment: { kind: "stay" }, map: { centre: null, stayRadiusMeters: 40, nearbySavedPlaces: [] } }))
}));
vi.mock("./LocationCorrectionSheet", () => ({ LocationCorrectionSheet: "LocationCorrectionSheet" }));
vi.mock("../../lib/friendlyError", () => ({ friendlyMobileErrorMessage: (_error: unknown, fallback: string) => fallback }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("../../lib/haptics", () => ({ playHaptic: vi.fn() }));

const account = await import("../../lib/mobileAccount");
const outbox = await import("../../lib/timelineCorrectionOutbox");
const answers = await import("../../lib/reviewAnswersAfterCorrections");
const { useCalendarCheckAnswers } = await import("./useCalendarCheckAnswers");
const { useLocationCorrections } = await import("./useLocationCorrections");

const KEY = "dayframe.reviewAnswersAfterCorrections.v1";
const CATEGORY = "6f000000-0000-4000-8000-0000000000c1";
const iso = (minutes: number) => new Date(Date.parse("2026-10-27T08:00:00.000Z") + minutes * 60_000).toISOString();
const owners = [{ userId: "user-a", workspaceId: "ws" }, { userId: "user-b", workspaceId: "ws" }];
const segmentOf = (index: number) => `seg-${index}`;
const itemOf = (index: number): MobileReviewItem => ({
  id: `ri-${index}`, title: "Exampleton Library", eventSource: "location_learning", eventType: "unknown_stay", categoryName: null,
  placeName: null, suggestedCategoryId: null, suggestedPlaceId: null, suggestedStartedAt: iso(0), suggestedStoppedAt: iso(60),
  confidence: "medium", status: "open", notes: null, rawPayload: { clientSegmentId: segmentOf(index) }, createdAt: iso(70)
}) as MobileReviewItem;
const dataOf = (index: number) => ({
  user: { id: owners[index].userId }, workspace: { id: owners[index].workspaceId }, reviewItems: [itemOf(index)],
  categories: [{ id: CATEGORY, name: "Errands", color: "teal", isPinned: true }], places: []
}) as unknown as MobileBootstrap;
const placeOf = (index: number): TimelinePlace => ({
  kind: "place", id: segmentOf(index), status: "finalised", startedAt: iso(0), stoppedAt: iso(60), placeId: null, learnedPlaceId: null,
  name: null, role: null, matchKind: "unknown", confidence: "low", blockIds: []
});
const NONE: ReadonlySet<string> = new Set();

/** A small seeded RNG (mulberry32). */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type Hooks = { answers: ReturnType<typeof useCalendarCheckAnswers>; places: ReturnType<typeof useLocationCorrections> };
const hooks: { current: Hooks | null } = { current: null };
// One data and one timeline object per account, as a Dashboard keeps them between renders.
const DATA = [dataOf(0), dataOf(1)];
const TIMELINES = [0, 1].map((index) => ({ items: [placeOf(index)] }) as unknown as LocationTimeline);
function Harness({ index }: { index: number }) {
  const data = DATA[index];
  const answersHook = useCalendarCheckAnswers({ data, locallyDecidedIds: NONE, ownerKey: `owner-${index}`, syncStateIds: NONE });
  const places = useLocationCorrections({ acknowledged: [], clockFormat: "24h", data, pending: [], reduceMotion: false,
    showNotice: () => undefined, theme: {} as never, timeline: TIMELINES[index] });
  hooks.current = { answers: answersHook, places };
  return places.sheet;
}
const flush = async () => {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
};

describe("randomised interleavings of waiting answers and Logs as, over the real store (Codex r15 on #610)", () => {
  it("never leaves a record held, never touches a foreign record, and leaves every \"?\" visible or resolved", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-10-27T12:00:00.000Z"));
    // How much the runs exercised: records seen held mid-run, and each kind of step taken.
    let seenHeld = 0;
    const kinds = new Map<string, number>();
    try {
      for (let run = 0; run < 200; run += 1) {
        const random = rng(610_000 + run);
        env.storage.clear();
        env.appState = "active";
        env.listeners.clear();
        account.__resetMobileAccountForTests();
        outbox.__resetTimelineCorrectionOutboxForTests();
        answers.__resetAnswersAfterCorrectionsForTests();
        let current = 0;
        await account.activateMobileAccount(owners[current]);
        // Each account has a correction for its place saved offline: its answers and Logs as wait for it.
        for (const [index, owner] of owners.entries()) {
          await outbox.enqueueTimelineCorrections(owner, [{ request: { kind: "times", subject: "place", itemId: segmentOf(index),
            startedAt: iso(0), stoppedAt: iso(60), clientCorrectionId: `6f000000-0000-4000-8000-00000000000${index + 1}` } }]);
        }
        // A foreign backend's record, which nothing here may touch.
        const foreign = { userId: owners[0].userId, workspaceId: owners[0].workspaceId, id: "6f000000-0000-4000-8000-0000000000ff",
          reviewItemId: "ri-0", logged: true, waitsFor: ["6f000000-0000-4000-8000-000000000001"], acknowledged: [],
          backendId: "https://elsewhere.example", held: { run: "elsewhere" }, createdAt: iso(0) };
        env.storage.set(KEY, JSON.stringify([foreign]));
        const foreignJson = JSON.stringify(foreign);
        let tree: ReturnType<typeof create> | null = null;
        const mount = () => act(() => { tree = create(<Harness index={current} />); });
        const unmount = () => act(() => { tree?.unmount(); tree = null; });
        await mount();
        const steps = 6 + Math.floor(random() * 10);
        const trace: string[] = [];
        for (let step = 0; step < steps; step += 1) {
          const roll = Math.floor(random() * 11);
          const live = tree !== null && hooks.current;
          if (roll === 0 && live) {
            trace.push("answer");
            act(() => { hooks.current!.answers.answer(`ri-${current}`, random() < 0.5); });
          } else if (roll === 1 && live) {
            trace.push("logAs");
            act(() => { hooks.current!.places.openPlace(placeOf(current), "Unknown place"); });
            const sheet = tree!.root.findAll((node) => (node.type as unknown) === "LocationCorrectionSheet")[0];
            const logAs = sheet?.props.logAs as { onLog: (id: string) => void } | undefined;
            if (logAs) act(() => { logAs.onLog(CATEGORY); });
          } else if (roll === 2 && live) {
            trace.push("undo");
            act(() => {
              hooks.current!.answers.undo();
              hooks.current!.places.undoLog();
            });
          } else if (roll === 3) {
            trace.push("time");
            await act(async () => { vi.advanceTimersByTime(5_000); await flush(); });
          } else if (roll === 4) {
            trace.push(tree ? "unmount" : "mount");
            if (tree) await unmount();
            else await mount();
          } else if (roll === 5) {
            env.appState = env.appState === "active" ? "background" : "active";
            trace.push(env.appState);
            act(() => { for (const listener of [...env.listeners]) listener(env.appState); });
          } else if (roll === 6) {
            trace.push("switch");
            current = 1 - current;
            await account.activateMobileAccount(owners[current]);
            if (tree) act(() => { (tree as ReturnType<typeof create>).update(<Harness index={current} />); });
          } else if (roll === 7 || roll === 8) {
            env.reply = roll === 7 ? 200 : 409;
            trace.push(roll === 7 ? "ack" : "refuse");
            vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(env.reply === 200 ? { ok: true } : { error: "No." }), { status: env.reply })));
            await act(async () => { await outbox.synchroniseTimelineCorrections({ owner: owners[current], force: true }); await flush(); });
          } else if (roll === 9 && live) {
            // A Logs as whose hold starts and whose screen goes away in one batch, before any re-render.
            trace.push("logAs+unmount");
            act(() => { hooks.current!.places.openPlace(placeOf(current), "Unknown place"); });
            const sheet = tree!.root.findAll((node) => (node.type as unknown) === "LocationCorrectionSheet")[0];
            const logAs = sheet?.props.logAs as { onLog: (id: string) => void } | undefined;
            await act(async () => {
              logAs?.onLog(CATEGORY);
              await flush();
              tree?.unmount();
              tree = null;
            });
          } else {
            trace.push("flush");
            await act(async () => { await flush(); });
          }
          await act(async () => { await flush(); });
          const now = JSON.parse(env.storage.get(KEY) ?? "[]") as Array<{ held?: { run: string }; backendId?: string }>;
          if (now.some((record) => record.held && record.backendId !== "https://elsewhere.example")) seenHeld += 1;
          kinds.set(trace[trace.length - 1], (kinds.get(trace[trace.length - 1]) ?? 0) + 1);
        }
        // Settle: every Undo ends, the screen goes away, everything in flight lands.
        await act(async () => { vi.advanceTimersByTime(10_000); await flush(); });
        if (tree) await unmount();
        await act(async () => { await flush(); vi.advanceTimersByTime(10_000); await flush(); });
        const stored = JSON.parse(env.storage.get(KEY) ?? "[]") as Array<{ id: string; held?: unknown; backendId?: string }>;
        const context = `run ${run}: ${trace.join(", ")}`;
        // No record of this backend is held without a live hold (every hold ended with its screen).
        expect(stored.filter((record) => !record.backendId || record.backendId !== "https://elsewhere.example").filter((record) => record.held),
          context).toEqual([]);
        // The foreign record was never touched.
        expect(stored.find((record) => record.id === foreign.id), context).toEqual(JSON.parse(foreignJson));
        // Every "?" is visible or resolved, once a Dashboard's release has run (as it does on mount): a record that still
        // hides one waits only for corrections still to come (none refused), and nothing is left committing.
        for (const [index, owner] of owners.entries()) {
          await answers.releaseAnswersAfterCorrections({ owner, readPending: outbox.readPendingTimelineCorrections,
            readAcknowledged: (each) => outbox.readAcknowledgedTimelineCorrections(each), release: async () => "wait" });
          const pending = await outbox.readPendingTimelineCorrections(owner);
          const refused = new Set(pending.filter((item) => item.failureKind === "permanent").map((item) => item.clientCorrectionId));
          for (const { record, state } of await answers.readAnswersAfterCorrectionsWithState(owner)) {
            if (state === "abandoned") continue;
            expect(state, `${context} (account ${index})`).toBe("committed");
            expect(record.waitsFor.filter((id) => !record.acknowledged.includes(id)).filter((id) => refused.has(id)), `${context} (account ${index})`).toEqual([]);
          }
        }
        vi.unstubAllGlobals();
      }
      // The runs did exercise holds (answers and Logs as waiting on their corrections) and every kind of step.
      expect(seenHeld).toBeGreaterThan(50);
      for (const kind of ["answer", "logAs", "logAs+unmount", "undo", "time", "unmount", "mount", "background", "active", "switch", "ack", "refuse"]) {
        expect(kinds.get(kind) ?? 0, kind).toBeGreaterThan(10);
      }
    } finally {
      vi.useRealTimers();
    }
  }, 120_000);
});
