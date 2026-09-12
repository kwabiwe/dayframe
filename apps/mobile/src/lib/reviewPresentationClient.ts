import {
  REVIEW_PRESENTATION_MAX_SNAPSHOT_RECORDS,
  ReviewPresentationResponseSchema,
  ReviewPresentationSnapshotSchema,
  type ReviewPresentationRequest,
  type ReviewPresentationResponse,
  type ReviewPresentationSnapshot
} from "@dayframe/shared";
import { AuthRequiredError } from "./api";
import { DAYFRAME_API_BASE } from "./config";
import {
  MobileHttpResponseError,
  StaleMobileSessionResponseError,
  mobileJsonRequest
} from "./mobile-network";
import {
  isAuthenticatedSessionSnapshotCurrent,
  readOwnedAuthenticatedSessionSnapshot
} from "./secure-session";
import type { ReviewPresentationOwner } from "./reviewSyncStore";

const PRESENTATION_TIMEOUT_MS = 8_000;
const MAX_SNAPSHOT_RESTARTS = 1;

export class ReviewPresentationSnapshotChangedError extends Error {
  constructor() {
    super("Review changed while this display snapshot was loading.");
    this.name = "ReviewPresentationSnapshotChangedError";
  }
}

/**
 * Read-only, owner-bound mobile adapter for the Stage B presentation contract.
 * It is intentionally separate from the Review mutation synchroniser: callers
 * may cancel this display read without affecting durable Review delivery.
 */
export async function fetchReviewPresentationPage(input: {
  owner: ReviewPresentationOwner;
  request: ReviewPresentationRequest;
  signal?: AbortSignal;
}): Promise<ReviewPresentationResponse> {
  const session = await readOwnedAuthenticatedSessionSnapshot({
    workspaceId: input.owner.workspaceId,
    userId: input.owner.userId
  });
  if (session.status === "signed_out") throw new AuthRequiredError();
  if (session.status !== "authenticated") throw new StaleMobileSessionResponseError();

  const { response, body } = await mobileJsonRequest<ReviewPresentationResponse | { code?: unknown } | null>(
    `${DAYFRAME_API_BASE}/api/review/presentation`,
    {
      method: "POST",
      signal: input.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.snapshot.token}`
      },
      body: JSON.stringify(input.request)
    },
    {
      timeoutMilliseconds: PRESENTATION_TIMEOUT_MS,
      timeoutMessage: "Review presentation is taking too long to load.",
      isCurrent: () => isAuthenticatedSessionSnapshotCurrent(session.snapshot),
      validate: (value, response) => {
        // Keep a small typed error envelope long enough to recognise an
        // immutable-snapshot conflict. mobileJsonRequest otherwise discards
        // non-2xx bodies, which would turn the required one-time restart into
        // an ordinary stale-view error.
        if (!response.ok) {
          return value && typeof value === "object" && !Array.isArray(value)
            ? value as { code?: unknown }
            : null;
        }
        return ReviewPresentationResponseSchema.parse(value);
      }
    }
  );
  if (response.status === 401 || response.status === 403) throw new AuthRequiredError();
  if (response.status === 409 && presentationErrorCode(body) === "snapshot_changed") {
    throw new ReviewPresentationSnapshotChangedError();
  }
  if (!response.ok) {
    throw new MobileHttpResponseError(response.status, "Unable to load Review presentation.");
  }
  const parsed = ReviewPresentationResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error("Review presentation response was empty or malformed.");
  return parsed.data;
}

/** Fetch every bounded page from one immutable server snapshot. */
export async function fetchReviewPresentationSnapshot(input: {
  owner: ReviewPresentationOwner;
  request: Omit<ReviewPresentationRequest, "cursor">;
  signal?: AbortSignal;
}): Promise<ReviewPresentationSnapshot> {
  let lastSnapshotChanged: unknown = null;
  for (let attempt = 0; attempt <= MAX_SNAPSHOT_RESTARTS; attempt += 1) {
    try {
      const pages: ReviewPresentationResponse[] = [];
      let cursor: string | undefined;
      do {
        const page = await fetchReviewPresentationPage({
          owner: input.owner,
          request: { ...input.request, ...(cursor ? { cursor } : {}) },
          signal: input.signal
        });
        pages.push(page);
        cursor = page.nextCursor ?? undefined;
        if (pages.reduce((total, current) => total + current.records.length, 0) > REVIEW_PRESENTATION_MAX_SNAPSHOT_RECORDS) {
          throw new Error("Review presentation exceeded its bounded display collection.");
        }
      } while (cursor);
      return mergeReviewPresentationPages(pages);
    } catch (error) {
      if (!(error instanceof ReviewPresentationSnapshotChangedError)) throw error;
      lastSnapshotChanged = error;
    }
  }
  throw lastSnapshotChanged ?? new ReviewPresentationSnapshotChangedError();
}

/** Combines only pages proven to belong to the exact same server snapshot. */
export function mergeReviewPresentationPages(
  pages: readonly ReviewPresentationResponse[]
): ReviewPresentationSnapshot {
  const first = pages[0];
  if (!first) throw new Error("Review presentation did not return a page.");
  const recordById = new Map<string, ReviewPresentationSnapshot["records"][number]>();
  const links = new Map<string, { reviewItemId: string; entryIds: Set<string>; status: "open" | "accepted" | "ignored" | "missing" }>();
  const lookupReviewById = new Map<string, ReviewPresentationSnapshot["lookup"]["reviewItems"][number]>();
  const lookupEntryById = new Map<string, ReviewPresentationSnapshot["lookup"]["entries"][number]>();

  for (const page of pages) {
    if (
      page.snapshotToken !== first.snapshotToken ||
      JSON.stringify(page.scope) !== JSON.stringify(first.scope) ||
      page.outstanding.globalCount !== first.outstanding.globalCount ||
      page.outstanding.todayCount !== first.outstanding.todayCount
    ) {
      throw new ReviewPresentationSnapshotChangedError();
    }
    for (const record of page.records) recordById.set(presentationRecordKey(record), record);
    for (const link of page.links) {
      const existing = links.get(link.reviewItemId);
      if (existing && existing.status !== link.status) throw new ReviewPresentationSnapshotChangedError();
      const entryIds = existing?.entryIds ?? new Set<string>();
      for (const entryId of link.entryIds) entryIds.add(entryId);
      links.set(link.reviewItemId, { reviewItemId: link.reviewItemId, entryIds, status: link.status });
    }
    for (const item of page.lookup.reviewItems) {
      lookupReviewById.set(item.kind === "missing_review" ? item.reviewItemId : item.reviewItemId, item);
    }
    for (const item of page.lookup.entries) {
      lookupEntryById.set(item.kind === "missing_entry" ? item.entryId : item.entryId, item);
    }
  }

  const last = pages.at(-1)!;
  return ReviewPresentationSnapshotSchema.parse({
    ...first,
    capturedAt: last.capturedAt,
    nextCursor: null,
    completeness: last.completeness,
    records: [...recordById.values()],
    links: [...links.values()].map((link) => ({
      reviewItemId: link.reviewItemId,
      entryIds: [...link.entryIds].sort(),
      status: link.status
    })),
    lookup: {
      reviewItems: [...lookupReviewById.values()],
      entries: [...lookupEntryById.values()]
    }
  });
}

function presentationRecordKey(record: ReviewPresentationResponse["records"][number]) {
  if (record.kind === "review") return `review:${record.reviewItemId}`;
  if (record.kind === "legacy_review_entry") return `legacy:${record.entryId}`;
  return `entry:${record.entryId}`;
}

function presentationErrorCode(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
