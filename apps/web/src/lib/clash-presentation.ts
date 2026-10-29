import {
  REVIEW_PRESENTATION_FEATURES_HEADER,
  REVIEW_PRESENTATION_MAX_LIMIT,
  REVIEW_PRESENTATION_MAX_SNAPSHOT_RECORDS,
  REVIEW_PRESENTATION_TIMER_TRIP_CLASH_FEATURE,
  REVIEW_PRESENTATION_VERSION,
  ReviewPresentationResponseSchema,
  ReviewTimerTripClashPresentationSchema,
  TIMER_TRIP_CLASH_EVENT_TYPE,
  TIMER_TRIP_CLASH_REVIEW_TYPE,
  checkAskingStartMs,
  type ReviewPresentationResponse
} from "@dayframe/shared";
import type { ReviewItemRow } from "@/lib/queries";

/**
 * "A block ran into your trip" past the bootstrap's 100 Review items (location v4 design §7, #621, web parity with
 * #622): the Review presentation read with the `timer-trip-clash` feature, over the "?" asking window (today and the
 * 6 days before), paged with the server's cursor. Each open clash record with a valid `timerTripClash` becomes a Review
 * item like the bootstrap's (its payload names its block; End it sends the record's `proposalHash`); one without a valid
 * field is skipped, so it is never counted without a block to answer on.
 */

/** At most this many pages per read (the iPhone's bound; 200 a page, within the server's 5,000-record collection). */
export const CLASH_PRESENTATION_MAX_PAGES = 25;
/** Read again at most this often on bootstrap refreshes (an owner change reads at once). */
export const CLASH_PRESENTATION_MIN_INTERVAL_MS = 60_000;
/** The bootstrap lists at most this many open Review items: below it, nothing lies past the cap. */
export const BOOTSTRAP_REVIEW_ITEM_CAP = 100;

export type ClashPresentationFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Whether the bootstrap's Review items may have left clashes out (it listed its cap). */
export function clashPresentationNeeded(bootstrapItems: readonly ReviewItemRow[]) {
  return bootstrapItems.length >= BOOTSTRAP_REVIEW_ITEM_CAP;
}

/** The request's window: the asking window to the end of today, in the viewer's zone. */
export function clashPresentationWindow(todayStartMs: number) {
  const tomorrow = new Date(todayStartMs);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    window: { start: new Date(checkAskingStartMs(todayStartMs)).toISOString(), end: tomorrow.toISOString() },
    today: { start: new Date(todayStartMs).toISOString(), end: tomorrow.toISOString() }
  };
}

/**
 * Reads every page (bounded) and returns the open clash items. `isCurrent` is checked after every page: once the owner
 * it was read for is no longer the signed-in one, it stops and returns null (nothing of it is used).
 */
export async function fetchClashPresentationItems(input: {
  fetcher: ClashPresentationFetch;
  todayStartMs: number;
  timeZone: string;
  isCurrent: () => boolean;
  signal?: AbortSignal;
}): Promise<ReviewItemRow[] | null> {
  const items = new Map<string, ReviewItemRow>();
  let cursor: string | undefined;
  let records = 0;
  let snapshot: string | null = null;
  for (let page = 0; page < CLASH_PRESENTATION_MAX_PAGES; page += 1) {
    const response = await input.fetcher("/api/review/presentation", {
      method: "POST",
      headers: { "Content-Type": "application/json", [REVIEW_PRESENTATION_FEATURES_HEADER]: REVIEW_PRESENTATION_TIMER_TRIP_CLASH_FEATURE },
      body: JSON.stringify({
        version: REVIEW_PRESENTATION_VERSION, mode: "window", timeZone: input.timeZone, limit: REVIEW_PRESENTATION_MAX_LIMIT,
        ...clashPresentationWindow(input.todayStartMs), ...(cursor ? { cursor } : {})
      }),
      signal: input.signal
    });
    if (!input.isCurrent()) return null;
    if (!response.ok) throw new Error(`Review presentation read failed: ${response.status}`);
    const body = await response.json().catch(() => null);
    if (!input.isCurrent()) return null;
    const parsed = ReviewPresentationResponseSchema.safeParse(withoutInvalidClashFields(body));
    if (!parsed.success) throw new Error("Review presentation read was not understood.");
    // One server snapshot only: a page from another snapshot means the data moved; the next refresh reads again.
    if (snapshot !== null && parsed.data.snapshotToken !== snapshot) throw new Error("Review presentation changed while it was read.");
    snapshot = parsed.data.snapshotToken;
    records += parsed.data.records.length;
    if (records > REVIEW_PRESENTATION_MAX_SNAPSHOT_RECORDS) throw new Error("Review presentation exceeded its bounded collection.");
    for (const item of clashItemsFrom(parsed.data)) items.set(item.id, item);
    cursor = parsed.data.nextCursor ?? undefined;
    if (!cursor) return [...items.values()];
  }
  throw new Error("Review presentation exceeded its bounded page count.");
}

/** A record whose `timerTripClash` is malformed loses the field (the page still parses; that clash is skipped). */
function withoutInvalidClashFields(body: unknown) {
  if (!body || typeof body !== "object" || !Array.isArray((body as { records?: unknown }).records)) return body;
  const value = body as { records: unknown[] };
  return {
    ...value,
    records: value.records.map((record) => {
      if (!record || typeof record !== "object" || !("timerTripClash" in record)) return record;
      if (ReviewTimerTripClashPresentationSchema.safeParse((record as { timerTripClash: unknown }).timerTripClash).success) return record;
      const rest = { ...(record as Record<string, unknown>) };
      delete rest.timerTripClash;
      return rest;
    })
  };
}

/** The open clash records with a valid field, as Review items (suggested times from the record's interval). */
export function clashItemsFrom(response: Pick<ReviewPresentationResponse, "records">): ReviewItemRow[] {
  return response.records.flatMap((record): ReviewItemRow[] => {
    if (record.kind !== "review" || record.status !== "open" || record.eventType !== TIMER_TRIP_CLASH_EVENT_TYPE) return [];
    if (!record.timerTripClash || !record.proposalHash) return [];
    return [{
      id: record.reviewItemId, type: TIMER_TRIP_CLASH_REVIEW_TYPE, title: record.title, eventSource: record.eventSource,
      eventType: record.eventType, projectName: null, categoryName: record.category.name, categoryColor: record.category.color,
      placeName: record.place.label, suggestedProjectId: null, suggestedCategoryId: record.category.id, suggestedPlaceId: record.place.id,
      suggestedStartedAt: record.interval.start, suggestedStoppedAt: record.interval.end, confidence: record.confidence, status: "open",
      notes: null, rawPayload: { ...record.timerTripClash }, createdAt: record.createdAt, proposalHash: record.proposalHash
    }];
  });
}

/** The bootstrap's items with the clashes read past its cap, each once (the bootstrap's copy wins). */
export function withClashItems(bootstrapItems: readonly ReviewItemRow[], clashItems: readonly ReviewItemRow[]) {
  if (!clashItems.length) return bootstrapItems;
  const listed = new Set(bootstrapItems.map((item) => item.id));
  const extra = clashItems.filter((item) => !listed.has(item.id));
  return extra.length ? [...bootstrapItems, ...extra] : bootstrapItems;
}
