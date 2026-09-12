import type {
  CompletedTodayEntryPresentation,
  ReviewPresentationSnapshot,
  ReviewProposalPresentation
} from "@dayframe/shared";
import type { MobileTimeEntry } from "./api";
import { quickConfirmEligibility, type QuickConfirmEligibility } from "./reviewQuickConfirm";
import type { ReviewPresentationStoreEffect } from "./reviewSyncStore";

export type ActivitySource =
  | { kind: "entry"; entryId: string }
  | { kind: "review"; reviewItemId: string }
  | { kind: "legacy_review_entry"; entryId: string };

export type CategoryPresentation = {
  id: string | null;
  name: string | null;
  color: string | null;
};

export type TodayActivity = {
  presentationKey: string;
  ownerKey: string;
  source: ActivitySource;
  state: "needs_review" | "accepted_locally" | "confirmed" | "needs_attention";
  canonicalEntryIds: readonly string[];
  interval: { startMs: number; endMs: number } | null;
  clippedInterval: { startMs: number; endMs: number } | null;
  /** A valid detected timestamp preserves incomplete-item ordering without inventing an interval. */
  detectedAtMs: number | null;
  reviewSourceKind: "generic" | "location_v2" | null;
  title: string;
  category: CategoryPresentation | null;
  placeLabel: string | null;
  awaitingDecision: boolean;
  countsAsLogged: boolean;
  quickConfirm: QuickConfirmEligibility;
  resolution: "none" | "pending" | "verified" | "unknown" | "rejected";
};

export type TodayDonutSegment = {
  id: string;
  kind: "completed" | "pending";
  valueMs: number;
  category: CategoryPresentation | null;
  title: string;
  source: ActivitySource | null;
  provisional: boolean;
};

export type TodayActivitySection = {
  key: string;
  title: "Today" | "Incomplete time";
  activities: readonly TodayActivity[];
};

export type TodayReviewPresentation = {
  dayKey: string;
  coverage: "complete" | "cached" | "partial" | "unavailable";
  completedLoggedMs: number;
  awaitingReviewMs: number;
  pendingConfirmationCount: number;
  savedConfirmationCount: number;
  globalReviewCount: { value: number | null; exact: boolean };
  todayReviewCount: { value: number | null; exact: boolean };
  donutSegments: readonly TodayDonutSegment[];
  daySections: readonly TodayActivitySection[];
};

export type TodayReviewProjectionInput = {
  ownerKey: string;
  snapshotOwnerKey: string | null;
  response: ReviewPresentationSnapshot | null;
  effects: readonly ReviewPresentationStoreEffect[];
  dashboardEntries: readonly MobileTimeEntry[];
  /** Existing timer/edit/delete owner projections, already evidenced locally. */
  manualProjectedEntries?: readonly MobileTimeEntry[];
  day: { key: string; startMs: number; endMs: number };
  nowMs: number;
};

type CanonicalEntry = {
  id: string;
  title: string;
  category: CategoryPresentation | null;
  placeLabel: string | null;
  startMs: number;
  endMs: number;
  updatedAt: string | null;
  source: string;
};

type ReviewCandidate = {
  record: ReviewProposalPresentation;
  canonicalEntryIds: string[];
};

/**
 * The only Today accounting projection. It has no clock read, network, SQL or
 * React dependency: source lineage, not title/time coincidence, joins Review
 * intent to actual canonical entries.
 */
export function projectTodayReviewPresentation(input: TodayReviewProjectionInput): TodayReviewPresentation {
  const unavailable = emptyPresentation(input.day.key, "unavailable");
  if (input.snapshotOwnerKey !== input.ownerKey) return unavailable;
  const response = input.response;
  if (!response) return unavailable;

  const canonicalEntries = canonicalEntryMap(input, response);
  const responseLinks = new Map(response.links.map((link) => [link.reviewItemId, link.entryIds]));
  const effectsBySource = new Map(input.effects.map((effect) => [effect.reviewItemId, effect]));
  const reviews = reviewCandidates(response, responseLinks, input.effects);
  const activities: TodayActivity[] = [];
  const pendingSegments: TodayDonutSegment[] = [];
  const completedSegments = new Map<string, TodayDonutSegment>();
  const dayStart = input.day.startMs;
  const dayEnd = input.day.endMs;
  const capturedEnd = Math.min(dayEnd, input.nowMs);

  for (const entry of canonicalEntries.values()) {
    const clipped = clipInterval(entry.startMs, entry.endMs, dayStart, capturedEnd);
    if (!clipped) continue;
    const source: ActivitySource = { kind: "entry", entryId: entry.id };
    activities.push({
      presentationKey: `${input.ownerKey}:entry:${entry.id}:${input.day.key}`,
      ownerKey: input.ownerKey,
      source,
      state: "confirmed",
      canonicalEntryIds: [entry.id],
      interval: { startMs: entry.startMs, endMs: entry.endMs },
      clippedInterval: clipped,
      detectedAtMs: null,
      reviewSourceKind: null,
      title: entry.title,
      category: entry.category,
      placeLabel: entry.placeLabel,
      awaitingDecision: false,
      countsAsLogged: true,
      quickConfirm: { eligible: false, reason: "This is already logged activity." },
      resolution: "verified"
    });
    const categoryKey = entry.category?.id ?? entry.category?.name?.trim().toLocaleLowerCase() ?? "uncategorized";
    const segmentId = `category:${categoryKey}`;
    const existing = completedSegments.get(segmentId);
    if (existing) {
      existing.valueMs += clipped.endMs - clipped.startMs;
    } else {
      completedSegments.set(segmentId, {
        id: segmentId,
        kind: "completed",
        valueMs: clipped.endMs - clipped.startMs,
        category: entry.category,
        title: entry.category?.name ?? "Uncategorized",
        source: null,
        provisional: false
      });
    }
  }

  let savedConfirmationCount = 0;
  for (const candidate of reviews) {
    const effect = effectsBySource.get(candidate.record.reviewItemId) ?? null;
    const explicitCanonicalIds = uniqueIds([
      ...candidate.canonicalEntryIds,
      ...(effect?.canonicalEntryIds ?? [])
    ]);
    const canonicalVisible = explicitCanonicalIds.some((id) => canonicalEntries.has(id));
    const resolution = effect?.resolution ?? "none";
    const saved = Boolean(effect && effect.localEffect === "hidden" && (
      resolution === "pending" || resolution === "verified"
    ));
    const restoredAttention = Boolean(effect && effect.localEffect === "restore");
    const unresolved = Boolean(effect && effect.localEffect === "hidden" && resolution === "unknown");

    // A receipt-linked canonical entry wins the row. Keeping a second saved
    // source here would duplicate a real entry merely to preserve animation.
    // Persisted source lineage plus a current scoped canonical entry is enough
    // to replace the visual Review row. Delivery acknowledgement still stays
    // in the existing outbox until its terminal proof is safe to retire.
    if (saved && canonicalVisible) continue;

    const interval = finiteInterval(candidate.record.interval.start, candidate.record.interval.end);
    const clipped = interval ? clipInterval(interval.startMs, interval.endMs, dayStart, capturedEnd) : null;
    if ((interval && !clipped) || (!interval && !isDetectedInDay(candidate.record.createdAt, dayStart, dayEnd))) continue;
    const source: ActivitySource = { kind: "review", reviewItemId: candidate.record.reviewItemId };
    const state: TodayActivity["state"] = saved
      ? "accepted_locally"
      : restoredAttention || unresolved ? "needs_attention"
      : "needs_review";
    const awaitingDecision = !saved && !unresolved;
    const quickConfirm = quickConfirmEligibility({
      source: candidate.record,
      ownerMatches: true,
      effect,
      localCommitInProgress: false,
      requiresCorrection: restoredAttention
    });
    activities.push({
      presentationKey: `${input.ownerKey}:review:${candidate.record.reviewItemId}:${input.day.key}`,
      ownerKey: input.ownerKey,
      source,
      state,
      canonicalEntryIds: explicitCanonicalIds,
      interval,
      clippedInterval: clipped,
      detectedAtMs: parseInstant(candidate.record.createdAt),
      reviewSourceKind: candidate.record.sourceKind,
      title: candidate.record.title,
      category: candidate.record.category,
      placeLabel: candidate.record.place.label,
      awaitingDecision,
      countsAsLogged: false,
      quickConfirm,
      resolution
    });
    if (saved) {
      savedConfirmationCount += 1;
      continue;
    }
    // A proof gap is neither a fresh proposal nor a canonical result. Keep
    // its owned row visible for diagnostics, but never let it re-enter pending
    // geometry or accounting merely because its old interval is still cached.
    if (unresolved) continue;
    if (clipped) {
      pendingSegments.push({
        id: `review:${candidate.record.reviewItemId}`,
        kind: "pending",
        valueMs: clipped.endMs - clipped.startMs,
        category: candidate.record.category,
        title: candidate.record.title,
        source,
        provisional: true
      });
    }
  }

  const representedReviewIds = new Set(reviews.map((candidate) => candidate.record.reviewItemId));
  for (const record of response.records) {
    if (record.kind !== "legacy_review_entry") continue;
    if (record.linkedReviewItemId && representedReviewIds.has(record.linkedReviewItemId)) continue;
    const interval = finiteInterval(record.interval.start, record.interval.end);
    const clipped = interval ? clipInterval(interval.startMs, interval.endMs, dayStart, capturedEnd) : null;
    if ((interval && !clipped) || (!interval && !isDetectedInDay(record.updatedAt, dayStart, dayEnd))) continue;
    const source: ActivitySource = { kind: "legacy_review_entry", entryId: record.entryId };
    activities.push({
      presentationKey: `${input.ownerKey}:legacy-entry:${record.entryId}:${input.day.key}`,
      ownerKey: input.ownerKey,
      source,
      state: "needs_review",
      canonicalEntryIds: [],
      interval,
      clippedInterval: clipped,
      detectedAtMs: parseInstant(record.updatedAt),
      reviewSourceKind: null,
      title: record.title,
      category: record.category,
      placeLabel: record.place.label,
      awaitingDecision: true,
      countsAsLogged: false,
      quickConfirm: { eligible: false, reason: "This older entry needs its existing editor." },
      resolution: "none"
    });
    if (clipped) {
      pendingSegments.push({
        id: `legacy-entry:${record.entryId}`,
        kind: "pending",
        valueMs: clipped.endMs - clipped.startMs,
        category: record.category,
        title: record.title,
        source,
        provisional: true
      });
    }
  }

  const completedLoggedMs = [...completedSegments.values()].reduce((total, segment) => total + segment.valueMs, 0);
  const awaitingActivities = activities.filter((activity) => activity.awaitingDecision);
  const awaitingReviewMs = awaitingActivities.reduce(
    (total, activity) => total + (activity.clippedInterval ? activity.clippedInterval.endMs - activity.clippedInterval.startMs : 0),
    0
  );
  const timedActivities = activities.filter((activity) => activity.clippedInterval);
  const incomplete = activities
    .filter((activity) => !activity.interval)
    .sort(compareActivity);
  const today = timedActivities.sort(compareActivity);
  const counts = adjustedCounts(response, input.effects, reviews, dayStart, capturedEnd);
  const coverage = response.completeness.completedToday && response.completeness.records && response.completeness.outstandingCounts
    ? "complete"
    : response.completeness.records || response.records.length > 0
      ? "cached"
      : "partial";

  return {
    dayKey: input.day.key,
    coverage,
    completedLoggedMs,
    awaitingReviewMs,
    pendingConfirmationCount: awaitingActivities.length,
    savedConfirmationCount,
    globalReviewCount: counts.global,
    todayReviewCount: counts.today,
    donutSegments: [...completedSegments.values(), ...pendingSegments],
    daySections: [
      { key: `day:${input.day.key}`, title: "Today", activities: today },
      ...(incomplete.length ? [{ key: "incomplete", title: "Incomplete time" as const, activities: incomplete }] : [])
    ]
  };
}

function canonicalEntryMap(input: TodayReviewProjectionInput, response: ReviewPresentationSnapshot) {
  const responseEntries = presentationEntries(response);
  const fromResponse = new Map(responseEntries.map((entry) => [entry.id, entry]));
  const responseIsComplete = response.scope.mode === "window" && response.completeness.completedToday;
  const entries = responseIsComplete
    ? fromResponse
    : new Map([
        ...input.dashboardEntries.map((entry) => [entry.id, mobileEntry(entry)] as const),
        ...fromResponse
      ]);
  for (const entry of input.manualProjectedEntries ?? []) {
    const projected = mobileEntry(entry);
    entries.set(projected.id, projected);
  }
  return entries;
}

function presentationEntries(response: ReviewPresentationSnapshot) {
  const records = [...response.records, ...response.lookup.entries]
    .filter((record): record is CompletedTodayEntryPresentation => record.kind === "completed_entry")
    .map(presentationEntry);
  return uniqueById(records);
}

function mobileEntry(entry: MobileTimeEntry): CanonicalEntry {
  const startMs = Date.parse(entry.startedAt);
  const endMs = entry.stoppedAt ? Date.parse(entry.stoppedAt) : Number.NaN;
  return {
    id: entry.id,
    title: entry.description?.trim() || entry.categoryName || "Untitled activity",
    category: { id: entry.categoryId, name: entry.categoryName, color: entry.categoryColor ?? null },
    placeLabel: entry.placeName,
    startMs,
    endMs,
    updatedAt: null,
    source: entry.source
  };
}

function presentationEntry(entry: CompletedTodayEntryPresentation): CanonicalEntry {
  return {
    id: entry.entryId,
    title: entry.title,
    category: entry.category,
    placeLabel: entry.place.label,
    startMs: Date.parse(entry.interval.start),
    endMs: Date.parse(entry.interval.end),
    updatedAt: entry.updatedAt,
    source: entry.source
  };
}

function reviewCandidates(
  response: ReviewPresentationSnapshot,
  links: Map<string, string[]>,
  effects: readonly ReviewPresentationStoreEffect[]
) {
  const candidates = new Map<string, ReviewCandidate>();
  for (const record of response.records) {
    if (record.kind !== "review" || record.status !== "open") continue;
    candidates.set(record.reviewItemId, {
      record,
      canonicalEntryIds: uniqueIds([...record.canonicalEntryIds, ...(links.get(record.reviewItemId) ?? [])])
    });
  }
  for (const effect of effects) {
    if (candidates.has(effect.reviewItemId) || !effect.source) continue;
    candidates.set(effect.reviewItemId, {
      record: {
        kind: "review",
        reviewItemId: effect.source.reviewItemId,
        eventId: null,
        locationSegmentId: null,
        sourceKind: effect.source.sourceKind,
        eventSource: effect.source.eventSource,
        eventType: effect.source.eventType,
        title: effect.source.title,
        category: effect.source.category,
        place: { id: null, label: effect.source.placeLabel },
        interval: effect.source.interval,
        confidence: "unknown",
        status: "open",
        createdAt: effect.source.createdAt,
        updatedAt: effect.source.createdAt,
        proposalHash: null,
        canonicalEntryIds: effect.canonicalEntryIds,
        semanticRevision: null
      },
      canonicalEntryIds: effect.canonicalEntryIds
    });
  }
  return [...candidates.values()];
}

function adjustedCounts(
  response: ReviewPresentationSnapshot,
  effects: readonly ReviewPresentationStoreEffect[],
  reviews: ReviewCandidate[],
  dayStart: number,
  capturedEnd: number
) {
  const openIds = new Set(response.outstanding.openReviewItemIds);
  const excluded = effects.filter((effect) =>
    effect.localEffect === "hidden" && effect.resolution !== "rejected" && openIds.has(effect.reviewItemId)
  );
  const globalExact = response.completeness.outstandingCounts;
  const global = {
    value: Math.max(0, response.outstanding.globalCount - excluded.length),
    exact: globalExact
  };
  const todayEffectIds = new Set(reviews
    .filter((candidate) => {
      const interval = finiteInterval(candidate.record.interval.start, candidate.record.interval.end);
      return interval ? Boolean(clipInterval(interval.startMs, interval.endMs, dayStart, capturedEnd)) : false;
    })
    .map((candidate) => candidate.record.reviewItemId));
  const todayExcluded = excluded.filter((effect) => todayEffectIds.has(effect.reviewItemId)).length;
  return {
    global,
    today: {
      value: Math.max(0, response.outstanding.todayCount - todayExcluded),
      exact: globalExact && response.completeness.records
    }
  };
}

function finiteInterval(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
    ? { startMs, endMs }
    : null;
}

function clipInterval(startMs: number, endMs: number, rangeStart: number, rangeEnd: number) {
  const start = Math.max(startMs, rangeStart);
  const end = Math.min(endMs, rangeEnd);
  return end > start ? { startMs: start, endMs: end } : null;
}

function isDetectedInDay(value: string, dayStart: number, dayEnd: number) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= dayStart && timestamp < dayEnd;
}

function parseInstant(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareActivity(left: TodayActivity, right: TodayActivity) {
  const leftAt = left.interval?.startMs ?? left.detectedAtMs ?? Number.NEGATIVE_INFINITY;
  const rightAt = right.interval?.startMs ?? right.detectedAtMs ?? Number.NEGATIVE_INFINITY;
  if (leftAt !== rightAt) return rightAt - leftAt;
  return left.presentationKey.localeCompare(right.presentationKey);
}

function uniqueById(entries: CanonicalEntry[]) {
  const map = new Map<string, CanonicalEntry>();
  for (const entry of entries) map.set(entry.id, entry);
  return [...map.values()];
}

function uniqueIds(values: readonly string[]) {
  return [...new Set(values)];
}

function emptyPresentation(dayKey: string, coverage: TodayReviewPresentation["coverage"]): TodayReviewPresentation {
  return {
    dayKey,
    coverage,
    completedLoggedMs: 0,
    awaitingReviewMs: 0,
    pendingConfirmationCount: 0,
    savedConfirmationCount: 0,
    globalReviewCount: { value: null, exact: false },
    todayReviewCount: { value: null, exact: false },
    donutSegments: [],
    daySections: [{ key: `day:${dayKey}`, title: "Today", activities: [] }]
  };
}
