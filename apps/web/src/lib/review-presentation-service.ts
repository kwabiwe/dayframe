import { createHash } from "node:crypto";
import {
  REVIEW_PRESENTATION_MAX_IDS,
  REVIEW_PRESENTATION_VERSION,
  ReviewPresentationResponseSchema,
  type CompletedTodayEntryPresentation,
  type LegacyReviewEntryPresentation,
  type ReviewPresentationRecord,
  type ReviewPresentationRequest,
  type ReviewPresentationResponse,
  type ReviewProposalPresentation
} from "@dayframe/shared";
import type pg from "pg";
import { withSyncTransaction, type SyncTransactionOptions } from "./sync-transaction";
import { canonicalJson, isoOrNull, reviewProposalHash } from "./review-proposal-hash";
import type { RequestSession } from "./session";

const COLLECTION_LIMIT = 5_000;
const SQL_COLLECTION_LIMIT = COLLECTION_LIMIT + 1;

type ReviewRow = {
  id: string;
  eventId: string | null;
  locationSegmentId: string | null;
  type: string;
  title: string;
  status: "open" | "accepted" | "ignored";
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  placeId: string | null;
  placeLabel: string | null;
  startedAt: Date | string | null;
  stoppedAt: Date | string | null;
  confidence: string;
  createdAt: Date | string;
  semanticRevision: Date | string | null;
  eventSource: string | null;
  eventType: string | null;
  canonicalEntryIds: string[] | null;
};

type LegacyRow = {
  id: string;
  eventId: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  clientName: string | null;
  title: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  placeId: string | null;
  placeLabel: string | null;
  startedAt: Date | string | null;
  stoppedAt: Date | string | null;
  confidence: string;
  updatedAt: Date | string;
  source: string;
  description: string | null;
  placeKind: "saved" | "one_time" | null;
  durationSeconds: number | string;
  tagNames: string[] | null;
  linkedReviewItemId: string | null;
};

type EntryRow = {
  id: string;
  eventId: string | null;
  title: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  placeId: string | null;
  placeLabel: string | null;
  startedAt: Date | string;
  stoppedAt: Date | string;
  confidence: string;
  reviewStatus: "confirmed" | "accepted";
  updatedAt: Date | string;
  source: string;
};

type LookupEntryRow = EntryRow | LegacyRow;

type CountsRow = {
  globalCount: number | string;
  todayCount: number | string;
  openReviewItemIds: string[] | null;
};

type InternalRecord = {
  record: ReviewPresentationRecord;
  sortAt: string;
  sortKind: "completed_entry" | "legacy_review_entry" | "review";
  recordId: string;
};

type Cursor = {
  version: 1;
  scope: string;
  snapshot: string;
  sortAt: string;
  sortKind: InternalRecord["sortKind"];
  recordId: string;
};

export class ReviewPresentationError extends Error {
  constructor(
    readonly code: "invalid_cursor" | "snapshot_changed" | "presentation_unavailable",
    message: string,
    readonly status = code === "snapshot_changed" ? 409 : 400
  ) {
    super(message);
    this.name = "ReviewPresentationError";
  }
}

/**
 * A bounded, read-only projection for Today and Review. It intentionally does
 * not reuse bootstrap's capped arrays: the response carries the coverage and
 * identity evidence required to materialise a saved Review action honestly.
 */
export async function getReviewPresentation(
  session: RequestSession,
  input: ReviewPresentationRequest,
  options: SyncTransactionOptions = {}
): Promise<ReviewPresentationResponse> {
  const capturedAt = new Date().toISOString();
  const deadlineAt = options.deadlineAt ?? Date.now() + 8_000;
  return withSyncTransaction("review_presentation", async ({ client, phase }) => {
    phase("canonical_read");
    // Multiple bounded reads need one snapshot; no row locks or advisory locks
    // are acquired for presentation.
    await client.query("set transaction isolation level repeatable read");

    const [counts, reviewRows, legacyRows, entryRows, lookup] = await Promise.all([
      loadCounts(client, session, input),
      input.mode === "lookup" ? Promise.resolve([]) : loadReviewRows(client, session, input),
      input.mode === "lookup" ? Promise.resolve([]) : loadLegacyRows(client, session, input),
      input.mode === "window" ? loadCompletedTodayRows(client, session, input) : Promise.resolve([]),
      input.mode === "lookup" ? loadLookupRows(client, session, input) : Promise.resolve({ reviews: [], entries: [] })
    ]);

    const allRecords = [
      ...reviewRows.map(toReviewRecord),
      ...legacyRows.map(toLegacyRecord),
      ...entryRows.map(toCompletedEntryRecord)
    ].sort(compareRecords);
    const boundedCollection = allRecords.length > COLLECTION_LIMIT;
    const collection = boundedCollection ? allRecords.slice(0, COLLECTION_LIMIT) : allRecords;
    const scope = scopeFor(input);
    const snapshotToken = snapshotFor(scope, counts, collection, lookup);
    const cursor = input.cursor ? parseCursor(input.cursor) : null;
    if (cursor && (cursor.scope !== scope || cursor.snapshot !== snapshotToken)) {
      throw new ReviewPresentationError(
        "snapshot_changed",
        "Review changed while this page was loading. Refresh the current view."
      );
    }
    const page = pageAfter(collection, cursor, input.limit);
    const next = !boundedCollection && page.hasMore
      ? encodeCursor({
          version: 1,
          scope,
          snapshot: snapshotToken,
          sortAt: page.records.at(-1)!.sortAt,
          sortKind: page.records.at(-1)!.sortKind,
          recordId: page.records.at(-1)!.recordId
        })
      : null;
    const links = linksFor([...reviewRows, ...lookup.reviews]);
    const response: ReviewPresentationResponse = {
      version: REVIEW_PRESENTATION_VERSION,
      scope: {
        mode: input.mode,
        ...(input.window ? { window: input.window } : {}),
        ...(input.today ? { today: input.today } : {}),
        timeZone: input.timeZone,
        ...(input.reviewItemIds?.length
          ? { reviewItemIds: [...input.reviewItemIds].sort() }
          : {}),
        ...(input.entryIds?.length
          ? { entryIds: [...input.entryIds].sort() }
          : {})
      },
      snapshotToken,
      capturedAt,
      nextCursor: next,
      completeness: {
        records: !boundedCollection && !page.hasMore,
        // Exact counts remain in the response, but a local client must not
        // subtract hidden effects unless it has this complete membership list.
        outstandingCounts: (counts.openReviewItemIds?.length ?? 0) <= COLLECTION_LIMIT,
        completedToday: input.mode === "window" && !boundedCollection && !page.hasMore,
        partialReason: boundedCollection ? "bounded_collection" : page.hasMore ? "page" : null
      },
      outstanding: {
        globalCount: Number(counts.globalCount),
        todayCount: Number(counts.todayCount),
        openReviewItemIds: (counts.openReviewItemIds ?? []).slice(0, COLLECTION_LIMIT)
      },
      records: page.records.map(({ record }) => record),
      links,
      lookup: {
        reviewItems: lookupReviewsFor(input.reviewItemIds ?? [], lookup.reviews),
        entries: lookupEntriesFor(input.entryIds ?? [], lookup.entries)
      }
    };
    return ReviewPresentationResponseSchema.parse(response);
  }, { ...options, deadlineAt, readOnly: true, cleanupReserveMs: 500 });
}

async function loadCounts(client: pg.PoolClient, session: RequestSession, input: ReviewPresentationRequest) {
  const todayStart = input.today?.start ?? null;
  const todayEnd = input.today?.end ?? null;
  const result = await client.query<CountsRow>(
    `with open_reviews as (
       select ri.id, ri.event_id, ri.suggested_started_at, ri.suggested_stopped_at, ri.created_at
       from review_items ri
       where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open'
     ), unlinked_legacy as (
       select te.id, te.started_at, te.stopped_at, te.created_at
       from time_entries te
       where te.workspace_id = $1 and te.user_id = $2 and te.review_status = 'needs_review'
         and not exists (
           select 1
           from review_items ri
           join activity_events ae
             on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
           where ri.workspace_id = te.workspace_id and ri.user_id = te.user_id
             and ri.status = 'open' and te.created_from_event_id = ae.id
         )
     )
     select
       ((select count(*) from open_reviews) + (select count(*) from unlinked_legacy))::int as "globalCount",
       (
         (select count(*) from open_reviews
          where ($3::timestamptz is not null and $4::timestamptz is not null)
            and ((suggested_started_at is not null and suggested_stopped_at is not null
                  and suggested_started_at < $4::timestamptz and suggested_stopped_at > $3::timestamptz)
                 or ((suggested_started_at is null or suggested_stopped_at is null)
                     and created_at >= $3::timestamptz and created_at < $4::timestamptz)))
         +
         (select count(*) from unlinked_legacy
          where ($3::timestamptz is not null and $4::timestamptz is not null)
            and ((started_at is not null and stopped_at is not null
                  and started_at < $4::timestamptz and stopped_at > $3::timestamptz)
                 or ((started_at is null or stopped_at is null)
                     and created_at >= $3::timestamptz and created_at < $4::timestamptz)))
       )::int as "todayCount",
       (select coalesce(array_agg(id::text order by id), array[]::text[])
        from (select id from open_reviews order by id limit ${SQL_COLLECTION_LIMIT}) bounded) as "openReviewItemIds"`,
    [session.workspaceId, session.userId, todayStart, todayEnd]
  );
  return result.rows[0] ?? { globalCount: 0, todayCount: 0, openReviewItemIds: [] };
}

async function loadReviewRows(client: pg.PoolClient, session: RequestSession, input: ReviewPresentationRequest) {
  const windowClause = input.mode === "window"
    ? `and (
        (ri.suggested_started_at is not null and ri.suggested_stopped_at is not null
          and ri.suggested_started_at < $3::timestamptz and ri.suggested_stopped_at > $4::timestamptz)
        or ((ri.suggested_started_at is null or ri.suggested_stopped_at is null)
          and ri.created_at >= $5::timestamptz and ri.created_at < $6::timestamptz)
      )`
    : "";
  const values = input.mode === "window"
    ? [session.workspaceId, session.userId, input.window!.end, input.window!.start, input.window!.start, input.window!.end]
    : [session.workspaceId, session.userId];
  const result = await client.query<ReviewRow>(
    `select ri.id,
            ri.event_id as "eventId",
            ri.location_segment_id as "locationSegmentId",
            ri.type,
            ri.title,
            ri.status,
            c.id as "categoryId", c.name as "categoryName", c.color as "categoryColor",
            pl.id as "placeId", pl.name as "placeLabel",
            ri.suggested_started_at as "startedAt", ri.suggested_stopped_at as "stoppedAt",
            ri.confidence, ri.created_at as "createdAt",
            coalesce(st.updated_at, cs.updated_at, ri.resolved_at, ri.created_at) as "semanticRevision",
            ae.source as "eventSource", ae.event_type as "eventType",
            links.entry_ids as "canonicalEntryIds"
     from review_items ri
     left join activity_events ae
       on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
     left join categories c on c.id = ri.suggested_category_id and c.workspace_id = ri.workspace_id
     left join places pl on pl.id = ri.suggested_place_id and pl.workspace_id = ri.workspace_id
     left join stay_segments st on st.id = ri.location_segment_id and st.workspace_id = ri.workspace_id and st.user_id = ri.user_id
     left join commute_segments cs on cs.id = ri.location_segment_id and cs.workspace_id = ri.workspace_id and cs.user_id = ri.user_id
     left join lateral (
       select coalesce(array_agg(distinct matched.id::text), array[]::text[]) as entry_ids
       from time_entries matched
       where matched.workspace_id = ri.workspace_id and matched.user_id = ri.user_id
         and (
           matched.created_from_event_id = ri.event_id
           or matched.id = ae.resolved_time_entry_id
           or matched.id in (
             select receipt_id::uuid
             from (
               select r.result_json ->> 'entryId' as receipt_id
               from review_mutation_receipts r
               where r.workspace_id = ri.workspace_id and r.user_id = ri.user_id and r.review_item_id = ri.id
               union all
               select jsonb_array_elements_text(coalesce(r.result_json -> 'entryIds', '[]'::jsonb))
               from review_mutation_receipts r
               where r.workspace_id = ri.workspace_id and r.user_id = ri.user_id and r.review_item_id = ri.id
             ) receipt_values
             where receipt_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           )
         )
     ) links on true
     where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open'
     ${windowClause}
     order by coalesce(ri.suggested_started_at, ri.created_at) desc, ri.id desc
     limit ${SQL_COLLECTION_LIMIT}`,
    values
  );
  return result.rows;
}

async function loadLegacyRows(client: pg.PoolClient, session: RequestSession, input: ReviewPresentationRequest) {
  const windowClause = input.mode === "window"
    ? `and (
        (te.started_at is not null and te.stopped_at is not null
          and te.started_at < $3::timestamptz and te.stopped_at > $4::timestamptz)
        or ((te.started_at is null or te.stopped_at is null)
          and te.created_at >= $5::timestamptz and te.created_at < $6::timestamptz)
      )`
    : "";
  const values = input.mode === "window"
    ? [session.workspaceId, session.userId, input.window!.end, input.window!.start, input.window!.start, input.window!.end]
    : [session.workspaceId, session.userId];
  const result = await client.query<LegacyRow>(
    `select te.id, te.created_from_event_id as "eventId",
            p.id as "projectId", p.name as "projectName", p.color as "projectColor",
            cl.name as "clientName",
            coalesce(nullif(te.description, ''), c.name, 'Untitled activity') as title,
            c.id as "categoryId", c.name as "categoryName", c.color as "categoryColor",
            pl.id as "placeId", coalesce(pl.name, te.place_label) as "placeLabel",
            case
              when pl.id is not null then 'saved'
              when te.place_label is not null then 'one_time'
              else null
            end as "placeKind",
            te.started_at as "startedAt", te.stopped_at as "stoppedAt", te.confidence,
            te.updated_at as "updatedAt", te.source, te.description,
            case
              when te.stopped_at is null then 0
              else greatest(0, extract(epoch from (te.stopped_at - te.started_at)))::int
            end as "durationSeconds",
            (
              select coalesce(array_agg(t.name order by t.name), '{}')
              from time_entry_tags tet
              join tags t on t.id = tet.tag_id and t.workspace_id = te.workspace_id
              where tet.time_entry_id = te.id and tet.workspace_id = te.workspace_id
            ) as "tagNames",
            linked.id as "linkedReviewItemId"
     from time_entries te
     left join projects p on p.id = te.project_id and p.workspace_id = te.workspace_id
     left join clients cl on cl.id = p.client_id and cl.workspace_id = te.workspace_id
     left join categories c on c.id = te.category_id and c.workspace_id = te.workspace_id
     left join places pl on pl.id = te.place_id and pl.workspace_id = te.workspace_id
     left join lateral (
       select ri.id
       from review_items ri
       where ri.workspace_id = te.workspace_id and ri.user_id = te.user_id
         and ri.status = 'open' and ri.event_id = te.created_from_event_id
       limit 1
     ) linked on true
     where te.workspace_id = $1 and te.user_id = $2 and te.review_status = 'needs_review'
       and linked.id is null
     ${windowClause}
     order by coalesce(te.started_at, te.created_at) desc, te.id desc
     limit ${SQL_COLLECTION_LIMIT}`,
    values
  );
  return result.rows;
}

async function loadCompletedTodayRows(client: pg.PoolClient, session: RequestSession, input: ReviewPresentationRequest) {
  const result = await client.query<EntryRow>(
    `select te.id, te.created_from_event_id as "eventId",
            coalesce(nullif(te.description, ''), c.name, 'Untitled activity') as title,
            c.id as "categoryId", c.name as "categoryName", c.color as "categoryColor",
            pl.id as "placeId", coalesce(pl.name, te.place_label) as "placeLabel",
            te.started_at as "startedAt", te.stopped_at as "stoppedAt", te.confidence,
            te.review_status as "reviewStatus", te.updated_at as "updatedAt", te.source
     from time_entries te
     left join categories c on c.id = te.category_id and c.workspace_id = te.workspace_id
     left join places pl on pl.id = te.place_id and pl.workspace_id = te.workspace_id
     where te.workspace_id = $1 and te.user_id = $2
       and te.review_status in ('confirmed', 'accepted') and te.stopped_at is not null
       and te.started_at < $3::timestamptz and te.stopped_at > $4::timestamptz
     order by te.started_at desc, te.id desc
     limit ${SQL_COLLECTION_LIMIT}`,
    [session.workspaceId, session.userId, input.today!.end, input.today!.start]
  );
  return result.rows;
}

async function loadLookupRows(client: pg.PoolClient, session: RequestSession, input: ReviewPresentationRequest) {
  const reviewIds = input.reviewItemIds ?? [];
  const entryIds = input.entryIds ?? [];
  if (reviewIds.length > REVIEW_PRESENTATION_MAX_IDS || entryIds.length > REVIEW_PRESENTATION_MAX_IDS) {
    throw new ReviewPresentationError("presentation_unavailable", "Lookup IDs exceed the bounded request.");
  }
  const [reviews, completedEntries, legacyEntries] = await Promise.all([
    reviewIds.length
      ? loadReviewRowsByIds(client, session, reviewIds)
      : Promise.resolve([]),
    entryIds.length
      ? loadCompletedEntriesByIds(client, session, entryIds)
      : Promise.resolve([]),
    entryIds.length
      ? loadLegacyRowsByIds(client, session, entryIds)
      : Promise.resolve([])
  ]);
  return { reviews, entries: [...completedEntries, ...legacyEntries] };
}

async function loadReviewRowsByIds(client: pg.PoolClient, session: RequestSession, ids: string[]) {
  // Keep this query's selected fields intentionally identical to the read page.
  const result = await client.query<ReviewRow>(
    `select ri.id, ri.event_id as "eventId", ri.location_segment_id as "locationSegmentId", ri.type, ri.title, ri.status,
            c.id as "categoryId", c.name as "categoryName", c.color as "categoryColor",
            pl.id as "placeId", pl.name as "placeLabel", ri.suggested_started_at as "startedAt", ri.suggested_stopped_at as "stoppedAt",
            ri.confidence, ri.created_at as "createdAt", coalesce(st.updated_at, cs.updated_at, ri.resolved_at, ri.created_at) as "semanticRevision",
            ae.source as "eventSource", ae.event_type as "eventType",
            links.entry_ids as "canonicalEntryIds"
     from review_items ri
     left join activity_events ae on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
     left join categories c on c.id = ri.suggested_category_id and c.workspace_id = ri.workspace_id
     left join places pl on pl.id = ri.suggested_place_id and pl.workspace_id = ri.workspace_id
     left join stay_segments st on st.id = ri.location_segment_id and st.workspace_id = ri.workspace_id and st.user_id = ri.user_id
     left join commute_segments cs on cs.id = ri.location_segment_id and cs.workspace_id = ri.workspace_id and cs.user_id = ri.user_id
     left join lateral (
       select coalesce(array_agg(distinct matched.id::text), array[]::text[]) as entry_ids
       from time_entries matched
       where matched.workspace_id = ri.workspace_id and matched.user_id = ri.user_id
         and (
           matched.created_from_event_id = ri.event_id
           or matched.id = ae.resolved_time_entry_id
           or matched.id in (
             select receipt_id::uuid
             from (
               select r.result_json ->> 'entryId' as receipt_id
               from review_mutation_receipts r
               where r.workspace_id = ri.workspace_id and r.user_id = ri.user_id and r.review_item_id = ri.id
               union all
               select jsonb_array_elements_text(coalesce(r.result_json -> 'entryIds', '[]'::jsonb))
               from review_mutation_receipts r
               where r.workspace_id = ri.workspace_id and r.user_id = ri.user_id and r.review_item_id = ri.id
             ) receipt_values
             where receipt_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           )
         )
     ) links on true
     where ri.workspace_id = $1 and ri.user_id = $2 and ri.id = any($3::uuid[])
     order by ri.id`,
    [session.workspaceId, session.userId, ids]
  );
  return result.rows;
}

async function loadCompletedEntriesByIds(client: pg.PoolClient, session: RequestSession, ids: string[]) {
  const result = await client.query<EntryRow>(
    `select te.id, te.created_from_event_id as "eventId",
            coalesce(nullif(te.description, ''), c.name, 'Untitled activity') as title,
            c.id as "categoryId", c.name as "categoryName", c.color as "categoryColor",
            pl.id as "placeId", coalesce(pl.name, te.place_label) as "placeLabel",
            te.started_at as "startedAt", te.stopped_at as "stoppedAt", te.confidence,
            te.review_status as "reviewStatus", te.updated_at as "updatedAt", te.source
     from time_entries te
     left join categories c on c.id = te.category_id and c.workspace_id = te.workspace_id
     left join places pl on pl.id = te.place_id and pl.workspace_id = te.workspace_id
     where te.workspace_id = $1 and te.user_id = $2 and te.id = any($3::uuid[])
       and te.review_status in ('confirmed', 'accepted') and te.stopped_at is not null
     order by te.id`,
    [session.workspaceId, session.userId, ids]
  );
  return result.rows;
}

async function loadLegacyRowsByIds(client: pg.PoolClient, session: RequestSession, ids: string[]) {
  const result = await client.query<LegacyRow>(
    `select te.id, te.created_from_event_id as "eventId",
            p.id as "projectId", p.name as "projectName", p.color as "projectColor",
            cl.name as "clientName",
            coalesce(nullif(te.description, ''), c.name, 'Untitled activity') as title,
            c.id as "categoryId", c.name as "categoryName", c.color as "categoryColor",
            pl.id as "placeId", coalesce(pl.name, te.place_label) as "placeLabel",
            case
              when pl.id is not null then 'saved'
              when te.place_label is not null then 'one_time'
              else null
            end as "placeKind",
            te.started_at as "startedAt", te.stopped_at as "stoppedAt", te.confidence,
            te.updated_at as "updatedAt", te.source, te.description,
            case
              when te.stopped_at is null then 0
              else greatest(0, extract(epoch from (te.stopped_at - te.started_at)))::int
            end as "durationSeconds",
            (
              select coalesce(array_agg(t.name order by t.name), '{}')
              from time_entry_tags tet
              join tags t on t.id = tet.tag_id and t.workspace_id = te.workspace_id
              where tet.time_entry_id = te.id and tet.workspace_id = te.workspace_id
            ) as "tagNames",
            linked.id as "linkedReviewItemId"
     from time_entries te
     left join projects p on p.id = te.project_id and p.workspace_id = te.workspace_id
     left join clients cl on cl.id = p.client_id and cl.workspace_id = te.workspace_id
     left join categories c on c.id = te.category_id and c.workspace_id = te.workspace_id
     left join places pl on pl.id = te.place_id and pl.workspace_id = te.workspace_id
     left join lateral (
       select ri.id
       from review_items ri
       where ri.workspace_id = te.workspace_id and ri.user_id = te.user_id
         and ri.status = 'open' and ri.event_id = te.created_from_event_id
       limit 1
     ) linked on true
     where te.workspace_id = $1 and te.user_id = $2 and te.id = any($3::uuid[])
       and te.review_status = 'needs_review' and linked.id is null
     order by te.id`,
    [session.workspaceId, session.userId, ids]
  );
  return result.rows;
}

function toReviewRecord(row: ReviewRow): InternalRecord {
  const sourceKind = row.locationSegmentId ? "location_v2" : "generic" as const;
  const record: ReviewProposalPresentation = {
    kind: "review",
    reviewItemId: row.id,
    eventId: row.eventId,
    locationSegmentId: row.locationSegmentId,
    sourceKind,
    eventSource: row.eventSource,
    eventType: row.eventType,
    title: row.title,
    category: { id: row.categoryId, name: row.categoryName, color: row.categoryColor },
    place: { id: row.placeId, label: row.placeLabel },
    interval: { start: isoOrNull(row.startedAt), end: isoOrNull(row.stoppedAt) },
    confidence: row.confidence,
    status: row.status,
    createdAt: isoOrNull(row.createdAt)!,
    updatedAt: isoOrNull(row.semanticRevision) ?? isoOrNull(row.createdAt)!,
    proposalHash: row.status === "open"
      ? reviewProposalHash({
          reviewItemId: row.id, eventId: row.eventId, locationSegmentId: row.locationSegmentId,
          sourceKind, title: row.title, categoryId: row.categoryId, placeId: row.placeId,
          startedAt: row.startedAt, stoppedAt: row.stoppedAt, confidence: row.confidence,
          eventSource: row.eventSource, eventType: row.eventType, semanticRevision: row.semanticRevision
        })
      : null,
    canonicalEntryIds: row.canonicalEntryIds ?? [],
    semanticRevision: isoOrNull(row.semanticRevision)
  };
  return {
    record,
    sortAt: isoOrNull(row.startedAt) ?? isoOrNull(row.createdAt)!,
    sortKind: "review",
    recordId: row.id
  };
}

function toLegacyRecord(row: LegacyRow): InternalRecord {
  const record: Extract<ReviewPresentationRecord, { kind: "legacy_review_entry" }> = {
    kind: "legacy_review_entry",
    entryId: row.id,
    eventId: row.eventId,
    title: row.title,
    category: { id: row.categoryId, name: row.categoryName, color: row.categoryColor },
    place: { id: row.placeId, label: row.placeLabel },
    interval: { start: isoOrNull(row.startedAt), end: isoOrNull(row.stoppedAt) },
    confidence: row.confidence,
    status: "needs_review",
    updatedAt: isoOrNull(row.updatedAt)!,
    linkedReviewItemId: row.linkedReviewItemId,
    editor: {
      projectId: row.projectId,
      projectName: row.projectName,
      projectColor: row.projectColor,
      clientName: row.clientName,
      placeKind: row.placeKind,
      source: row.source,
      description: row.description,
      durationSeconds: Math.max(0, Number(row.durationSeconds) || 0),
      tagNames: row.tagNames ?? []
    }
  };
  return {
    record,
    sortAt: isoOrNull(row.startedAt) ?? isoOrNull(row.updatedAt)!,
    sortKind: "legacy_review_entry",
    recordId: row.id
  };
}

function toCompletedEntryRecord(row: EntryRow): InternalRecord {
  const record: CompletedTodayEntryPresentation = {
    kind: "completed_entry",
    entryId: row.id,
    eventId: row.eventId,
    title: row.title,
    category: { id: row.categoryId, name: row.categoryName, color: row.categoryColor },
    place: { id: row.placeId, label: row.placeLabel },
    interval: { start: isoOrNull(row.startedAt)!, end: isoOrNull(row.stoppedAt)! },
    confidence: row.confidence,
    reviewStatus: row.reviewStatus,
    updatedAt: isoOrNull(row.updatedAt)!,
    source: row.source
  };
  return { record, sortAt: record.interval.start, sortKind: "completed_entry", recordId: row.id };
}

function lookupReviewsFor(ids: string[], rows: ReviewRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    return row
      ? toReviewRecord(row).record as ReviewProposalPresentation
      : { kind: "missing_review" as const, reviewItemId: id };
  });
}

function lookupEntriesFor(ids: string[], rows: LookupEntryRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) return { kind: "missing_entry" as const, entryId: id };
    return isLegacyRow(row)
      ? toLegacyRecord(row).record as LegacyReviewEntryPresentation
      : toCompletedEntryRecord(row).record as CompletedTodayEntryPresentation;
  });
}

function isLegacyRow(row: LookupEntryRow): row is LegacyRow {
  return "linkedReviewItemId" in row;
}

function linksFor(rows: ReviewRow[]) {
  const links = new Map<string, { reviewItemId: string; entryIds: string[]; status: "open" | "accepted" | "ignored" | "missing" }>();
  for (const row of rows) {
    links.set(row.id, {
      reviewItemId: row.id,
      entryIds: [...new Set(row.canonicalEntryIds ?? [])],
      status: row.status
    });
  }
  return [...links.values()];
}

function scopeFor(input: ReviewPresentationRequest) {
  return createHash("sha256")
    .update(canonicalJson({
      version: REVIEW_PRESENTATION_VERSION,
      mode: input.mode,
      window: input.window ?? null,
      today: input.today ?? null,
      timeZone: input.timeZone,
      reviewItemIds: input.reviewItemIds ? [...input.reviewItemIds].sort() : null,
      entryIds: input.entryIds ? [...input.entryIds].sort() : null
    }))
    .digest("base64url");
}

function snapshotFor(
  scope: string,
  counts: CountsRow,
  records: InternalRecord[],
  lookup: { reviews: ReviewRow[]; entries: LookupEntryRow[] }
) {
  return createHash("sha256")
    .update(canonicalJson({
      scope,
      counts: {
        global: Number(counts.globalCount),
        today: Number(counts.todayCount),
        openReviewItemIds: counts.openReviewItemIds ?? []
      },
      records: records.map(({ record }) => record),
      lookup: {
        reviews: lookup.reviews.map((row) => toReviewRecord(row).record),
        entries: lookup.entries.map((row) => isLegacyRow(row)
          ? toLegacyRecord(row).record as LegacyReviewEntryPresentation
          : toCompletedEntryRecord(row).record)
      }
    }))
    .digest("base64url");
}

function compareRecords(left: InternalRecord, right: InternalRecord) {
  if (left.sortAt !== right.sortAt) return left.sortAt > right.sortAt ? -1 : 1;
  if (left.sortKind !== right.sortKind) return left.sortKind.localeCompare(right.sortKind);
  return left.recordId === right.recordId ? 0 : left.recordId > right.recordId ? -1 : 1;
}

function pageAfter(records: InternalRecord[], cursor: Cursor | null, limit: number) {
  const after = cursor
    ? records.filter((record) => isAfterCursor(record, cursor))
    : records;
  return { records: after.slice(0, limit), hasMore: after.length > limit };
}

function isAfterCursor(record: InternalRecord, cursor: Cursor) {
  const cursorRecord: InternalRecord = {
    record: record.record,
    sortAt: cursor.sortAt,
    sortKind: cursor.sortKind,
    recordId: cursor.recordId
  };
  return compareRecords(record, cursorRecord) > 0;
}

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function parseCursor(value: string): Cursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (
      decoded.version !== 1 ||
      typeof decoded.scope !== "string" ||
      typeof decoded.snapshot !== "string" ||
      typeof decoded.sortAt !== "string" ||
      !["review", "legacy_review_entry", "completed_entry"].includes(decoded.sortKind) ||
      typeof decoded.recordId !== "string"
    ) {
      throw new Error("invalid cursor");
    }
    return decoded;
  } catch {
    throw new ReviewPresentationError("invalid_cursor", "Review page cursor is invalid.");
  }
}
