import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool } from "./db";
import { processActivityEvent, resolveReviewItem } from "./event-service";

const runDatabaseIntegration = process.env.DAYFRAME_RUN_DB_INTEGRATION === "1";

// Stability audit health-6: a later accepted revision of the same Apple Health episode retires the
// earlier revision's still-open Review card in the same ingest transaction. Synthetic fixtures only.
describe.runIf(runDatabaseIntegration)("Health episode revisions supersede earlier open Review cards", () => {
  let userId: string;
  let workspaceId: string;
  let session: { authMode: "provider"; scopes: string[]; userId: string; workspaceId: string };
  const night = Date.parse("2026-09-02T22:00:00.000Z");
  const at = (minutes: number) => new Date(night + minutes * 60_000).toISOString();

  beforeEach(async () => {
    userId = randomUUID();
    workspaceId = randomUUID();
    session = { authMode: "provider", scopes: ["app:read", "app:write", "events:write"], userId, workspaceId };
    await pool.query(`insert into users (id, email, name) values ($1, $2, 'Health revision test')`,
      [userId, `dayframe-health-revision-${userId}@example.invalid`]);
    await pool.query(`insert into workspaces (id, name) values ($1, 'Health revision test')`, [workspaceId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id) values ($1, $2)`, [workspaceId, userId]);
  });

  afterEach(async () => {
    await pool.query("delete from workspaces where id = $1", [workspaceId]).catch(() => undefined);
    await pool.query("delete from users where id = $1", [userId]).catch(() => undefined);
  });

  afterAll(async () => {
    await pool.end();
  });

  // One grouped Sleep revision as the iPhone journal sends it: `logicalEpisodeId` is the episode,
  // `episodeRevision` the fingerprint of its source facts (#546).
  function sleep(episode: string, revision: string, samples: Array<[id: string, start: number, stop: number]>) {
    const startedAt = at(Math.min(...samples.map(([, start]) => start)));
    const stoppedAt = at(Math.max(...samples.map(([, , stop]) => stop)));
    return {
      source: "health_sleep",
      type: "health_sleep_import",
      clientEventId: `healthkit:sleep:${episode}:${revision}`,
      occurredAt: stoppedAt,
      description: "Sleep",
      rawPayload: {
        provider: "healthkit",
        sleepStage: "asleep_unspecified",
        sourceName: "Synthetic Watch",
        sourceBundleIdentifier: "test.synthetic.watch",
        externalSampleId: `health-revision-${revision}`,
        logicalEpisodeId: episode,
        episodeRevision: revision,
        sourceSampleIds: samples.map(([id]) => id),
        startedAt,
        stoppedAt,
        durationSeconds: (Date.parse(stoppedAt) - Date.parse(startedAt)) / 1000,
        autoConfirm: true,
        samples: samples.map(([id, start, stop]) => ({
          externalSampleId: id, sleepStage: "asleep_core", startedAt: at(start), stoppedAt: at(stop)
        }))
      }
    };
  }

  function walk(episode: string, revision: string, sampleId: string, start: number, stop: number) {
    return {
      source: "health_workout",
      type: "health_workout_import",
      clientEventId: `healthkit:workout:${episode}:${revision}`,
      occurredAt: at(stop),
      description: "Walk",
      rawPayload: {
        provider: "healthkit",
        workoutType: "walking",
        externalSampleId: sampleId,
        logicalEpisodeId: episode,
        episodeRevision: revision,
        sourceSampleIds: [sampleId],
        // Below the walking auto-log threshold, so each revision is a Review card.
        autoConfirm: false,
        startedAt: at(start),
        stoppedAt: at(stop),
        durationSeconds: (stop - start) * 60
      }
    };
  }

  async function card(eventId: string) {
    const result = await pool.query<{ id: string; status: string; ignoredScope: string | null; resolvedAt: Date | null;
      eventReviewStatus: string }>(
      `select ri.id, ri.status, ri.ignored_scope as "ignoredScope", ri.resolved_at as "resolvedAt",
              ae.review_status as "eventReviewStatus"
       from review_items ri join activity_events ae on ae.id = ri.event_id
       where ri.event_id = $1`,
      [eventId]
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0];
  }

  async function openCards() {
    const result = await pool.query<{ eventId: string }>(
      `select event_id as "eventId" from review_items where workspace_id = $1 and user_id = $2 and status = 'open'
       order by created_at, id`,
      [workspaceId, userId]
    );
    return result.rows.map((row) => row.eventId);
  }

  async function entryCount() {
    const result = await pool.query<{ n: number }>(
      "select count(*)::int as n from time_entries where workspace_id = $1 and user_id = $2", [workspaceId, userId]);
    return result.rows[0].n;
  }

  it("a full night accepted after a short first chunk retires the chunk's open card", async () => {
    const first = await processActivityEvent(sleep("episode-a", "r1", [["s1", 0, 90]]), session);
    expect(first.reviewItemId).toBeTruthy();
    expect(await openCards()).toEqual([first.eventId]);

    const second = await processActivityEvent(sleep("episode-a", "r2", [["s1", 0, 90], ["s2", 90, 420]]), session);
    expect(second.timeEntryId).toBeTruthy();
    expect(await entryCount()).toBe(1);
    expect(await openCards()).toEqual([]);
    const retired = await card(first.eventId);
    // Retired by the server, not a person's Dismiss: marked superseded, and the event keeps its
    // undecided status so a later revision never reads it as an ignore decision.
    expect(retired).toMatchObject({ status: "ignored", ignoredScope: "superseded", eventReviewStatus: "needs_review" });
    expect(retired.resolvedAt).toBeInstanceOf(Date);

    // A third revision still logs normally into the same night.
    const third = await processActivityEvent(
      sleep("episode-a", "r3", [["s1", 0, 90], ["s2", 90, 420], ["s3", 420, 450]]), session);
    expect(third.timeEntryId).toBe(second.timeEntryId);
    expect(await entryCount()).toBe(1);
    expect(await openCards()).toEqual([]);
  });

  it("a changed walk that is still a card leaves exactly one card, the newest", async () => {
    const first = await processActivityEvent(walk("walk-1", "r1", "workout-1", 600, 603), session);
    const second = await processActivityEvent(walk("walk-1", "r2", "workout-1", 600, 604), session);
    expect(second.reviewItemId).toBeTruthy();
    expect(await openCards()).toEqual([second.eventId]);
    expect(await card(first.eventId)).toMatchObject({ status: "ignored", ignoredScope: "superseded" });
  });

  it("a nap regrouped into the night retires the nap's card", async () => {
    // The nap and the night were separate episodes; the merged revision keeps the night's episode
    // identity and carries every nap sample, so the nap card describes time it now covers.
    const nap = await processActivityEvent(sleep("episode-nap", "r1", [["n1", -150, -90]]), session);
    const nightFirst = await processActivityEvent(sleep("episode-night", "r1", [["s1", 0, 420]]), session);
    expect(nightFirst.timeEntryId).toBeTruthy();
    expect(await openCards()).toEqual([nap.eventId]);

    const merged = await processActivityEvent(
      sleep("episode-night", "r2", [["n1", -150, -90], ["s1", 0, 420]]), session);
    expect(merged.timeEntryId).toBe(nightFirst.timeEntryId);
    expect(await openCards()).toEqual([]);
    expect(await card(nap.eventId)).toMatchObject({ status: "ignored", ignoredScope: "superseded" });
  });

  it("never changes a card the person already acted on", async () => {
    const first = await processActivityEvent(walk("walk-2", "r1", "workout-2", 600, 603), session);
    const before = await card(first.eventId);
    await resolveReviewItem(before.id, "accept", session);
    const accepted = await card(first.eventId);
    expect(accepted.status).toBe("accepted");

    await processActivityEvent(walk("walk-2", "r2", "workout-2", 600, 604), session);
    const after = await card(first.eventId);
    expect(after).toMatchObject({ status: "accepted", ignoredScope: null });
    expect(after.resolvedAt?.toISOString()).toBe(accepted.resolvedAt?.toISOString());
  });

  it("never closes a card for a different episode", async () => {
    // Another source episode the same evening: different identity, its own samples.
    const other = await processActivityEvent(sleep("episode-b", "r1", [["b1", 30, 100]]), session);
    // A different episode that shares one sample but is not wholly covered stays too.
    const partial = await processActivityEvent(sleep("episode-c", "r1", [["c1", 200, 230], ["shared", 230, 250]]), session);
    const first = await processActivityEvent(sleep("episode-a", "r1", [["s1", 0, 60]]), session);
    expect(await openCards()).toEqual([other.eventId, partial.eventId, first.eventId]);

    await processActivityEvent(sleep("episode-a", "r2", [["s1", 0, 60], ["s2", 60, 420], ["shared", 230, 250]]), session);
    expect(await openCards()).toEqual([other.eventId, partial.eventId]);
    expect(await card(first.eventId)).toMatchObject({ status: "ignored", ignoredScope: "superseded" });
  });

  it("an idempotent redelivery of either revision reopens nothing", async () => {
    const r1 = sleep("episode-a", "r1", [["s1", 0, 90]]);
    const r2 = sleep("episode-a", "r2", [["s1", 0, 90], ["s2", 90, 420]]);
    const first = await processActivityEvent(r1, session);
    const second = await processActivityEvent(r2, session);
    const retired = await card(first.eventId);

    const again = await processActivityEvent(r2, session);
    expect(again).toMatchObject({ duplicate: true, eventId: second.eventId, timeEntryId: second.timeEntryId });
    const firstAgain = await processActivityEvent(r1, session);
    expect(firstAgain).toMatchObject({ duplicate: true, eventId: first.eventId });

    expect(await openCards()).toEqual([]);
    expect(await entryCount()).toBe(1);
    const still = await card(first.eventId);
    expect(still).toMatchObject({ status: "ignored", ignoredScope: "superseded" });
    expect(still.resolvedAt?.toISOString()).toBe(retired.resolvedAt?.toISOString());
  });
});
