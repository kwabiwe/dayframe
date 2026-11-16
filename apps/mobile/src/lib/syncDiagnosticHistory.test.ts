import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  read: vi.fn<(key: string) => Promise<string | null>>(),
  write: vi.fn<(key: string, value: string) => Promise<void>>(),
  owner: { userId: "synthetic-user", workspaceId: "synthetic-workspace" },
  epoch: 0,
  generation: 0,
  signedIn: true
}));

vi.mock("expo-sqlite/kv-store", () => ({ SQLiteStorage: class {
  getItemAsync = fixture.read;
  setItemAsync = fixture.write;
} }));
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  digestStringAsync: async (_: string, value: string) => createHash("sha256").update(value).digest("hex")
}));
vi.mock("./mobileAccount", () => ({
  currentMobileAccountEpoch: () => fixture.epoch,
  getActiveMobileAccountSnapshot: () => fixture.owner,
  mobileAccountOwnersEqual: (a: typeof fixture.owner | undefined, b: typeof fixture.owner | undefined) =>
    a?.userId === b?.userId && a?.workspaceId === b?.workspaceId
}));
vi.mock("./secure-session", () => ({
  currentSessionGeneration: () => fixture.generation,
  peekAuthenticatedSessionOwner: () => fixture.signedIn ? fixture.owner : null,
  readOwnedAuthenticatedSessionSnapshot: async () => fixture.signedIn
    ? { status: "authenticated", snapshot: { generation: fixture.generation, token: "bearer-secret" } }
    : { status: "signed_out" },
  isAuthenticatedSessionSnapshotCurrent: (value: { generation: number }) => value.generation === fixture.generation
}));

const key = "dayframe.syncDiagnosticHistory.v1";
const ownerA = { ...fixture.owner };
let history: typeof import("./syncDiagnosticHistory");
beforeEach(async () => {
  vi.resetModules();
  fixture.owner = ownerA;
  fixture.epoch += 1;
  fixture.generation += 1;
  fixture.signedIn = true;
  fixture.storage.clear();
  fixture.read.mockReset().mockImplementation(async (key) => fixture.storage.get(key) ?? null);
  fixture.write.mockReset().mockImplementation(async (key, value) => { fixture.storage.set(key, value); });
  history = await import("./syncDiagnosticHistory");
});

function shareFixture() {
  const share = vi.fn(async (_content: { title: string; message: string }) => {});
  return {
    share,
    export: () => history.exportSyncDiagnosticHistory(history.captureSyncDiagnosticScope(), share, () => true),
    json: () => JSON.parse(share.mock.calls.at(-1)![0].message)
  };
}

describe("local sync diagnostic history", () => {
  it("persists only allowlisted fields and exports linked records without raw or partition IDs", async () => {
    const scope = history.captureSyncDiagnosticScope();
    const extras = {
      email: "person@example.invalid", token: "bearer-secret", description: "private meeting",
      latitude: 51.5007, longitude: -0.1246, health: { duration: 82345 }, response: { email: "raw-response" }
    };
    const internalId = "opaque-queue-id";
    history.recordSyncDiagnostic(scope, { ...extras, lane: "timer_stop", event: "queued", pending: 1 }, internalId);
    history.recordSyncDiagnostic(scope, { lane: "timer_stop", event: "attempted", attempt: 1 }, internalId);
    history.recordSyncDiagnostic(scope, { lane: "timer_stop", event: "retry_pending", attempt: 1, status: 503 }, internalId);
    const share = shareFixture();
    expect(await share.export()).toBe(true);
    const raw = fixture.storage.get(key)!;
    const rows = share.json().records;
    expect(rows.map((row: { event: string }) => row.event)).toEqual(["queued", "attempted", "retry_pending"]);
    expect(rows[2]).toEqual({ lane: "timer_stop", event: "retry_pending", attempt: 1, status: 503,
      work: rows[0].work, at: expect.any(String) });
    expect(rows[0].work).toMatch(/^[a-f0-9]{24}$/);
    for (const secret of [...Object.keys(extras), "person@example.invalid", "bearer-secret", "private meeting",
      "51.5007", "-0.1246", "82345", ownerA.userId, ownerA.workspaceId, internalId]) {
      expect(raw + share.share.mock.calls[0][0].message).not.toContain(secret);
    }
    expect(share.share.mock.calls[0][0].message).not.toContain(JSON.parse(raw).partition);
    // The read boundary rejects non-allowlisted enum values and strips extras even from a stored row.
    const stored = JSON.parse(raw);
    stored.records[0].rawPayload = extras;
    stored.records.push({ ...stored.records[0], lane: "health_workout" });
    fixture.storage.set(key, JSON.stringify(stored));
    await share.export();
    expect(share.json().records).toEqual(rows);
  });

  it("bounds bursts, batches writes, and ages entries out after a restart", async () => {
    const scope = history.captureSyncDiagnosticScope();
    for (let i = 0; i < 250; i += 1) {
      history.recordSyncDiagnostic(scope, { lane: "recovery", event: "retry_scheduled", attempt: i + 1 });
    }
    const share = shareFixture();
    await share.export();
    expect(fixture.write).toHaveBeenCalledOnce();
    expect(share.json().records).toHaveLength(200);
    expect(share.json().records[0].attempt).toBe(51);
    expect(share.json().records.at(-1).attempt).toBe(250);
    vi.resetModules();
    history = await import("./syncDiagnosticHistory");
    await share.export();
    expect(share.json().records).toHaveLength(200);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 8 * 24 * 60 * 60 * 1000);
    try {
      await share.export();
      expect(share.json().records).toEqual([]);
      history.recordSyncDiagnostic(history.captureSyncDiagnosticScope(), { lane: "connectivity", event: "online" });
      await share.export();
      expect(JSON.parse(fixture.storage.get(key)!).records).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("isolates workspaces and rejects stale export and late work across A → B → A or sign-out", async () => {
    const oldScope = history.captureSyncDiagnosticScope();
    history.recordSyncDiagnostic(oldScope, { lane: "timer_stop", event: "queued" }, "stop-a");
    const share = shareFixture();
    await share.export();
    const aRef = share.json().records[0].work;
    fixture.owner = { ...ownerA, workspaceId: "different-workspace" };
    fixture.epoch += 1;
    expect(await share.export()).toBe(true);
    expect(share.json().records).toEqual([]);
    history.recordSyncDiagnostic(history.captureSyncDiagnosticScope(), { lane: "timer_stop", event: "queued" }, "stop-a");
    await share.export();
    expect(share.json().records[0].work).not.toBe(aRef);
    const bScope = history.captureSyncDiagnosticScope();
    const lastShare = share.share.mock.calls.length;
    fixture.read.mockImplementationOnce(async (key) => {
      fixture.owner = ownerA;
      fixture.epoch += 1;
      return fixture.storage.get(key) ?? null;
    });
    const staleExport = share.export();
    expect(await staleExport).toBe(false);
    history.recordSyncDiagnostic(oldScope, { lane: "timer_stop", event: "delivered" }, "stop-a");
    history.recordSyncDiagnostic(bScope, { lane: "timer_stop", event: "delivered" }, "stop-a");
    expect(share.share).toHaveBeenCalledTimes(lastShare);
    await share.export();
    expect(share.json().records).toEqual([]);
    fixture.signedIn = false;
    fixture.generation += 1;
    share.share.mockClear();
    expect(await share.export()).toBe(false);
    expect(share.share).not.toHaveBeenCalled();
  });

  it("serializes an accepted old-account write ahead of the new account's history", async () => {
    const oldScope = history.captureSyncDiagnosticScope();
    let release!: () => void;
    fixture.write.mockImplementationOnce(async (key, value) => {
      await new Promise<void>((resolve) => { release = resolve; });
      fixture.storage.set(key, value);
    });
    history.recordSyncDiagnostic(oldScope, { lane: "timer_stop", event: "authentication_required", status: 401 }, "old-stop");
    await vi.waitFor(() => expect(fixture.write).toHaveBeenCalledOnce());
    fixture.owner = { ...ownerA, userId: "replacement-synthetic-user" };
    fixture.epoch += 1;
    fixture.generation += 1;
    history.recordSyncDiagnostic(history.captureSyncDiagnosticScope(), { lane: "location_upload", event: "queued" }, "new-batch");
    history.recordSyncDiagnostic(oldScope, { lane: "timer_stop", event: "delivered" }, "old-stop");
    release();

    const share = shareFixture();
    await share.export();
    expect(share.json().records).toEqual([expect.objectContaining({ lane: "location_upload", event: "queued" })]);
    expect(fixture.write).toHaveBeenCalledTimes(2);
  });

  it("keeps a pending 401 when recovery follows same-account sign-in during a slow write", async () => {
    const expiredScope = history.captureSyncDiagnosticScope();
    let release!: () => void;
    fixture.write.mockImplementationOnce(async (key, value) => {
      await new Promise<void>((resolve) => { release = resolve; });
      fixture.storage.set(key, value);
    });
    history.recordSyncDiagnostic(expiredScope, { lane: "timer_stop", event: "attempted" }, "stop");
    await vi.waitFor(() => expect(fixture.write).toHaveBeenCalledOnce());
    history.recordSyncDiagnostic(expiredScope, { lane: "timer_stop", event: "authentication_required", status: 401 }, "stop");
    fixture.generation += 2;
    history.recordSyncDiagnostic(history.captureSyncDiagnosticScope(), { lane: "recovery", event: "attempted" });
    release();

    const share = shareFixture();
    await share.export();
    const rows = share.json().records;
    expect(rows).toEqual([
      expect.objectContaining({ lane: "timer_stop", event: "attempted" }),
      expect.objectContaining({ lane: "timer_stop", event: "authentication_required", status: 401, work: rows[0].work }),
      expect.objectContaining({ lane: "recovery", event: "attempted" })
    ]);
  });

  it("does not share after leaving Sync help while preparing and surfaces read failure", async () => {
    const share = shareFixture();
    const scope = history.captureSyncDiagnosticScope();
    let visible = true;
    fixture.read.mockImplementationOnce(async () => { visible = false; return null; });
    expect(await history.exportSyncDiagnosticHistory(scope, share.share, () => visible)).toBe(false);
    expect(share.share).not.toHaveBeenCalled();
    fixture.read.mockRejectedValueOnce(new Error("synthetic storage error"));
    await expect(share.export()).rejects.toThrow("synthetic storage error");
    expect(share.share).not.toHaveBeenCalled();
  });

  it("keeps one write in flight, bounds pending writes, and recovers from a failed write", async () => {
    let failWrite!: (error: Error) => void;
    fixture.write.mockImplementationOnce(() => new Promise((_resolve, reject) => { failWrite = reject; }));
    const scope = history.captureSyncDiagnosticScope();
    history.recordSyncDiagnostic(scope, { lane: "connectivity", event: "offline" });
    await vi.waitFor(() => expect(fixture.write).toHaveBeenCalledOnce());
    for (let attempt = 1; attempt <= 220; attempt += 1) {
      history.recordSyncDiagnostic(scope, { lane: "recovery", event: "retry_scheduled", attempt });
    }
    expect(fixture.write).toHaveBeenCalledOnce();
    failWrite(new Error("synthetic disk error"));
    const share = shareFixture();
    await share.export();
    const rows = share.json().records;
    expect(fixture.write).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(200);
    expect(rows[0].attempt).toBe(21);
  });
});
