import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type {
  HealthCaptureOwner,
  HealthEpisodeDraft,
  HealthJournalSample,
} from "./healthSyncStore";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  failHandoff: false,
  failUpgrade: false,
  recorded: null as null | Array<{ sql: string; args: unknown[] }>,
}));
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: mocks.open }));
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  digestStringAsync: async (_algorithm: string, value: string) =>
    createHash("sha256").update(value).digest("hex"),
}));
let db: DatabaseSync;
let store: typeof import("./healthSyncStore");
const owner: HealthCaptureOwner = {
  backendId: "staging-fixture",
  workspaceId: "workspace",
  userId: "user",
};
function adapter() {
  const value = {
    execAsync: async (sql: string) => {
      if (mocks.failUpgrade && sql === "PRAGMA user_version=2")
        throw new Error("upgrade interrupted");
      db.exec(sql);
    },
    getFirstAsync: async (sql: string, ...args: never[]) =>
      db.prepare(sql).get(...args) ?? null,
    getAllAsync: async (sql: string, ...args: never[]) =>
      db.prepare(sql).all(...args),
    runAsync: async (sql: string, ...args: never[]) => {
      mocks.recorded?.push({ sql, args });
      if (mocks.failHandoff && sql.includes("handed_off_at=?"))
        throw new Error("crash after durable enqueue");
      return db.prepare(sql).run(...args);
    },
    withExclusiveTransactionAsync: async (
      work: (transaction: unknown) => Promise<void>,
    ) => {
      db.exec("begin immediate");
      try {
        await work(value);
        db.exec("commit");
      } catch (error) {
        db.exec("rollback");
        throw error;
      }
    },
  };
  return value;
}
beforeEach(async () => {
  vi.resetModules();
  mocks.failHandoff = false;
  mocks.failUpgrade = false;
  mocks.recorded = null;
  db = new DatabaseSync(":memory:");
  mocks.open.mockResolvedValue(adapter());
  store = await import("./healthSyncStore");
  await store.getHealthCheckpoint(owner, "sleep");
});
afterEach(() => db.close());
const count = (table: string) =>
  Number(db.prepare(`select count(*) as n from ${table}`).get()!.n);
const sample = (id: string, offset = 0): HealthJournalSample => ({
  id,
  sourceKey: "watch.fixture",
  startedAt: new Date(Date.now() - 5 * 3_600_000 + offset).toISOString(),
  stoppedAt: new Date(Date.now() - 4 * 3_600_000 + offset).toISOString(),
  value: { externalSampleId: id, stage: "asleep_core" },
});
function derive(samples: HealthJournalSample[]): HealthEpisodeDraft[] {
  return deriveWith({})(samples);
}
/** The same episodes under a different Dayframe mapping or build-specific event shape. */
function deriveWith(mapping: { categoryId?: string; description?: string; shape?: string }) {
  return (samples: HealthJournalSample[]): HealthEpisodeDraft[] =>
    deriveMapped(samples, mapping);
}
function deriveMapped(
  samples: HealthJournalSample[],
  mapping: { categoryId?: string; description?: string; shape?: string },
): HealthEpisodeDraft[] {
  if (!samples.length) return [];
  const startedAt = samples[0].startedAt,
    stoppedAt = samples.at(-1)!.stoppedAt;
  return [
    {
      sourceKey: "watch.fixture",
      sampleIds: samples.map((sample) => sample.id),
      startedAt,
      stoppedAt,
      event: {
        source: "health_sleep",
        type: "health_sleep_import",
        occurredAt: new Date(startedAt),
        categoryId: mapping.categoryId,
        description: mapping.description ?? "Sleep",
        rawPayload: {
          startedAt,
          stoppedAt,
          samples: samples.map((sample) => sample.value),
          ...(mapping.shape ? { buildShape: mapping.shape } : {}),
        },
      },
    },
  ];
}
async function page(
  additions: HealthJournalSample[],
  options: {
    owner?: HealthCaptureOwner;
    deletedIds?: string[];
    isCurrent?: () => boolean;
    repair?: { startedAt: string; stoppedAt: string };
    derive?: (samples: HealthJournalSample[]) => HealthEpisodeDraft[];
  } = {},
) {
  const active = options.owner ?? owner;
  const checkpoint = await store.getHealthCheckpoint(
    active,
    "sleep",
    options.repair,
  );
  return store.commitHealthCapturePage({
    owner: active,
    ...checkpoint,
    previousAnchor: checkpoint.anchor,
    newAnchor: `anchor-${count("health_query_runs") + 1}`,
    runId: `run-${count("health_query_runs") + 1}`,
    startedAt: new Date().toISOString(),
    additions,
    deletedIds: options.deletedIds ?? [],
    returnedCount: additions.length,
    complete: true,
    isCurrent: options.isCurrent ?? (() => true),
    derive: options.derive ?? derive,
  });
}

describe("Health journal real SQLite boundaries", () => {
  it("reconstructs a complete revision across deltas while preserving the original payload and ID", async () => {
    const early = sample("early"),
      late = sample("late", 3_600_000);
    await page([early]);
    const original = db
      .prepare("select client_event_id,payload_json from health_deliveries")
      .get()!;
    await page([late]);
    const deliveries = db
      .prepare(
        "select client_event_id,payload_json from health_deliveries order by created_at,rowid",
      )
      .all();
    expect(deliveries).toHaveLength(2);
    expect(deliveries[0]).toEqual(original);
    const revision = JSON.parse(String(deliveries[1].payload_json));
    expect(
      revision.rawPayload.samples.map(
        (sample: { externalSampleId: string }) => sample.externalSampleId,
      ),
    ).toEqual(["early", "late"]);
    expect(deliveries[1].client_event_id).not.toBe(original.client_event_id);
    expect(String(deliveries[1].client_event_id)).toMatch(
      /:[0-9a-f]{64}:[0-9a-f]{64}$/,
    );
  });
  it("rolls back additions, generated intent and checkpoint together when checkpoint storage fails", async () => {
    db.exec(
      "create trigger fail_checkpoint before insert on health_checkpoints begin select raise(abort,'disk fixture'); end",
    );
    await expect(page([sample("early")])).rejects.toThrow("disk fixture");
    expect(count("health_samples")).toBe(0);
    expect(count("health_deliveries")).toBe(0);
    expect(count("health_checkpoints")).toBe(0);
  });
  it("advances its durable anchor offline without claiming server acknowledgement", async () => {
    await page([sample("early")]);
    expect((await store.getHealthCheckpoint(owner, "sleep")).anchor).toBe(
      "anchor-1",
    );
    expect(
      db
        .prepare("select state,acknowledgement_json from health_deliveries")
        .get(),
    ).toMatchObject({ state: "pending_handoff", acknowledgement_json: null });
  });
  it("repeats the exact handoff ID after a crash between stores", async () => {
    await page([sample("early")]);
    const queue = new Map<string, unknown>();
    const enqueue = vi.fn(
      async (events: Parameters<typeof import("./api").enqueueEvents>[0]) => {
        for (const event of events) queue.set(event.localId!, event);
        return { acceptedCount: events.length };
      },
    );
    mocks.failHandoff = true;
    await expect(
      store.handoffHealthEvents(owner, enqueue, () => true),
    ).rejects.toThrow("crash after");
    vi.resetModules();
    store = await import("./healthSyncStore");
    mocks.failHandoff = false;
    await store.handoffHealthEvents(owner, enqueue, () => true);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(queue.size).toBe(1);
    expect(enqueue.mock.calls[0][0]).toEqual(enqueue.mock.calls[1][0]);
    expect(enqueue.mock.calls[0][0]).toHaveLength(1);
    expect(enqueue.mock.calls[0][0][0].healthOwner).toEqual(owner);
    expect(db.prepare("select state from health_deliveries").get()!.state).toBe(
      "queued",
    );
  });
  it("rolls back late query results after owner replacement", async () => {
    let checks = 0;
    await expect(
      page([sample("early")], { isCurrent: () => ++checks === 1 }),
    ).rejects.toThrow("owner changed");
    expect(count("health_samples")).toBe(0);
    expect(count("health_checkpoints")).toBe(0);
  });
  it("isolates cloned identical account IDs across stable backends", async () => {
    await page([sample("early")]);
    const production = { ...owner, backendId: "production-fixture" };
    expect(
      (await store.getHealthCheckpoint(production, "sleep")).anchor,
    ).toBeNull();
    await page([sample("early")], { owner: production });
    expect(count("health_checkpoints")).toBe(2);
    const ids = db
      .prepare("select distinct client_event_id from health_deliveries")
      .all();
    expect(ids).toHaveLength(2);
  });
  it("atomically upgrades queued deliveries for owner-proven handoff without changing IDs, checkpoints or acknowledged work", async () => {
    await page([sample("early")]);
    await page([sample("late", 3_600_000)]);
    const before = db.prepare("select * from health_deliveries order by rowid").all();
    const acknowledgedId = String(before[0].client_event_id);
    await store.recordHealthAcknowledgement(owner, acknowledgedId, {
      eventId: "server-event", clientEventId: acknowledgedId, processingDisposition: "processed",
    });
    const acknowledged = db.prepare("select * from health_deliveries where client_event_id=?").get(acknowledgedId);
    const queuedId = String(before[1].client_event_id);
    db.prepare("update health_deliveries set state='queued' where client_event_id=?").run(queuedId);
    db.exec("PRAGMA user_version=1");
    vi.resetModules();
    store = await import("./healthSyncStore");
    mocks.failUpgrade = true;
    await expect(store.getHealthCheckpoint(owner, "sleep")).rejects.toThrow("upgrade interrupted");
    expect(db.prepare("PRAGMA user_version").get()!.user_version).toBe(1);
    expect(db.prepare("select state from health_deliveries where client_event_id=?").get(queuedId)!.state).toBe("queued");
    vi.resetModules();
    store = await import("./healthSyncStore");
    mocks.failUpgrade = false;
    expect((await store.getHealthCheckpoint(owner, "sleep")).anchor).toBe("anchor-2");
    expect(db.prepare("PRAGMA user_version").get()!.user_version).toBe(2);
    const enqueue = vi.fn(async (events: readonly unknown[]) => ({ acceptedCount: events.length }));
    await store.handoffHealthEvents({ ...owner, backendId: "production-fixture" }, enqueue, () => true);
    expect(enqueue).not.toHaveBeenCalled();
    await store.handoffHealthEvents(owner, enqueue, () => true);
    expect(enqueue).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({
      localId: queuedId, healthOwner: owner,
      rawPayload: JSON.parse(String(before[1].payload_json)).rawPayload,
    })]);
    expect(db.prepare("select payload_json from health_deliveries where client_event_id=?").get(queuedId)!.payload_json).toBe(before[1].payload_json);
    expect(db.prepare("select * from health_deliveries where client_event_id=?").get(acknowledgedId)).toEqual(acknowledged);
    // A normal reopen must not keep resetting an already upgraded queue.
    vi.resetModules();
    store = await import("./healthSyncStore");
    await store.getHealthCheckpoint(owner, "sleep");
    await store.handoffHealthEvents(owner, enqueue, () => true);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it("rejects acknowledgements from a different backend, workspace or user", async () => {
    await page([sample("early")]);
    const clientEventId = String(db.prepare("select client_event_id from health_deliveries").get()!.client_event_id);
    for (const wrongOwner of [
      { ...owner, backendId: "production-fixture" },
      { ...owner, workspaceId: "other-workspace" },
      { ...owner, userId: "other-user" },
    ]) {
      await expect(store.recordHealthAcknowledgement(wrongOwner, clientEventId, {
        eventId: "server-event", clientEventId, processingDisposition: "processed",
      })).resolves.toBe(false);
    }
    expect(db.prepare("select state from health_deliveries").get()!.state).toBe("pending_handoff");
  });
  it("records deletion as unresolved source correction without shrinking or replacing delivered intent", async () => {
    const early = sample("early"),
      late = sample("late", 3_600_000);
    await page([early, late]);
    const original = db
      .prepare("select client_event_id,payload_json from health_deliveries")
      .get()!;
    await page([], { deletedIds: ["late"] });
    expect(count("health_source_corrections")).toBe(1);
    expect(
      db
        .prepare("select client_event_id,payload_json from health_deliveries")
        .get(),
    ).toEqual(original);
    await page([late]);
    expect(
      db
        .prepare(
          "select deleted,sample_json from health_samples where sample_id='late'",
        )
        .get(),
    ).toMatchObject({ deleted: 1, sample_json: null });
    expect(count("health_deliveries")).toBe(1);
  });
  it("keeps repair progress independent of the normal delta contract", async () => {
    await page([sample("early")]);
    const delta = await store.getHealthCheckpoint(owner, "sleep");
    const repair = {
      startedAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      stoppedAt: new Date().toISOString(),
    };
    await page([], { repair });
    expect(await store.getHealthCheckpoint(owner, "sleep")).toEqual(delta);
    expect(
      (await store.getHealthCheckpoint(owner, "sleep", repair)).anchor,
    ).toBe("anchor-2");
  });
  it("resumes the identical repair window after process restart and keeps its per-type anchor", async () => {
    const repair = await store.beginOrResumeHealthRepair(owner, 7);
    await page([sample("early")], { repair });
    vi.resetModules();
    store = await import("./healthSyncStore");
    expect(await store.beginOrResumeHealthRepair(owner, 7)).toEqual(repair);
    expect(
      (await store.getHealthCheckpoint(owner, "sleep", repair)).anchor,
    ).toBe("anchor-1");
    expect(
      (await store.getHealthCheckpoint(owner, "workout", repair)).anchor,
    ).toBeNull();
    expect((await store.getHealthCheckpoint(owner, "sleep")).anchor).toBeNull();
  });
  it("rejects the wrong acknowledgement and persists canonical disposition separately from capture", async () => {
    await page([sample("early")]);
    const id = String(
      db.prepare("select client_event_id from health_deliveries").get()!
        .client_event_id,
    );
    await expect(
      store.recordHealthAcknowledgement(owner, id, {
        clientEventId: "wrong",
        eventId: "event",
        processingDisposition: "confirmed",
      }),
    ).rejects.toThrow("identity mismatch");
    expect(db.prepare("select state from health_deliveries").get()!.state).toBe(
      "pending_handoff",
    );
    await store.recordHealthAcknowledgement(owner, id, {
      clientEventId: id,
      eventId: "event",
      processingDisposition: "confirmed",
      timeEntryId: "entry",
    });
    expect(
      JSON.parse(
        String(
          db
            .prepare("select acknowledgement_json from health_deliveries")
            .get()!.acknowledgement_json,
        ),
      ),
    ).toMatchObject({ eventId: "event", timeEntryId: "entry" });
    expect(db.prepare("select state from health_deliveries").get()!.state).toBe(
      "acknowledged",
    );
  });
  it("retains unacknowledged source and payload beyond retention then expires only acknowledged raw data", async () => {
    await page([sample("early")]);
    const later = Date.now() + 20 * 86_400_000;
    await store.pruneAcknowledgedHealthCapture(owner, later);
    expect(
      db.prepare("select sample_json from health_samples").get()!.sample_json,
    ).not.toBeNull();
    expect(
      db.prepare("select payload_json from health_deliveries").get()!
        .payload_json,
    ).not.toBeNull();
    const id = String(
      db.prepare("select client_event_id from health_deliveries").get()!
        .client_event_id,
    );
    await store.recordHealthAcknowledgement(owner, id, {
      clientEventId: id,
      eventId: "event",
      processingDisposition: "open",
    });
    await store.pruneAcknowledgedHealthCapture(owner, later);
    expect(
      db.prepare("select sample_json from health_samples").get()!.sample_json,
    ).toBeNull();
    expect(
      db
        .prepare(
          "select payload_json,acknowledgement_json from health_deliveries",
        )
        .get(),
    ).toMatchObject({
      payload_json: null,
      acknowledgement_json: expect.any(String),
    });
  });
  it("keeps source corrections and recorded time through explicit keep and later replay", async () => {
    const early = sample("early"),
      late = sample("late", 3_600_000);
    await page([early, late]);
    await page([], { deletedIds: ["late"] });
    const correction = (await store.listHealthSourceCorrections(owner))[0];
    expect(
      await store.keepRecordedHealthTime(
        { ...owner, backendId: "different" },
        correction.correctionId,
        () => true,
      ),
    ).toBe(false);
    expect(
      await store.keepRecordedHealthTime(
        owner,
        correction.correctionId,
        () => true,
      ),
    ).toBe(true);
    await page([early]);
    expect(count("health_deliveries")).toBe(1);
  });
  it("serializes simultaneous sleep/workout handoffs and counts an immutable event only once", async () => {
    await page([sample("simultaneous")]);
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const enqueue = vi.fn(async (events: readonly unknown[]) => {
      await wait;
      return { acceptedCount: events.length };
    });
    const first = store.handoffHealthEvents(
      owner,
      enqueue as never,
      () => true,
    );
    const second = store.handoffHealthEvents(
      owner,
      enqueue as never,
      () => true,
    );
    release();
    expect(await first).toEqual({ queuedCount: 1 });
    expect(await second).toEqual({ queuedCount: 0 });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it("finishes disabled repair types without advancing a Health anchor and permits a fresh bounded window", async () => {
    const window = await store.beginOrResumeHealthRepair(owner, 7);
    await page([sample("repair")], { repair: window });
    await store.completeSkippedHealthRepairKind(
      owner,
      "workout",
      window,
      () => true,
    );
    expect(
      db
        .prepare("select workout_complete,sleep_complete from health_repairs")
        .get(),
    ).toMatchObject({ workout_complete: 1, sleep_complete: 1 });
    expect(
      (await store.getHealthCheckpoint(owner, "workout")).anchor,
    ).toBeNull();
    const next = await store.beginOrResumeHealthRepair(owner, 7);
    expect(next.startedAt >= window.startedAt).toBe(true);
    expect(
      db
        .prepare("select workout_complete,sleep_complete from health_repairs")
        .get(),
    ).toMatchObject({ workout_complete: 0, sleep_complete: 0 });
  });
});

// Synthetic journal at steady state: one night per day for 90 days, `perNight` source samples
// each (40 ≈ one Watch, 120 ≈ three sources). IDs and times are synthetic; no Health values.
function seedJournal(
  nights: number,
  perNight: number,
  now: number,
  protect: (night: number) => "acknowledged" | "pending" | "correction",
) {
  const key = store.healthOwnerKey(owner);
  const sampleRow = db.prepare(
    "insert into health_samples(owner_key,kind,sample_id,source_key,started_at,stopped_at,sample_json,updated_at) values(?,?,?,?,?,?,?,?)",
  );
  const episodeRow = db.prepare(
    "insert into health_episodes(owner_key,kind,episode_id,source_key,sample_ids_json,started_at,stopped_at,revision,updated_at) values(?,?,?,?,?,?,?,?,?)",
  );
  const deliveryRow = db.prepare(
    "insert into health_deliveries(owner_key,client_event_id,episode_id,revision,payload_json,state,created_at,acknowledged_at) values(?,?,?,?,?,?,?,?)",
  );
  const correctionRow = db.prepare(
    "insert into health_source_corrections(owner_key,correction_id,episode_id,deleted_ids_json,created_at) values(?,?,?,?,?)",
  );
  db.exec("begin");
  for (let night = 0; night < nights; night++) {
    const at = new Date(now - (night + 1) * 86_400_000).toISOString();
    const ids = Array.from(
      { length: perNight },
      (_, index) => `synthetic-${night}-${index}`,
    );
    for (const id of ids)
      sampleRow.run(key, "sleep", id, "fixture", at, at, "{}", at);
    const episodeId = `episode-${night}`;
    episodeRow.run(key, "sleep", episodeId, "fixture", JSON.stringify(ids), at, at, "r", at);
    const state = protect(night);
    deliveryRow.run(
      key,
      `delivery-${night}`,
      episodeId,
      "r",
      "{}",
      state === "pending" ? "queued" : "acknowledged",
      at,
      state === "pending" ? null : at,
    );
    if (state === "correction")
      correctionRow.run(key, `correction-${night}`, episodeId, "[]", at);
  }
  db.exec("commit");
}

describe("Health journal of signed-out accounts (stability audit health-3)", () => {
  const ownerKeys = () =>
    db
      .prepare(
        `select owner_key from health_checkpoints union select owner_key from health_samples
         union select owner_key from health_episodes union select owner_key from health_deliveries
         union select owner_key from health_query_runs order by 1`,
      )
      .all()
      .map((row) => String(row.owner_key));
  const rowsOf = (who: HealthCaptureOwner, table: string) =>
    Number(
      db
        .prepare(`select count(*) n from ${table} where owner_key=?`)
        .get(store.healthOwnerKey(who))!.n,
    );
  async function acknowledgeAll(who: HealthCaptureOwner) {
    const rows = db
      .prepare("select client_event_id id from health_deliveries where owner_key=? and state!='acknowledged'")
      .all(store.healthOwnerKey(who));
    for (const row of rows) {
      const id = String(row.id);
      await store.recordHealthAcknowledgement(who, id, { clientEventId: id, eventId: `event-${id}`, processingDisposition: "open" });
    }
  }
  const keeper = (keep: HealthCaptureOwner | null) => async () => ({ keep, isCurrent: () => true });
  const departed = { ...owner, userId: "departed" };
  const unsettled = { ...owner, userId: "unsettled" };
  const signedIn = { ...owner, userId: "signed-in" };

  it("deletes departed accounts' journals, keeps the signed-in account's and every unacknowledged delivery", async () => {
    await page([sample("departed-1")], { owner: departed });
    await acknowledgeAll(departed);
    await page([sample("unsettled-1")], { owner: unsettled });
    await page([sample("signed-in-1")], { owner: signedIn });
    await acknowledgeAll(signedIn);
    const signedInRows = ["health_checkpoints", "health_samples", "health_episodes", "health_deliveries", "health_query_runs"]
      .map((table) => rowsOf(signedIn, table));
    const unsettledPayload = db
      .prepare("select client_event_id,payload_json from health_deliveries where owner_key=?")
      .get(store.healthOwnerKey(unsettled))!;
    expect(String(unsettledPayload.payload_json)).toContain("unsettled-1");

    expect(await store.expireInactiveHealthOwners(keeper(signedIn))).toBeGreaterThan(0);

    // The departed account leaves nothing behind: no raw sample, payload, episode or checkpoint.
    for (const table of ["health_checkpoints", "health_samples", "health_episodes", "health_deliveries", "health_query_runs"])
      expect(rowsOf(departed, table), table).toBe(0);
    // The signed-in account is untouched.
    expect(["health_checkpoints", "health_samples", "health_episodes", "health_deliveries", "health_query_runs"]
      .map((table) => rowsOf(signedIn, table))).toEqual(signedInRows);
    // Unacknowledged work stays with its episode, so the queued event's acknowledgement still lands.
    expect(db.prepare("select client_event_id,payload_json from health_deliveries where owner_key=?")
      .get(store.healthOwnerKey(unsettled))).toEqual(unsettledPayload);
    expect(rowsOf(unsettled, "health_episodes")).toBe(1);
    expect(rowsOf(unsettled, "health_samples")).toBe(0);
    expect(rowsOf(unsettled, "health_checkpoints")).toBe(0);
    const id = String(unsettledPayload.client_event_id);
    await store.recordHealthAcknowledgement(unsettled, id, { clientEventId: id, eventId: "event", processingDisposition: "open" });

    // Signed out entirely: every account's settled journal goes.
    await page([sample("unsettled-2", 60_000)], { owner: unsettled });
    expect(await store.expireInactiveHealthOwners(keeper(null))).toBeGreaterThan(0);
    expect(rowsOf(signedIn, "health_samples") + rowsOf(signedIn, "health_deliveries") + rowsOf(signedIn, "health_checkpoints")).toBe(0);
    expect(ownerKeys()).toEqual([store.healthOwnerKey(unsettled)]);
    expect(db.prepare("select state from health_deliveries").all().map((row) => row.state)).toEqual(["pending_handoff"]);
  });

  it("defers while the keeper cannot be settled, and rolls back when it changes before commit (Codex r1 on #549)", async () => {
    await page([sample("departed-1")], { owner: departed });
    await acknowledgeAll(departed);
    expect(await store.expireInactiveHealthOwners(async () => null)).toBeNull();
    let current = true;
    expect(await store.expireInactiveHealthOwners(async () => ({
      keep: signedIn,
      isCurrent: () => { const was = current; current = false; return was; },
    }))).toBeNull();
    expect(rowsOf(departed, "health_samples")).toBe(1);
    expect(rowsOf(departed, "health_deliveries")).toBe(1);
  });

  it("settles a queued event removed from the activity queue as discarded, keeping work still owed (Codex r1 on #549)", async () => {
    await page([sample("refused-1")], { owner: departed });
    await store.handoffHealthEvents(departed, (async (events: readonly unknown[]) => ({ acceptedCount: events.length })) as never, () => true);
    await page([sample("waiting-1", 60_000)], { owner: unsettled });
    const refused = String(db.prepare("select client_event_id id from health_deliveries where owner_key=?").get(store.healthOwnerKey(departed))!.id);
    const waiting = String(db.prepare("select client_event_id id from health_deliveries where owner_key=?").get(store.healthOwnerKey(unsettled))!.id);
    expect(await store.discardQueuedHealthDeliveries([{ owner: departed, clientEventId: refused }])).toBe(1);
    expect(db.prepare("select state,payload_json from health_deliveries where client_event_id=?").get(refused))
      .toEqual({ state: "discarded", payload_json: null });
    // Prune no longer protects its samples; signed-out expiry deletes it and its episode.
    await store.pruneAcknowledgedHealthCapture(departed, Date.now() + 20 * 86_400_000);
    expect(db.prepare("select sample_json from health_samples where sample_id='refused-1'").get()!.sample_json).toBeNull();
    expect(await store.expireInactiveHealthOwners(keeper(null))).toBeGreaterThan(0);
    expect(rowsOf(departed, "health_deliveries") + rowsOf(departed, "health_episodes")).toBe(0);
    expect(db.prepare("select state from health_deliveries where client_event_id=?").get(waiting)!.state).toBe("pending_handoff");
    expect(rowsOf(unsettled, "health_episodes")).toBe(1);
  });

  it("settles a removed event whose handoff was interrupted, so the next handoff cannot bring it back (Codex r2 on #549)", async () => {
    await page([sample("interrupted-1")], { owner: departed });
    const id = String(db.prepare("select client_event_id id from health_deliveries").get()!.id);
    // The event reached the durable queue, but the process stopped before the journal recorded it.
    mocks.failHandoff = true;
    await expect(store.handoffHealthEvents(departed, (async (events: readonly unknown[]) => ({ acceptedCount: events.length })) as never, () => true)).rejects.toThrow("crash after durable enqueue");
    mocks.failHandoff = false;
    expect(db.prepare("select state from health_deliveries").get()!.state).toBe("pending_handoff");
    expect(await store.discardQueuedHealthDeliveries([{ owner: departed, clientEventId: id }])).toBe(1);
    const enqueue = vi.fn(async () => undefined);
    expect(await store.handoffHealthEvents(departed, enqueue as never, () => true)).toEqual({ queuedCount: 0 });
    expect(enqueue).not.toHaveBeenCalled();
    // An acknowledged row is not changed by a discard.
    await page([sample("acknowledged-1")], { owner: signedIn });
    await acknowledgeAll(signedIn);
    const acknowledged = String(db.prepare("select client_event_id id from health_deliveries where owner_key=?").get(store.healthOwnerKey(signedIn))!.id);
    expect(await store.discardQueuedHealthDeliveries([{ owner: signedIn, clientEventId: acknowledged }])).toBe(0);
  });

  it("reads the account to keep when its turn in the journal's lane comes, not when it was asked", async () => {
    await page([sample("new-account")], { owner: signedIn });
    let active: HealthCaptureOwner | null = null;
    // Asked while signed out; a sign-in lands before the expiry's turn and keeps its journal.
    const expiry = store.expireInactiveHealthOwners(async () => ({ keep: active, isCurrent: () => true }));
    active = signedIn;
    await expiry;
    expect(rowsOf(signedIn, "health_samples")).toBe(1);
    expect(rowsOf(signedIn, "health_checkpoints")).toBe(1);
  });
});

describe("Health journal prune budget (stability audit health-1)", () => {
  it("prunes 90 days of three-source journal with no per-row correlated subquery", async () => {
    const now = Date.now();
    seedJournal(90, 120, now, () => "acknowledged");
    mocks.recorded = [];
    const startedAt = performance.now();
    await store.pruneAcknowledgedHealthCapture(owner, now);
    const elapsed = performance.now() - startedAt;
    const statements = mocks.recorded;
    mocks.recorded = null;
    expect(statements.length).toBeGreaterThanOrEqual(7);
    // Deterministic bound: a correlated subquery is re-run for every journal row (quadratic in
    // journal age); each statement may only build its protected set once.
    const correlated = statements.flatMap(({ sql, args }) =>
      (
        db.prepare(`explain query plan ${sql}`).all(...(args as never[])) as Array<{
          detail: string;
        }>
      )
        .filter((row) => /CORRELATED/.test(row.detail))
        .map((row) => `${sql.replace(/\s+/g, " ").slice(0, 60)} → ${row.detail}`),
    );
    expect(correlated).toEqual([]);
    // Loose wall-clock backstop only (measured 6.5 s before the fix, a few ms after).
    expect(elapsed).toBeLessThan(1_000);
    expect(
      Number(
        db.prepare("select count(*) n from health_samples where sample_json is not null").get()!.n,
      ),
    ).toBe(14 * 120);
  }, 30_000);

  it("never prunes members of an unacknowledged delivery or unresolved correction, however old", async () => {
    const now = Date.now();
    // Nights 0-119: every 10th still queued, every 10th+5 corrected, the rest acknowledged.
    seedJournal(120, 4, now, (night) =>
      night % 10 === 0 ? "pending" : night % 10 === 5 ? "correction" : "acknowledged",
    );
    await store.pruneAcknowledgedHealthCapture(owner, now);
    const protectedNights = Array.from({ length: 120 }, (_, night) => night).filter(
      (night) => night % 10 === 0 || night % 10 === 5,
    );
    for (const night of protectedNights) {
      const rows = db
        .prepare("select sample_json from health_samples where sample_id like ?")
        .all(`synthetic-${night}-%`) as Array<{ sample_json: string | null }>;
      expect(rows).toHaveLength(4);
      expect(rows.every((row) => row.sample_json !== null)).toBe(true);
      expect(
        db.prepare("select payload_json from health_deliveries where episode_id=?").get(`episode-${night}`),
      ).toMatchObject({ payload_json: "{}" });
      expect(
        db.prepare("select count(*) n from health_episodes where episode_id=?").get(`episode-${night}`)!.n,
      ).toBe(1);
    }
    // Acknowledged nights: raw nulled after 14 days, everything gone after 90.
    expect(
      db.prepare("select sample_json from health_samples where sample_id='synthetic-21-0'").get(),
    ).toMatchObject({ sample_json: null });
    expect(
      db.prepare("select count(*) n from health_samples where sample_id like 'synthetic-101-%'").get()!.n,
    ).toBe(0);
    expect(
      db.prepare("select count(*) n from health_episodes where episode_id='episode-101'").get()!.n,
    ).toBe(0);
    expect(
      db.prepare("select sample_json from health_samples where sample_id='synthetic-3-0'").get(),
    ).toMatchObject({ sample_json: "{}" });
  });

  it("bounds query-run history on every capture write, without the daily prune", async () => {
    const key = store.healthOwnerKey(owner);
    const otherKey = store.healthOwnerKey({ ...owner, userId: "other" });
    const now = Date.now();
    const insert = db.prepare(
      "insert into health_query_runs(owner_key,run_id,kind,contract_json,started_at,finished_at,additions,deletions,usable,generated,ignored,checkpoint_advanced,outcome) values(?,?,'sleep','{}',?,?,0,0,0,0,0,0,'query_completed')",
    );
    // 101 daily background captures, none followed by a foreground prune.
    for (let day = 0; day <= 100; day++) {
      const at = new Date(now - day * 86_400_000 - 60_000).toISOString();
      insert.run(key, `synthetic-run-${day}`, at, at);
      insert.run(otherKey, `synthetic-other-${day}`, at, at);
    }
    const runs = (owner_key: string) =>
      Number(db.prepare("select count(*) n from health_query_runs where owner_key=?").get(owner_key)!.n);
    const { contract } = await store.getHealthCheckpoint(owner, "sleep");
    await store.recordHealthQueryFailure({
      owner,
      contract,
      runId: "synthetic-full",
      startedAt: new Date(now).toISOString(),
      reason: "storage_full",
    });
    // Days 0-89 survive (day 90 is exactly past retention), plus the new failure row.
    expect(runs(key)).toBe(91);
    expect(runs(otherKey)).toBe(101);
    insert.run(key, "synthetic-stale", new Date(now - 95 * 86_400_000).toISOString(), new Date(now - 95 * 86_400_000).toISOString());
    await page([]);
    expect(runs(key)).toBe(92);
    expect(
      db.prepare("select count(*) n from health_query_runs where owner_key=? and finished_at<?")
        .get(key, new Date(now - 90 * 86_400_000).toISOString())!.n,
    ).toBe(0);
    expect(
      JSON.stringify(
        db.prepare(`explain query plan ${store.HEALTH_QUERY_RUN_EXPIRY_SQL}`).all(key, new Date(now).toISOString()),
      ),
    ).toContain("health_query_run_finished");
  });

  it("runs the foreground maintenance prune at most once a day per owner", async () => {
    const now = Date.now();
    expect(await store.pruneAcknowledgedHealthCaptureIfDue(owner, now)).toBe(true);
    seedJournal(30, 2, now, () => "acknowledged");
    const raw = () =>
      Number(db.prepare("select count(*) n from health_samples where sample_json is not null").get()!.n);
    expect(raw()).toBe(60);
    expect(await store.pruneAcknowledgedHealthCaptureIfDue(owner, now + 3_600_000)).toBe(false);
    expect(
      await store.pruneAcknowledgedHealthCaptureIfDue(owner, now + store.HEALTH_PRUNE_INTERVAL_MS - 1),
    ).toBe(false);
    expect(raw()).toBe(60);
    // Another owner has its own schedule.
    expect(
      await store.pruneAcknowledgedHealthCaptureIfDue({ ...owner, userId: "other" }, now + 1),
    ).toBe(true);
    expect(
      await store.pruneAcknowledgedHealthCaptureIfDue(owner, now + store.HEALTH_PRUNE_INTERVAL_MS),
    ).toBe(true);
    expect(raw()).toBe(26);
    // A clock set back before the last run does not postpone maintenance.
    expect(await store.pruneAcknowledgedHealthCaptureIfDue(owner, now - 86_400_000)).toBe(true);
  });
});

describe("Health revision identity comes from source facts only (stability audit health-2)", () => {
  const deliveries = () =>
    db
      .prepare("select client_event_id,revision,payload_json from health_deliveries order by created_at,rowid")
      .all();
  it("does not re-send an unchanged episode after a mapping or event-shape change", async () => {
    await page([sample("early"), sample("late", 3_600_000)]);
    const [original] = deliveries();
    expect(deliveries()).toHaveLength(1);
    // Settings > Apple Health "Logs as" / Name change, then a capture with no new samples.
    await page([], { derive: deriveWith({ categoryId: "category-rest", description: "Rest" }) });
    // A newer build that changes a label or payload field of the derived event.
    await page([], { derive: deriveWith({ shape: "build-2" }) });
    expect(deliveries()).toEqual([original]);
    expect(db.prepare("select revision from health_episodes").get()!.revision).toBe(original.revision);
  });
  it("re-sends a genuine source change with the current mapping", async () => {
    const early = sample("early");
    await page([early]);
    await page([], { derive: deriveWith({ description: "Rest" }) });
    expect(deliveries()).toHaveLength(1);
    // An added member and an edited member (different times) are both source changes.
    await page([sample("late", 3_600_000)], { derive: deriveWith({ description: "Rest" }) });
    await page([{ ...early, stoppedAt: new Date(Date.parse(early.stoppedAt) + 600_000).toISOString() }], {
      derive: deriveWith({ description: "Rest" }),
    });
    const sent = deliveries();
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((row) => row.client_event_id)).size).toBe(3);
    expect(JSON.parse(String(sent[2].payload_json)).description).toBe("Rest");
  });
  it("adopts episodes journaled by an older build without re-sending them on upgrade", async () => {
    // Journal written by a build whose revision fingerprinted the event (mapping and shape).
    await page([sample("early"), sample("late", 3_600_000)], {
      derive: deriveWith({ description: "Legacy", shape: "build-1" }),
    });
    await page([sample("other", 30 * 3_600_000)], { derive: deriveWith({ description: "Legacy", shape: "build-1" }) });
    const legacyColumns = "owner_key,kind,episode_id,source_key,sample_ids_json,started_at,stopped_at,revision,updated_at";
    db.exec(`create table legacy_episodes as select ${legacyColumns} from health_episodes;
      drop table health_episodes;
      create table health_episodes (
        owner_key text not null, kind text not null, episode_id text not null, source_key text not null,
        sample_ids_json text not null, started_at text not null, stopped_at text not null,
        revision text not null, updated_at text not null, primary key(owner_key,episode_id));
      insert into health_episodes select * from legacy_episodes; drop table legacy_episodes;`);
    const before = deliveries();
    expect(before).toHaveLength(2);
    vi.resetModules();
    store = await import("./healthSyncStore");
    // The upgraded build derives the same episodes with its own mapping and event shape.
    await page([], { derive: deriveWith({ shape: "build-2" }) });
    await page([], { derive: deriveWith({ description: "Rest" }) });
    expect(deliveries()).toEqual(before);
    // A genuine change to an adopted episode still re-sends, once.
    await page([sample("later", 30 * 3_600_000 + 3_600_000)], { derive: deriveWith({ shape: "build-2" }) });
    await page([], { derive: deriveWith({ shape: "build-3" }) });
    expect(deliveries()).toHaveLength(3);
  });
});
