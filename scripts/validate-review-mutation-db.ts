import assert from "node:assert/strict";
import { pool } from "../apps/web/src/lib/db";
import { resolveIdempotentReviewMutation } from "../apps/web/src/lib/review-mutation-service";
import type { RequestSession } from "../apps/web/src/lib/session";

const databaseUrl = process.env.DATABASE_URL;
assert(databaseUrl, "DATABASE_URL is required.");
const parsedDatabaseUrl = new URL(databaseUrl);
assert(
  ["localhost", "127.0.0.1"].includes(parsedDatabaseUrl.hostname) &&
    parsedDatabaseUrl.pathname.endsWith("_test"),
  "Refusing to run Review mutation validation outside a disposable local *_test database."
);

const WORKSPACE_ID = "51000000-0000-4000-8000-000000000001";
const USER_ID = "51000000-0000-4000-8000-000000000002";
const OTHER_USER_ID = "51000000-0000-4000-8000-000000000003";
const CATEGORY_ID = "51000000-0000-4000-8000-000000000004";
const INVALID_CATEGORY_ID = "51000000-0000-4000-8000-000000000099";
const session: RequestSession = {
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  authMode: "token",
  scopes: ["app:read", "app:write", "events:write"]
};
const otherSession: RequestSession = {
  ...session,
  userId: OTHER_USER_ID
};

async function seed() {
  await pool.query("delete from workspaces where id = $1", [WORKSPACE_ID]);
  await pool.query(
    `insert into users (id, email, name) values
       ($1, 'review-validation@example.test', 'Review Validation'),
       ($2, 'review-validation-other@example.test', 'Review Validation Other')`,
    [USER_ID, OTHER_USER_ID]
  );
  await pool.query(
    "insert into workspaces (id, name) values ($1, 'Review Validation')",
    [WORKSPACE_ID]
  );
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values
       ($1, $2, 'owner'),
       ($1, $3, 'member')`,
    [WORKSPACE_ID, USER_ID, OTHER_USER_ID]
  );
  await pool.query(
    `insert into categories (id, workspace_id, name, color)
     values ($1, $2, 'Exercise', 'moss')`,
    [CATEGORY_ID, WORKSPACE_ID]
  );
}

async function createReview(
  userId: string,
  idSuffix: number,
  startedAt: string,
  stoppedAt: string
) {
  const event = await pool.query<{ id: string }>(
    `insert into activity_events (
       workspace_id, user_id, source, event_type, occurred_at, confidence,
       raw_payload, suggested_category_id, review_status
     ) values ($1, $2, 'health_workout', 'health_workout_import', $3,
       'high', '{}'::jsonb, $4, 'needs_review')
     returning id`,
    [WORKSPACE_ID, userId, startedAt, CATEGORY_ID]
  );
  const reviewId = `51000000-0000-4000-8000-${idSuffix
    .toString()
    .padStart(12, "0")}`;
  await pool.query(
    `insert into review_items (
       id, workspace_id, user_id, event_id, type, title,
       suggested_category_id, suggested_started_at, suggested_stopped_at,
       confidence, status
     ) values ($1, $2, $3, $4, 'health', 'Workout', $5, $6, $7, 'high', 'open')`,
    [
      reviewId,
      WORKSPACE_ID,
      userId,
      event.rows[0].id,
      CATEGORY_ID,
      startedAt,
      stoppedAt
    ]
  );
  return reviewId;
}

async function countRows(table: string, userId = USER_ID) {
  assert(/^[a-z_]+$/.test(table));
  const result = await pool.query<{ count: number }>(
    `select count(*)::integer as count
     from ${table}
     where workspace_id = $1 and user_id = $2`,
    [WORKSPACE_ID, userId]
  );
  return result.rows[0].count;
}

async function run() {
  await seed();
  const reviewId = await createReview(
    USER_ID,
    10,
    "2026-07-27T08:00:00.000Z",
    "2026-07-27T09:00:00.000Z"
  );
  const envelope = {
    clientMutationId: "51000000-0000-4000-8000-000000000020",
    mutation: {
      action: "edit_and_confirm" as const,
      edit: {
        categoryId: CATEGORY_ID,
        description: "Morning walk",
        startedAt: "2026-07-27T08:05:00.000Z",
        stoppedAt: "2026-07-27T08:55:00.000Z",
        tags: ["outdoors"]
      }
    }
  };

  const first = await resolveIdempotentReviewMutation(reviewId, envelope, session);
  assert.equal(first.status, "accepted");
  assert.equal(await countRows("time_entries"), 1);
  assert.equal(await countRows("review_mutation_receipts"), 1);
  const saved = await pool.query<{
    description: string;
    status: string;
    tagName: string;
  }>(
    `select te.description,
            ri.status,
            tag.name as "tagName"
     from time_entries te
     join review_items ri
       on ri.event_id = te.created_from_event_id
      and ri.workspace_id = te.workspace_id
      and ri.user_id = te.user_id
     join time_entry_tags link
       on link.time_entry_id = te.id
      and link.workspace_id = te.workspace_id
     join tags tag
       on tag.id = link.tag_id
      and tag.workspace_id = link.workspace_id
     where te.workspace_id = $1 and te.user_id = $2`,
    [WORKSPACE_ID, USER_ID]
  );
  assert.deepEqual(saved.rows[0], {
    description: "Morning walk",
    status: "accepted",
    tagName: "outdoors"
  });

  const retry = await resolveIdempotentReviewMutation(reviewId, envelope, session);
  assert.deepEqual(retry, first, "Lost-response retry did not return the stored result.");
  assert.equal(await countRows("time_entries"), 1, "Retry created a duplicate entry.");
  assert.equal(await countRows("review_mutation_receipts"), 1, "Retry created a duplicate receipt.");

  const equivalent = await resolveIdempotentReviewMutation(
    reviewId,
    {
      ...envelope,
      clientMutationId: "51000000-0000-4000-8000-000000000022"
    },
    session
  );
  assert.equal(equivalent.equivalent, true);
  assert.equal(await countRows("time_entries"), 1);
  assert.equal(await countRows("review_mutation_receipts"), 2);

  await assert.rejects(
    () =>
      resolveIdempotentReviewMutation(
        reviewId,
        {
          clientMutationId: "51000000-0000-4000-8000-000000000023",
          mutation: { action: "ignore_once" }
        },
        session
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "resolution_conflict"
  );
  assert.equal(
    await countRows("review_mutation_receipts"),
    2,
    "A semantic conflict stored a receipt."
  );

  await assert.rejects(
    () =>
      resolveIdempotentReviewMutation(
        reviewId,
        {
          ...envelope,
          mutation: { action: "ignore_once" }
        },
        session
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "mutation_id_conflict"
  );

  const concurrentSameReviewId = await createReview(
    USER_ID,
    13,
    "2026-07-27T14:00:00.000Z",
    "2026-07-27T15:00:00.000Z"
  );
  const concurrentSameEnvelope = {
    clientMutationId: "51000000-0000-4000-8000-000000000024",
    mutation: { action: "accept" as const }
  };
  const concurrentSame = await Promise.all([
    resolveIdempotentReviewMutation(
      concurrentSameReviewId,
      concurrentSameEnvelope,
      session
    ),
    resolveIdempotentReviewMutation(
      concurrentSameReviewId,
      concurrentSameEnvelope,
      session
    )
  ]);
  assert.deepEqual(
    concurrentSame[1],
    concurrentSame[0],
    "Concurrent receipt replay returned a different result."
  );
  assert.equal(await countRows("time_entries"), 2);
  assert.equal(
    await countRows("review_mutation_receipts"),
    3,
    "Concurrent identical mutations created duplicate receipts."
  );

  const concurrentDifferentReviewId = await createReview(
    USER_ID,
    14,
    "2026-07-27T16:00:00.000Z",
    "2026-07-27T17:00:00.000Z"
  );
  const concurrentDifferent = await Promise.allSettled([
    resolveIdempotentReviewMutation(
      concurrentDifferentReviewId,
      {
        clientMutationId: "51000000-0000-4000-8000-000000000025",
        mutation: { action: "accept" }
      },
      session
    ),
    resolveIdempotentReviewMutation(
      concurrentDifferentReviewId,
      {
        clientMutationId: "51000000-0000-4000-8000-000000000026",
        mutation: { action: "ignore_once" }
      },
      session
    )
  ]);
  assert.equal(
    concurrentDifferent.filter((result) => result.status === "fulfilled").length,
    1,
    "Concurrent conflicting mutations did not choose one canonical winner."
  );
  const rejectedDifferent = concurrentDifferent.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  assert(
    rejectedDifferent &&
      rejectedDifferent.reason instanceof Error &&
      "code" in rejectedDifferent.reason &&
      ["review_item_locked", "resolution_conflict"].includes(
        String(rejectedDifferent.reason.code)
      ),
    "Concurrent conflicting mutation did not return a typed retry/conflict outcome."
  );
  assert.equal(
    await countRows("review_mutation_receipts"),
    4,
    "Concurrent conflicting mutations stored more than the winning receipt."
  );

  const rollbackReviewId = await createReview(
    USER_ID,
    11,
    "2026-07-27T10:00:00.000Z",
    "2026-07-27T11:00:00.000Z"
  );
  await assert.rejects(() =>
    resolveIdempotentReviewMutation(
      rollbackReviewId,
      {
        clientMutationId: "51000000-0000-4000-8000-000000000021",
        mutation: {
          action: "edit_and_confirm",
          edit: {
            categoryId: INVALID_CATEGORY_ID,
            startedAt: "2026-07-27T10:00:00.000Z",
            stoppedAt: "2026-07-27T11:00:00.000Z"
          }
        }
      },
      session
    )
  );
  const rollbackState = await pool.query<{ status: string; receiptCount: number }>(
    `select ri.status,
            (
              select count(*)::integer
              from review_mutation_receipts receipt
              where receipt.workspace_id = ri.workspace_id
                and receipt.user_id = ri.user_id
                and receipt.review_item_id = ri.id
            ) as "receiptCount"
     from review_items ri
     where ri.id = $1`,
    [rollbackReviewId]
  );
  assert.deepEqual(rollbackState.rows[0], {
    status: "open",
    receiptCount: 0
  });

  const otherReviewId = await createReview(
    OTHER_USER_ID,
    12,
    "2026-07-27T12:00:00.000Z",
    "2026-07-27T13:00:00.000Z"
  );
  await resolveIdempotentReviewMutation(
    otherReviewId,
    {
      clientMutationId: envelope.clientMutationId,
      mutation: { action: "ignore_once" }
    },
    otherSession
  );
  assert.equal(
    await countRows("review_mutation_receipts", OTHER_USER_ID),
    1,
    "Same mutation ID was not isolated by user."
  );

  console.log(
    "Review mutation database validation passed: atomic generic edit-and-confirm, tags, receipt/result commit, lost-response retry, equivalent/conflicting resolution, concurrent same/different mutations, duplicate prevention, payload conflict, rollback, workspace/user scoping."
  );
}

run()
  .finally(async () => {
    await pool.query("delete from workspaces where id = $1", [WORKSPACE_ID]);
    await pool.query("delete from users where id in ($1, $2)", [
      USER_ID,
      OTHER_USER_ID
    ]);
    await pool.end();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
