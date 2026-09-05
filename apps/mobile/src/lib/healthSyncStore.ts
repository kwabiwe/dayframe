import * as SQLite from "expo-sqlite";
import type { enqueueEvent } from "./api";
import { healthFingerprint, canonicalHealthJson } from "./healthFingerprint";

export type HealthCaptureOwner = {
  backendId: string;
  workspaceId: string;
  userId: string;
};
export type HealthCaptureKind = "sleep" | "workout";
export type HealthQueryContract = {
  version: 2;
  kind: HealthCaptureKind;
  mode: "delta" | "repair";
  startedAt: string;
  stoppedAt?: string;
};
export type HealthJournalSample = {
  id: string;
  sourceKey: string;
  startedAt: string;
  stoppedAt: string;
  value: Record<string, unknown>;
};
export type HealthEpisodeDraft = {
  sourceKey: string;
  sampleIds: string[];
  startedAt: string;
  stoppedAt: string;
  event: Parameters<typeof enqueueEvent>[0];
};
type EpisodeRow = {
  episode_id: string;
  source_key: string;
  sample_ids_json: string;
  started_at: string;
  stopped_at: string;
};
type DeliveryRow = {
  client_event_id: string;
  episode_id: string;
  payload_json: string | null;
  state: string;
  created_at: string;
  acknowledgement_json: string | null;
};
const MAX_SAMPLES_PER_OWNER = 50_000;
const MAX_UNSETTLED_DELIVERIES = 5_000;
export const HEALTH_RAW_RETENTION_DAYS = 14;
export const HEALTH_PROVENANCE_RETENTION_DAYS = 90;
let opening: Promise<SQLite.SQLiteDatabase> | undefined;
let tail: Promise<unknown> = Promise.resolve();
const handoffTails = new Map<string, Promise<unknown>>();
function serial<T>(work: () => Promise<T>) {
  const result = tail.catch(() => undefined).then(work);
  tail = result.catch(() => undefined);
  return result;
}
export function healthOwnerKey(owner: HealthCaptureOwner) {
  if (!owner.backendId || !owner.workspaceId || !owner.userId)
    throw new Error("Health capture requires a verified owner.");
  return JSON.stringify([owner.backendId, owner.workspaceId, owner.userId]);
}
async function database() {
  opening ??= SQLite.openDatabaseAsync("dayframe-health-capture-v2.db").then(
    async (db) => {
      await db.execAsync(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
      );
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.execAsync(`
        create table if not exists health_checkpoints (
          owner_key text not null, contract_key text not null, contract_json text not null,
          anchor text, updated_at text not null, primary key(owner_key,contract_key));
        create table if not exists health_repairs (
          owner_key text not null, days integer not null, started_at text not null, stopped_at text not null,
          sleep_complete integer not null default 0, workout_complete integer not null default 0,
          primary key(owner_key,days));
        create table if not exists health_samples (
          owner_key text not null, kind text not null, sample_id text not null, source_key text,
          started_at text, stopped_at text, sample_json text, deleted integer not null default 0,
          updated_at text not null, primary key(owner_key,kind,sample_id));
        create table if not exists health_episodes (
          owner_key text not null, kind text not null, episode_id text not null, source_key text not null,
          sample_ids_json text not null, started_at text not null, stopped_at text not null,
          revision text not null, updated_at text not null, primary key(owner_key,episode_id));
        create table if not exists health_deliveries (
          owner_key text not null, client_event_id text not null, episode_id text not null, revision text not null,
          payload_json text, state text not null default 'pending_handoff', created_at text not null,
          handed_off_at text, acknowledged_at text, acknowledgement_json text,
          primary key(owner_key,client_event_id));
        create table if not exists health_source_corrections (
          owner_key text not null, correction_id text not null, episode_id text not null,
          deleted_ids_json text not null, state text not null default 'needs_attention',
          created_at text not null, resolved_at text, primary key(owner_key,correction_id));
        create table if not exists health_query_runs (
          owner_key text not null, run_id text not null, kind text not null, contract_json text not null,
          started_at text not null, finished_at text not null, additions integer not null, deletions integer not null,
          usable integer not null, generated integer not null, ignored integer not null,
          checkpoint_advanced integer not null, outcome text not null, primary key(owner_key,run_id));
        create index if not exists health_sample_window on health_samples(owner_key,kind,stopped_at);
        create index if not exists health_delivery_pending on health_deliveries(owner_key,state,created_at);
        PRAGMA user_version=1;
      `);
      });
      return db;
    },
  );
  return opening;
}

export async function getHealthCheckpoint(
  owner: HealthCaptureOwner,
  kind: HealthCaptureKind,
  repair?: { startedAt: string; stoppedAt: string },
) {
  const db = await database();
  const key = healthOwnerKey(owner);
  const contractKey = repair
    ? `repair:${kind}:${repair.startedAt}:${repair.stoppedAt}`
    : `delta:${kind}:v2`;
  const saved = await db.getFirstAsync<{
    contract_json: string;
    anchor: string | null;
  }>(
    "select contract_json,anchor from health_checkpoints where owner_key=? and contract_key=?",
    key,
    contractKey,
  );
  // Never copy a global legacy anchor into a different predicate or backend.
  const contract: HealthQueryContract = saved
    ? JSON.parse(saved.contract_json)
    : {
        version: 2,
        kind,
        mode: repair ? "repair" : "delta",
        startedAt:
          repair?.startedAt ??
          new Date(Date.now() - 7 * 86_400_000).toISOString(),
        ...(repair ? { stoppedAt: repair.stoppedAt } : {}),
      };
  return { contractKey, contract, anchor: saved?.anchor ?? null };
}

export async function commitHealthCapturePage(input: {
  owner: HealthCaptureOwner;
  contractKey: string;
  contract: HealthQueryContract;
  previousAnchor: string | null;
  newAnchor: string;
  runId: string;
  startedAt: string;
  additions: HealthJournalSample[];
  deletedIds: string[];
  returnedCount: number;
  ignoredCount?: number;
  complete: boolean;
  isCurrent: () => boolean | Promise<boolean>;
  derive: (samples: HealthJournalSample[]) => HealthEpisodeDraft[];
}) {
  return serial(async () => {
    const db = await database();
    const key = healthOwnerKey(input.owner);
    const now = new Date().toISOString();
    let generated = 0;
    await db.withExclusiveTransactionAsync(async (transaction) => {
      if (!(await input.isCurrent()))
        throw new Error("Health capture owner changed.");
      const previous = await transaction.getFirstAsync<{
        anchor: string | null;
      }>(
        "select anchor from health_checkpoints where owner_key=? and contract_key=?",
        key,
        input.contractKey,
      );
      if ((previous?.anchor ?? null) !== input.previousAnchor)
        throw new Error(
          "Health checkpoint advanced during this query; retry from its saved anchor.",
        );
      const count = await transaction.getFirstAsync<{
        samples: number;
        pending: number;
      }>(
        `select
        (select count(*) from health_samples where owner_key=?) as samples,
        (select count(*) from health_deliveries where owner_key=? and state!='acknowledged') as pending`,
        key,
        key,
      );
      if (
        (count?.samples ?? 0) +
          input.additions.length +
          input.deletedIds.length >
          MAX_SAMPLES_PER_OWNER ||
        (count?.pending ?? 0) >= MAX_UNSETTLED_DELIVERIES
      ) {
        throw new Error(
          "Health capture storage is full. Saved work is preserved; sync or review it before capturing more.",
        );
      }
      for (const sample of input.additions) {
        await transaction.runAsync(
          `insert into health_samples(owner_key,kind,sample_id,source_key,started_at,stopped_at,sample_json,updated_at)
          values(?,?,?,?,?,?,?,?) on conflict(owner_key,kind,sample_id) do update set
          source_key=excluded.source_key,started_at=excluded.started_at,stopped_at=excluded.stopped_at,
          sample_json=case when deleted=0 then excluded.sample_json else null end,updated_at=excluded.updated_at`,
          key,
          input.contract.kind,
          sample.id,
          sample.sourceKey,
          sample.startedAt,
          sample.stoppedAt,
          canonicalHealthJson(sample.value),
          now,
        );
      }
      const oldEpisodes = await transaction.getAllAsync<EpisodeRow>(
        "select * from health_episodes where owner_key=? and kind=?",
        key,
        input.contract.kind,
      );
      for (const id of input.deletedIds) {
        await transaction.runAsync(
          `insert into health_samples(owner_key,kind,sample_id,deleted,updated_at) values(?,?,?,1,?)
          on conflict(owner_key,kind,sample_id) do update set deleted=1,sample_json=null,updated_at=excluded.updated_at`,
          key,
          input.contract.kind,
          id,
          now,
        );
      }
      for (const episode of oldEpisodes) {
        const members: string[] = JSON.parse(episode.sample_ids_json);
        const deleted = input.deletedIds
          .filter((id) => members.includes(id))
          .sort();
        if (!deleted.length) continue;
        const correctionId = await healthFingerprint([
          key,
          episode.episode_id,
          deleted,
        ]);
        await transaction.runAsync(
          `insert or ignore into health_source_corrections(owner_key,correction_id,episode_id,deleted_ids_json,created_at)
          values(?,?,?,?,?)`,
          key,
          correctionId,
          episode.episode_id,
          JSON.stringify(deleted),
          now,
        );
      }
      const sampleRows = await transaction.getAllAsync<{
        sample_id: string;
        source_key: string;
        started_at: string;
        stopped_at: string;
        sample_json: string;
      }>(
        `select * from health_samples where owner_key=? and kind=? and deleted=0 and sample_json is not null
         and stopped_at>=? order by started_at,sample_id`,
        key,
        input.contract.kind,
        new Date(
          Date.now() - HEALTH_RAW_RETENTION_DAYS * 86_400_000,
        ).toISOString(),
      );
      const drafts = input.derive(
        sampleRows.map((row) => ({
          id: row.sample_id,
          sourceKey: row.source_key,
          startedAt: row.started_at,
          stoppedAt: row.stopped_at,
          value: JSON.parse(row.sample_json),
        })),
      );
      for (const draft of drafts) {
        const members = [...new Set(draft.sampleIds)].sort();
        const matches = oldEpisodes
          .filter(
            (episode) =>
              episode.source_key === draft.sourceKey &&
              (JSON.parse(episode.sample_ids_json) as string[]).some((id) =>
                members.includes(id),
              ),
          )
          .sort((a, b) => a.episode_id.localeCompare(b.episode_id));
        const episodeId =
          matches[0]?.episode_id ??
          (await healthFingerprint([
            key,
            input.contract.kind,
            draft.sourceKey,
            members[0],
          ]));
        const unresolved = await transaction.getFirstAsync<{ n: number }>(
          `select count(*) as n from health_source_corrections where owner_key=? and episode_id=?`,
          key,
          episodeId,
        );
        if (unresolved?.n) continue; // Explicit correction preserves the existing union and user-visible time.
        const {
          localId: _legacyId,
          owner: _owner,
          requestImmediateDelivery: _immediate,
          ...base
        } = draft.event;
        const payload = {
          ...base,
          rawPayload: {
            ...base.rawPayload,
            externalSampleId: undefined,
            logicalEpisodeId: episodeId,
          },
        };
        const revision = await healthFingerprint(payload);
        const clientEventId = `healthkit:${input.contract.kind}:${episodeId}:${revision}`;
        const event = {
          ...payload,
          localId: clientEventId,
          rawPayload: {
            ...payload.rawPayload,
            externalSampleId:
              input.contract.kind === "workout"
                ? base.rawPayload?.externalSampleId
                : `health-revision-${revision}`,
            episodeRevision: revision,
          },
        };
        const inserted = await transaction.runAsync(
          `insert or ignore into health_deliveries(owner_key,client_event_id,episode_id,revision,payload_json,created_at)
          values(?,?,?,?,?,?)`,
          key,
          clientEventId,
          episodeId,
          revision,
          canonicalHealthJson(event),
          now,
        );
        generated += inserted.changes;
        await transaction.runAsync(
          `insert into health_episodes(owner_key,kind,episode_id,source_key,sample_ids_json,started_at,stopped_at,revision,updated_at)
          values(?,?,?,?,?,?,?,?,?) on conflict(owner_key,episode_id) do update set sample_ids_json=excluded.sample_ids_json,
          started_at=excluded.started_at,stopped_at=excluded.stopped_at,revision=excluded.revision,updated_at=excluded.updated_at`,
          key,
          input.contract.kind,
          episodeId,
          draft.sourceKey,
          JSON.stringify(members),
          draft.startedAt,
          draft.stoppedAt,
          revision,
          now,
        );
      }
      if ((count?.pending ?? 0) + generated > MAX_UNSETTLED_DELIVERIES)
        throw new Error(
          "Health handoff capacity reached; this query was not checkpointed.",
        );
      if (!(await input.isCurrent()))
        throw new Error("Health capture owner changed.");
      await transaction.runAsync(
        `insert into health_checkpoints(owner_key,contract_key,contract_json,anchor,updated_at) values(?,?,?,?,?)
        on conflict(owner_key,contract_key) do update set anchor=excluded.anchor,updated_at=excluded.updated_at`,
        key,
        input.contractKey,
        canonicalHealthJson(input.contract),
        input.newAnchor,
        now,
      );
      if (input.contract.mode === "repair" && input.complete) {
        const column =
          input.contract.kind === "sleep"
            ? "sleep_complete"
            : "workout_complete";
        await transaction.runAsync(
          `update health_repairs set ${column}=1 where owner_key=? and started_at=? and stopped_at=?`,
          key,
          input.contract.startedAt,
          input.contract.stoppedAt!,
        );
      }
      await transaction.runAsync(
        `insert into health_query_runs(owner_key,run_id,kind,contract_json,started_at,finished_at,additions,deletions,usable,generated,ignored,checkpoint_advanced,outcome)
        values(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        key,
        input.runId,
        input.contract.kind,
        canonicalHealthJson(input.contract),
        input.startedAt,
        now,
        input.returnedCount,
        input.deletedIds.length,
        input.additions.length,
        generated,
        input.ignoredCount ?? 0,
        input.previousAnchor !== input.newAnchor ? 1 : 0,
        input.complete ? "query_completed" : "partial",
      );
    });
    return {
      generatedCount: generated,
      deletionCount: input.deletedIds.length,
      usableSampleCount: input.additions.length,
    };
  });
}

export async function handoffHealthEvents(
  owner: HealthCaptureOwner,
  enqueue: typeof enqueueEvent,
  isCurrent: () => boolean | Promise<boolean>,
) {
  const key = healthOwnerKey(owner);
  const previous = handoffTails.get(key) ?? Promise.resolve();
  const result = previous
    .catch(() => undefined)
    .then(async () => {
      const db = await database();
      const rows = await db.getAllAsync<DeliveryRow>(
        "select * from health_deliveries where owner_key=? and state='pending_handoff' order by created_at,client_event_id limit 250",
        key,
      );
      let queuedCount = 0;
      for (const row of rows) {
        if (!(await isCurrent())) break;
        if (!row.payload_json)
          throw new Error(
            "Unacknowledged Health payload is unavailable; source repair is required.",
          );
        const payload = JSON.parse(row.payload_json) as Parameters<
          typeof enqueueEvent
        >[0];
        // Explicit owner + deterministic ID make the separate outbox boundary restartable.
        await enqueue({
          ...payload,
          localId: row.client_event_id,
          occurredAt: new Date(String(payload.occurredAt)),
          owner: { workspaceId: owner.workspaceId, userId: owner.userId },
        });
        if (!(await isCurrent())) break;
        await serial(() =>
          db.runAsync(
            "update health_deliveries set state='queued',handed_off_at=? where owner_key=? and client_event_id=? and state='pending_handoff'",
            new Date().toISOString(),
            key,
            row.client_event_id,
          ),
        );
        queuedCount++;
      }
      return { queuedCount };
    });
  handoffTails.set(key, result);
  try {
    return await result;
  } finally {
    if (handoffTails.get(key) === result) handoffTails.delete(key);
  }
}

export async function recordHealthAcknowledgement(
  owner: HealthCaptureOwner,
  clientEventId: string,
  acknowledgement: {
    eventId: string;
    clientEventId: string;
    processingDisposition: string;
    reviewItemId?: string | null;
    timeEntryId?: string | null;
  },
) {
  if (
    !acknowledgement.eventId ||
    acknowledgement.clientEventId !== clientEventId
  )
    throw new Error("Health acknowledgement identity mismatch.");
  const db = await database();
  await serial(() =>
    db.runAsync(
      `update health_deliveries set state='acknowledged',acknowledgement_json=?,acknowledged_at=?
    where owner_key=? and client_event_id=?`,
      canonicalHealthJson(acknowledgement),
      new Date().toISOString(),
      healthOwnerKey(owner),
      clientEventId,
    ),
  );
}

export async function beginOrResumeHealthRepair(
  owner: HealthCaptureOwner,
  days: 7 | 14,
) {
  return serial(async () => {
    const db = await database();
    const key = healthOwnerKey(owner);
    let window: { startedAt: string; stoppedAt: string } | undefined;
    await db.withExclusiveTransactionAsync(async (transaction) => {
      const saved = await transaction.getFirstAsync<{
        started_at: string;
        stopped_at: string;
        sleep_complete: number;
        workout_complete: number;
      }>(
        "select * from health_repairs where owner_key=? and days=?",
        key,
        days,
      );
      if (saved && (!saved.sleep_complete || !saved.workout_complete)) {
        window = { startedAt: saved.started_at, stoppedAt: saved.stopped_at };
        return;
      }
      window = {
        startedAt: new Date(Date.now() - days * 86_400_000).toISOString(),
        stoppedAt: new Date().toISOString(),
      };
      await transaction.runAsync(
        `insert into health_repairs(owner_key,days,started_at,stopped_at) values(?,?,?,?)
        on conflict(owner_key,days) do update set started_at=excluded.started_at,stopped_at=excluded.stopped_at,sleep_complete=0,workout_complete=0`,
        key,
        days,
        window.startedAt,
        window.stoppedAt,
      );
    });
    return window!;
  });
}

/** Disabled import types finish only the explicit repair window, without moving an anchor. */
export async function completeSkippedHealthRepairKind(
  owner: HealthCaptureOwner,
  kind: HealthCaptureKind,
  window: { startedAt: string; stoppedAt: string },
  isCurrent: () => boolean | Promise<boolean>,
) {
  return serial(async () => {
    const db = await database();
    await db.withExclusiveTransactionAsync(async (transaction) => {
      if (!(await isCurrent()))
        throw new Error("Health capture owner changed.");
      const column = kind === "sleep" ? "sleep_complete" : "workout_complete";
      await transaction.runAsync(
        `update health_repairs set ${column}=1 where owner_key=? and started_at=? and stopped_at=?`,
        healthOwnerKey(owner),
        window.startedAt,
        window.stoppedAt,
      );
      if (!(await isCurrent()))
        throw new Error("Health capture owner changed.");
    });
  });
}

export async function getHealthJournalDiagnostics(owner: HealthCaptureOwner) {
  const db = await database();
  const key = healthOwnerKey(owner);
  const deliveries = await db.getAllAsync<{ state: string; count: number }>(
    "select state,count(*) as count from health_deliveries where owner_key=? group by state",
    key,
  );
  const runs = await db.getAllAsync<Record<string, unknown>>(
    "select kind,started_at,finished_at,additions,deletions,usable,generated,ignored,checkpoint_advanced,outcome from health_query_runs where owner_key=? order by finished_at desc limit 20",
    key,
  );
  const corrections = await db.getFirstAsync<{ count: number }>(
    "select count(*) as count from health_source_corrections where owner_key=? and state='needs_attention'",
    key,
  );
  return {
    backendId: owner.backendId,
    deliveries,
    runs,
    sourceCorrections: corrections?.count ?? 0,
    rawRetentionDays: HEALTH_RAW_RETENTION_DAYS,
    provenanceRetentionDays: HEALTH_PROVENANCE_RETENTION_DAYS,
    maxSamples: MAX_SAMPLES_PER_OWNER,
    maxUnsettledDeliveries: MAX_UNSETTLED_DELIVERIES,
  };
}

export async function recordHealthQueryFailure(input: {
  owner: HealthCaptureOwner;
  contract: HealthQueryContract;
  runId: string;
  startedAt: string;
  reason: "query_failed" | "invalid_anchor" | "storage_full";
}) {
  const db = await database();
  await serial(() =>
    db.runAsync(
      `insert or ignore into health_query_runs(owner_key,run_id,kind,contract_json,started_at,finished_at,
    additions,deletions,usable,generated,ignored,checkpoint_advanced,outcome) values(?,?,?,?,?,?,0,0,0,0,0,0,?)`,
      healthOwnerKey(input.owner),
      input.runId,
      input.contract.kind,
      canonicalHealthJson(input.contract),
      input.startedAt,
      new Date().toISOString(),
      input.reason,
    ),
  );
}

export async function listHealthSourceCorrections(owner: HealthCaptureOwner) {
  const db = await database();
  return db.getAllAsync<{
    correctionId: string;
    episodeId: string;
    kind: HealthCaptureKind;
    startedAt: string;
    stoppedAt: string;
    createdAt: string;
  }>(
    `select c.correction_id as correctionId,c.episode_id as episodeId,e.kind,e.started_at as startedAt,e.stopped_at as stoppedAt,c.created_at as createdAt
     from health_source_corrections c join health_episodes e on e.owner_key=c.owner_key and e.episode_id=c.episode_id
     where c.owner_key=? and c.state='needs_attention' order by c.created_at limit 100`,
    healthOwnerKey(owner),
  );
}

/** An explicit decision to keep recorded time acknowledges the source notice; it writes no entry. */
export async function keepRecordedHealthTime(
  owner: HealthCaptureOwner,
  correctionId: string,
  isCurrent: () => boolean | Promise<boolean>,
) {
  const db = await database();
  return serial(async () => {
    if (!(await isCurrent())) return false;
    const result = await db.runAsync(
      `update health_source_corrections set state='keep_recorded_time',resolved_at=?
      where owner_key=? and correction_id=? and state='needs_attention'`,
      new Date().toISOString(),
      healthOwnerKey(owner),
      correctionId,
    );
    return result.changes > 0;
  });
}

export async function pruneAcknowledgedHealthCapture(
  owner: HealthCaptureOwner,
  now = Date.now(),
) {
  const db = await database();
  const key = healthOwnerKey(owner);
  const rawBefore = new Date(
    now - HEALTH_RAW_RETENTION_DAYS * 86_400_000,
  ).toISOString();
  const provenanceBefore = new Date(
    now - HEALTH_PROVENANCE_RETENTION_DAYS * 86_400_000,
  ).toISOString();
  await serial(() =>
    db.withExclusiveTransactionAsync(async (transaction) => {
      // Every unacknowledged delivery and unresolved correction protects its source members.
      const unprotected = `not exists(select 1 from health_episodes e,json_each(e.sample_ids_json) member
      where e.owner_key=health_samples.owner_key and member.value=health_samples.sample_id and
      (exists(select 1 from health_deliveries d where d.owner_key=e.owner_key and d.episode_id=e.episode_id and d.state!='acknowledged')
       or exists(select 1 from health_source_corrections c where c.owner_key=e.owner_key and c.episode_id=e.episode_id and c.state='needs_attention')))`;
      await transaction.runAsync(
        `update health_samples set sample_json=null where owner_key=? and updated_at<? and ${unprotected}`,
        key,
        rawBefore,
      );
      await transaction.runAsync(
        `update health_deliveries set payload_json=null where owner_key=? and state='acknowledged' and acknowledged_at<?
      and not exists(select 1 from health_source_corrections c where c.owner_key=health_deliveries.owner_key and c.episode_id=health_deliveries.episode_id and c.state='needs_attention')`,
        key,
        rawBefore,
      );
      await transaction.runAsync(
        `delete from health_samples where owner_key=? and updated_at<? and ${unprotected}`,
        key,
        provenanceBefore,
      );
      await transaction.runAsync(
        `delete from health_deliveries where owner_key=? and state='acknowledged' and acknowledged_at<?
      and not exists(select 1 from health_source_corrections c where c.owner_key=health_deliveries.owner_key and c.episode_id=health_deliveries.episode_id and c.state='needs_attention')`,
        key,
        provenanceBefore,
      );
      await transaction.runAsync(
        "delete from health_query_runs where owner_key=? and finished_at<?",
        key,
        provenanceBefore,
      );
      await transaction.runAsync(
        "delete from health_source_corrections where owner_key=? and state!='needs_attention' and resolved_at<?",
        key,
        provenanceBefore,
      );
      await transaction.runAsync(
        `delete from health_episodes where owner_key=? and updated_at<?
      and not exists(select 1 from health_deliveries d where d.owner_key=health_episodes.owner_key and d.episode_id=health_episodes.episode_id)
      and not exists(select 1 from health_source_corrections c where c.owner_key=health_episodes.owner_key and c.episode_id=health_episodes.episode_id and c.state='needs_attention')`,
        key,
        provenanceBefore,
      );
    }),
  );
}
