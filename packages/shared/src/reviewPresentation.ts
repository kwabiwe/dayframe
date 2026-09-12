import { z } from "zod";

const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Expected a valid instant."
  });
const uuid = z.string().uuid();

export const REVIEW_PRESENTATION_VERSION = 1 as const;
export const REVIEW_PRESENTATION_DEFAULT_LIMIT = 100;
export const REVIEW_PRESENTATION_MAX_LIMIT = 200;
export const REVIEW_PRESENTATION_MAX_IDS = 100;
export const REVIEW_PRESENTATION_MAX_CURSOR_LENGTH = 2_048;
export const REVIEW_PRESENTATION_MAX_SNAPSHOT_RECORDS = 5_000;
// Sixty local calendar days can include a DST rollback. The request remains
// deliberately bounded even when a caller supplies absolute instants.
export const REVIEW_PRESENTATION_MAX_WINDOW_MS = 61 * 24 * 60 * 60 * 1_000;

const pageCursor = z
  .string()
  .min(1)
  .max(REVIEW_PRESENTATION_MAX_CURSOR_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/, "Expected an opaque URL-safe cursor.");

const localWindow = z
  .object({ start: instant, end: instant })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.end) <= Date.parse(value.start)) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "Window end must be after its start."
      });
    }
  });

const uniqueIds = z
  .array(uuid)
  .max(REVIEW_PRESENTATION_MAX_IDS)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "IDs must be unique."
  });

const timeZone = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isIanaTimeZone, "Expected a valid IANA time zone.");

export const ReviewPresentationRequestSchema = z
  .object({
    version: z.literal(REVIEW_PRESENTATION_VERSION),
    mode: z.enum(["window", "backlog", "lookup"]),
    window: localWindow.optional(),
    today: localWindow.optional(),
    timeZone,
    cursor: pageCursor.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(REVIEW_PRESENTATION_MAX_LIMIT)
      .default(REVIEW_PRESENTATION_DEFAULT_LIMIT),
    reviewItemIds: uniqueIds.optional(),
    entryIds: uniqueIds.optional()
  })
  .strict()
  .superRefine((value, context) => {
    // Field validation reports the invalid IANA value. Avoid constructing a
    // formatter with it while collecting the remaining structural issues.
    if (!isIanaTimeZone(value.timeZone)) return;
    if (value.mode === "window") {
      if (!value.window) {
        context.addIssue({ code: "custom", path: ["window"], message: "Window mode requires a window." });
      }
      if (!value.today) {
        context.addIssue({ code: "custom", path: ["today"], message: "Window mode requires today bounds." });
      }
      if (value.reviewItemIds || value.entryIds) {
        context.addIssue({ code: "custom", message: "Window mode does not accept lookup IDs." });
      }
    }
    if (value.mode === "backlog" && (value.window || value.today || value.reviewItemIds || value.entryIds)) {
      context.addIssue({ code: "custom", message: "Backlog mode accepts neither a window nor lookup IDs." });
    }
    if (value.mode === "lookup") {
      if (!value.reviewItemIds?.length && !value.entryIds?.length) {
        context.addIssue({ code: "custom", message: "Lookup mode requires one or more IDs." });
      }
      if (value.window || value.today) {
        context.addIssue({ code: "custom", message: "Lookup mode does not accept date bounds." });
      }
    }

    for (const [key, bounds] of [["window", value.window], ["today", value.today]] as const) {
      if (!bounds) continue;
      const startMs = Date.parse(bounds.start);
      const endMs = Date.parse(bounds.end);
      if (!isLocalMidnight(bounds.start, value.timeZone) || !isLocalMidnight(bounds.end, value.timeZone)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Bounds must align to local-day boundaries in the supplied time zone."
        });
      }
      if (endMs - startMs > REVIEW_PRESENTATION_MAX_WINDOW_MS) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Window exceeds the bounded presentation range."
        });
      }
    }

    if (value.today && !isOneLocalDay(value.today, value.timeZone)) {
      context.addIssue({
        code: "custom",
        path: ["today"],
        message: "Today bounds must cover exactly one local calendar day."
      });
    }
    if (value.window && value.today && (
      Date.parse(value.today.start) < Date.parse(value.window.start) ||
      Date.parse(value.today.end) > Date.parse(value.window.end)
    )) {
      context.addIssue({
        code: "custom",
        path: ["today"],
        message: "Today must be contained by the requested window."
      });
    }
  });

const category = z
  .object({ id: uuid.nullable(), name: z.string().max(240).nullable(), color: z.string().max(80).nullable() })
  .strict();
const place = z.object({ id: uuid.nullable(), label: z.string().max(240).nullable() }).strict();
const interval = z.object({ start: instant.nullable(), end: instant.nullable() }).strict();
const legacyEditor = z
  .object({
    projectId: uuid.nullable(),
    projectName: z.string().max(240).nullable(),
    projectColor: z.string().max(80).nullable(),
    clientName: z.string().max(240).nullable(),
    placeKind: z.enum(["saved", "one_time"]).nullable(),
    source: z.string().max(100),
    description: z.string().max(2_000).nullable(),
    durationSeconds: z.number().int().nonnegative(),
    tagNames: z.array(z.string().min(1).max(240)).max(24)
  })
  .strict();

export const ReviewProposalPresentationSchema = z
  .object({
    kind: z.literal("review"),
    reviewItemId: uuid,
    eventId: uuid.nullable(),
    locationSegmentId: uuid.nullable(),
    sourceKind: z.enum(["generic", "location_v2"]),
    eventSource: z.string().max(100).nullable(),
    eventType: z.string().max(100).nullable(),
    title: z.string().max(500),
    category,
    place,
    interval,
    confidence: z.string().max(80),
    status: z.enum(["open", "accepted", "ignored", "missing"]),
    createdAt: instant,
    updatedAt: instant,
    proposalHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    canonicalEntryIds: z.array(uuid).max(25),
    semanticRevision: z.string().max(100).nullable()
  })
  .strict();

export const LegacyReviewEntryPresentationSchema = z
  .object({
    kind: z.literal("legacy_review_entry"),
    entryId: uuid,
    eventId: uuid.nullable(),
    title: z.string().max(500),
    category,
    place,
    interval,
    confidence: z.string().max(80),
    status: z.enum(["needs_review", "missing"]),
    updatedAt: instant,
    linkedReviewItemId: uuid.nullable(),
    /**
     * Actual, narrowly whitelisted values needed by the existing legacy-entry
     * editor. This avoids fabricating a MobileTimeEntry from display fields.
     */
    editor: legacyEditor
  })
  .strict();

export const CompletedTodayEntryPresentationSchema = z
  .object({
    kind: z.literal("completed_entry"),
    entryId: uuid,
    eventId: uuid.nullable(),
    title: z.string().max(500),
    category,
    place,
    interval: z.object({ start: instant, end: instant }).strict(),
    confidence: z.string().max(80),
    reviewStatus: z.enum(["confirmed", "accepted"]),
    updatedAt: instant,
    source: z.string().max(100)
  })
  .strict();

export const ReviewPresentationRecordSchema = z.discriminatedUnion("kind", [
  ReviewProposalPresentationSchema,
  LegacyReviewEntryPresentationSchema,
  CompletedTodayEntryPresentationSchema
]);

export const ReviewPresentationLinkSchema = z
  .object({
    reviewItemId: uuid,
    entryIds: z.array(uuid).max(25),
    status: z.enum(["open", "accepted", "ignored", "missing"])
  })
  .strict();

const MissingReviewLookupSchema = z
  .object({ kind: z.literal("missing_review"), reviewItemId: uuid })
  .strict();
const MissingEntryLookupSchema = z
  .object({ kind: z.literal("missing_entry"), entryId: uuid })
  .strict();
const ReviewLookupResultSchema = z.union([
  ReviewProposalPresentationSchema,
  MissingReviewLookupSchema
]);
const EntryLookupResultSchema = z.union([
  CompletedTodayEntryPresentationSchema,
  LegacyReviewEntryPresentationSchema,
  MissingEntryLookupSchema
]);

export const ReviewPresentationResponseSchema = z
  .object({
    version: z.literal(REVIEW_PRESENTATION_VERSION),
    scope: z
      .object({
        mode: z.enum(["window", "backlog", "lookup"]),
        window: localWindow.optional(),
        today: localWindow.optional(),
        timeZone,
        reviewItemIds: uniqueIds.optional(),
        entryIds: uniqueIds.optional()
      })
      .strict(),
    snapshotToken: z.string().min(1).max(512),
    capturedAt: instant,
    nextCursor: pageCursor.nullable(),
    completeness: z
      .object({
        records: z.boolean(),
        outstandingCounts: z.boolean(),
        completedToday: z.boolean(),
        partialReason: z.enum(["none", "page", "bounded_collection"]).nullable()
      })
      .strict(),
    outstanding: z
      .object({
        globalCount: z.number().int().nonnegative(),
        todayCount: z.number().int().nonnegative(),
        openReviewItemIds: z.array(uuid).max(5_000)
      })
      .strict(),
    records: z.array(ReviewPresentationRecordSchema).max(REVIEW_PRESENTATION_MAX_LIMIT),
    links: z.array(ReviewPresentationLinkSchema).max(500),
    lookup: z
      .object({
        reviewItems: z.array(ReviewLookupResultSchema).max(REVIEW_PRESENTATION_MAX_IDS),
        entries: z.array(EntryLookupResultSchema).max(REVIEW_PRESENTATION_MAX_IDS)
      })
      .strict()
  })
  .strict();

/**
 * The network response is one bounded page. The mobile cache may combine the
 * pages of one verified snapshot before rendering Today, so it needs a
 * separate strict shape with the same whitelisted fields and a bounded
 * collection limit. It is deliberately not used by the route handler.
 */
export const ReviewPresentationSnapshotSchema = ReviewPresentationResponseSchema.extend({
  records: z.array(ReviewPresentationRecordSchema).max(REVIEW_PRESENTATION_MAX_SNAPSHOT_RECORDS),
  links: z.array(ReviewPresentationLinkSchema).max(REVIEW_PRESENTATION_MAX_SNAPSHOT_RECORDS)
});

export type ReviewPresentationRequest = z.output<typeof ReviewPresentationRequestSchema>;
export type ReviewPresentationRecord = z.output<typeof ReviewPresentationRecordSchema>;
export type ReviewPresentationResponse = z.output<typeof ReviewPresentationResponseSchema>;
export type ReviewPresentationSnapshot = z.output<typeof ReviewPresentationSnapshotSchema>;
export type ReviewProposalPresentation = z.output<typeof ReviewProposalPresentationSchema>;
export type LegacyReviewEntryPresentation = z.output<typeof LegacyReviewEntryPresentationSchema>;
export type CompletedTodayEntryPresentation = z.output<typeof CompletedTodayEntryPresentationSchema>;

export function isIanaTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function localDateParts(value: string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function isLocalMidnight(value: string, zone: string) {
  const parts = localDateParts(value, zone);
  return parts.hour === "00" && parts.minute === "00" && parts.second === "00";
}

function isOneLocalDay(bounds: { start: string; end: string }, zone: string) {
  const start = localDateParts(bounds.start, zone);
  const end = localDateParts(bounds.end, zone);
  const startDay = Date.UTC(Number(start.year), Number(start.month) - 1, Number(start.day));
  const endDay = Date.UTC(Number(end.year), Number(end.month) - 1, Number(end.day));
  return endDay - startDay === 24 * 60 * 60 * 1_000;
}
