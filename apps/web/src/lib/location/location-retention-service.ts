import { pool } from "../db";

const RETENTION_BATCH_LIMIT = 10_000;
const RETENTION_MAX_BATCHES = 5;

export type LocationRetentionResult = {
  acquiredLock: boolean;
  deletedEvidenceCount: number;
  batches: number;
  backlogPossible: boolean;
};

export async function deleteExpiredLocationEvidence(): Promise<LocationRetentionResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const lock = await client.query<{ acquired: boolean }>(
      "select pg_try_advisory_xact_lock(hashtext('dayframe-location-retention-v2')) as acquired"
    );
    if (!lock.rows[0]?.acquired) {
      await client.query("commit");
      return { acquiredLock: false, deletedEvidenceCount: 0, batches: 0, backlogPossible: false };
    }
    let deletedEvidenceCount = 0;
    let batches = 0;
    let lastBatchCount = 0;
    do {
      const result = await client.query<{ deletedCount: string | number }>(
        `select public.dayframe_delete_expired_location_evidence() as "deletedCount"`
      );
      lastBatchCount = Number(result.rows[0]?.deletedCount ?? 0);
      deletedEvidenceCount += lastBatchCount;
      batches += 1;
    } while (lastBatchCount === RETENTION_BATCH_LIMIT && batches < RETENTION_MAX_BATCHES);
    await client.query("commit");
    return {
      acquiredLock: true,
      deletedEvidenceCount,
      batches,
      backlogPossible: lastBatchCount === RETENTION_BATCH_LIMIT
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
