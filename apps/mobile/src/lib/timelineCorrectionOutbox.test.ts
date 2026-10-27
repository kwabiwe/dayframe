import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, string>());

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    })
  }
}));

vi.mock("./secure-session", () => ({
  isAuthenticatedSessionSnapshotCurrent: vi.fn(() => true),
  readOwnedAuthenticatedSessionSnapshot: vi.fn(async (owner) => ({
    status: "authenticated",
    snapshot: { generation: 1, owner, token: "token-a" }
  }))
}));

const account = await import("./mobileAccount");
const network = await import("./mobile-network");
const outbox = await import("./timelineCorrectionOutbox");
const secureSession = await import("./secure-session");

// Location v4 step 12: synthetic item ids and times only.
const OWNER_A = { userId: "user-a", workspaceId: "workspace-a" };
const OWNER_B = { userId: "user-b", workspaceId: "workspace-b" };
const PLACE_ID = "6f000000-0000-4000-8000-000000000001";
let ids = 0;
const createId = () => `6f000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("the iPhone's timeline correction queue (location v4 step 12)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T12:00:00.000Z"));
    storage.clear();
    ids = 0;
    account.__resetMobileAccountForTests();
    outbox.__resetTimelineCorrectionOutboxForTests();
    await account.activateMobileAccount(OWNER_A);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps a correction with its own id and sends it, with that id, in order", async () => {
    await outbox.enqueueTimelineCorrection(OWNER_A, { kind: "place", subject: "place", itemId: "seg-a", placeId: PLACE_ID, learnedPlaceId: null }, { createId });
    await outbox.enqueueTimelineCorrection(OWNER_A, { kind: "delete", subject: "trip", itemId: "trip-b" }, { createId });
    const fetch = vi.fn(async () => json(200, { ok: true }));
    vi.stubGlobal("fetch", fetch);
    expect(await outbox.synchroniseTimelineCorrections({ owner: OWNER_A })).toMatchObject({ deliveredCount: 2, waitingCount: 0, reason: "drained" });
    const sent = fetch.mock.calls.map((call) => {
      const [url, init] = call as unknown as [string, RequestInit];
      return [url.replace(/^.*\/api/, "/api"), JSON.parse(init.body as string), (init.headers as Record<string, string>).Authorization];
    });
    expect(sent).toEqual([
      ["/api/timeline/corrections", { kind: "place", subject: "place", itemId: "seg-a", placeId: PLACE_ID, learnedPlaceId: null,
        clientCorrectionId: "6f000000-0000-4000-8000-000000000001" }, "Bearer token-a"],
      ["/api/timeline/corrections", { kind: "delete", subject: "trip", itemId: "trip-b", clientCorrectionId: "6f000000-0000-4000-8000-000000000002" }, "Bearer token-a"]
    ]);
    expect(await outbox.readPendingTimelineCorrections(OWNER_A)).toEqual([]);
  });

  it("keeps it on the phone and stops when offline or busy, then resends the same id; later ones wait their turn", async () => {
    await outbox.enqueueTimelineCorrection(OWNER_A, { kind: "delete", subject: "trip", itemId: "trip-b" }, { createId });
    await outbox.enqueueTimelineCorrection(OWNER_A, { kind: "delete", subject: "trip", itemId: "trip-c" }, { createId });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Network request failed"); }));
    expect(await outbox.synchroniseTimelineCorrections({ owner: OWNER_A })).toMatchObject({ deliveredCount: 0, waitingCount: 2, reason: "retryable_failure" });
    const [first] = await outbox.readPendingTimelineCorrections(OWNER_A);
    expect(first).toMatchObject({ attemptCount: 1, failureKind: "retryable" });
    // Not before its retry time, unless forced.
    const busy = vi.fn(async () => json(503, { error: "Dayframe is busy. Try again in a moment." }));
    vi.stubGlobal("fetch", busy);
    expect(await outbox.synchroniseTimelineCorrections({ owner: OWNER_A })).toMatchObject({ reason: "retry_wait" });
    expect(busy).not.toHaveBeenCalled();
    expect(await outbox.synchroniseTimelineCorrections({ owner: OWNER_A, force: true })).toMatchObject({ reason: "retryable_failure", waitingCount: 2 });
    const delivered = vi.fn(async () => json(200, { ok: true }));
    vi.stubGlobal("fetch", delivered);
    await outbox.synchroniseTimelineCorrections({ owner: OWNER_A, force: true });
    expect(delivered.mock.calls.map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string).clientCorrectionId))
      .toEqual(["6f000000-0000-4000-8000-000000000001", "6f000000-0000-4000-8000-000000000002"]);
  });

  it("keeps a refusal for the List to say why, moves on to the next, and drops it when told", async () => {
    await outbox.enqueueTimelineCorrection(OWNER_A, { kind: "delete", subject: "trip", itemId: "trip-in-block" }, { createId });
    await outbox.enqueueTimelineCorrection(OWNER_A, { kind: "delete", subject: "trip", itemId: "trip-c" }, { createId });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => JSON.parse(init.body as string).itemId === "trip-in-block"
      ? json(409, { error: "This trip is already in a block. Edit the block instead." })
      : json(200, { ok: true })));
    const result = await outbox.synchroniseTimelineCorrections({ owner: OWNER_A });
    expect(result).toMatchObject({ deliveredCount: 1, waitingCount: 0, reason: "drained" });
    expect(result.refused).toEqual([expect.objectContaining({
      failureKind: "permanent", lastStatusCode: 409, lastError: "This trip is already in a block. Edit the block instead."
    })]);
    expect(await outbox.getTimelineCorrectionDiagnostics(OWNER_A)).toMatchObject({ pendingCount: 0, refusedCount: 1 });
    await outbox.removeTimelineCorrections(result.refused.map((item) => item.clientCorrectionId));
    expect(await outbox.readPendingTimelineCorrections(OWNER_A)).toEqual([]);
  });

  it("sends only the signed-in account's corrections, stops when signed out, and clears an account's on logout", async () => {
    await outbox.enqueueTimelineCorrection(OWNER_A, { kind: "delete", subject: "trip", itemId: "trip-a" }, { createId });
    await outbox.enqueueTimelineCorrection(OWNER_B, { kind: "delete", subject: "trip", itemId: "trip-b" }, { createId });
    vi.mocked(secureSession.readOwnedAuthenticatedSessionSnapshot).mockResolvedValueOnce({ status: "signed_out" } as never);
    const fetch = vi.fn(async () => json(200, { ok: true }));
    vi.stubGlobal("fetch", fetch);
    expect(await outbox.synchroniseTimelineCorrections({ owner: OWNER_A })).toMatchObject({ reason: "authentication_required", waitingCount: 1 });
    expect(await outbox.synchroniseTimelineCorrections({ owner: OWNER_B })).toMatchObject({ reason: "session_changed", deliveredCount: 0 });
    expect(fetch).not.toHaveBeenCalled();
    await outbox.clearTimelineCorrectionsForOwner(OWNER_A);
    expect(await outbox.readPendingTimelineCorrections(OWNER_A)).toEqual([]);
    expect(await outbox.readPendingTimelineCorrections(OWNER_B)).toHaveLength(1);
  });

  it("never stores a request the server would refuse as malformed, and keeps records it can't read exactly as they were (Codex r1 on #598)", async () => {
    await expect(outbox.enqueueTimelineCorrection(OWNER_A, { kind: "delete", subject: "trip", itemId: "" } as never, { createId })).rejects.toThrow();
    // Another version's correction for another account: not read here, never dropped by this one's writes.
    const theirs = { userId: "user-b", workspaceId: "workspace-b", clientCorrectionId: "x", request: { kind: "leg_split", subject: "leg" } };
    storage.set("dayframe.timelineCorrectionOutbox.v1", JSON.stringify([theirs]));
    expect(await outbox.readPendingTimelineCorrections(OWNER_A)).toEqual([]);
    await outbox.enqueueTimelineCorrection(OWNER_A, { kind: "delete", subject: "trip", itemId: "trip-a" }, { createId });
    await outbox.clearTimelineCorrectionsForOwner(OWNER_A);
    expect(JSON.parse(storage.get("dayframe.timelineCorrectionOutbox.v1")!)).toEqual([theirs]);
    // A queue that can't be read at all is set aside as it is, and the queue starts again.
    storage.set("dayframe.timelineCorrectionOutbox.v1", "{not json");
    expect(await outbox.readPendingTimelineCorrections(OWNER_A)).toEqual([]);
    expect([...storage.entries()].filter(([key]) => key.startsWith("dayframe.timelineCorrectionOutbox.v1.unreadable."))
      .map(([, value]) => value)).toEqual(["{not json"]);
    expect(storage.has("dayframe.timelineCorrectionOutbox.v1")).toBe(false);
  });

  it("leaves a correction untouched when its answer belongs to a session that has changed (Codex r1 on #598)", async () => {
    await outbox.enqueueTimelineCorrection(OWNER_A, { kind: "delete", subject: "trip", itemId: "trip-a" }, { createId });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new network.StaleMobileSessionResponseError(); }));
    expect(await outbox.synchroniseTimelineCorrections({ owner: OWNER_A })).toMatchObject({ reason: "session_changed", refused: [] });
    expect(await outbox.readPendingTimelineCorrections(OWNER_A)).toEqual([expect.objectContaining({ attemptCount: 0 })]);
    expect((await outbox.readPendingTimelineCorrections(OWNER_A))[0]).not.toHaveProperty("failureKind");
  });

  it("sends nothing more once the app has left the foreground (Codex r1 on #598)", async () => {
    await outbox.enqueueTimelineCorrection(OWNER_A, { kind: "delete", subject: "trip", itemId: "trip-a" }, { createId });
    await outbox.enqueueTimelineCorrection(OWNER_A, { kind: "delete", subject: "trip", itemId: "trip-b" }, { createId });
    let foreground = true;
    const fetch = vi.fn(async () => { foreground = false; return json(200, { ok: true }); });
    vi.stubGlobal("fetch", fetch);
    expect(await outbox.synchroniseTimelineCorrections({ owner: OWNER_A, isForeground: () => foreground }))
      .toMatchObject({ reason: "background", deliveredCount: 1, waitingCount: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a delivered correction a while for the List, and says so once per pass (Codex r1 on #598)", async () => {
    await outbox.enqueueTimelineCorrection(OWNER_A, { kind: "delete", subject: "trip", itemId: "trip-a" }, { createId });
    await outbox.enqueueTimelineCorrection(OWNER_A, { kind: "delete", subject: "trip", itemId: "trip-b" }, { createId });
    const listener = vi.fn();
    outbox.subscribeTimelineCorrectionOutbox(listener);
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { ok: true })));
    await outbox.synchroniseTimelineCorrections({ owner: OWNER_A });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(outbox.readAcknowledgedTimelineCorrections(OWNER_A).map((item) => item.request.itemId)).toEqual(["trip-a", "trip-b"]);
    expect(outbox.readAcknowledgedTimelineCorrections(OWNER_B)).toEqual([]);
    expect(outbox.readAcknowledgedTimelineCorrections(OWNER_A, Date.now() + 6 * 60_000)).toEqual([]);
  });

  it("is due when the first correction waiting is, since they go in order (Codex r1 on #598)", async () => {
    await outbox.enqueueTimelineCorrection(OWNER_A, { kind: "delete", subject: "trip", itemId: "trip-a" }, { createId });
    vi.stubGlobal("fetch", vi.fn(async () => json(503, { error: "busy" })));
    await outbox.synchroniseTimelineCorrections({ owner: OWNER_A });
    await outbox.enqueueTimelineCorrection(OWNER_A, { kind: "delete", subject: "trip", itemId: "trip-b" }, { createId });
    const [head] = await outbox.readPendingTimelineCorrections(OWNER_A);
    expect(await outbox.getTimelineCorrectionDiagnostics(OWNER_A)).toMatchObject({ pendingCount: 2, nextRetryAt: head.nextAttemptAt });
  });
});
