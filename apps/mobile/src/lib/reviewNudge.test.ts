import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const native = vi.hoisted(() => ({
  permission: "granted" as "granted" | "denied" | "undetermined",
  scheduled: [] as { fireAt: Date; body: string; accountKey: string }[],
  cancelled: 0
}));
const account = vi.hoisted(() => ({ active: { userId: "user-a", workspaceId: "ws-1" } as { userId: string; workspaceId: string } | null }));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    })
  }
}));
vi.mock("./mobileAccount", () => ({
  mobileAccountKey: (owner: { userId: string; workspaceId: string }) => `${owner.userId}:${owner.workspaceId}`,
  mobileAccountOwnersEqual: (left: { userId: string; workspaceId: string } | null, right: { userId: string; workspaceId: string } | null) =>
    Boolean(left && right && left.userId === right.userId && left.workspaceId === right.workspaceId),
  readActiveMobileAccount: () => Promise.resolve(account.active)
}));
vi.mock("./reviewNudgeNative", () => ({
  readReviewNudgePermission: () => Promise.resolve(native.permission),
  scheduleReviewNudge: (fireAt: Date, body: string, accountKey: string) => {
    native.scheduled.push({ fireAt, body, accountKey });
    return Promise.resolve();
  },
  cancelReviewNudge: () => {
    native.cancelled += 1;
    return Promise.resolve();
  }
}));

const nudge = await import("./reviewNudge");
const { DEFAULT_REVIEW_NUDGE_STATE, planReviewNudge, reviewNudgeBody, clampReviewNudgeMinutes, formatReviewNudgeTime } = nudge;

const owner = { userId: "user-a", workspaceId: "ws-1" };
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);
const on = (patch: Partial<typeof DEFAULT_REVIEW_NUDGE_STATE> = {}) => ({
  ...DEFAULT_REVIEW_NUDGE_STATE,
  enabled: true,
  knownCount: 3,
  knownAt: at(2026, 10, 9, 12).toISOString(),
  ...patch
});

describe("planReviewNudge", () => {
  it("fires at the chosen time today when suggestions are waiting", () => {
    const plan = planReviewNudge(on(), at(2026, 10, 9, 15));
    expect(plan?.fireAt).toEqual(at(2026, 10, 9, 20));
    expect(plan?.body).toBe("3 suggestions are ready to review.");
  });

  it("moves to tomorrow once today's time has passed", () => {
    expect(planReviewNudge(on(), at(2026, 10, 9, 20, 1))?.fireAt).toEqual(at(2026, 10, 10, 20));
  });

  it("never fires twice in a day, even after the time is moved later", () => {
    const plan = planReviewNudge(on({ minutes: 22 * 60, lastFireAt: at(2026, 10, 9, 20).toISOString() }), at(2026, 10, 9, 21));
    expect(plan?.fireAt).toEqual(at(2026, 10, 10, 22));
  });

  it("can still fire today when today's reminder was only scheduled, not yet shown", () => {
    const plan = planReviewNudge(on({ lastFireAt: at(2026, 10, 9, 20).toISOString() }), at(2026, 10, 9, 19));
    expect(plan?.fireAt).toEqual(at(2026, 10, 9, 20));
  });

  it("stays quiet when off, when nothing is waiting, or when the count is unknown", () => {
    const now = at(2026, 10, 9, 15);
    expect(planReviewNudge(on({ enabled: false }), now)).toBeNull();
    expect(planReviewNudge(on({ knownCount: 0 }), now)).toBeNull();
    expect(planReviewNudge(on({ knownCount: null, knownAt: null }), now)).toBeNull();
  });

  it("stops nagging when the count is days old", () => {
    expect(planReviewNudge(on({ knownAt: at(2026, 10, 5, 12).toISOString() }), at(2026, 10, 9, 15))).toBeNull();
  });

  it("keeps the wall-clock time across a clock change", () => {
    // 25 October 2026 is the UK change back to GMT; the reminder stays at 8:00 pm local.
    const plan = planReviewNudge(on({ knownAt: at(2026, 10, 24, 21).toISOString() }), at(2026, 10, 24, 21));
    expect(plan?.fireAt.getHours()).toBe(20);
    expect(plan?.fireAt.getDate()).toBe(25);
  });

  it("words one and many, and never mentions places", () => {
    expect(reviewNudgeBody(1)).toBe("1 suggestion is ready to review.");
    expect(reviewNudgeBody(4)).toBe("4 suggestions are ready to review.");
  });

  it("keeps the time inside the evening range in half hours", () => {
    expect(clampReviewNudgeMinutes(12 * 60)).toBe(17 * 60);
    expect(clampReviewNudgeMinutes(24 * 60)).toBe(23 * 60 + 30);
    expect(clampReviewNudgeMinutes(20 * 60 + 10)).toBe(20 * 60);
    expect(formatReviewNudgeTime(20 * 60)).toBe("8:00 pm");
    expect(formatReviewNudgeTime(17 * 60 + 30)).toBe("5:30 pm");
  });
});

describe("review nudge store", () => {
  beforeEach(() => {
    store.clear();
    native.permission = "granted";
    native.scheduled = [];
    native.cancelled = 0;
    account.active = owner;
  });

  it("schedules one reminder from a known count once it is switched on", async () => {
    await nudge.noteReviewCount(owner, 2, at(2026, 10, 9, 15));
    expect(native.scheduled).toHaveLength(0);
    await nudge.setReviewNudgeEnabled(owner, true);
    expect(native.scheduled.at(-1)).toMatchObject({ body: "2 suggestions are ready to review.", accountKey: "user-a:ws-1" });
  });

  it("cancels when Review is cleared", async () => {
    await nudge.setReviewNudgeEnabled(owner, true);
    await nudge.noteReviewCount(owner, 3, at(2026, 10, 9, 15));
    const cancelledBefore = native.cancelled;
    await nudge.noteReviewCount(owner, 0, at(2026, 10, 9, 16));
    expect(native.cancelled).toBe(cancelledBefore + 1);
    expect((await nudge.readReviewNudgeState(owner)).lastFireAt).toBeNull();
  });

  it("schedules nothing without notification permission", async () => {
    native.permission = "denied";
    await nudge.setReviewNudgeEnabled(owner, true);
    await nudge.noteReviewCount(owner, 3, at(2026, 10, 9, 15));
    expect(native.scheduled).toHaveLength(0);
  });

  it("never schedules for an account that is no longer signed in, but keeps its choice", async () => {
    account.active = { userId: "user-b", workspaceId: "ws-2" };
    await nudge.setReviewNudgeEnabled(owner, true);
    await nudge.noteReviewCount(owner, 3, at(2026, 10, 9, 15));
    expect(native.scheduled).toHaveLength(0);
    expect((await nudge.readReviewNudgeState(owner)).enabled).toBe(true);
  });

  it("keeps a fired day quiet after a later count and a later time (Codex r1 repro)", async () => {
    await nudge.setReviewNudgeEnabled(owner, true, at(2026, 10, 9, 15));
    await nudge.noteReviewCount(owner, 3, at(2026, 10, 9, 15));
    expect(native.scheduled.at(-1)?.fireAt).toEqual(at(2026, 10, 9, 20));
    // 20:00 passes (the reminder fires); a count at 21:00 schedules tomorrow.
    await nudge.noteReviewCount(owner, 3, at(2026, 10, 9, 21));
    expect(native.scheduled.at(-1)?.fireAt).toEqual(at(2026, 10, 10, 20));
    // Moving the time later the same evening must not add a second reminder today.
    await nudge.setReviewNudgeMinutes(owner, 21 * 60 + 30, at(2026, 10, 9, 21, 5));
    expect(native.scheduled.at(-1)?.fireAt).toEqual(at(2026, 10, 10, 21, 30));
    expect((await nudge.readReviewNudgeState(owner)).firedOn).toBe("2026-10-09");
  });

  it("does not count a reminder cancelled before its time as fired", async () => {
    await nudge.setReviewNudgeEnabled(owner, true, at(2026, 10, 9, 15));
    await nudge.noteReviewCount(owner, 3, at(2026, 10, 9, 15));
    await nudge.noteReviewCount(owner, 0, at(2026, 10, 9, 19));
    await nudge.noteReviewCount(owner, 2, at(2026, 10, 9, 19, 30));
    expect(native.scheduled.at(-1)?.fireAt).toEqual(at(2026, 10, 9, 20));
    expect((await nudge.readReviewNudgeState(owner)).firedOn).toBeNull();
  });

  it("clears the leaving account's pending time at sign-out but keeps a day that already fired", async () => {
    await nudge.setReviewNudgeEnabled(owner, true, at(2026, 10, 9, 15));
    await nudge.noteReviewCount(owner, 3, at(2026, 10, 9, 15));
    await nudge.cancelReviewNudgeForLogout(at(2026, 10, 9, 19));
    let state = await nudge.readReviewNudgeState(owner);
    expect(state.lastFireAt).toBeNull();
    expect(state.firedOn).toBeNull();
    // Back at 21:00 and choosing 22:00: today never had a reminder, so it can still come today.
    await nudge.setReviewNudgeMinutes(owner, 22 * 60, at(2026, 10, 9, 21));
    expect(native.scheduled.at(-1)?.fireAt).toEqual(at(2026, 10, 9, 22));
    // A reminder that already fired keeps its day through a sign-out.
    await nudge.cancelReviewNudgeForLogout(at(2026, 10, 9, 22, 30));
    state = await nudge.readReviewNudgeState(owner);
    expect(state.firedOn).toBe("2026-10-09");
  });

  it("ignores counts that aren't whole numbers", async () => {
    await nudge.setReviewNudgeEnabled(owner, true);
    await nudge.noteReviewCount(owner, "3" as unknown as number);
    await nudge.noteReviewCount(owner, -1);
    expect((await nudge.readReviewNudgeState(owner)).knownCount).toBeNull();
  });

  it("applies changes in order, so a later time change wins", async () => {
    await nudge.setReviewNudgeEnabled(owner, true);
    await Promise.all([
      nudge.noteReviewCount(owner, 2, at(2026, 10, 9, 15)),
      nudge.setReviewNudgeMinutes(owner, 21 * 60)
    ]);
    expect((await nudge.readReviewNudgeState(owner)).minutes).toBe(21 * 60);
    expect(native.scheduled.at(-1)?.fireAt.getHours()).toBe(21);
  });
});
