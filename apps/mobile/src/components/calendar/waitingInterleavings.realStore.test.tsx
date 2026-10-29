import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { LocationTimeline, TimelinePlace } from "@dayframe/shared";
import type { MobileBootstrap, MobileReviewItem } from "../../lib/api";

// Randomised interleavings over the real waiting-record store, correction queue and release (Codex r15 and r16 on
// #610): answers, Logs as, Undo, unmount/remount, background/foreground, account switches, acknowledgements and
// refusals, with seeded deferred and failing storage writes. After each run settles (each account's Dashboard back in
// front, so its recovery and release run):
// - no record is held without a live hold, and a foreign backend's record is never touched;
// - every open "?" is visible in the List's projection unless a live hold, a delivered answer, or a pending record
//   waiting on corrections none of which was refused covers it;
// - every answer delivered to the Review outbox (and every Logs as queued) matches one that was taken and not undone.
// Synthetic ids only.
vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const env = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  appState: "active",
  listeners: new Set<(state: string) => void>(),
  reply: 200,
  /** Seeded faults on the waiting-record store's writes: a write fails, or lands a few turns late. */
  random: null as null | (() => number),
  faults: false,
  failed: 0,
  deferred: 0,
  delivered: [] as Array<{ itemId: string; action: string; id: string }>
}));
const WAITING_KEY = "dayframe.reviewAnswersAfterCorrections.v1";
async function maybeFault(key: string) {
  if (!env.faults || !env.random || key !== WAITING_KEY) return;
  const roll = env.random();
  if (roll < 0.08) {
    env.failed += 1;
    throw new Error("disk full");
  }
  if (roll < 0.3) {
    env.deferred += 1;
    for (let index = 0; index < 1 + Math.floor(env.random() * 6); index += 1) await Promise.resolve();
  }
}
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => env.storage.get(key) ?? null,
    removeItem: async (key: string) => { await maybeFault(key); env.storage.delete(key); },
    setItem: async (key: string, value: string) => { await maybeFault(key); env.storage.set(key, value); }
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
  // The Review outbox: what reaches it is recorded, as delivered.
  enqueueReviewMutation: vi.fn(async (input: { item: { id: string }; mutation: { action: string }; clientMutationId: string }) => {
    env.delivered.push({ itemId: input.item.id, action: input.mutation.action, id: input.clientMutationId });
  }),
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
const { useAnswersAfterCorrections } = await import("./useAnswersAfterCorrections");

const CATEGORY = "6f000000-0000-4000-8000-0000000000c1";
const iso = (minutes: number) => new Date(Date.parse("2026-10-27T08:00:00.000Z") + minutes * 60_000).toISOString();
const owners = [{ userId: "user-a", workspaceId: "ws" }, { userId: "user-b", workspaceId: "ws" }];
const segmentOf = (index: number) => `seg-${index}`;
const itemOf = (index: number): MobileReviewItem => ({
  id: `ri-${index}`, title: "Exampleton Library", eventSource: "location_learning", eventType: "unknown_stay", categoryName: null,
  placeName: null, suggestedCategoryId: null, suggestedPlaceId: null, suggestedStartedAt: iso(0), suggestedStoppedAt: iso(60),
  confidence: "medium", status: "open", notes: null, rawPayload: { clientSegmentId: segmentOf(index) }, createdAt: iso(70)
}) as MobileReviewItem;
const placeOf = (index: number): TimelinePlace => ({
  kind: "place", id: segmentOf(index), status: "finalised", startedAt: iso(0), stoppedAt: iso(60), placeId: null, learnedPlaceId: null,
  name: null, role: null, matchKind: "unknown", confidence: "low", blockIds: []
});
// One data and one timeline object per account, as a Dashboard keeps them between renders.
const DATA = [0, 1].map((index) => ({
  user: { id: owners[index].userId }, workspace: { id: owners[index].workspaceId }, reviewItems: [itemOf(index)],
  categories: [{ id: CATEGORY, name: "Errands", color: "teal", isPinned: true }], places: []
}) as unknown as MobileBootstrap);
const TIMELINES = [0, 1].map((index) => ({ items: [placeOf(index)] }) as unknown as LocationTimeline);
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

type Hooks = {
  answers: ReturnType<typeof useCalendarCheckAnswers>;
  places: ReturnType<typeof useLocationCorrections>;
  release: ReturnType<typeof useAnswersAfterCorrections>;
};
const hooks: { current: Hooks | null } = { current: null };
function Harness({ index }: { index: number }) {
  const data = DATA[index];
  const answersHook = useCalendarCheckAnswers({ data, locallyDecidedIds: NONE, ownerKey: `owner-${index}`, syncStateIds: NONE });
  const places = useLocationCorrections({ acknowledged: [], clockFormat: "24h", data, pending: [], reduceMotion: false,
    showNotice: () => undefined, theme: {} as never, timeline: TIMELINES[index] });
  // The Dashboard's release: real outcomes (into the Review outbox, or log_place into the correction queue).
  const release = useAnswersAfterCorrections({ data, owner: owners[index], onDropped: answersHook.restoreAnswered });
  hooks.current = { answers: answersHook, places, release };
  return places.sheet;
}
const flush = async () => {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
};
const loggedOf = (action: string) => action === "confirm" || action === "accept" || action === "edit_and_confirm" || action === "record_poi_once";

describe("randomised interleavings of waiting answers and Logs as, over the real store (Codex r15 and r16 on #610)", () => {
  it("keeps every open \"?\" visible unless something live covers it, and delivers only answers taken and not undone", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-10-27T12:00:00.000Z"));
    let seenHeld = 0;
    let seenDelivered = 0;
    const kinds = new Map<string, number>();
    try {
      for (let run = 0; run < 200; run += 1) {
        const random = rng(616_000 + run);
        env.storage.clear();
        env.appState = "active";
        env.listeners.clear();
        env.delivered = [];
        env.random = rng(916_000 + run);
        env.faults = false;
        account.__resetMobileAccountForTests();
        outbox.__resetTimelineCorrectionOutboxForTests();
        answers.__resetAnswersAfterCorrectionsForTests();
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(env.reply === 200 ? { ok: true } : { error: "No." }), { status: env.reply })));
        let current = 0;
        await account.activateMobileAccount(owners[current]);
        // Each account has a correction for its place saved offline: its answers and Logs as wait for it.
        for (const [index, owner] of owners.entries()) {
          await outbox.enqueueTimelineCorrections(owner, [{ request: { kind: "times", subject: "place", itemId: segmentOf(index),
            startedAt: iso(0), stoppedAt: iso(60), clientCorrectionId: `6f000000-0000-4000-8000-00000000000${index + 1}` } }]);
        }
        // A foreign backend's record for account A's "?", which nothing here may touch or deliver.
        const foreign = { userId: owners[0].userId, workspaceId: owners[0].workspaceId, id: "6f000000-0000-4000-8000-0000000000ff",
          reviewItemId: "ri-0", logged: true, waitsFor: ["6f000000-0000-4000-8000-000000000001"], acknowledged: ["6f000000-0000-4000-8000-000000000001"],
          backendId: "https://elsewhere.example", createdAt: iso(0) };
        env.storage.set(WAITING_KEY, JSON.stringify([foreign]));
        env.faults = true;
        // Answers and Logs as taken, and those undone, by account and kind.
        const taken = new Map<string, number>();
        const undone = new Map<string, number>();
        const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
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
            const logged = random() < 0.5;
            let took = false;
            act(() => { took = hooks.current!.answers.answer(`ri-${current}`, logged); });
            if (took) bump(taken, `ri-${current}|${logged}`);
          } else if ((roll === 1 || roll === 9) && live) {
            trace.push(roll === 1 ? "logAs" : "logAs+unmount");
            act(() => { hooks.current!.places.openPlace(placeOf(current), "Unknown place"); });
            const sheet = tree!.root.findAll((node) => (node.type as unknown) === "LocationCorrectionSheet")[0];
            const logAs = sheet?.props.logAs as { onLog: (id: string) => void } | undefined;
            if (logAs) {
              bump(taken, `log|seg-${current}`);
              if (roll === 1) act(() => { logAs.onLog(CATEGORY); });
              else {
                // Its hold starts and its screen goes away in one batch, before any re-render.
                await act(async () => {
                  logAs.onLog(CATEGORY);
                  await flush();
                  tree?.unmount();
                  tree = null;
                });
              }
            }
          } else if (roll === 2 && live) {
            trace.push("undo");
            const held = hooks.current!.answers.held;
            const heldLog = hooks.current!.places.heldLog;
            act(() => {
              hooks.current!.answers.undo();
              hooks.current!.places.undoLog();
            });
            if (held) bump(undone, `${held.itemId}|${held.logged}`);
            if (heldLog) bump(undone, `log|${heldLog.request.itemId}`);
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
            await act(async () => { await outbox.synchroniseTimelineCorrections({ owner: owners[current], force: true }); await flush(); });
          } else {
            trace.push("flush");
          }
          await act(async () => { await flush(); });
          const now = JSON.parse(env.storage.get(WAITING_KEY) ?? "[]") as Array<{ held?: unknown; backendId?: string }>;
          if (now.some((record) => record.held && record.backendId !== "https://elsewhere.example")) seenHeld += 1;
          kinds.set(trace[trace.length - 1], (kinds.get(trace[trace.length - 1]) ?? 0) + 1);
        }
        const context = `run ${run}: ${trace.join(", ")}`;
        // Settle: no more faults; every Undo ends; each account's Dashboard comes back in front, so its recovery and
        // release run, and its List is read while it is there.
        env.faults = false;
        if (tree) await unmount();
        env.appState = "active";
        await act(async () => { vi.advanceTimersByTime(10_000); await flush(); });
        for (const [index, owner] of owners.entries()) {
          current = index;
          await account.activateMobileAccount(owner);
          await mount();
          await act(async () => { await flush(); vi.advanceTimersByTime(10_000); await flush(); await flush(); });
          const pending = await outbox.readPendingTimelineCorrections(owner);
          const refused = new Set(pending.filter((item) => item.failureKind === "permanent").map((item) => item.clientCorrectionId));
          const records = await answers.readAnswersAfterCorrectionsWithState(owner);
          for (const item of [itemOf(index)]) {
            const visible = !hooks.current!.answers.hiddenIds.has(item.id) && !hooks.current!.release.waitingIds.has(item.id);
            if (visible) continue;
            // Hidden: only by a live hold, a delivered answer, or a pending record waiting on corrections none refused.
            const liveHold = hooks.current!.answers.held?.itemId === item.id;
            const delivered = env.delivered.some((each) => each.itemId === item.id);
            const covering = records.filter(({ record, state }) => state !== "abandoned" && answers.answeredReviewItemIds(record).includes(item.id));
            const pendingCover = covering.some(({ record, state }) => state === "committed"
              && !record.waitsFor.some((id) => !record.acknowledged.includes(id) && refused.has(id)));
            expect(liveHold || delivered || pendingCover, `${context}: ${item.id} hidden with nothing live covering it`).toBe(true);
          }
          await unmount();
          await act(async () => { await flush(); });
        }
        const stored = JSON.parse(env.storage.get(WAITING_KEY) ?? "[]") as Array<{ id: string; held?: unknown; backendId?: string }>;
        // No record of this backend is held without a live hold (every screen is gone now).
        expect(stored.filter((record) => record.backendId !== "https://elsewhere.example" && record.held), context).toEqual([]);
        // The foreign record was never touched, and nothing was delivered from it.
        expect(stored.find((record) => record.id === foreign.id), context).toEqual(foreign);
        expect(env.delivered.some((each) => each.id === foreign.id), context).toBe(false);
        // Every delivered answer matches one taken and not undone (per "?" and answer), never more often.
        const deliveredCount = new Map<string, number>();
        for (const each of env.delivered) bump(deliveredCount, `${each.itemId}|${loggedOf(each.action)}`);
        for (const [key, count] of deliveredCount) {
          expect(count, `${context}: delivered ${key}`).toBeLessThanOrEqual((taken.get(key) ?? 0) - (undone.get(key) ?? 0));
        }
        // And every Logs as queued as log_place matches one taken and not undone.
        for (const [index, owner] of owners.entries()) {
          const logs = (await outbox.readPendingTimelineCorrections(owner)).filter((item) => item.request.kind === "log_place").length
            + outbox.readAcknowledgedTimelineCorrections(owner).filter((item) => item.request.kind === "log_place").length;
          const key = `log|seg-${index}`;
          expect(logs, `${context}: log_place for ${key}`).toBeLessThanOrEqual((taken.get(key) ?? 0) - (undone.get(key) ?? 0));
        }
        seenDelivered += env.delivered.length;
        vi.unstubAllGlobals();
      }
      // The runs did exercise holds, deliveries and every kind of step.
      expect(seenHeld).toBeGreaterThan(50);
      expect(seenDelivered).toBeGreaterThan(10);
      // Storage writes did fail and land late.
      expect(env.failed).toBeGreaterThan(20);
      expect(env.deferred).toBeGreaterThan(50);
      for (const kind of ["answer", "logAs", "logAs+unmount", "undo", "time", "unmount", "mount", "background", "active", "switch", "ack", "refuse"]) {
        expect(kinds.get(kind) ?? 0, kind).toBeGreaterThan(10);
      }
    } finally {
      env.faults = false;
      vi.useRealTimers();
    }
  }, 240_000);
});
