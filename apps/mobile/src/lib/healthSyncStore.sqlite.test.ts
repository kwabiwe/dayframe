import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type {
  HealthCaptureOwner,
  HealthEpisodeDraft,
  HealthJournalSample,
} from "./healthSyncStore";

const mocks = vi.hoisted(() => ({ open: vi.fn(), failHandoff: false }));
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
      db.exec(sql);
    },
    getFirstAsync: async (sql: string, ...args: never[]) =>
      db.prepare(sql).get(...args) ?? null,
    getAllAsync: async (sql: string, ...args: never[]) =>
      db.prepare(sql).all(...args),
    runAsync: async (sql: string, ...args: never[]) => {
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
        description: "Sleep",
        rawPayload: {
          startedAt,
          stoppedAt,
          samples: samples.map((sample) => sample.value),
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
    derive,
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
      async (event: Parameters<typeof import("./api").enqueueEvent>[0]) => {
        queue.set(event.localId!, event);
        return [];
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
    const enqueue = vi.fn(async () => {
      await wait;
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
