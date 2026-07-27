import { createHash } from "node:crypto";
import {
  ReviewMutationEnvelopeSchema,
  type ReviewMutation,
  type ReviewMutationEdit
} from "@dayframe/shared";
import type pg from "pg";
import { isLockNotAvailableError, pool } from "./db";
import {
  ReviewResolutionError,
  type ReviewResolutionResult
} from "./event-service";
import {
  resolveLocationReviewActionWithClient
} from "./location/location-review-service";
import type { RequestSession } from "./session";
import { syncTimeEntryTags } from "./tag-service";

type ReceiptRow = {
  reviewItemId: string;
  actionKey: string;
  requestHash: string;
  resultJson: unknown;
};

type GenericReviewRow = {
  id: string;
  eventId: string | null;
  title: string;
  status: string;
  suggestedCategoryId: string | null;
  suggestedPlaceId: string | null;
  suggestedStartedAt: Date | string | null;
  suggestedStoppedAt: Date | string | null;
  confidence: string;
  eventSource: string | null;
  locationSegmentId: string | null;
};

export async function resolveIdempotentReviewMutation(
  reviewItemId: string,
  input: unknown,
  session: RequestSession
) {
  const envelope = ReviewMutationEnvelopeSchema.parse(input);
  const requestHash = mutationHash(envelope.mutation);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [
        `${session.workspaceId}:${session.userId}`,
        envelope.clientMutationId
      ]
    );
    const existing = await loadReceipt(client, envelope.clientMutationId, session);
    if (existing) {
      if (
        existing.requestHash !== requestHash ||
        existing.reviewItemId !== reviewItemId ||
        existing.actionKey !== envelope.mutation.action
      ) {
        throw new ReviewResolutionError(
          "mutation_id_conflict",
          "This client mutation ID is already used for different Review data.",
          {
            status: 409,
            details: {
              reviewItemId,
              canonicalStatus: "unknown"
            }
          }
        );
      }
      await client.query("commit");
      return existing.resultJson;
    }

    const locationItem = await isLocationReview(client, reviewItemId, session);
    const result = locationItem
      ? await resolveLocationMutation(
          client,
          reviewItemId,
          envelope.mutation,
          session
        )
      : await resolveGenericMutation(
          client,
          reviewItemId,
          envelope.mutation,
          session
        );
    await client.query(
      `insert into review_mutation_receipts (
         workspace_id,
         user_id,
         client_mutation_id,
         review_item_id,
         action_key,
         request_hash,
         result_json
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        session.workspaceId,
        session.userId,
        envelope.clientMutationId,
        reviewItemId,
        envelope.mutation.action,
        requestHash,
        JSON.stringify(result)
      ]
    );
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    if (isLockNotAvailableError(error)) {
      throw new ReviewResolutionError(
        "review_item_locked",
        "This Review item is already being updated. Try again in a moment.",
        {
          status: 409,
          details: {
            reviewItemId,
            canonicalStatus: "open"
          }
        }
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

async function loadReceipt(
  client: pg.PoolClient,
  clientMutationId: string,
  session: RequestSession
) {
  const result = await client.query<ReceiptRow>(
    `select review_item_id as "reviewItemId",
            action_key as "actionKey",
            request_hash as "requestHash",
            result_json as "resultJson"
     from review_mutation_receipts
     where workspace_id = $1
       and user_id = $2
       and client_mutation_id = $3`,
    [session.workspaceId, session.userId, clientMutationId]
  );
  return result.rows[0] ?? null;
}

async function isLocationReview(
  client: pg.PoolClient,
  reviewItemId: string,
  session: RequestSession
) {
  const result = await client.query<{ locationSegmentId: string | null }>(
    `select location_segment_id as "locationSegmentId"
     from review_items
     where id = $1 and workspace_id = $2 and user_id = $3`,
    [reviewItemId, session.workspaceId, session.userId]
  );
  if (!result.rows[0]) {
    throw new ReviewResolutionError(
      "review_item_not_found",
      "Review item not found.",
      {
        status: 404,
        details: {
          reviewItemId,
          canonicalStatus: "unknown"
        }
      }
    );
  }
  return Boolean(result.rows[0].locationSegmentId);
}

async function resolveLocationMutation(
  client: pg.PoolClient,
  reviewItemId: string,
  mutation: ReviewMutation,
  session: RequestSession
) {
  if (
    mutation.action !== "confirm" &&
    mutation.action !== "ignore_once_location" &&
    mutation.action !== "edit_and_confirm"
  ) {
    throw new ReviewResolutionError(
      "invalid_action",
      "Use a location Review action for this suggestion.",
      {
        status: 422,
        details: {
          reviewItemId,
          canonicalStatus: "open"
        }
      }
    );
  }
  return resolveLocationReviewActionWithClient(
    client,
    reviewItemId,
    mutation,
    session
  );
}

async function resolveGenericMutation(
  client: pg.PoolClient,
  reviewItemId: string,
  mutation: ReviewMutation,
  session: RequestSession
) {
  if (
    mutation.action !== "accept" &&
    mutation.action !== "ignore_once" &&
    mutation.action !== "edit_and_confirm"
  ) {
    throw new ReviewResolutionError(
      "invalid_action",
      "Use a standard Review action for this suggestion.",
      {
        status: 422,
        details: {
          reviewItemId,
          canonicalStatus: "open"
        }
      }
    );
  }
  const item = await lockGenericReview(client, reviewItemId, session);
  if (item.status !== "open") {
    return resolveClosedGenericReview(client, item, mutation, session);
  }
  if (mutation.action === "ignore_once") {
    await resolveGenericReviewAndEvent(client, item, session, "ignored");
    return {
      ok: true,
      action: mutation.action,
      status: "ignored"
    };
  }
  if (mutation.action === "edit_and_confirm") {
    return editAndConfirmGenericReview(
      client,
      item,
      mutation.edit,
      session
    );
  }
  return acceptGenericReview(client, item, session);
}

async function lockGenericReview(
  client: pg.PoolClient,
  reviewItemId: string,
  session: RequestSession
) {
  const result = await client.query<GenericReviewRow>(
    `select ri.id,
            ri.event_id as "eventId",
            ri.title,
            ri.status,
            ri.suggested_category_id as "suggestedCategoryId",
            ri.suggested_place_id as "suggestedPlaceId",
            ri.suggested_started_at as "suggestedStartedAt",
            ri.suggested_stopped_at as "suggestedStoppedAt",
            ri.confidence,
            ae.source as "eventSource",
            ri.location_segment_id as "locationSegmentId"
     from review_items ri
     left join activity_events ae
       on ae.id = ri.event_id
      and ae.workspace_id = ri.workspace_id
      and ae.user_id = ri.user_id
     where ri.id = $1 and ri.workspace_id = $2 and ri.user_id = $3
     for update of ri nowait`,
    [reviewItemId, session.workspaceId, session.userId]
  );
  const item = result.rows[0];
  if (!item) {
    throw new ReviewResolutionError(
      "review_item_not_found",
      "Review item not found.",
      {
        status: 404,
        details: {
          reviewItemId,
          canonicalStatus: "unknown"
        }
      }
    );
  }
  if (item.locationSegmentId) {
    throw new ReviewResolutionError(
      "invalid_action",
      "Use a location Review action for this suggestion.",
      {
        status: 422,
        details: {
          reviewItemId,
          canonicalStatus: item.status
        }
      }
    );
  }
  return item;
}

async function acceptGenericReview(
  client: pg.PoolClient,
  item: GenericReviewRow,
  session: RequestSession
): Promise<ReviewResolutionResult> {
  const window = validWindow(item.suggestedStartedAt, item.suggestedStoppedAt);
  if (!window) {
    throw new ReviewResolutionError(
      "invalid_time_window",
      "This Review item is missing a valid start and end time.",
      {
        status: 422,
        details: {
          reviewItemId: item.id,
          canonicalStatus: "open"
        }
      }
    );
  }
  const existing = item.eventId
    ? await entryCreatedFromEvent(client, item.eventId, session)
    : null;
  if (
    existing &&
    !await genericEditMatchesExisting(
      client,
      existing.id,
      genericAcceptEdit(item, window),
      item,
      session
    )
  ) {
    throw resolutionConflict(item.id, item.status);
  }
  let entryId = existing?.id;
  if (!entryId) {
    const inserted = await client.query<{ id: string }>(
      `insert into time_entries (
         workspace_id, user_id, category_id, place_id, source, confidence,
         review_status, description, started_at, stopped_at, created_from_event_id
       ) values ($1, $2, $3, $4, coalesce($5, 'manual_app'), $6, 'confirmed',
         $7, $8, $9, $10)
       returning id`,
      [
        session.workspaceId,
        session.userId,
        item.suggestedCategoryId,
        item.suggestedPlaceId,
        item.eventSource,
        item.confidence,
        item.title,
        window.startedAt,
        window.stoppedAt,
        item.eventId
      ]
    );
    entryId = inserted.rows[0]?.id;
  }
  await resolveGenericReviewAndEvent(client, item, session, "accepted");
  return {
    ok: true,
    action: "accept",
    status: "accepted",
    entryId,
    duplicate: Boolean(existing)
  };
}

async function editAndConfirmGenericReview(
  client: pg.PoolClient,
  item: GenericReviewRow,
  edit: ReviewMutationEdit,
  session: RequestSession
) {
  await validateEditReferences(client, edit, session, item.id);
  await validateNoOverlap(client, edit, session, item);
  const existing = item.eventId
    ? await entryCreatedFromEvent(client, item.eventId, session)
    : null;
  if (existing) {
    if (
      await genericEditMatchesExisting(
        client,
        existing.id,
        edit,
        item,
        session
      )
    ) {
      await resolveGenericReviewAndEvent(client, item, session, "accepted");
      return {
        ok: true,
        action: "edit_and_confirm",
        status: "accepted",
        entryId: existing.id,
        duplicate: true,
        equivalent: true
      };
    }
    throw resolutionConflict(item.id, item.status);
  }
  const inserted = await client.query<{ id: string }>(
    `insert into time_entries (
       workspace_id, user_id, category_id, place_id, source, confidence,
       review_status, description, started_at, stopped_at, created_from_event_id
     ) values ($1, $2, $3, $4, 'manual_app', 'high', 'confirmed',
       $5, $6, $7, $8)
     returning id`,
    [
      session.workspaceId,
      session.userId,
      explicitNullable(edit, "categoryId", item.suggestedCategoryId),
      explicitNullable(edit, "placeId", item.suggestedPlaceId),
      edit.description?.trim() || null,
      edit.startedAt,
      edit.stoppedAt,
      item.eventId
    ]
  );
  const entryId = inserted.rows[0].id;
  await syncTimeEntryTags(client, entryId, edit.tags ?? [], session);
  await resolveGenericReviewAndEvent(client, item, session, "accepted");
  return {
    ok: true,
    action: "edit_and_confirm",
    status: "accepted",
    entryId
  };
}

async function resolveClosedGenericReview(
  client: pg.PoolClient,
  item: GenericReviewRow,
  mutation: Extract<
    ReviewMutation,
    { action: "accept" | "ignore_once" | "edit_and_confirm" }
  >,
  session: RequestSession
) {
  const equivalent =
    (
      mutation.action === "accept" &&
      item.status === "accepted" &&
      await genericAcceptMatchesExisting(client, item, session)
    ) ||
    (mutation.action === "ignore_once" && item.status === "ignored") ||
    (
      mutation.action === "edit_and_confirm" &&
      item.status === "accepted" &&
      Boolean(
        item.eventId &&
        await entryCreatedFromEvent(client, item.eventId, session)
          .then((entry) =>
            entry
              ? genericEditMatchesExisting(
                  client,
                  entry.id,
                  mutation.edit,
                  item,
                  session
                )
              : false
          )
      )
    );
  if (!equivalent) throw resolutionConflict(item.id, item.status);
  return {
    ok: true,
    action: mutation.action,
    status: item.status === "ignored" ? "ignored" : "accepted",
    alreadyResolved: true,
    equivalent: true
  };
}

async function genericAcceptMatchesExisting(
  client: pg.PoolClient,
  item: GenericReviewRow,
  session: RequestSession
) {
  const window = validWindow(item.suggestedStartedAt, item.suggestedStoppedAt);
  if (!window || !item.eventId) return false;
  const entry = await entryCreatedFromEvent(client, item.eventId, session);
  if (!entry) return false;
  return genericEditMatchesExisting(
    client,
    entry.id,
    genericAcceptEdit(item, window),
    item,
    session
  );
}

function genericAcceptEdit(
  item: GenericReviewRow,
  window: { startedAt: string; stoppedAt: string }
): ReviewMutationEdit {
  return {
    categoryId: item.suggestedCategoryId,
    placeId: item.suggestedPlaceId,
    description: item.title,
    startedAt: window.startedAt,
    stoppedAt: window.stoppedAt,
    tags: []
  };
}

async function resolveGenericReviewAndEvent(
  client: pg.PoolClient,
  item: GenericReviewRow,
  session: RequestSession,
  status: "accepted" | "ignored"
) {
  await client.query(
    `update review_items
     set status = $4,
         ignored_scope = case when $4 = 'ignored' then 'once' else null end,
         resolved_at = now()
     where id = $1 and workspace_id = $2 and user_id = $3`,
    [item.id, session.workspaceId, session.userId, status]
  );
  if (item.eventId) {
    await client.query(
      `update activity_events
       set review_status = $4
       where id = $1 and workspace_id = $2 and user_id = $3`,
      [
        item.eventId,
        session.workspaceId,
        session.userId,
        status === "accepted" ? "confirmed" : "ignored"
      ]
    );
  }
}

async function validateEditReferences(
  client: pg.PoolClient,
  edit: ReviewMutationEdit,
  session: RequestSession,
  reviewItemId: string
) {
  if (edit.categoryId) {
    const category = await client.query(
      `select 1 from categories
       where id = $1 and workspace_id = $2 and is_archived = false`,
      [edit.categoryId, session.workspaceId]
    );
    if (!category.rows[0]) {
      throw new ReviewResolutionError(
        "invalid_category",
        "The selected category is no longer available.",
        {
          status: 422,
          details: {
            reviewItemId,
            canonicalStatus: "open"
          }
        }
      );
    }
  }
  if (edit.placeId) {
    const place = await client.query(
      `select 1 from places where id = $1 and workspace_id = $2`,
      [edit.placeId, session.workspaceId]
    );
    if (!place.rows[0]) {
      throw new ReviewResolutionError(
        "invalid_action",
        "The selected place is no longer available.",
        {
          status: 422,
          details: {
            reviewItemId,
            canonicalStatus: "open"
          }
        }
      );
    }
  }
}

async function validateNoOverlap(
  client: pg.PoolClient,
  edit: ReviewMutationEdit,
  session: RequestSession,
  item: GenericReviewRow
) {
  const overlap = await client.query<{ id: string }>(
    `select id
     from time_entries
     where workspace_id = $1
       and user_id = $2
       and started_at < $4::timestamptz
       and coalesce(stopped_at, 'infinity'::timestamptz) > $3::timestamptz
       and ($5::uuid is null or created_from_event_id is distinct from $5::uuid)
     limit 1`,
    [
      session.workspaceId,
      session.userId,
      edit.startedAt,
      edit.stoppedAt,
      item.eventId
    ]
  );
  if (overlap.rows[0]) {
    throw new ReviewResolutionError(
      "overlap",
      "The corrected time overlaps an existing confirmed entry.",
      {
        status: 409,
        details: {
          reviewItemId: item.id,
          canonicalStatus: "open"
        }
      }
    );
  }
}

async function entryCreatedFromEvent(
  client: pg.PoolClient,
  eventId: string,
  session: RequestSession
) {
  const result = await client.query<{ id: string }>(
    `select id
     from time_entries
     where workspace_id = $1 and user_id = $2 and created_from_event_id = $3
     limit 1`,
    [session.workspaceId, session.userId, eventId]
  );
  return result.rows[0] ?? null;
}

async function genericEditMatchesExisting(
  client: pg.PoolClient,
  entryId: string,
  edit: ReviewMutationEdit,
  item: GenericReviewRow,
  session: RequestSession
) {
  const result = await client.query<{
    categoryId: string | null;
    placeId: string | null;
    description: string | null;
    startedAt: Date | string;
    stoppedAt: Date | string;
  }>(
    `select category_id as "categoryId",
            place_id as "placeId",
            description,
            started_at as "startedAt",
            stopped_at as "stoppedAt"
     from time_entries
     where id = $1 and workspace_id = $2 and user_id = $3`,
    [entryId, session.workspaceId, session.userId]
  );
  const entry = result.rows[0];
  if (!entry) return false;
  if (
    entry.categoryId !== explicitNullable(
      edit,
      "categoryId",
      item.suggestedCategoryId
    ) ||
    entry.placeId !== explicitNullable(
      edit,
      "placeId",
      item.suggestedPlaceId
    ) ||
    (entry.description ?? "") !== (edit.description?.trim() ?? "") ||
    new Date(entry.startedAt).toISOString() !== new Date(edit.startedAt).toISOString() ||
    new Date(entry.stoppedAt).toISOString() !== new Date(edit.stoppedAt).toISOString()
  ) {
    return false;
  }
  const tags = await client.query<{ name: string }>(
    `select tag.name
     from time_entry_tags link
     join tags tag on tag.id = link.tag_id and tag.workspace_id = link.workspace_id
     where link.workspace_id = $1 and link.time_entry_id = $2
     order by tag.normalized_name`,
    [session.workspaceId, entryId]
  );
  return sameTags(tags.rows.map((tag) => tag.name), edit.tags ?? []);
}

function resolutionConflict(reviewItemId: string, canonicalStatus: string) {
  return new ReviewResolutionError(
    "resolution_conflict",
    "This Review item was resolved differently on another device.",
    {
      status: 409,
      details: {
        reviewItemId,
        canonicalStatus
      }
    }
  );
}

function validWindow(
  startedAt: Date | string | null,
  stoppedAt: Date | string | null
) {
  if (!startedAt || !stoppedAt) return null;
  const started = new Date(startedAt);
  const stopped = new Date(stoppedAt);
  if (
    Number.isNaN(started.getTime()) ||
    Number.isNaN(stopped.getTime()) ||
    stopped <= started
  ) {
    return null;
  }
  return {
    startedAt: started.toISOString(),
    stoppedAt: stopped.toISOString()
  };
}

function explicitNullable<
  T extends { categoryId?: string | null; placeId?: string | null }
>(
  input: T,
  key: "categoryId" | "placeId",
  fallback: string | null
) {
  return Object.prototype.hasOwnProperty.call(input, key)
    ? input[key] ?? null
    : fallback;
}

function mutationHash(mutation: ReviewMutation) {
  return createHash("sha256")
    .update(JSON.stringify(sortJsonValue(mutation)))
    .digest("hex");
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonValue(item)])
  );
}

function sameTags(left: string[], right: string[]) {
  const normalise = (tags: string[]) =>
    tags.map((tag) => tag.trim().toLowerCase()).sort();
  return JSON.stringify(normalise(left)) === JSON.stringify(normalise(right));
}
