import { inspectHealthSourceRevision, supersedeEarlierHealthRevisionReviews, type HealthSourceDecision } from "./health-source-provenance";
import { reconcileTimerTripClashes, timerTripChecksEnabled } from "./location/timer-trip-clash-service";
import {
  LEGACY_PERSON_EDIT_SQL, PERSON_EDIT_ACTION, PERSON_SET_END_ACTION, PERSON_SET_END_SQL, SERVER_TIMER_START_KEY, TIMER_STARTED_SQL
} from "./time-entry-provenance";
import { withoutServerReviewDecision } from "./review-decision-signal";
import { withSyncTransaction, setSyncPhase, syncFailureMetadata, SyncOperationError, type SyncTransactionOptions } from "./sync-transaction";
import {
  defaultCountsTowardGoal,
  ActivityEventInputSchema,
  hasAutomaticConfidence,
  classifyLocationLearningEvidence,
  DEFAULT_HEALTH_IMPORT_PREFERENCES,
  HEALTH_SLEEP_SESSION_GAP_MS,
  HEALTH_IMPORT_PREFERENCE_OPTIONS,
  healthAutoLogMappingFor,
  isActivityIconKey,
  matchHealthSleepSessionWindows,
  normalizeHealthWorkoutType,
  normalizeHealthAutoLogMappings,
  normalizePaletteKey,
  normalizeActivityEvent,
  locationAddressSummary,
  locationLearningEvidenceFromPayload,
  shouldAutoConfirmHealthSleep,
  shouldAutoConfirmHealthWorkout,
  TimeEntryTagsPatchSchema,
  readableLocationNameFromParts,
  isStarterActivityKey,
  starterActivityByKey,
  type LocationDisplayAddress,
  type ActivityEventType,
  type ActivityEventInput,
  type CandidateActivity,
  type HealthAutoLogMappings,
  type HealthImportPreferenceKey,
  type HealthImportPreferences,
  type PlaceRole,
  TIMER_TRIP_CLASH_EVENT_TYPE
} from "@dayframe/shared";
import {
  databaseReadinessError,
  databasePayloadError,
  isCheckViolationError,
  isForeignKeyViolationError,
  isInsufficientPrivilegeError,
  isInvalidTextRepresentationError,
  isInvalidConflictTargetError,
  isLockNotAvailableError,
  isNotNullViolationError,
  isStatementTimeoutError,
  isUniqueViolationError,
  isUndefinedColumnError,
  isUndefinedTableError,
  missingRequiredColumnError,
  pool,
  query
} from "./db";
import { getNormalizationContext } from "./queries";
import { detailsChangedSince, versionChangedSince, type ExpectedDetails } from "./time-entry-details-precondition";
import { getDevSession, type RequestSession } from "./session";
import { createTag, syncTimeEntryTags } from "./tag-service";
import type pg from "pg";
import {
  automaticLoggingCategorySpec,
  ensureAutomaticCategoryId,
  ensureCommuteCategoryId,
  ensureHealthEventCategoryId,
  lockActivityNames,
  healthCategorySpecForEventType,
  type AutomaticLoggingCategoryKind
} from "./automatic-category-service";
import { getServerLocationRolloutMode } from "./location/location-rollout";
import { placeDisplayNameSql } from "./place-display";
import { assignPlaceRoleWith, lockLocationOwnersForArchive, placeWriteMigrationError } from "./place-role-service";

export type { AutomaticLoggingCategoryKind } from "./automatic-category-service";

/** Quick start's tiles on Today: the iPhone mosaic and this server cap agree (Blocks D2). */
export const QUICK_START_PIN_LIMIT = 6;

export class QuickStartFullError extends Error {
  status = 409;
  code = "quick_start_full";

  constructor(message = `Quick start holds ${QUICK_START_PIN_LIMIT} activities. Unpin one first.`) {
    super(message);
    this.name = "QuickStartFullError";
  }
}

export class CategoryConflictError extends Error {
  status = 409;

  constructor(message = "An activity with that name already exists.") {
    super(message);
    this.name = "CategoryConflictError";
  }
}

/** An entity kind the API does not create (unknown, or retired like automation rules). */
export class UnsupportedEntityError extends Error {
  status = 400;
  code = "unsupported_entity";

  constructor(entity: string) {
    super(`Unsupported entity: ${entity}`);
    this.name = "UnsupportedEntityError";
  }
}

type CategoryRowLike = {
  id: string;
  name: string;
  color: string;
  isPinned: boolean;
  icon?: string | null;
  starterKey?: string | null;
  countsTowardGoal: boolean;
};

const CATEGORY_COLUMNS = 'id, name, color, is_pinned as "isPinned", icon, starter_key as "starterKey", counts_toward_goal as "countsTowardGoal"';
const CATEGORY_RETURNING = `returning ${CATEGORY_COLUMNS}`;

type PlaceRowLike = {
  id: string;
  name: string;
  role: PlaceRole | null;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  priority: number;
  defaultProjectId: string | null;
  defaultProjectName: string | null;
  defaultCategoryId: string | null;
  defaultCategoryName: string | null;
  defaultActivityDescription: string | null;
  autoStart: boolean;
  loggingEnabled: boolean;
  autoLog: boolean;
};

type PlaceMutationFields = {
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters?: number | null;
  priority?: number | null;
  defaultCategoryId?: string | null;
  defaultActivityDescription?: string | null;
  autoStart?: boolean;
  loggingEnabled?: boolean;
  autoLog?: boolean;
};

type QueryRunner = <T extends pg.QueryResultRow>(statement: string, values?: unknown[]) => Promise<{ rows: T[] }>;

export type ReviewResolutionCode =
  | "review_item_not_found"
  | "already_resolved"
  | "mutation_id_conflict"
  | "resolution_conflict"
  | "proposal_changed"
  | "invalid_action"
  | "invalid_category"
  | "invalid_time_window"
  | "overlap"
  | "duplicate_entry"
  | "database_constraint"
  | "review_item_locked"
  | "review_query_timeout"
  | "review_query_cancelled"
  | "review_service_unavailable";

// "Always ignore" (always_ignore_source) and "Make rule" (create_rule) were removed by
// owner decision on 8 Oct 2026; they are now rejected as invalid_action.
type ReviewResolutionAction = "accept" | "ignore_once";

export type ReviewResolutionResult = {
  ok: true;
  action: ReviewResolutionAction;
  status: "accepted" | "ignored";
  entryId?: string;
  duplicate?: boolean;
  alreadyResolved?: boolean;
};

type ReviewResolutionDetails = Record<string, unknown>;

export class ReviewResolutionError extends Error {
  code: ReviewResolutionCode;
  status: number;
  details?: ReviewResolutionDetails;

  constructor(
    code: ReviewResolutionCode,
    message: string,
    options: { status?: number; details?: ReviewResolutionDetails; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "ReviewResolutionError";
    this.code = code;
    this.status = options.status ?? 400;
    this.details = options.details;
    if (options.cause) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * A Stop dated at or before the start of the block it stops (another device's clock, or the start
 * edited later than the Stop). It used to break the stops-after-start constraint and answer a generic
 * 500, so the phone retried the same moment forever while the block kept running (stability audit
 * SERVER-4). It is refused as a permanent validation error; the phone restores server truth.
 */
export class TimerStopBeforeStartError extends Error {
  status = 422;
  code = "timer_stop_before_start";

  constructor(message = "This Stop is earlier than the block's start.") {
    super(message);
    this.name = "TimerStopBeforeStartError";
  }
}

export class TimerReplacementWindowError extends Error {
  status = 409;

  constructor(message = "Start time must be after the running block's start time.") {
    super(message);
    this.name = "TimerReplacementWindowError";
  }
}

export class TimerMutationBusyError extends Error {
  readonly code = "timer_busy";
  readonly status = 503;

  constructor(message = "This block is busy. Dayframe will retry the Stop shortly.") {
    super(message);
    this.name = "TimerMutationBusyError";
  }
}

const SCOPED_STOP_LOCK_TIMEOUT = "2s";
const SCOPED_STOP_STATEMENT_TIMEOUT = "5s";

type OverlapBlockingEntry = {
  id: string;
  description: string | null;
  source: string;
  reviewStatus: string;
  startedAt: string;
  stoppedAt: string | null;
  categoryName: string | null;
  stoppedAtIsNull: boolean;
};

type HealthReviewReason = {
  reviewItemId: string;
  code: string;
  message: string;
  blockingEntry?: OverlapBlockingEntry;
};

type SleepReviewSegment = {
  item: HealthReviewItemRow;
  startedAt: string;
  stoppedAt: string;
  startedMs: number;
  stoppedMs: number;
};

type HealthSleepTimeEntry = {
  id: string;
  startedAt: string;
  stoppedAt: string;
  rawPayload: unknown;
};

const CATEGORY_PINS_MIGRATION = "supabase/migrations/202607040001_category_pins_and_project_backfill.sql";
const MOBILE_EVENT_IDEMPOTENCY_MIGRATION =
  "supabase/migrations/202607030001_mobile_event_idempotency_and_workouts.sql";
const HEALTH_SLEEP_SCHEMA_MIGRATION =
  "supabase/migrations/202607070001_health_sleep_segments.sql";
const HEALTH_SLEEP_RECONCILIATION_MIGRATION =
  "supabase/migrations/202608010001_health_sleep_session_reconciliation.sql";
const HEALTH_RLS_MIGRATION = "supabase/migrations/202607020001_dayframe_rls.sql";
const PLACE_DEFAULT_ACTIVITY_DESCRIPTION_MIGRATION =
  "supabase/migrations/202607070002_place_default_activity_description.sql";
const PLACE_LOGGING_ENABLED_MIGRATION = "supabase/migrations/202607140002_place_logging_enabled.sql";
const PLACE_AUTO_LOG_MIGRATION = "supabase/migrations/202610150001_place_auto_log.sql";
const LOCATION_LEARNING_MIGRATION = "supabase/migrations/202607140001_location_learning_intelligence.sql";
const DEFAULT_HEALTH_REPROCESS_BATCH_SIZE = 12;
const MAX_HEALTH_REPROCESS_BATCH_SIZE = 25;
const LEGACY_SLEEP_CONSOLIDATION_BATCH_SIZE = 120;

const LEGACY_LOCATION_EVENT_TYPES = new Set<ActivityEventType>([
  "geofence_enter",
  "geofence_exit",
  "unknown_stay",
  "learned_place_visit",
  "commute_detected"
]);

function isLegacyLocationSemanticInput(event: ReturnType<typeof ActivityEventInputSchema.parse>) {
  return LEGACY_LOCATION_EVENT_TYPES.has(event.type) &&
    ["geofence_specific", "geofence_broad", "location_learning"].includes(event.source);
}

function missingCategoryPinColumnError(cause: unknown) {
  return missingRequiredColumnError("categories", "is_pinned", CATEGORY_PINS_MIGRATION, cause);
}

function missingPlaceDefaultActivityDescriptionColumnError(cause: unknown) {
  return missingRequiredColumnError(
    "places",
    "default_activity_description",
    PLACE_DEFAULT_ACTIVITY_DESCRIPTION_MIGRATION,
    cause
  );
}

function missingPlaceLoggingEnabledColumnError(cause: unknown) {
  return missingRequiredColumnError(
    "places",
    "logging_enabled",
    PLACE_LOGGING_ENABLED_MIGRATION,
    cause
  );
}

function missingPlaceAutoLogColumnError(cause: unknown) {
  return missingRequiredColumnError("places", "auto_log", PLACE_AUTO_LOG_MIGRATION, cause);
}

function eventSyncReadinessError(error: unknown, eventType: ActivityEventType) {
  if (isUndefinedColumnError(error, "client_event_id")) {
    return missingRequiredColumnError(
      "activity_events",
      "client_event_id",
      MOBILE_EVENT_IDEMPOTENCY_MIGRATION,
      error
    );
  }

  if (isForeignKeyViolationError(error, "activity_events_workspace_id_fkey")) {
    return databaseReadinessError(
      "Authenticated session workspace is missing from public.workspaces. Log out and back in, then retry queued sync.",
      "public.workspaces",
      "docs/vercel-supabase-hosting.md",
      error
    );
  }

  if (eventType === "health_sleep_import" && isUndefinedColumnError(error, "user_edited_at")) {
    return missingRequiredColumnError(
      "time_entries",
      "user_edited_at",
      HEALTH_SLEEP_RECONCILIATION_MIGRATION,
      error
    );
  }

  if (isInvalidTextRepresentationError(error)) {
    return databasePayloadError(
      eventType === "health_workout_import"
        ? "Unable to sync this Health workout because a numeric value could not be stored. Update Dayframe and tap Retry failed."
        : "Unable to sync this event because a payload value has the wrong format.",
      eventType,
      error
    );
  }

  if (eventType === "health_sleep_import") {
    return healthSchemaReadinessError(error, {
      tableName: "health_sleep_segments",
      objectName: "public.health_sleep_segments",
      indexName: "idx_health_sleep_segments_external_sample",
      migrationHint: HEALTH_SLEEP_SCHEMA_MIGRATION,
      columns: [
        "workspace_id",
        "user_id",
        "external_sample_id",
        "provider",
        "source_name",
        "sleep_stage",
        "started_at",
        "stopped_at",
        "raw_payload"
      ]
    });
  }

  if (eventType === "health_workout_import") {
    return healthSchemaReadinessError(error, {
      tableName: "health_workouts",
      objectName: "public.health_workouts",
      indexName: "idx_health_workouts_external_sample",
      migrationHint: MOBILE_EVENT_IDEMPOTENCY_MIGRATION,
      columns: [
        "workspace_id",
        "user_id",
        "external_sample_id",
        "provider",
        "workout_type",
        "started_at",
        "stopped_at",
        "duration_seconds",
        "distance_meters",
        "energy_kcal",
        "raw_payload"
      ]
    });
  }

  if (eventType === "learned_place_visit") {
    return learnedPlacesReadinessError(error);
  }

  return undefined;
}

function learnedPlacesReadinessError(error: unknown) {
  if (isUndefinedTableError(error, "learned_places")) {
    return databaseReadinessError(
      `Database schema is missing public.learned_places. Run ${LOCATION_LEARNING_MIGRATION} before syncing location-learning events.`,
      "public.learned_places",
      LOCATION_LEARNING_MIGRATION,
      error
    );
  }

  const missingColumn = [
    "workspace_id",
    "user_id",
    "cluster_key",
    "latitude",
    "longitude",
    "visit_count",
    "distinct_day_count",
    "total_dwell_seconds",
    "longest_dwell_seconds",
    "classification",
    "raw_payload"
  ].find((column) => isUndefinedColumnError(error, column));
  if (missingColumn) return missingRequiredColumnError("learned_places", missingColumn, LOCATION_LEARNING_MIGRATION, error);

  if (isInvalidConflictTargetError(error)) {
    return databaseReadinessError(
      `Database schema is missing the learned_places workspace/user/cluster key. Run ${LOCATION_LEARNING_MIGRATION} before syncing location-learning events.`,
      "learned_places_workspace_user_cluster_key",
      LOCATION_LEARNING_MIGRATION,
      error
    );
  }

  return undefined;
}

function healthSchemaReadinessError(
  error: unknown,
  options: {
    tableName: string;
    objectName: string;
    indexName: string;
    migrationHint: string;
    columns: string[];
  }
) {
  if (isUndefinedTableError(error, options.tableName)) {
    return databaseReadinessError(
      `Database schema is missing ${options.objectName}. Run ${options.migrationHint} before syncing Health events.`,
      options.objectName,
      options.migrationHint,
      error
    );
  }

  const missingColumn = options.columns.find((column) => isUndefinedColumnError(error, column));
  if (missingColumn) {
    return missingRequiredColumnError(options.tableName, missingColumn, options.migrationHint, error);
  }

  if (isInvalidConflictTargetError(error)) {
    return databaseReadinessError(
      `Database schema is missing ${options.indexName} for ${options.objectName}. Run ${options.migrationHint} before syncing Health events.`,
      options.indexName,
      options.migrationHint,
      error
    );
  }

  if (isInsufficientPrivilegeError(error)) {
    return databaseReadinessError(
      `Database permissions rejected writes to ${options.objectName}. Verify the Health table RLS policies from ${HEALTH_RLS_MIGRATION}.`,
      options.objectName,
      HEALTH_RLS_MIGRATION,
      error
    );
  }

  return undefined;
}

export async function processActivityEvent(
  rawInput: unknown, session: RequestSession = getDevSession(), options: SyncTransactionOptions = {}
) {
  if (!isRecord(rawInput) || !isHealthEvent(String(rawInput.type))) {
    return processActivityEventWithClient(rawInput, session);
  }
  const deadlineAt = options.deadlineAt ?? Date.now() + 8_000;
  try {
    return await withSyncTransaction("health_ingest", ({client}) => processActivityEventWithClient(rawInput,session,client), {...options,deadlineAt});
  } catch (error) {
    // A competing delivery may have committed the existing event receipt. Read it
    // only after rollback, on a fresh bounded transaction; never retry the effect here.
    if (isUniqueViolationError(error) && typeof rawInput.clientEventId === "string") {
      return withSyncTransaction("health_ingest_receipt", async ({client,phase})=>{
        phase("receipt_read");
        if (!await findExistingActivityEventReceipt(rawInput.clientEventId as string,session,client.query)) throw error;
        return processActivityEventWithClient(rawInput,session,client);
      },{...options,deadlineAt,cleanupReserveMs:100,readOnly:true});
    }
    throw error;
  }
}

async function processActivityEventWithClient(
  rawInput: unknown,
  session: RequestSession,
  boundedClient?: pg.PoolClient
): Promise<{
  eventId: string;
  candidate: CandidateActivity;
  processingDisposition?: string;
  reviewItemId?: string;
  timeEntryId?: string;
  duplicate?: boolean;
  updatedExistingTimeEntry?: boolean;
  stopOutcome?: "stopped" | "superseded" | "ignored_unscoped";
  startOutcome?: "recorded_completed" | "superseded";
}> {
  const input = isRecord(rawInput) ? rawInput : {};
  const parsed = ActivityEventInputSchema.parse({
    occurredAt: new Date(),
    rawPayload: {},
    ...input,
    workspaceId: session.workspaceId,
    userId: session.userId
  });
  if (isHealthEvent(parsed.type)) delete parsed.rawPayload.serverHealthSourceDecision;
  if (boundedClient) setSyncPhase(boundedClient, "receipt_read");
  const fastDuplicate = parsed.clientEventId
    ? await findExistingActivityEventReceipt(parsed.clientEventId, session, boundedClient?.query)
    : null;
  if (boundedClient) setSyncPhase(boundedClient, "canonical_read");
  const context = await getNormalizationContext(session, boundedClient?.query);
  let candidate = normalizeActivityEvent(parsed, context);
  const suppressLegacyLocationSemantics =
    getServerLocationRolloutMode() !== "v1" && isLegacyLocationSemanticInput(parsed);
  if (suppressLegacyLocationSemantics) {
    candidate = {
      ...candidate,
      action: "record_only",
      reviewStatus: "confirmed",
      reason: "Legacy location evidence was retained for audit, but Location Intelligence V2 is authoritative."
    };
  }
  const stopScope = timerStopScope(parsed);
  if (stopScope.mode === "ignored_unscoped") {
    candidate = {
      ...candidate,
      action: "record_only",
      reviewStatus: "confirmed",
      reason: "An unscoped legacy iOS Stop was recorded but could not target a newer block."
    };
  }
  if (fastDuplicate) {
    recordTimerMutationTiming({
      eventType: parsed.type,
      stopScope: stopScope.mode,
      lockWaitMilliseconds: 0,
      transactionMilliseconds: 0,
      outcome: "duplicate"
    });
    return {
      eventId: fastDuplicate.eventId,
      processingDisposition: fastDuplicate.processingDisposition,
      candidate,
      duplicate: true,
      ...(fastDuplicate.timeEntryId ? { timeEntryId: fastDuplicate.timeEntryId } : {}),
      ...await duplicateShortcutStartOutcome(parsed, fastDuplicate.timeEntryId, session, boundedClient?.query)
    };
  }
  const client = boundedClient ?? await pool.connect();
  const transactionStartedAt = Date.now();
  let lockWaitMilliseconds = 0;

  try {
    if (!boundedClient) await client.query("begin");
    if (stopScope.mode === "entry") {
      await client.query("select set_config('lock_timeout', $1, true)", [SCOPED_STOP_LOCK_TIMEOUT]);
      await client.query("select set_config('statement_timeout', $1, true)", [SCOPED_STOP_STATEMENT_TIMEOUT]);
    }

    if (parsed.clientEventId) {
      const existingEvent = await client.query<{ id: string }>(
        `select id
         from activity_events
         where workspace_id = $1 and user_id = $2 and client_event_id = $3
         limit 1`,
        [parsed.workspaceId, parsed.userId, parsed.clientEventId]
      );

      if (existingEvent.rows[0]) {
        const existingTimeEntry = await getTimeEntryCreatedFromEvent(
          client,
          existingEvent.rows[0].id,
          session
        );
        if (!boundedClient) await client.query("commit");
        recordTimerMutationTiming({
          eventType: parsed.type,
          stopScope: stopScope.mode,
          lockWaitMilliseconds,
          transactionMilliseconds: Date.now() - transactionStartedAt,
          outcome: "duplicate"
        });
        return {
          eventId: existingEvent.rows[0].id,
          candidate,
          duplicate: true,
          ...(existingTimeEntry ? { timeEntryId: existingTimeEntry.id } : {}),
          ...await duplicateShortcutStartOutcome(parsed, existingTimeEntry?.id ?? null, session, client.query.bind(client))
        };
      }
    }

    if (isHealthEvent(parsed.type) || parsed.type === "commute_detected") {
      setSyncPhase(client, "owner_lock");
      await lockUserTimerState(client, session);
    }

    setSyncPhase(client, "effect");
    const sourceDecision: HealthSourceDecision = isHealthEvent(parsed.type)
      ? await inspectHealthSourceRevision(client,session,parsed.type,parsed.rawPayload) : {kind:"none"};
    if(sourceDecision.kind!=="none") {
      parsed.rawPayload.serverHealthSourceDecision={...sourceDecision,version:1};
      candidate={...candidate,
        action:sourceDecision.kind==="needs_review"?"create_review_item":"record_only",
        reviewStatus:sourceDecision.kind==="ignored"?"ignored":sourceDecision.kind==="needs_review"?"needs_review":"confirmed",
        reason:sourceDecision.kind==="ignored" ? "These Apple Health source samples were previously ignored; their decision is preserved."
          : sourceDecision.kind==="resolution_unavailable" ? "These source samples were previously resolved, but their recorded block is unavailable. No replacement was created."
          : sourceDecision.kind==="existing_workout" ? "This Apple Health source revision refers to the existing workout; later edits are preserved."
          : "This Health source revision needs review because its prior decisions or block links are ambiguous."
      };
    }

    if (isHealthEvent(parsed.type) && !candidate.categoryId) {
      candidate = {
        ...candidate,
        categoryId: await ensureHealthEventCategoryId(client, session, parsed.type)
      };
    }

    if (!suppressLegacyLocationSemantics && parsed.type === "commute_detected" && !candidate.categoryId) {
      candidate = {
        ...candidate,
        categoryId: await ensureCommuteCategoryId(client, session)
      };
    }

    if (!suppressLegacyLocationSemantics && parsed.type === "learned_place_visit" && await hasIgnoredLearnedPlaceCluster(client, parsed, session)) {
      candidate = {
        ...candidate,
        action: "record_only",
        reviewStatus: "ignored",
        reason: "This learned-place cluster was ignored, so Dayframe suppresses future save/review prompts for it."
      };
    }

    // Serialize the session lookup as well as its insert/update. Otherwise two
    // concurrent revisions can both see no existing Sleep before taking the lock.
    if (parsed.type === "health_sleep_import") {
      const lockStartedAt = Date.now();
      await lockUserTimerState(client, session);
      lockWaitMilliseconds = Date.now() - lockStartedAt;
    }
    const matchingHealthSleepEntry = parsed.type === "health_sleep_import" && sourceDecision.kind === "none"
      ? await findMatchingHealthSleepTimeEntry(
        client,
        session,
        parsed.rawPayload,
        suggestedStartedAtForEvent(parsed),
        suggestedStoppedAtForEvent(parsed)
      )
      : null;
    if (matchingHealthSleepEntry) {
      candidate = {
        ...candidate,
        action: "record_only",
        reviewStatus: "confirmed",
        reason: "This Apple Health update belongs to an existing logical Sleep session."
      };
    }

    if (candidate.action === "create_time_entry" && isHealthEvent(parsed.type)) {
      const start = suggestedStartedAtForEvent(parsed);
      const stop = suggestedStoppedAtForEvent(parsed);
      const safeWindow = validHealthWindow(start, stop);
      const unsafeSleep = parsed.type === "health_sleep_import" && safeWindow &&
        await hasUnsafeHealthSleepCollision(client, session, start, stop);
      if (!safeWindow || unsafeSleep) {
        candidate = {
          ...candidate, action: "create_review_item", reviewStatus: "needs_review",
          reason: unsafeSleep
            ? "This Sleep import may conflict with an existing logical session and needs review."
            : "This Health activity needs a complete valid time window."
        };
      }
    }

    if (candidate.action === "create_time_entry" && parsed.type === "commute_detected") {
      const conflict = await hasOverlappingTimeEntry(client, parsed, session);
      if (conflict) {
        candidate = {
          ...candidate,
          action: "create_review_item",
          reviewStatus: "needs_review",
          reason: "Automatic logging paused because this commute overlaps existing time. You can still confirm it from Review."
        };
      }
    }

    if (
      candidate.action === "start_timer" ||
      (candidate.action === "stop_timer" && stopScope.mode !== "entry") ||
      // A timer's "?" about a trip is settled under the owner lock, as replay and answers decide it (design §7).
      (candidate.action === "stop_timer" && timerTripChecksEnabled())
    ) {
      const lockStartedAt = Date.now();
      await lockUserTimerState(client, session);
      lockWaitMilliseconds = Date.now() - lockStartedAt;
    }

    const eventResult = await client.query<{ id: string }>(
      `insert into activity_events (
          workspace_id,
          user_id,
          device_id,
          client_event_id,
          source,
          event_type,
          occurred_at,
          confidence,
          raw_payload,
          suggested_project_id,
          suggested_category_id,
          suggested_place_id,
          review_status
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
       returning id`,
      [
        parsed.workspaceId,
        parsed.userId,
        parsed.deviceId ?? null,
        parsed.clientEventId ?? null,
        parsed.source,
        parsed.type,
        parsed.occurredAt,
        candidate.confidence,
        // Review decision keys are written only by the server's Review actions (E1).
        // Server-owned keys are stripped from client input; a Start the server runs is marked (server-1).
        JSON.stringify(withServerTimerStart(
          withoutServerStopOutcome(withoutServerReviewDecision(parsed.rawPayload)),
          candidate.action === "start_timer"
        )),
        candidate.projectId ?? null,
        candidate.categoryId ?? null,
        candidate.placeId ?? null,
        candidate.reviewStatus
      ]
    );
    const eventId = eventResult.rows[0].id;
    let timeEntryId: string | undefined = sourceDecision.kind === "existing_workout" ? sourceDecision.timeEntryId : undefined;
    let reviewItemId: string | undefined;
    let stopOutcome: "stopped" | "superseded" | "ignored_unscoped" | undefined =
      stopScope.mode === "ignored_unscoped" ? "ignored_unscoped" : undefined;
    let startOutcome: "recorded_completed" | "superseded" | undefined;

    if(sourceDecision.kind==="existing_workout") {
      await client.query(`update activity_events ae set resolved_time_entry_id=te.id from time_entries te
        where ae.id=$1 and ae.workspace_id=$2 and ae.user_id=$3 and te.id=$4 and te.workspace_id=ae.workspace_id and te.user_id=ae.user_id`,
        [eventId,session.workspaceId,session.userId,sourceDecision.timeEntryId]);
    }

    if (matchingHealthSleepEntry) {
      const updatedEntry = await updateHealthSleepTimeEntryWindow(
        client,
        session,
        matchingHealthSleepEntry,
        suggestedStartedAtForEvent(parsed),
        suggestedStoppedAtForEvent(parsed)
      );
      timeEntryId = updatedEntry?.id;
      if (timeEntryId) await recordHealthSleepResolution(client, session, eventId, timeEntryId);
    } else if (candidate.action === "stop_timer") {
      const scopedStopStartedAt = Date.now();
      const stopResult = stopScope.mode === "running_at"
        ? await stopBlocksRunningAt(client, parsed)
        : stopScope.mode === "entry"
        ? await stopEntryAt(client, parsed, stopScope.targetEntryId)
        : await stopCurrentTimerAt(client, parsed);
      if (stopScope.mode === "entry") {
        lockWaitMilliseconds = Date.now() - scopedStopStartedAt;
      }
      timeEntryId = stopResult.rows[0]?.id;
      stopOutcome = timeEntryId ? "stopped" : "superseded";
      // A Stop that ended a block before the trip it ran into (one queued offline) settles its "?" (design §7).
      if (stopResult.rows.length) {
        await reconcileTimerTripClashes(client, session, { entryIds: stopResult.rows.map((row) => row.id) });
      }
      // Server-owned: a Stop that ended a block is a boundary for a Shortcut Start placed later (#403).
      if (timeEntryId) {
        await client.query(
          `update activity_events set raw_payload = raw_payload || '{"serverStopOutcome":"stopped"}'::jsonb
           where id = $1
             and exists (select 1 from time_entries where id = $2 and source not in ('health_sleep', 'health_workout'))`,
          [eventId, timeEntryId]
        );
      }
    } else if (candidate.action === "start_timer") {
      const startedAt = suggestedStartedAtForEvent(parsed);
      // A Shortcut Start can reach the server after later blocks or a later Shortcut Stop (it waited
      // offline, or the app delivered it after a Stop). It then fills its own slot instead of replacing
      // the running block: the block it interrupted ends at its start, and it ends where the next block
      // starts or where the earliest later Stop ran (owner decision 14 Oct, #403 option c).
      // A Start made in the iPhone app and queued offline gets the same placement (owner decision
      // 22 Oct, PR A option a); it used to fail on every retry and hold every later timer change behind it.
      const lateStart = (parsed.source === "shortcut" || parsed.source === "mobile_app") &&
          isExplicitStartEvent(parsed.type)
        ? await lateShortcutStartWindow(client, session, startedAt, { sameStartSupersedes: parsed.source === "shortcut" })
        : null;
      if (lateStart?.kind === "same_start") {
        startOutcome = "superseded";
      } else if (lateStart?.kind === "window") {
        if (lateStart.interruptedEntryIds.length) {
          const interrupted = await client.query<{ id: string }>(
            `update time_entries
             set stopped_at = $1, updated_at = now()
             where workspace_id = $2 and user_id = $3 and id = any($4::uuid[])
               and started_at < $1 and (stopped_at is null or stopped_at > $1)
             returning id`,
            [startedAt, session.workspaceId, session.userId, lateStart.interruptedEntryIds]
          );
          // A late Start that ended a block before the trip it ran into settles its "?" (design §7).
          await reconcileTimerTripClashes(client, session, { entryIds: interrupted.rows.map((row) => row.id) });
        }
        startOutcome = "recorded_completed";
      } else if (candidate.shouldClosePrevious) {
        const replaced = await closeActiveTimersForReplacement(client, session, startedAt);
        await reconcileTimerTripClashes(client, session, { entryIds: replaced });
      }

      const timeEntryResult = startOutcome === "superseded" ? { rows: [] } : await client.query<{ id: string }>(
        `insert into time_entries (
            workspace_id,
            user_id,
            project_id,
            category_id,
            place_id,
            source,
            confidence,
            review_status,
            description,
            started_at,
            stopped_at,
            created_from_event_id
         )
         values ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8, $9, $10, $11)
         returning id`,
        [
          parsed.workspaceId,
          parsed.userId,
          candidate.projectId ?? null,
          candidate.categoryId ?? null,
          candidate.placeId ?? null,
          parsed.source,
          candidate.confidence,
          parsed.description ?? candidate.description ?? (isExplicitStartEvent(parsed.type) ? null : candidate.title),
          startedAt,
          lateStart?.kind === "window" ? lateStart.stoppedAt : null,
          eventId
        ]
      );
      timeEntryId = timeEntryResult.rows[0]?.id;
      if (timeEntryId) {
        await syncTimeEntryTags(client, timeEntryId, tagNamesFromRawPayload(parsed.rawPayload), session);
      }
    } else if (candidate.action === "create_time_entry") {
      const startedAt = suggestedStartedAtForEvent(parsed);
      const stoppedAt = suggestedStoppedAtForEvent(parsed);
      const createdEntry = await client.query<{ id: string }>(
        `insert into time_entries (
            workspace_id,
            user_id,
            project_id,
            category_id,
            place_id,
            source,
            confidence,
            review_status,
            description,
            started_at,
            stopped_at,
            created_from_event_id
         )
         values ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8, $9, coalesce($10, $9::timestamptz + interval '1 hour'), $11) returning id`,
        [
          parsed.workspaceId,
          parsed.userId,
          candidate.projectId ?? null,
          candidate.categoryId ?? null,
          candidate.placeId ?? null,
          parsed.source,
          candidate.confidence,
          descriptionForCreatedTimeEntry(parsed, candidate),
          startedAt,
          stoppedAt,
          eventId
        ]
      );
      timeEntryId = createdEntry.rows[0]?.id;
    }

    if (candidate.reviewStatus === "needs_review") {
      const suggestedStartedAt = suggestedStartedAtForEvent(parsed);
      const suggestedStoppedAt = suggestedStoppedAtForEvent(parsed);
      const createdReview = await client.query<{id: string}>(
        `insert into review_items (
            workspace_id,
            user_id,
            event_id,
            type,
            title,
            suggested_project_id,
            suggested_category_id,
            suggested_place_id,
            suggested_started_at,
            suggested_stopped_at,
            confidence,
            status,
            notes
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open', $12) returning id`,
        [
          parsed.workspaceId,
          parsed.userId,
          eventId,
          `${parsed.type}_suggestion`,
          candidate.title,
          candidate.projectId ?? null,
          candidate.categoryId ?? null,
          candidate.placeId ?? null,
          suggestedStartedAt,
          suggestedStoppedAt,
          candidate.confidence,
          candidate.reason
        ]
      );
      reviewItemId = createdReview.rows[0]?.id;
    }

    // A newer revision of the same Health episode, now visible as a block or its own card, retires
    // the earlier revisions' still-open cards in this transaction (stability audit health-6).
    if (isHealthEvent(parsed.type) && (timeEntryId || reviewItemId)) {
      await supersedeEarlierHealthRevisionReviews(client, session, parsed.type, eventId, parsed.rawPayload);
    }

    if (parsed.type === "health_sleep_import") {
      for (const segment of healthSleepSegmentsForEvent(parsed)) {
        await client.query(
          `insert into health_sleep_segments (
              workspace_id,
              user_id,
              external_sample_id,
              provider,
              source_name,
              sleep_stage,
              started_at,
              stopped_at,
              raw_payload
           )
           values ($1, $2, $3, coalesce($4, 'healthkit'), $5, coalesce($6, 'asleep_unspecified'), $7, $8, $9::jsonb)
           on conflict (workspace_id, provider, external_sample_id)
           where external_sample_id is not null
           do nothing`,
          [
            parsed.workspaceId,
            parsed.userId,
            segment.externalSampleId,
            segment.provider,
            segment.sourceName,
            segment.sleepStage,
            segment.startedAt,
            segment.stoppedAt,
            JSON.stringify(segment.rawPayload)
          ]
        );
      }
    }

    if (parsed.type === "health_workout_import") {
      await client.query(
        `insert into health_workouts (
            workspace_id,
            user_id,
            external_sample_id,
            provider,
            workout_type,
            started_at,
            stopped_at,
            duration_seconds,
            distance_meters,
            energy_kcal,
            raw_payload
         )
         values ($1, $2, $3, coalesce($4, 'healthkit'), coalesce($5, 'other'), $6, $7, $8, $9, $10, $11::jsonb)
         on conflict (workspace_id, provider, external_sample_id)
         where external_sample_id is not null
         do nothing`,
        [
          parsed.workspaceId,
          parsed.userId,
          stringOrNull(parsed.rawPayload.externalSampleId),
          stringOrNull(parsed.rawPayload.provider),
          stringOrNull(parsed.rawPayload.workoutType),
          stringOrNull(parsed.rawPayload.startedAt) ?? parsed.occurredAt,
          stringOrNull(parsed.rawPayload.stoppedAt) ?? parsed.occurredAt,
          wholeSecondsOrNull(parsed.rawPayload.durationSeconds),
          numberOrNull(parsed.rawPayload.distanceMeters),
          numberOrNull(parsed.rawPayload.energyKcal),
          JSON.stringify(parsed.rawPayload)
        ]
      );
    }

    if (
      !suppressLegacyLocationSemantics &&
      parsed.type === "learned_place_visit" &&
      candidate.reviewStatus !== "ignored" &&
      classifyLocationLearningEvidence(locationLearningEvidenceFromPayload(parsed.rawPayload)).kind === "place_candidate"
    ) {
      await upsertLearnedPlaceVisit(client, parsed, session);
    }

    if (!boundedClient) await client.query("commit");
    if (candidate.action === "start_timer" || candidate.action === "stop_timer") {
      recordTimerMutationTiming({
        eventType: parsed.type,
        stopScope: stopScope.mode,
        lockWaitMilliseconds,
        transactionMilliseconds: Date.now() - transactionStartedAt,
        outcome: candidate.action === "start_timer"
          ? "started"
          : stopOutcome === "stopped" ? "stopped" : "superseded"
      });
    }
    return {
      eventId,
      processingDisposition: sourceDecision.kind==="resolution_unavailable" ? "prior_resolution_unavailable" : sourceDecision.kind==="ignored" ? "prior_ignore_preserved" : candidate.reviewStatus,
      candidate,
      timeEntryId,
      reviewItemId,
      stopOutcome,
      ...(startOutcome ? { startOutcome } : {}),
      ...(matchingHealthSleepEntry ? { updatedExistingTimeEntry: true } : {})
    };
  } catch (error) {
    if (!boundedClient) await client.query("rollback");
    if (stopScope.mode === "entry" && (isLockNotAvailableError(error) || isStatementTimeoutError(error))) {
      recordTimerMutationTiming({
        eventType: parsed.type,
        stopScope: stopScope.mode,
        lockWaitMilliseconds,
        transactionMilliseconds: Date.now() - transactionStartedAt,
        outcome: "timer_busy"
      });
      throw new TimerMutationBusyError();
    }
    if (!boundedClient && parsed.clientEventId && isUniqueViolationError(error)) {
      const duplicate = await findExistingActivityEventReceipt(parsed.clientEventId, session);
      if (duplicate) {
        recordTimerMutationTiming({
          eventType: parsed.type,
          stopScope: stopScope.mode,
          lockWaitMilliseconds,
          transactionMilliseconds: Date.now() - transactionStartedAt,
          outcome: "duplicate"
        });
        return {
          eventId: duplicate.eventId,
          candidate,
          duplicate: true,
          ...(duplicate.timeEntryId ? { timeEntryId: duplicate.timeEntryId } : {}),
          ...await duplicateShortcutStartOutcome(parsed, duplicate.timeEntryId, session)
        };
      }
    }
    throw eventSyncReadinessError(error, parsed.type) ?? error;
  } finally {
    if (!boundedClient) client.release();
  }
}

const SERVER_STOP_OUTCOME_KEY = "serverStopOutcome";
/**
 * Server-owned: written on every explicit Start event the server runs as a timer (`start_timer`), and on
 * a split's `timer_switch`, never taken from client input. It marks the blocks those events create as
 * blocks a timer started (TIMER_STARTED_SQL, stability audit server-1; Codex r1 on #538).
 */

function withoutServerStopOutcome<T extends Record<string, unknown>>(payload: T): T {
  if (!payload || typeof payload !== "object") return payload;
  if (!(SERVER_STOP_OUTCOME_KEY in payload) && !(SERVER_TIMER_START_KEY in payload)) return payload;
  const rest: Record<string, unknown> = { ...payload };
  delete rest[SERVER_STOP_OUTCOME_KEY];
  delete rest[SERVER_TIMER_START_KEY];
  return rest as T;
}

function withServerTimerStart<T extends Record<string, unknown>>(payload: T, timerStart: boolean) {
  return timerStart ? { ...payload, [SERVER_TIMER_START_KEY]: true } : payload;
}

/**
 * A repeated Shortcut Start says whether its block is running now, as the first delivery did, so the iOS
 * intent never keeps a Live Activity for a Start the server placed as finished or superseded (#403).
 */
async function duplicateShortcutStartOutcome(
  event: { source: string; type: string },
  timeEntryId: string | null | undefined,
  session: RequestSession,
  execute: typeof query = query
): Promise<{ startOutcome?: "recorded_completed" | "superseded" }> {
  if ((event.source !== "shortcut" && event.source !== "mobile_app") || !isExplicitStartEvent(event.type)) return {};
  if (!timeEntryId) return { startOutcome: "superseded" };
  const result = await execute<{ stopped: boolean }>(
    `select stopped_at is not null as stopped from time_entries
     where workspace_id = $1 and user_id = $2 and id = $3`,
    [session.workspaceId, session.userId, timeEntryId]
  );
  return result?.rows?.[0]?.stopped === false ? {} : { startOutcome: "recorded_completed" };
}

async function findExistingActivityEventReceipt(
  clientEventId: string,
  session: RequestSession,
  execute: typeof query = query
) {
  const result = await execute<{ eventId: string; timeEntryId: string | null; processingDisposition: string }>(
    `select ae.id as "eventId",
            te.id as "timeEntryId",
            case ae.raw_payload->'serverHealthSourceDecision'->>'kind'
              when 'resolution_unavailable' then 'prior_resolution_unavailable'
              when 'ignored' then 'prior_ignore_preserved'
              else ae.review_status::text end as "processingDisposition"
     from activity_events ae
     left join lateral (
       select id
       from time_entries
       where workspace_id = ae.workspace_id
         and user_id = ae.user_id
         and (created_from_event_id = ae.id or id = ae.resolved_time_entry_id)
       limit 1
     ) te on true
     where ae.workspace_id = $1
       and ae.user_id = $2
       and ae.client_event_id = $3
     limit 1`,
    [session.workspaceId, session.userId, clientEventId]
  );
  return result?.rows?.[0] ?? null;
}

function recordTimerMutationTiming(input: {
  eventType: string;
  stopScope: TimerStopScope["mode"];
  lockWaitMilliseconds: number;
  transactionMilliseconds: number;
  outcome: "started" | "stopped" | "superseded" | "duplicate" | "timer_busy";
}) {
  console.info("Dayframe timer mutation", input);
}

type TimerStopScope =
  | { mode: "entry"; targetEntryId: string }
  | { mode: "current" }
  | { mode: "running_at" }
  | { mode: "ignored_unscoped" };

function timerStopScope(event: {
  source: string;
  type: string;
  rawPayload: Record<string, unknown>;
}): TimerStopScope {
  if (event.type !== "timer_stop") return { mode: "current" };
  const targetEntryId = uuidStringOrNull(event.rawPayload.targetEntryId);
  if (event.rawPayload.stopScope === "entry" && targetEntryId) {
    return { mode: "entry", targetEntryId };
  }
  if (event.rawPayload.stopScope === "current") {
    return { mode: "current" };
  }
  // A Shortcut or NFC Stop stops whatever was running when it ran, never a block started after it,
  // so a Stop delivered late (offline, or after a Start that was still waiting) cannot end a newer block.
  if (event.rawPayload.stopScope === "running_at") {
    return { mode: "running_at" };
  }
  // Older iOS App Intent builds used the same anonymous event for a Live
  // Activity button and the explicit Stop shortcut. It is impossible to tell
  // whether such an event belongs to a stale activity, so fail closed. Other
  // authenticated clients retain their existing current-timer semantics.
  if (event.source === "shortcut" && event.rawPayload.origin === "ios_app_intent") {
    return { mode: "ignored_unscoped" };
  }
  return { mode: "current" };
}

async function lockUserTimerState(client: pg.PoolClient, session: RequestSession) {
  await client.query(
    "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
    [session.workspaceId, session.userId]
  );
}

// Health sleep and workout entries may overlap tracked blocks: Shortcut Stops and late Starts never end
// them or use them as bounds.
const TIMELINE_BLOCK_FILTER = `
           and review_status = 'confirmed' and source not in ('health_sleep', 'health_workout')`;

/** A Shortcut Start delivered this long after it happened is late (queued offline, or replayed by the app). */
const LATE_SHORTCUT_START_MS = 10_000;

/**
 * Where a Shortcut Start belongs when it reaches the server late, or null when it is the newest thing on
 * the timeline (the usual case: it replaces the running block). Runs under the user's timer lock.
 *
 * The rules give the same timeline whatever order a phone's queued Starts and `running_at` Stops arrive in
 * (#403): a late Start ends the block that covered its moment there, and itself ends at the earliest of the
 * next block's start and any recorded Stop after it; a `running_at` Stop ends whatever covered its moment.
 * A Start that arrives on time always runs, so a phone clock a little behind the server never turns a fresh
 * Start into a finished block. One that arrives on time but older than a block already started is placed
 * as late (it used to fail with `TimerReplacementWindowError`).
 */
async function lateShortcutStartWindow(
  client: pg.PoolClient,
  session: RequestSession,
  startedAt: string | Date,
  // The phone needs a block for every in-app Start it delivers, so only a Shortcut Start at the same
  // moment as an existing block is folded into it.
  options: { sameStartSupersedes: boolean } = { sameStartSupersedes: true }
): Promise<
  | { kind: "window"; stoppedAt: Date; interruptedEntryIds: string[] }
  | { kind: "same_start" }
  | null
> {
  const startedMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedMs)) return null;
  const at = new Date(startedMs);
  const sameStart = await client.query(
    `select 1 from time_entries
     where workspace_id = $1 and user_id = $2 and started_at = $3${TIMELINE_BLOCK_FILTER}
     limit 1`,
    [session.workspaceId, session.userId, at]
  );
  if (sameStart.rows.length) {
    // An in-app Start at exactly another block's start is refused rather than placed beside it (Codex r1
    // on #531): the phone needs a block of its own for it, and two blocks can't share a start.
    if (!options.sameStartSupersedes) throw new TimerReplacementWindowError();
    return { kind: "same_start" };
  }
  // Lock what covers the Start's moment first, so a concurrent entry-scoped Stop (which does not take the
  // timer lock) either commits before these rows are read or waits for this transaction.
  const covering = await client.query<{ id: string; stoppedAt: string | Date | null }>(
    `select id, stopped_at as "stoppedAt" from time_entries
     where workspace_id = $1 and user_id = $2 and started_at < $3
       and (stopped_at is null or stopped_at > $3)${TIMELINE_BLOCK_FILTER}
     -- Entry-id order, as every multi-entry lock (grouped edits, batch deletes; Codex r1 on #538).
     order by id
     for update`,
    [session.workspaceId, session.userId, at]
  );
  const later = await client.query<{
    nextStartedAt: string | Date | null;
    laterShortcutStopAt: string | Date | null;
    laterStopAt: string | Date | null;
  }>(
    `select
       (select min(started_at) from time_entries
         where workspace_id = $1 and user_id = $2 and started_at > $3${TIMELINE_BLOCK_FILTER}) as "nextStartedAt",
       (select min(occurred_at) from activity_events
         where workspace_id = $1 and user_id = $2 and occurred_at > $3
           and event_type = 'timer_stop' and source = 'shortcut'
           and raw_payload->>'stopScope' = 'running_at') as "laterShortcutStopAt",
       (select min(occurred_at) from activity_events
         where workspace_id = $1 and user_id = $2 and occurred_at > $3
           and event_type = 'timer_stop'
           and raw_payload->>'serverStopOutcome' = 'stopped') as "laterStopAt"`,
    [session.workspaceId, session.userId, at]
  );
  const nextStartedAt = later.rows[0]?.nextStartedAt ?? null;
  // A Shortcut Stop after the Start comes from a phone's own clock, so it always bounds the Start (a Stop
  // delivered first, even seconds later). Ends written by other clients (a web Stop, a block that was
  // already finished) bound it only once the Start is late, so a phone clock a little behind the server
  // never turns a fresh Start into a finished block.
  const late = Date.now() - startedMs > LATE_SHORTCUT_START_MS;
  const bounds = [
    nextStartedAt,
    later.rows[0]?.laterShortcutStopAt ?? null,
    ...(late ? [later.rows[0]?.laterStopAt ?? null, ...covering.rows.map((row) => row.stoppedAt)] : []),
  ]
    .filter((value): value is string | Date => value !== null && value !== undefined)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value) && value > startedMs);
  if (!bounds.length) return null;
  return {
    kind: "window",
    stoppedAt: new Date(Math.min(...bounds)),
    // A covering manual or Review block, or one whose end a person set, keeps its end and still bounds
    // the Start (stability audit server-1).
    interruptedEntryIds: await blocksATimerMayEnd(client, session, covering.rows),
  };
}


/**
 * Of the locked blocks covering a Stop's or late Start's moment, the ones it may end there: the running
 * block, and a finished block a timer started whose later end no person set (PRD D20). A manual entry,
 * a Review/Location block, or an end a person set keeps its end (stability audit server-1). Read in a
 * fresh statement after the rows are locked, as `stopEntryAt` does, so an edit committed while this
 * waited is seen.
 */
async function blocksATimerMayEnd(
  client: pg.PoolClient,
  scope: { workspaceId: string; userId: string },
  rows: Array<{ id: string; stoppedAt: string | Date | null }>
) {
  const running = rows.filter((row) => row.stoppedAt === null).map((row) => row.id);
  const finished = rows.filter((row) => row.stoppedAt !== null).map((row) => row.id);
  if (!finished.length) return running;
  const result = await client.query<{ id: string }>(
    `select te.id from time_entries te
     where te.workspace_id = $1 and te.user_id = $2 and te.id = any($3::uuid[])
       and ${TIMER_STARTED_SQL} and not ${PERSON_SET_END_SQL}`,
    [scope.workspaceId, scope.userId, finished]
  );
  return [...running, ...result.rows.map((row) => row.id)];
}

async function stopEntryAt(
  client: pg.PoolClient,
  event: { occurredAt: string | Date; workspaceId: string; userId: string },
  targetEntryId: string
) {
  // Lock first, read provenance after (Codex r4 on #531). Under READ COMMITTED a statement that waits for
  // the row lock returns the row as the blocker committed it, but its subqueries keep the snapshot taken
  // before the wait, so they would miss the audit row that a concurrent end edit inserted.
  const target = await client.query<{ startedAt: string | Date; stoppedAt: string | Date | null; health: boolean }>(
    `select te.started_at as "startedAt", te.stopped_at as "stoppedAt",
            te.source in ('health_sleep', 'health_workout') as "health"
     from time_entries te
     where te.workspace_id = $1 and te.user_id = $2 and te.id = $3
     for update of te`,
    [event.workspaceId, event.userId, targetEntryId]
  );
  const block = target.rows[0];
  if (!block) return { rows: [] as Array<{ id: string }> };
  const startedMs = new Date(block.startedAt).getTime();
  const stopMs = new Date(event.occurredAt).getTime();
  if (block.stoppedAt === null) {
    if (startedMs >= stopMs) throw new TimerStopBeforeStartError();
  } else {
    // A block that already ended later than its own Stop, at an end no person chose (a later Start
    // replaced it, a late Start was placed or bounded, or another device stopped it later), ends where
    // this Stop ran: the phone queued it first (PRD D20; Codex r1–r4 on #531, stability audit
    // iphone-timer-sync-2). An end a person set, a Health entry, or an earlier end stays; a saved title,
    // activity or tags is not an end a person chose. The facts come from the locked row itself, so a
    // concurrent replacement can't hide them.
    const laterEnd = !block.health && new Date(block.stoppedAt).getTime() > stopMs && startedMs < stopMs;
    if (!laterEnd) return { rows: [] as Array<{ id: string }> };
    // A fresh statement, so it sees every edit committed before this transaction got the lock.
    // Only a block a timer started: a manual or Review block's end is the person's (stability audit server-1).
    const mayEnd = await blocksATimerMayEnd(client, event, [{ id: targetEntryId, stoppedAt: block.stoppedAt }]);
    if (!mayEnd.length) return { rows: [] as Array<{ id: string }> };
  }
  return client.query<{ id: string }>(
    `update time_entries
     set stopped_at = $1, updated_at = now()
     where workspace_id = $2
       and user_id = $3
       and id = $4
     returning id`,
    [event.occurredAt, event.workspaceId, event.userId, targetEntryId]
  );
}

/**
 * A Shortcut/NFC Stop (`stopScope: running_at`, #403): the blocks that covered its moment end there,
 * running or already finished at a later end a timer gave them (a Start delivered before its Stop), never
 * a block started after it. A manual or Review block, or an end a person set, is never cut by a Stop that
 * waited offline (stability audit server-1). The caller holds the user timer lock.
 */
async function stopBlocksRunningAt(
  client: pg.PoolClient,
  event: { occurredAt: string | Date; workspaceId: string; userId: string }
) {
  const covering = await client.query<{ id: string; stoppedAt: string | Date | null }>(
    `select id, stopped_at as "stoppedAt" from time_entries
     where workspace_id = $2 and user_id = $3
       and started_at < $1 and (stopped_at is null or stopped_at > $1)${TIMELINE_BLOCK_FILTER}
     -- Entry-id order, as every multi-entry lock (grouped edits, batch deletes; Codex r1 on #538).
     order by id
     for update`,
    [event.occurredAt, event.workspaceId, event.userId]
  );
  const ids = await blocksATimerMayEnd(client, event, covering.rows);
  if (!ids.length) return { rows: [] as Array<{ id: string }> };
  return client.query<{ id: string }>(
    `update time_entries
     set stopped_at = $1, updated_at = now()
     where workspace_id = $2 and user_id = $3 and id = any($4::uuid[])
       and started_at < $1 and (stopped_at is null or stopped_at > $1)
     returning id`,
    [event.occurredAt, event.workspaceId, event.userId, ids]
  );
}

/**
 * The unscoped Stop: the newest running block, locked before its start is checked so a concurrent start
 * edit can't move it past the Stop between the check and the update (Codex r1 on #531).
 */
async function stopCurrentTimerAt(
  client: pg.PoolClient,
  event: { occurredAt: string | Date; workspaceId: string; userId: string }
) {
  const current = await client.query<{ id: string; startedAt: string | Date }>(
    `select id, started_at as "startedAt" from time_entries
     where workspace_id = $1 and user_id = $2 and stopped_at is null
     order by started_at desc
     limit 1
     for update`,
    [event.workspaceId, event.userId]
  );
  const running = current.rows[0];
  if (!running) return { rows: [] as Array<{ id: string }> };
  if (new Date(running.startedAt).getTime() >= new Date(event.occurredAt).getTime()) {
    throw new TimerStopBeforeStartError();
  }
  return client.query<{ id: string }>(
    `update time_entries set stopped_at = $1, updated_at = now()
     where workspace_id = $2 and user_id = $3 and id = $4 and stopped_at is null
     returning id`,
    [event.occurredAt, event.workspaceId, event.userId, running.id]
  );
}

async function closeActiveTimersForReplacement(
  client: pg.PoolClient,
  session: RequestSession,
  stoppedAt: string | Date
) {
  const activeResult = await client.query<{ id: string; startedAt: string | Date }>(
    `select id, started_at as "startedAt"
     from time_entries
     where workspace_id = $1 and user_id = $2 and stopped_at is null
     order by started_at desc
     limit 1
     for update`,
    [session.workspaceId, session.userId]
  );
  const activeEntry = activeResult.rows[0];
  if (!activeEntry) return [];

  const activeStartedMs = new Date(activeEntry.startedAt).getTime();
  const stoppedMs = new Date(stoppedAt).getTime();
  if (!Number.isFinite(activeStartedMs) || !Number.isFinite(stoppedMs) || stoppedMs <= activeStartedMs) {
    throw new TimerReplacementWindowError();
  }

  const ended = await client.query<{ id: string }>(
    `update time_entries
     set stopped_at = $1, updated_at = now()
     where workspace_id = $2
       and user_id = $3
       and stopped_at is null
       and started_at < $1
     returning id`,
    [stoppedAt, session.workspaceId, session.userId]
  );
  return ended.rows.map((row) => row.id);
}

export async function createManualEntry(input: {
  projectId?: string | null;
  categoryId?: string | null;
  placeId?: string | null;
  description?: string | null;
  startedAt: string;
  stoppedAt: string;
  tagNames?: string[];
}, session: RequestSession = getDevSession()) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const eventResult = await client.query<{ id: string }>(
      `insert into activity_events (
          workspace_id,
          user_id,
          source,
          event_type,
          occurred_at,
          confidence,
          raw_payload,
          suggested_project_id,
          suggested_category_id,
          suggested_place_id,
          review_status
       )
       values ($1, $2, 'manual_app', 'timer_start', $3, 'high', $4::jsonb, $5, $6, $7, 'confirmed')
       returning id`,
      [
        session.workspaceId,
        session.userId,
        input.startedAt,
        // Never an `origin` key: its absence marks this as a manual entry, which no Stop or Start that
        // arrives later cuts (TIMER_STARTED_SQL, stability audit server-1).
        JSON.stringify({
          description: input.description ?? "Manual entry",
          tagNames: input.tagNames ?? []
        }),
        nullableString(input.projectId),
        nullableString(input.categoryId),
        nullableString(input.placeId)
      ]
    );

    const entryResult = await client.query<{ id: string }>(
      `insert into time_entries (
          workspace_id,
          user_id,
          project_id,
          category_id,
          place_id,
          source,
          confidence,
          review_status,
          description,
          started_at,
          stopped_at,
          created_from_event_id
       )
       values ($1, $2, $3, $4, $5, 'manual_app', 'high', 'confirmed', $6, $7, $8, $9)
       returning id`,
      [
        session.workspaceId,
        session.userId,
        nullableString(input.projectId),
        nullableString(input.categoryId),
        nullableString(input.placeId),
        input.description ?? null,
        input.startedAt,
        input.stoppedAt,
        eventResult.rows[0].id
      ]
    );

    const entryId = entryResult.rows[0].id;
    await syncTimeEntryTags(client, entryId, input.tagNames ?? [], session);

    await client.query("commit");
    return { id: entryId };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createCategory(
  input: {
    name: string;
    color?: string | null;
    isPinned?: boolean;
    icon?: string | null;
    /** Left out, a new activity counts toward the goal unless it is named Sleep. */
    countsTowardGoal?: boolean;
  },
  session: RequestSession = getDevSession()
) {
  const name = normalizeName(input.name, "New activity");
  const color = normalizePaletteKey(input.color, name);
  const icon = isActivityIconKey(input.icon) ? input.icon : null;
  const client = await pool.connect();

  try {
    await client.query("begin");
    // The name lock first (as automatic Sleep/Commute/Health creation takes it), then the
    // workspace: the same order as every other activity writer.
    await lockActivityNames(client, session.workspaceId, [name]);
    await client.query(
      "select id from workspaces where id = $1 for no key update",
      [session.workspaceId]
    );
    const duplicate = await client.query<{ id: string }>(
      `select id
       from categories
       where workspace_id = $1
         and is_archived = false
         and lower(btrim(name)) = lower($2)
       limit 1`,
      [session.workspaceId, name]
    );
    if (duplicate.rows[0]) throw new CategoryConflictError();
    // A full quick start still creates the activity, just unpinned (the answer says so), so a
    // create never fails for a pin the person can add later.
    const pin = Boolean(input.isPinned) &&
      (await pinnedCategoryCount(client, session.workspaceId, null)) < QUICK_START_PIN_LIMIT;

    const result = await client.query<CategoryRowLike>(
      `insert into categories (workspace_id, name, color, is_pinned, icon, counts_toward_goal)
       values ($1, $2, $3, $4, $5, $6)
       ${CATEGORY_RETURNING}`,
      [
        session.workspaceId,
        name,
        color,
        pin,
        icon,
        input.countsTowardGoal ?? defaultCountsTowardGoal(name)
      ]
    );

    await client.query("commit");
    return result.rows[0];
  } catch (error) {
    await client.query("rollback");
    if (isUndefinedColumnError(error, "is_pinned")) throw missingCategoryPinColumnError(error);
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureAutomaticLoggingCategories(
  kinds: AutomaticLoggingCategoryKind[],
  session: RequestSession = getDevSession()
) {
  const uniqueKinds = [...new Set(kinds)];
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Lock (and create) in alphabetical order so this never deadlocks with the starters route;
    // answer in the order the caller asked.
    const byKind = new Map<AutomaticLoggingCategoryKind, { id: string } & ReturnType<typeof automaticLoggingCategorySpec>>();
    for (const kind of [...uniqueKinds].sort()) {
      const spec = automaticLoggingCategorySpec(kind);
      const id = await ensureAutomaticCategoryId(client, session, spec);
      byKind.set(kind, { id, ...spec });
    }
    const categories = uniqueKinds.map((kind) => byKind.get(kind)!);
    await client.query("commit");
    return categories;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCategory(
  id: string,
  input: {
    name?: string | null;
    color?: string | null;
    isPinned?: boolean;
    icon?: string | null;
    /** Whether the activity's time fills the daily goal (UIA-043). */
    countsTowardGoal?: boolean;
    /** false restores an archived activity (Blocks 6b-2); archiving stays DELETE. */
    isArchived?: false;
  },
  session: RequestSession = getDevSession()
) {
  const hasIcon = Object.prototype.hasOwnProperty.call(input, "icon");
  const hasName = Object.prototype.hasOwnProperty.call(input, "name");
  const hasColor = Object.prototype.hasOwnProperty.call(input, "color");
  const hasIsPinned = Object.prototype.hasOwnProperty.call(input, "isPinned");
  const hasCountsTowardGoal = typeof input.countsTowardGoal === "boolean";
  const restoreRequested = input.isArchived === false;
  const normalizedName = hasName ? normalizeName(input.name, "Activity") : null;
  const normalizedColor = hasColor
    ? normalizePaletteKey(input.color, normalizedName ?? id)
    : null;
  const client = await pool.connect();

  try {
    await client.query("begin");
    // Lock order shared by every activity writer: per-name locks (sorted), then the workspace
    // row, then the activity row. A rename locks its new name; a restore locks the archived
    // name and its starter's name, so automatic creation of either waits for this answer.
    // (An archived row cannot be renamed, so what is read here still holds once locked.)
    const before = restoreRequested
      ? await client.query<{ name: string; starterKey: string | null }>(
        `select name, starter_key as "starterKey" from categories where id = $1 and workspace_id = $2`,
        [id, session.workspaceId]
      )
      : null;
    const beforeStarterKey = before?.rows[0]?.starterKey ?? null;
    await lockActivityNames(client, session.workspaceId, [
      normalizedName,
      hasName ? null : before?.rows[0]?.name,
      beforeStarterKey && isStarterActivityKey(beforeStarterKey) ? starterActivityByKey(beforeStarterKey).name : null
    ]);
    // The same workspace lock as createCategory, so a rename, a pin or a restore is checked
    // against the activities as they are, not as two racing requests each saw them.
    await client.query(
      "select id from workspaces where id = $1 for no key update",
      [session.workspaceId]
    );
    // NO KEY UPDATE, not FOR UPDATE: it never waits on inserts that merely reference this
    // activity (location or Health capture holding a key-share lock while it waits for a name
    // lock this request already holds).
    const current = await client.query<{ name: string; isPinned: boolean; isArchived: boolean; starterKey: string | null }>(
      `select name, is_pinned as "isPinned", is_archived as "isArchived", starter_key as "starterKey"
       from categories
       where id = $1 and workspace_id = $2
       for no key update`,
      [id, session.workspaceId]
    );
    const row = current.rows[0];
    const restoring = restoreRequested && row?.isArchived === true;
    // An archived activity can only be restored; anything else about it stays not-found.
    if (!row || (row.isArchived && !restoring)) {
      await client.query("rollback");
      return null;
    }
    if (restoring && !hasName && row.name !== before?.rows[0]?.name) {
      // Unreachable while archived rows cannot be renamed; refuse rather than check an unlocked name.
      throw new CategoryConflictError();
    }

    const finalName = normalizedName ?? row.name;
    if (hasName || restoring) {
      const duplicate = await client.query<{ id: string }>(
        `select id
         from categories
         where workspace_id = $1
           and id <> $2
           and is_archived = false
           and lower(btrim(name)) = lower($3)
         limit 1`,
        [session.workspaceId, id, finalName]
      );
      if (duplicate.rows[0]) throw new CategoryConflictError();
    }

    // Quick start holds QUICK_START_PIN_LIMIT: only a new pin is checked, so editing an activity
    // that is already pinned (or a workspace already over the limit) keeps working.
    // A restore always comes back unpinned: it wins over any pin in the same request and is
    // never refused for a full quick start.
    const wasPinned = row.isPinned && !row.isArchived;
    if (!restoring && hasIsPinned && input.isPinned && !wasPinned) {
      const pinned = await pinnedCategoryCount(client, session.workspaceId, id);
      if (pinned >= QUICK_START_PIN_LIMIT) throw new QuickStartFullError();
    }

    // A starter recreated while this one was archived (automatic Sleep, say) keeps its starter
    // key; the restored activity comes back as a plain activity instead of colliding with it.
    let dropStarterKey = false;
    if (restoring && row.starterKey) {
      const keyed = await client.query<{ id: string }>(
        `select id
         from categories
         where workspace_id = $1
           and id <> $2
           and starter_key = $3
           and is_archived = false
         limit 1`,
        [session.workspaceId, id, row.starterKey]
      );
      dropStarterKey = Boolean(keyed.rows[0]);
    }

    const result = await client.query<CategoryRowLike>(
      `update categories
       set name = case when $3 then $4 else name end,
           color = case when $5 then $6 else color end,
           is_pinned = case when $11 then false when $7 then $8 else is_pinned end,
           icon = case when $9 then $10 else icon end,
           is_archived = case when $11 then false else is_archived end,
           starter_key = case when $12 then null else starter_key end,
           counts_toward_goal = case when $13 then $14 else counts_toward_goal end
       where id = $1 and workspace_id = $2
       ${CATEGORY_RETURNING}`,
      [
        id,
        session.workspaceId,
        hasName,
        normalizedName,
        hasColor,
        normalizedColor,
        hasIsPinned,
        Boolean(input.isPinned),
        hasIcon,
        hasIcon && isActivityIconKey(input.icon) ? input.icon : null,
        restoring,
        dropStarterKey,
        hasCountsTowardGoal,
        input.countsTowardGoal !== false
      ]
    );

    await client.query("commit");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("rollback");
    if (isUndefinedColumnError(error, "is_pinned")) throw missingCategoryPinColumnError(error);
    throw error;
  } finally {
    client.release();
  }
}

async function pinnedCategoryCount(
  client: { query: <T>(statement: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  workspaceId: string,
  exceptId: string | null
) {
  const result = await client.query<{ count: string | number }>(
    `select count(*) as count
     from categories
     where workspace_id = $1
       and is_archived = false
       and is_pinned = true
       and ($2::uuid is null or id <> $2::uuid)`,
    [workspaceId, exceptId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Archived activities, for Settings › Activities › Archived (Blocks 6b-2). */
export async function listArchivedCategories(session: RequestSession = getDevSession()) {
  const result = await query<CategoryRowLike>(
    `select ${CATEGORY_COLUMNS}
     from categories
     where workspace_id = $1 and is_archived = true
     order by lower(name), id`,
    [session.workspaceId]
  );
  return result.rows;
}

export async function archiveCategory(id: string, session: RequestSession = getDevSession()) {
  try {
    await query(
      `update categories
       set is_archived = true,
           is_pinned = false
       where id = $1 and workspace_id = $2`,
      [id, session.workspaceId]
    );
  } catch (error) {
    if (isUndefinedColumnError(error, "is_pinned")) throw missingCategoryPinColumnError(error);
    throw error;
  }
}

export type NewPlaceRole = { role: PlaceRole; previousPlaceName?: string | null; archivePrevious?: boolean };

export async function createPlace(
  input: PlaceMutationFields,
  session: RequestSession = getDevSession(),
  newRole?: NewPlaceRole
) {
  if (!newRole) {
    return insertPlaceRecord(
      <T extends pg.QueryResultRow>(statement: string, values?: unknown[]) => query<T>(statement, values),
      input,
      session
    );
  }
  // A place added straight into the Home or Work slot takes the role in the same transaction.
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (newRole.archivePrevious) await lockLocationOwnersForArchive(client, session.workspaceId);
    const place = await insertPlaceRecord(
      <T extends pg.QueryResultRow>(statement: string, values?: unknown[]) => client.query<T>(statement, values),
      input,
      session
    );
    const assigned = await assignPlaceRoleWith(client, session, { ...newRole, placeId: place.id, targetIsNew: true });
    await client.query("commit");
    return { ...place, role: newRole.role, ...previousArchivedOf(assigned) };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createPlaceFromLearnedPlace(
  learnedPlaceId: string,
  input: PlaceMutationFields,
  session: RequestSession = getDevSession(),
  newRole?: NewPlaceRole
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Before the learned place's row lock: owner locks always come first (Codex r1 on #503).
    if (newRole?.archivePrevious) await lockLocationOwnersForArchive(client, session.workspaceId);
    const learnedPlace = await client.query<{ id: string }>(
      `select id
       from learned_places
       where id = $1
         and workspace_id = $2
         and user_id = $3
         and status = 'candidate'
         and classification = 'place_candidate'
       for update`,
      [learnedPlaceId, session.workspaceId, session.userId]
    );
    if (!learnedPlace.rows[0]) {
      await client.query("rollback");
      return null;
    }

    const place = await insertPlaceRecord(
      <T extends pg.QueryResultRow>(statement: string, values?: unknown[]) => client.query<T>(statement, values),
      input,
      session
    );
    await client.query(
      `update learned_places
       set status = 'accepted',
           place_id = $4,
           updated_at = now()
       where id = $1
         and workspace_id = $2
         and user_id = $3`,
      [learnedPlaceId, session.workspaceId, session.userId, place.id]
    );
    const assigned = newRole ? await assignPlaceRoleWith(client, session, { ...newRole, placeId: place.id, targetIsNew: true }) : null;
    await client.query("commit");
    return newRole ? { ...place, role: newRole.role, ...previousArchivedOf(assigned) } : place;
  } catch (error) {
    await client.query("rollback");
    const readinessError = learnedPlacesReadinessError(error);
    if (readinessError) throw readinessError;
    throw error;
  } finally {
    client.release();
  }
}

export async function updateLearnedPlaceStatus(
  learnedPlaceId: string,
  status: "ignored",
  session: RequestSession = getDevSession()
) {
  try {
    const result = await query<{ id: string }>(
      `update learned_places
       set status = $4,
           updated_at = now()
       where id = $1
         and workspace_id = $2
         and user_id = $3
         and status = 'candidate'
       returning id`,
      [learnedPlaceId, session.workspaceId, session.userId, status]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    const readinessError = learnedPlacesReadinessError(error);
    if (readinessError) throw readinessError;
    throw error;
  }
}

export async function resolveLearnedPlaceLocation(
  learnedPlaceId: string,
  rawAddress: unknown,
  session: RequestSession = getDevSession()
) {
  const address = normalizedLocationAddress(rawAddress);
  if (!address) return null;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{ latitude: number; longitude: number }>(
      `select latitude, longitude
       from learned_places
       where id = $1
         and workspace_id = $2
         and user_id = $3
         and status = 'candidate'
         and classification = 'place_candidate'
       for update`,
      [learnedPlaceId, session.workspaceId, session.userId]
    );
    const learnedPlace = existing.rows[0];
    if (!learnedPlace) {
      await client.query("rollback");
      return null;
    }

    const name = readableLocationNameFromParts({
      address,
      latitude: learnedPlace.latitude,
      longitude: learnedPlace.longitude
    });
    const addressName = stringOrNull(address.name);
    const poiName = addressName === name ? addressName : null;
    const formattedAddress = locationAddressSummary(address);
    const result = await client.query<{
      id: string;
      name: string;
      address: Record<string, unknown> | null;
      poiName: string | null;
      formattedAddress: string | null;
      geocodedAt: string;
    }>(
      `update learned_places
       set name = $4,
           address = $5::jsonb,
           poi_name = $6,
           formatted_address = $7,
           geocoded_at = now(),
           raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
             'address', $5::jsonb,
             'candidateName', $4
           ),
           updated_at = now()
       where id = $1
         and workspace_id = $2
         and user_id = $3
       returning id,
                 name,
                 address,
                 poi_name as "poiName",
                 formatted_address as "formattedAddress",
                 geocoded_at as "geocodedAt"`,
      [
        learnedPlaceId,
        session.workspaceId,
        session.userId,
        name,
        JSON.stringify(address),
        poiName,
        formattedAddress
      ]
    );
    await client.query("commit");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("rollback");
    const readinessError = learnedPlacesReadinessError(error);
    if (readinessError) throw readinessError;
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteLearnedPlace(
  learnedPlaceId: string,
  session: RequestSession = getDevSession()
) {
  try {
    const result = await query<{ id: string }>(
      `delete from learned_places
       where id = $1
         and workspace_id = $2
         and user_id = $3
         and status = 'candidate'
       returning id`,
      [learnedPlaceId, session.workspaceId, session.userId]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    const readinessError = learnedPlacesReadinessError(error);
    if (readinessError) throw readinessError;
    throw error;
  }
}

/** Creates a place inside the caller's transaction (Review's "Save this place"). */
export function insertPlaceWith(client: Pick<pg.PoolClient, "query">, input: PlaceMutationFields, session: RequestSession) {
  return insertPlaceRecord(<T extends pg.QueryResultRow>(statement: string, values?: unknown[]) => client.query<T>(statement, values), input, session);
}

async function insertPlaceRecord(
  runQuery: QueryRunner,
  input: PlaceMutationFields,
  session: RequestSession
) {
  const name = normalizeName(input.name, "New place");
  try {
    const result = await runQuery<PlaceRowLike>(
      `with inserted as (
         insert into places (
            workspace_id,
            name,
            latitude,
            longitude,
            radius_meters,
            priority,
            default_project_id,
            default_category_id,
            default_activity_description,
            auto_start,
            logging_enabled,
            auto_log
         )
         values ($1, $2, $3, $4, $5, $6, null, $7, $8, $9, $10, $11)
         returning id,
                   name,
                   role,
                   latitude,
                   longitude,
                   radius_meters,
                   priority,
                   default_project_id,
                   default_category_id,
                   default_activity_description,
                   auto_start,
                   logging_enabled,
                   auto_log
       )
       select inserted.id,
              inserted.name,
              inserted.role,
              inserted.latitude,
              inserted.longitude,
              inserted.radius_meters as "radiusMeters",
              inserted.priority,
              inserted.default_project_id as "defaultProjectId",
              p.name as "defaultProjectName",
              inserted.default_category_id as "defaultCategoryId",
              c.name as "defaultCategoryName",
              inserted.default_activity_description as "defaultActivityDescription",
              inserted.auto_start as "autoStart",
              inserted.logging_enabled as "loggingEnabled",
              inserted.auto_log as "autoLog"
       from inserted
       left join projects p on p.id = inserted.default_project_id
       left join categories c on c.id = inserted.default_category_id`,
      [
        session.workspaceId,
        name,
        nullableNumber(input.latitude),
        nullableNumber(input.longitude),
        normalizePlaceRadius(input.radiusMeters),
        normalizePlacePriority(input.priority),
        nullableString(input.defaultCategoryId),
        normalizeOptionalText(input.defaultActivityDescription),
        Boolean(input.autoStart),
        input.loggingEnabled !== false,
        input.loggingEnabled !== false && Boolean(input.autoLog)
      ]
    );

    return result.rows[0];
  } catch (error) {
    if (isUndefinedColumnError(error, "default_activity_description")) {
      throw missingPlaceDefaultActivityDescriptionColumnError(error);
    }
    if (isUndefinedColumnError(error, "logging_enabled")) {
      throw missingPlaceLoggingEnabledColumnError(error);
    }
    if (isUndefinedColumnError(error, "auto_log")) {
      throw missingPlaceAutoLogColumnError(error);
    }
    if (isUndefinedColumnError(error, "role")) {
      throw missingRequiredColumnError("places", "role", "supabase/migrations/202610070001_place_role.sql", error);
    }
    throw error;
  }
}

export async function updatePlace(
  id: string,
  input: {
    name?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    radiusMeters?: number | null;
    priority?: number | null;
    defaultCategoryId?: string | null;
    defaultActivityDescription?: string | null;
    autoStart?: boolean;
    loggingEnabled?: boolean;
    autoLog?: boolean;
  },
  session: RequestSession = getDevSession()
) {
  // A field is updated only when the caller sent a value; a key present as `undefined` is left
  // alone (null still clears), so a partial update never erases what it omitted (audit server-3).
  const sent = (key: keyof typeof input) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
  const hasName = sent("name");
  const hasLatitude = sent("latitude");
  const hasLongitude = sent("longitude");
  const hasRadius = sent("radiusMeters");
  const hasPriority = sent("priority");
  const hasDefaultCategory = sent("defaultCategoryId");
  const hasDefaultActivityDescription = sent("defaultActivityDescription");
  const hasAutoStart = sent("autoStart");
  const hasLoggingEnabled = sent("loggingEnabled");
  const hasAutoLog = sent("autoLog");

  try {
    const result = await query<PlaceRowLike>(
      `with updated as (
         update places
         set name = case when $3 then $4 else name end,
             latitude = case when $5 then $6 else latitude end,
             longitude = case when $7 then $8 else longitude end,
             radius_meters = case when $9 then $10 else radius_meters end,
             priority = case when $11 then $12 else priority end,
             default_category_id = case when $13 then $14 else default_category_id end,
             default_activity_description = case when $15 then $16 else default_activity_description end,
             auto_start = case when $17 then $18 else auto_start end,
             logging_enabled = case when $19 then $20 else logging_enabled end,
             -- Log automatically only means something while logging is on: turning logging off
             -- turns it off too, and it can only be turned on while logging is (or becomes) on — the
             -- stored value counts when this request leaves logging alone (Codex r1 on #434). SET
             -- expressions read the row as it was.
             auto_log = case
               when $19 and not $20 then false
               when $21 then $22 and (case when $19 then $20 else logging_enabled end)
               else auto_log
             end
         where id = $1 and workspace_id = $2
         returning id,
                   name,
                   role,
                   latitude,
                   longitude,
                   radius_meters,
                   priority,
                   default_project_id,
                   default_category_id,
                   default_activity_description,
                   auto_start,
                   logging_enabled,
                   auto_log
       )
       select updated.id,
              updated.name,
              updated.role,
              updated.latitude,
              updated.longitude,
              updated.radius_meters as "radiusMeters",
              updated.priority,
              updated.default_project_id as "defaultProjectId",
              p.name as "defaultProjectName",
              updated.default_category_id as "defaultCategoryId",
              c.name as "defaultCategoryName",
              updated.default_activity_description as "defaultActivityDescription",
              updated.auto_start as "autoStart",
              updated.logging_enabled as "loggingEnabled",
              updated.auto_log as "autoLog"
       from updated
       left join projects p on p.id = updated.default_project_id
       left join categories c on c.id = updated.default_category_id`,
      [
        id,
        session.workspaceId,
        hasName,
        hasName ? normalizeName(input.name, "Place") : null,
        hasLatitude,
        nullableNumber(input.latitude),
        hasLongitude,
        nullableNumber(input.longitude),
        hasRadius,
        normalizePlaceRadius(input.radiusMeters),
        hasPriority,
        normalizePlacePriority(input.priority),
        hasDefaultCategory,
        nullableString(input.defaultCategoryId),
        hasDefaultActivityDescription,
        normalizeOptionalText(input.defaultActivityDescription),
        hasAutoStart,
        Boolean(input.autoStart),
        hasLoggingEnabled,
        input.loggingEnabled !== false,
        hasAutoLog,
        Boolean(input.autoLog)
      ]
    );

    return result.rows[0] ?? null;
  } catch (error) {
    if (isUndefinedColumnError(error, "default_activity_description")) {
      throw missingPlaceDefaultActivityDescriptionColumnError(error);
    }
    if (isUndefinedColumnError(error, "logging_enabled")) {
      throw missingPlaceLoggingEnabledColumnError(error);
    }
    if (isUndefinedColumnError(error, "auto_log")) {
      throw missingPlaceAutoLogColumnError(error);
    }
    if (isUndefinedColumnError(error, "role")) {
      throw missingRequiredColumnError("places", "role", "supabase/migrations/202610070001_place_role.sql", error);
    }
    throw error;
  }
}

/** A place delete the database refused; nothing was changed. The route answers 409 with this sentence. */
export class PlaceDeleteBlockedError extends Error {
  readonly code = "place_delete_blocked";
  constructor(cause: unknown) {
    super("This place couldn't be deleted because some of its location history couldn't be cleared. Nothing was changed.", { cause });
  }
}

/** A lock the delete needs (usually location sync's) was held longer than it waits. The route answers 409. */
export class PlaceDeleteBusyError extends Error {
  readonly code = "place_delete_busy";
  constructor(cause: unknown) {
    super("This place is busy right now, so it wasn't deleted. Try again in a moment.", { cause });
  }
}

const PLACE_DELETE_ATTEMPTS = 3;

/**
 * Deletes a saved place. Past blocks, stays and journeys keep their times and lose the link (the
 * place's references are ON DELETE SET NULL; its geofence and match feedback rows cascade). Postgres
 * applies SET NULL one column per update, and the commute owner trigger then checks the journey's
 * other end: a round trip or "time away" row names this place at both ends, so clearing one end
 * alone is rejected and the whole delete rolled back (location v3 bug 6). Both ends are cleared in
 * one update first.
 *
 * Location writers (evidence ingest, replay, Review actions) take the per-user owner advisory lock
 * and then lock stays before journeys; clearing journeys and then stays without it could deadlock
 * with a replay (Codex r1 on #449). The delete takes the same owner lock for every user whose
 * location history can name the place, in user-id order, before touching any row, waits at most
 * `lockTimeoutMs` for each lock, and retries a transaction Postgres aborted as a deadlock or
 * serialization failure. The wait limit applies to each lock it takes (Postgres `lock_timeout`), so
 * a delete behind several busy locks can take longer in all.
 */
/** Whether "Replace the old place" archived the previous holder, when it was asked to. */
function previousArchivedOf(result: Awaited<ReturnType<typeof assignPlaceRoleWith>> | null) {
  return result?.status === "assigned" && result.previousArchived !== undefined ? { previousArchived: result.previousArchived } : {};
}

/**
 * Archive place (location v3 PR 15, PRD D19 A10): the place keeps its name on past blocks,
 * Reports and exports, but leaves bootstrap, matching, geofences, nearby suggestions and pickers
 * until it is restored. Archiving clears its Home or Work role, so the slot is free for the new
 * place; a restored place comes back without a role. Returns null when there is no such place.
 */
export async function setPlaceArchived(id: string, archived: boolean, session: RequestSession = getDevSession()) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Every member's location work finishes first, and none reads the old catalogue after.
    await client.query("set local lock_timeout = '10000ms'");
    await lockLocationOwnersForArchive(client, session.workspaceId);
    const result = await client.query<{ id: string; name: string; archivedAt: string | null }>(
      archived
        ? `update places set archived_at = coalesce(archived_at, now()), role = null
            where id = $1 and workspace_id = $2
            returning id, name, archived_at as "archivedAt"`
        : `update places set archived_at = null
            where id = $1 and workspace_id = $2
            returning id, name, archived_at as "archivedAt"`,
      [id, session.workspaceId]
    );
    await client.query("commit");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if ((error as { code?: unknown } | null)?.code === "55P03") throw new PlaceArchiveBusyError(error);
    throw placeWriteMigrationError(error) ?? error;
  } finally {
    client.release();
  }
}

export class PlaceArchiveBusyError extends Error {
  readonly code = "place_archive_busy";
  constructor(cause: unknown) {
    super("This place is busy right now, so it wasn't changed. Try again in a moment.", { cause });
  }
}

export async function deletePlace(
  id: string,
  session: RequestSession = getDevSession(),
  options: { lockTimeoutMs?: number } = {}
) {
  const lockTimeoutMs = Math.max(1, Math.round(options.lockTimeoutMs ?? 10_000));
  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local lock_timeout = '${lockTimeoutMs}ms'`);
      const place = await client.query<{ id: string }>(
        "select id from places where id = $1 and workspace_id = $2",
        [id, session.workspaceId]
      );
      if (!place.rows[0]) {
        await client.query("rollback");
        return null;
      }
      // Members, plus anyone whose stays or journeys still name the place (a former member).
      const owners = await client.query<{ userId: string }>(
        `select user_id::text as "userId" from workspace_members where workspace_id = $2
         union select user_id::text from stay_segments where workspace_id = $2 and place_id = $1
         union select user_id::text from commute_segments
           where workspace_id = $2 and (from_place_id = $1 or to_place_id = $1)
         order by 1`,
        [id, session.workspaceId]
      );
      for (const { userId } of owners.rows) {
        await client.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [session.workspaceId, userId]);
      }
      await client.query(
        `update commute_segments
         set from_place_id = case when from_place_id = $1 then null else from_place_id end,
             to_place_id = case when to_place_id = $1 then null else to_place_id end
         where workspace_id = $2 and (from_place_id = $1 or to_place_id = $1)`,
        [id, session.workspaceId]
      );
      const result = await client.query<{ id: string }>(
        "delete from places where id = $1 and workspace_id = $2 returning id",
        [id, session.workspaceId]
      );
      await client.query("commit");
      return result.rows[0] ?? null;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      const code = (error as { code?: unknown } | null)?.code;
      // A deadlock or serialization failure aborted the whole transaction: nothing was written.
      if ((code === "40P01" || code === "40001") && attempt < PLACE_DELETE_ATTEMPTS) continue;
      if (code === "55P03") throw new PlaceDeleteBusyError(error);
      // A trigger's raise (P0001) or an integrity violation (class 23) is the database refusing
      // this delete; anything else (a lost connection) stays a server error.
      if (typeof code === "string" && (code === "P0001" || code.startsWith("23"))) throw new PlaceDeleteBlockedError(error);
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function updateTimeEntry(
  id: string,
  input: {
    projectId?: string | null;
    categoryId?: string | null;
    placeId?: string | null;
    description?: string | null;
    startedAt?: string;
    stoppedAt?: string | null;
    tagNames?: string[];
    /** The details this edit was based on: refused (409) if any has changed since. */
    expectedDetails?: ExpectedDetails;
    /** The block's version this edit was based on: refused (409) if it has been written since. */
    expectedUpdatedAt?: string;
    /**
     * The iPhone outbox's stable command id for this edit (item 17). Recorded with the edit; a resend
     * of one already recorded for this block is answered `replayed` and applies nothing.
     */
    clientCommandId?: string;
  },
  session: RequestSession = getDevSession()
): Promise<{ id: string; updatedAt: string | null; replayed?: true }> {
  const hasProjectId = Object.prototype.hasOwnProperty.call(input, "projectId");
  const hasCategoryId = Object.prototype.hasOwnProperty.call(input, "categoryId");
  const hasPlaceId = Object.prototype.hasOwnProperty.call(input, "placeId");
  const hasDescription = Object.prototype.hasOwnProperty.call(input, "description");
  const hasStartedAt = Object.prototype.hasOwnProperty.call(input, "startedAt");
  const hasStoppedAt = Object.prototype.hasOwnProperty.call(input, "stoppedAt");
  const hasTagNames = Object.prototype.hasOwnProperty.call(input, "tagNames");
  const client = await pool.connect();

  try {
    await client.query("begin");
    // The owner lock before any row, so a timer's "?" about a trip is decided with replay's view (design §7).
    if (timerTripChecksEnabled()) await lockUserTimerState(client, session);
    // Lock the row in its own statement first. Under READ COMMITTED each statement takes a new
    // snapshot, so the reads below (after any concurrent save has committed and released the lock)
    // see that save's description, category, tags, times and recorded edits. Reading them in the
    // locking statement would pair the updated row with older related rows (Codex r1 on #387, r4 on
    // #531).
    const locked = await client.query(
      `select id from time_entries
       where id = $1 and workspace_id = $2 and user_id = $3
       for update`,
      [id, session.workspaceId, session.userId]
    );
    if (!locked.rows[0]) {
      // A resend of an edit that landed before the block was deleted: delivered, not a false rejection.
      if (input.clientCommandId && await timeEntryCommandRecorded(client, id, input.clientCommandId, session)) {
        await client.query("rollback");
        return { id, updatedAt: null, replayed: true };
      }
      throw new TimeEntryNotFoundError();
    }
    if (input.clientCommandId && await timeEntryCommandRecorded(client, id, input.clientCommandId, session)) {
      // Already applied (its response was lost): applying it again would revert any newer edit. Read
      // under the lock, so of two concurrent resends only the first applies.
      const version = await client.query<{ updatedAt: string | Date }>(
        `select updated_at as "updatedAt" from time_entries
         where id = $1 and workspace_id = $2 and user_id = $3`,
        [id, session.workspaceId, session.userId]
      );
      await client.query("commit");
      const updatedAt = version.rows[0]?.updatedAt;
      return { id, updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null, replayed: true };
    }
    if (input.expectedUpdatedAt) {
      // A fresh statement after the lock, as below: it sees a write that committed while this one waited.
      const version = await client.query<{ updatedAt: string | Date }>(
        `select updated_at as "updatedAt" from time_entries
         where id = $1 and workspace_id = $2 and user_id = $3`,
        [id, session.workspaceId, session.userId]
      );
      const row = version.rows[0];
      if (!row) throw new TimeEntryNotFoundError();
      if (versionChangedSince(row.updatedAt, input.expectedUpdatedAt)) throw new TimeEntryConflictError();
    }
    if (input.expectedDetails) {
      const stored = await client.query<{
        categoryId: string | null;
        description: string | null;
        tagNormalizedNames: string[];
      }>(
        `select te.category_id as "categoryId",
                te.description,
                coalesce((
                  select array_agg(t.normalized_name)
                  from time_entry_tags tet
                  join tags t on t.id = tet.tag_id and t.workspace_id = te.workspace_id
                  where tet.time_entry_id = te.id and tet.workspace_id = te.workspace_id
                ), array[]::text[]) as "tagNormalizedNames"
         from time_entries te
         where te.id = $1 and te.workspace_id = $2 and te.user_id = $3`,
        [id, session.workspaceId, session.userId]
      );
      const current = stored.rows[0];
      if (!current) throw new TimeEntryNotFoundError();
      if (detailsChangedSince(current, input.expectedDetails)) throw new TimeEntryConflictError();
    }
    // Clients resend unchanged times with a details save, so only a different end is one a person set.
    // Postgres decides "different" against the stored value at its own (microsecond) precision, so a
    // sub-millisecond change still counts (Codex r4 on #531).
    const existing = await client.query<{
      startedAt: string | Date;
      stoppedAt: string | Date | null;
      endChanged: boolean;
      legacyPersonSetEnd: boolean;
    }>(
      `select started_at as "startedAt", stopped_at as "stoppedAt",
              ($4::boolean and $5::timestamptz is not null and $5::timestamptz is distinct from te.stopped_at) as "endChanged",
              (te.stopped_at is not null and ${LEGACY_PERSON_EDIT_SQL}) as "legacyPersonSetEnd"
       from time_entries te
       where te.id = $1 and te.workspace_id = $2 and te.user_id = $3`,
      [id, session.workspaceId, session.userId, hasStoppedAt, hasStoppedAt ? input.stoppedAt ?? null : null]
    );
    const current = existing.rows[0];
    if (!current) throw new TimeEntryNotFoundError();
    if (hasStartedAt || hasStoppedAt) {
      validateResolvedTimeEntryWindow({
        startedAt: hasStartedAt ? input.startedAt : current.startedAt,
        stoppedAt: hasStoppedAt ? input.stoppedAt ?? null : current.stoppedAt
      });
    }
    const result = await client.query<{ id: string; updatedAt: string | Date }>(
      `update time_entries
     set project_id = case when $2 then $3 else project_id end,
         category_id = case when $4 then $5 else category_id end,
         place_id = case when $6 then $7 else place_id end,
         place_label = case when $6 then null else place_label end,
         description = case when $8 then $9 else description end,
         started_at = case when $10 then $11 else started_at end,
         stopped_at = case when $12 then $13 else stopped_at end,
         user_edited_at = now(),
         updated_at = now()
     where id = $1 and workspace_id = $14 and user_id = $15
     returning id, updated_at as "updatedAt"`,
      [
        id,
        hasProjectId,
        nullableString(input.projectId),
        hasCategoryId,
        nullableString(input.categoryId),
        hasPlaceId,
        nullableString(input.placeId),
        hasDescription,
        nullableString(input.description),
        hasStartedAt,
        input.startedAt ?? null,
        hasStoppedAt,
        input.stoppedAt ?? null,
        session.workspaceId,
        session.userId
      ]
    );
    if (!result.rows[0]) throw new TimeEntryNotFoundError();
    // Every edit is recorded so an earlier queued Stop never pulls back an end a person chose, and a
    // details edit is never read as a legacy one (see stopEntryAt). An end edited before edits were
    // recorded keeps its protection through this edit too (Codex r4 on #531).
    await recordTimeEntryEdits(
      client,
      [id],
      session,
      current.endChanged || current.legacyPersonSetEnd ? [id] : [],
      input.clientCommandId
    );
    if (hasTagNames) {
      await syncTimeEntryTags(client, id, input.tagNames ?? [], session);
    }
    // An edit can end a block before the trip it ran into, or make it a move activity (design §7).
    await reconcileTimerTripClashes(client, session, { entryIds: [id] });
    await client.query("commit");
    return { id, updatedAt: new Date(result.rows[0].updatedAt).toISOString() };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Records a person's edit of these blocks in the same transaction as the edit: `time_entry.end_set` with
 * the block's end for the blocks in `endSetIds` (only an ended block), else `time_entry.edited`.
 * `created_at` is the block's `user_edited_at`, which the edit has just set. A `clientCommandId` (the
 * iPhone outbox's, item 17) is kept in the same row's metadata as the edit's receipt.
 */
async function recordTimeEntryEdits(
  client: pg.PoolClient,
  ids: string[],
  session: RequestSession,
  endSetIds: string[],
  clientCommandId?: string
) {
  await client.query(
    `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata, created_at)
     select workspace_id, user_id,
            case when id = any($4::uuid[]) and stopped_at is not null then '${PERSON_SET_END_ACTION}' else '${PERSON_EDIT_ACTION}' end,
            'time_entry', id,
            (case when id = any($4::uuid[]) and stopped_at is not null then jsonb_build_object('stoppedAt', stopped_at) else '{}'::jsonb end)
              || case when $5::text is null then '{}'::jsonb else jsonb_build_object('clientCommandId', $5::text) end,
            user_edited_at
     from time_entries
     where id = any($1::uuid[]) and workspace_id = $2 and user_id = $3 and user_edited_at is not null`,
    [ids, session.workspaceId, session.userId, endSetIds, clientCommandId ?? null]
  );
}

/**
 * Whether this person's edit with this outbox command id is already recorded for this block (item 17).
 * Audit rows outlive the block, so this also answers for a block deleted since. `audit_log` has no
 * index yet (a later migration); the scan is per block and runs under its row lock.
 */
async function timeEntryCommandRecorded(
  client: pg.PoolClient,
  id: string,
  clientCommandId: string,
  session: RequestSession
) {
  const recorded = await client.query(
    `select 1 from audit_log
     where workspace_id = $1 and user_id = $2 and entity_type = 'time_entry' and entity_id = $3
       and action in ('${PERSON_SET_END_ACTION}', '${PERSON_EDIT_ACTION}')
       and metadata->>'clientCommandId' = $4
     limit 1`,
    [session.workspaceId, session.userId, id, clientCommandId]
  );
  return (recorded.rowCount ?? 0) > 0;
}

export class TimeEntryNotFoundError extends Error {
  constructor() {
    super("Block not found.");
    this.name = "TimeEntryNotFoundError";
  }
}

/** The details a PATCH was based on have changed since (another window or device saved first). */
export class TimeEntryConflictError extends Error {
  constructor() {
    super("This block was changed in another window or device.");
    this.name = "TimeEntryConflictError";
  }
}

export class TimeEntryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeEntryValidationError";
  }
}

function validateResolvedTimeEntryWindow({
  startedAt,
  stoppedAt,
  now = new Date()
}: {
  startedAt: string | Date | undefined;
  stoppedAt: string | Date | null;
  now?: Date;
}) {
  const started = startedAt
    ? new Date(startedAt instanceof Date ? startedAt.getTime() : startedAt)
    : null;
  if (!started || Number.isNaN(started.getTime())) {
    throw new TimeEntryValidationError("startedAt must be a valid date.");
  }
  if (stoppedAt === null) {
    if (started.getTime() > now.getTime()) {
      throw new TimeEntryValidationError("Start time cannot be in the future.");
    }
    return;
  }

  const stopped = new Date(stoppedAt instanceof Date ? stoppedAt.getTime() : stoppedAt);
  if (Number.isNaN(stopped.getTime())) {
    throw new TimeEntryValidationError("stoppedAt must be a valid date.");
  }
  if (stopped.getTime() <= started.getTime()) {
    throw new TimeEntryValidationError("Finish time must be after the start time.");
  }
  if (stopped.getTime() - started.getTime() > 24 * 60 * 60 * 1_000) {
    throw new TimeEntryValidationError("A block can be no longer than 24 hours.");
  }
}

/**
 * "End it at 14:22" (design §7): the block a timer left running into a trip ends where the trip started, as
 * the person chose (recorded like an edit, so a Stop queued earlier never pulls it back). A running timer
 * stops there. A block already ending by then, gone, or started after it is left as it is. The caller holds
 * the user's timer lock.
 */
export async function endBlockAtTripStart(
  client: pg.PoolClient, session: RequestSession, entryId: string, tripStartedAt: string
): Promise<{ ended: boolean; wasRunning: boolean }> {
  const locked = await client.query<{ startedAt: Date; stoppedAt: Date | null }>(
    `select started_at as "startedAt", stopped_at as "stoppedAt" from time_entries
     where id = $1 and workspace_id = $2 and user_id = $3
     for update`,
    [entryId, session.workspaceId, session.userId]
  );
  const block = locked.rows[0];
  const endMs = Date.parse(tripStartedAt);
  if (!block || !Number.isFinite(endMs) || block.startedAt.getTime() >= endMs ||
    (block.stoppedAt && block.stoppedAt.getTime() <= endMs)) return { ended: false, wasRunning: false };
  await client.query(
    `update time_entries set stopped_at = $4::timestamptz, user_edited_at = now(), updated_at = now()
     where id = $1 and workspace_id = $2 and user_id = $3`,
    [entryId, session.workspaceId, session.userId, new Date(endMs).toISOString()]
  );
  await recordTimeEntryEdits(client, [entryId], session, [entryId]);
  return { ended: true, wasRunning: block.stoppedAt === null };
}

export async function deleteTimeEntry(id: string, session: RequestSession = getDevSession()) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (timerTripChecksEnabled()) await lockUserTimerState(client, session);
    const result = await client.query(
      "delete from time_entries where id = $1 and workspace_id = $2 and user_id = $3",
      [id, session.workspaceId, session.userId]
    );
    if ((result.rowCount ?? 0) === 0) throw new TimeEntryNotFoundError();
    // A deleted block's "?" goes with it (design §7).
    await reconcileTimerTripClashes(client, session, { entryIds: [id] });
    await client.query("commit");
    return { id, deleted: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteTimeEntries(ids: string[], session: RequestSession = getDevSession()) {
  const uniqueIds = [...new Set(ids)];
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (timerTripChecksEnabled()) await lockUserTimerState(client, session);
    const existing = await client.query<{ id: string }>(
      `select id
       from time_entries
       where id = any($1::uuid[]) and workspace_id = $2 and user_id = $3
       -- Entry-id order, as every multi-entry lock (replay's Log automatically retirement too).
       order by id
       for update`,
      [uniqueIds, session.workspaceId, session.userId]
    );
    if (existing.rows.length !== uniqueIds.length) throw new TimeEntryNotFoundError();
    const deleted = await client.query<{ id: string }>(
      `delete from time_entries
       where id = any($1::uuid[]) and workspace_id = $2 and user_id = $3
       returning id`,
      [uniqueIds, session.workspaceId, session.userId]
    );
    await reconcileTimerTripClashes(client, session, { entryIds: uniqueIds });
    await client.query("commit");
    return { ids: deleted.rows.map((row) => row.id), deletedCount: deleted.rows.length };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateTimeEntryDescriptions(
  ids: string[],
  description: string | null,
  session: RequestSession = getDevSession()
) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length < 2) {
    throw new TimeEntryValidationError("Choose at least two grouped blocks.");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{ id: string; stoppedAt: string | Date | null }>(
      `select id, stopped_at as "stoppedAt"
       from time_entries
       where id = any($1::uuid[]) and workspace_id = $2 and user_id = $3
       -- Entry-id order, as every multi-entry lock (replay's Log automatically retirement too).
       order by id
       for update`,
      [uniqueIds, session.workspaceId, session.userId]
    );
    if (existing.rows.length !== uniqueIds.length) throw new TimeEntryNotFoundError();
    if (existing.rows.some((entry) => entry.stoppedAt === null)) {
      throw new TimeEntryValidationError("Grouped descriptions can only update completed blocks.");
    }

    // Read after the lock (fresh snapshot): an end edited before edits were recorded keeps its
    // protection through this description save (Codex r4 on #531).
    const legacy = await client.query<{ id: string }>(
      `select te.id from time_entries te
       where te.id = any($1::uuid[]) and te.workspace_id = $2 and te.user_id = $3 and ${LEGACY_PERSON_EDIT_SQL}`,
      [uniqueIds, session.workspaceId, session.userId]
    );

    const updated = await client.query<{ id: string }>(
      `update time_entries
       set description = $2,
           user_edited_at = now(),
           updated_at = now()
       where id = any($1::uuid[]) and workspace_id = $3 and user_id = $4
       returning id`,
      [uniqueIds, description, session.workspaceId, session.userId]
    );
    if (updated.rows.length !== uniqueIds.length) throw new TimeEntryNotFoundError();
    // A description is not an end a person chose; recorded so it never reads as a legacy edit.
    await recordTimeEntryEdits(client, uniqueIds, session, legacy.rows.map((row) => row.id));
    await client.query("commit");
    return { ids: updated.rows.map((row) => row.id), updatedCount: updated.rows.length };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function splitActiveEntry(session: RequestSession = getDevSession()) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (timerTripChecksEnabled()) await lockUserTimerState(client, session);
    const active = await client.query<{
      id: string;
      projectId: string | null;
      categoryId: string | null;
      placeId: string | null;
      placeLabel: string | null;
      source: string;
      confidence: string;
      reviewStatus: string;
      description: string | null;
    }>(
      `select id,
              project_id as "projectId",
              category_id as "categoryId",
              place_id as "placeId",
              place_label as "placeLabel",
              source,
              confidence,
              review_status as "reviewStatus",
              description
       from time_entries
       where workspace_id = $1 and user_id = $2 and stopped_at is null
       order by started_at desc
       limit 1
       for update`,
      [session.workspaceId, session.userId]
    );
    const row = active.rows[0];
    if (!row) throw new Error("There is no running block to split.");

    const eventResult = await client.query<{ id: string }>(
      `insert into activity_events (
          workspace_id,
          user_id,
          source,
          event_type,
          occurred_at,
          confidence,
          raw_payload,
          suggested_project_id,
          suggested_category_id,
          suggested_place_id,
          review_status
       )
       values ($1, $2, 'manual_app', 'timer_switch', now(), 'high', $3::jsonb, $4, $5, $6, 'confirmed')
       returning id`,
      [
        session.workspaceId,
        session.userId,
        JSON.stringify({ origin: "web_timer_split", previousEntryId: row.id, [SERVER_TIMER_START_KEY]: true }),
        row.projectId,
        row.categoryId,
        row.placeId
      ]
    );

    await client.query(
      `update time_entries
       set stopped_at = now(), updated_at = now()
       where id = $1 and workspace_id = $2`,
      [row.id, session.workspaceId]
    );

    await client.query(
      `insert into time_entries (
          workspace_id,
          user_id,
          project_id,
          category_id,
          place_id,
          place_label,
          source,
          confidence,
          review_status,
          description,
          started_at,
          created_from_event_id
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)`,
      [
        session.workspaceId,
        session.userId,
        row.projectId,
        row.categoryId,
        row.placeId,
        row.placeLabel,
        row.source,
        row.confidence,
        row.reviewStatus,
        row.description,
        eventResult.rows[0].id
      ]
    );
    // The running block now ends here (design §7).
    await reconcileTimerTripClashes(client, session, { entryIds: [row.id] });

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Card G: Split a finished block at `splitAt`, or Duplicate it right after itself, in one transaction on
 * the normal entries endpoint. The new block is a manual block (its own event first) with every detail of
 * the original: activity, project, saved or one-time place, description and tags. A split also ends the
 * original at `splitAt`, recorded as an end the person set. `expectedUpdatedAt` refuses (409) a block
 * written elsewhere since the editor read it. A `clientCommandId` makes a retry safe: the new block's
 * event keeps it, and a repeat is answered with the block it already made.
 */
export async function splitFinishedEntry(
  id: string,
  input: { splitAt: string; expectedUpdatedAt?: string; clientCommandId?: string },
  session: RequestSession = getDevSession()
) {
  return copyFinishedEntry(id, { kind: "split", ...input }, session);
}

export async function duplicateFinishedEntry(
  id: string,
  input: { expectedUpdatedAt?: string; clientCommandId?: string; now?: Date },
  session: RequestSession = getDevSession()
) {
  return copyFinishedEntry(id, { kind: "duplicate", ...input }, session);
}

async function copyFinishedEntry(
  id: string,
  input: { kind: "split" | "duplicate"; splitAt?: string; expectedUpdatedAt?: string; clientCommandId?: string; now?: Date },
  session: RequestSession
) {
  const clientEventId = input.clientCommandId ? `time_entry_${input.kind}:${input.clientCommandId}` : null;
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (timerTripChecksEnabled()) await lockUserTimerState(client, session);
    const locked = await client.query(
      `select id from time_entries where id = $1 and workspace_id = $2 and user_id = $3 for update`,
      [id, session.workspaceId, session.userId]
    );
    if (clientEventId) {
      // Already done (its reply was lost): the block it made, not a second one.
      const earlier = await client.query<{ id: string }>(
        `select te.id from activity_events e
         join time_entries te on te.created_from_event_id = e.id and te.workspace_id = e.workspace_id
         where e.workspace_id = $1 and e.user_id = $2 and e.client_event_id = $3`,
        [session.workspaceId, session.userId, clientEventId]
      );
      if (earlier.rows[0]) {
        await client.query("commit");
        return { id, newEntryId: earlier.rows[0].id, replayed: true as const };
      }
    }
    if (!locked.rows[0]) throw new TimeEntryNotFoundError();
    // A fresh statement after the lock sees a write that committed while this one waited.
    const stored = await client.query<{
      startedAt: Date; stoppedAt: Date | null; updatedAt: Date; projectId: string | null; categoryId: string | null;
      placeId: string | null; placeLabel: string | null; description: string | null; tagNames: string[];
    }>(
      `select te.started_at as "startedAt", te.stopped_at as "stoppedAt", te.updated_at as "updatedAt",
              te.project_id as "projectId", te.category_id as "categoryId", te.place_id as "placeId",
              te.place_label as "placeLabel", te.description,
              coalesce((
                select array_agg(t.name order by t.name)
                from time_entry_tags tet
                join tags t on t.id = tet.tag_id and t.workspace_id = te.workspace_id
                where tet.time_entry_id = te.id and tet.workspace_id = te.workspace_id
              ), array[]::text[]) as "tagNames"
       from time_entries te
       where te.id = $1 and te.workspace_id = $2 and te.user_id = $3`,
      [id, session.workspaceId, session.userId]
    );
    const row = stored.rows[0];
    if (!row) throw new TimeEntryNotFoundError();
    if (input.expectedUpdatedAt && versionChangedSince(row.updatedAt, input.expectedUpdatedAt)) throw new TimeEntryConflictError();
    if (!row.stoppedAt) {
      throw new TimeEntryValidationError(input.kind === "split" ? "Stop this block before splitting it." : "Stop this block before duplicating it.");
    }
    const startMs = row.startedAt.getTime();
    const stopMs = row.stoppedAt.getTime();
    let window: { startedAt: string; stoppedAt: string };
    if (input.kind === "split") {
      const atMs = Date.parse(input.splitAt ?? "");
      if (!Number.isFinite(atMs) || atMs <= startMs || atMs >= stopMs) {
        throw new TimeEntryValidationError("Choose a split time inside the block.");
      }
      window = { startedAt: new Date(atMs).toISOString(), stoppedAt: row.stoppedAt.toISOString() };
    } else {
      const endMs = stopMs + (stopMs - startMs);
      if (endMs > (input.now ?? new Date()).getTime()) throw new TimeEntryValidationError("No room after this block yet: the copy would end in the future.");
      window = { startedAt: row.stoppedAt.toISOString(), stoppedAt: new Date(endMs).toISOString() };
    }
    const event = await client.query<{ id: string }>(
      `insert into activity_events (
          workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload,
          suggested_project_id, suggested_category_id, suggested_place_id, review_status, client_event_id
       )
       values ($1, $2, 'manual_app', 'timer_start', $3, 'high', $4::jsonb, $5, $6, $7, 'confirmed', $8)
       returning id`,
      [
        session.workspaceId,
        session.userId,
        window.startedAt,
        // No `origin` key: a manual block, as createManualEntry's.
        JSON.stringify({ description: row.description ?? "Manual entry", tagNames: row.tagNames, [`${input.kind}From`]: id }),
        row.projectId,
        row.categoryId,
        row.placeId,
        clientEventId
      ]
    );
    if (input.kind === "split") {
      await client.query(
        `update time_entries set stopped_at = $4, user_edited_at = now(), updated_at = now()
         where id = $1 and workspace_id = $2 and user_id = $3`,
        [id, session.workspaceId, session.userId, window.startedAt]
      );
      // The original's new end is one the person set: an earlier queued Stop never pulls it back.
      await recordTimeEntryEdits(client, [id], session, [id], input.clientCommandId);
    }
    const inserted = await client.query<{ id: string }>(
      `insert into time_entries (
          workspace_id, user_id, project_id, category_id, place_id, place_label, source, confidence, review_status,
          description, started_at, stopped_at, created_from_event_id
       )
       values ($1, $2, $3, $4, $5, $6, 'manual_app', 'high', 'confirmed', $7, $8, $9, $10)
       returning id`,
      [
        session.workspaceId,
        session.userId,
        row.projectId,
        row.categoryId,
        row.placeId,
        row.placeLabel,
        row.description,
        window.startedAt,
        window.stoppedAt,
        event.rows[0].id
      ]
    );
    const newEntryId = inserted.rows[0].id;
    await syncTimeEntryTags(client, newEntryId, row.tagNames, session);
    // The original now ends where the person split it (design §7).
    await reconcileTimerTripClashes(client, session, { entryIds: [id] });
    await client.query("commit");
    return { id, newEntryId, replayed: false as const };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveReviewItem(
  id: string,
  action: unknown,
  session: RequestSession = getDevSession(),
  options: SyncTransactionOptions = {}
): Promise<ReviewResolutionResult> {
  // Checked before any database work, so a removed action ("Always ignore", "Make rule") is a
  // plain 400 even when the database is unavailable.
  if (!isReviewResolutionAction(action)) {
    throw new ReviewResolutionError("invalid_action", "Unsupported review action.", {
      status: 400,
      details: { action }
    });
  }
  try {
    return await withSyncTransaction("legacy_review", async ({ client }) => {
    setSyncPhase(client, "owner_lock");
    await lockUserTimerState(client, session);

    setSyncPhase(client, "review_lock");
    const review = await client.query<{
      id: string;
      eventId: string | null;
      title: string;
      status: string;
      suggestedProjectId: string | null;
      suggestedCategoryId: string | null;
      suggestedPlaceId: string | null;
      suggestedStartedAt: string | null;
      suggestedStoppedAt: string | null;
      confidence: string;
      eventSource: string | null;
      eventType: string | null;
      rawPayload: Record<string, unknown> | null;
    }>(
      `select ri.id,
              ri.event_id as "eventId",
              case
                when ae.event_type = 'geofence_exit'
                  and nullif(ri.title, '') is not null
                  and ri.title <> coalesce(pl.name, '')
                  and ri.title <> coalesce(${placeDisplayNameSql("pl")}, '')
                then ri.title
                when ae.event_type = 'geofence_exit'
                  and nullif(pl.default_activity_description, '') is not null
                then pl.default_activity_description
                else ri.title
              end as title,
              ri.status,
              p.id as "suggestedProjectId",
              c.id as "suggestedCategoryId",
              pl.id as "suggestedPlaceId",
              ri.suggested_started_at as "suggestedStartedAt",
              ri.suggested_stopped_at as "suggestedStoppedAt",
              ri.confidence,
              ae.source as "eventSource",
              ae.event_type as "eventType",
              ae.raw_payload as "rawPayload"
       from review_items ri
       left join activity_events ae on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id
       left join places pl on pl.id = ri.suggested_place_id and pl.workspace_id = ri.workspace_id
       left join projects p
         on p.id = ri.suggested_project_id
        and p.workspace_id = ri.workspace_id
        and p.is_archived = false
       left join categories c
         on c.id = ri.suggested_category_id
        and c.workspace_id = ri.workspace_id
        and c.is_archived = false
       where ri.id = $1 and ri.workspace_id = $2 and ri.user_id = $3
       for update of ri nowait`,
      [id, session.workspaceId, session.userId]
    );
    setSyncPhase(client, "effect");
    const item = review.rows[0];
    if (!item) {
      throw new ReviewResolutionError("review_item_not_found", "Review item not found.", { status: 404 });
    }
    // A timer that ran into a trip is answered through a Review mutation (End it / Keep it): a plain accept
    // here would add a block from its suggestion (design §7).
    if (item.eventType === TIMER_TRIP_CLASH_EVENT_TYPE) {
      throw new ReviewResolutionError("invalid_action", "Answer this question with End it or Keep it.", { status: 422 });
    }
    if (item.status !== "open") {
      const resolvedStatus = item.status === "ignored" ? "ignored" : "accepted";
      return { ok: true, action, status: resolvedStatus, alreadyResolved: true };
    }

    let entryId: string | undefined;
    let duplicate = false;

    if (action === "accept") {
      const window = reviewItemTimeWindow(item);
      if (!window) {
        throw new ReviewResolutionError(
          "invalid_time_window",
          "This review item is missing a valid start and end time.",
          {
            status: 422,
            details: {
              reviewItemId: item.id,
              suggestedStartedAt: item.suggestedStartedAt,
              suggestedStoppedAt: item.suggestedStoppedAt
            }
          }
        );
      }

      if (item.eventId) {
        const existingEntry = await getTimeEntryCreatedFromEvent(client, item.eventId, session);
        if (existingEntry) {
          entryId = existingEntry.id;
          duplicate = true;
        }
      }

      if (!entryId && item.eventType === "health_sleep_import") {
        const matchingEntry = await reconcileMatchingHealthSleepTimeEntry(client, session, {
          rawPayload: item.rawPayload,
          startedAt: window.startedAt,
          stoppedAt: window.stoppedAt
        });
        if (matchingEntry) {
          entryId = matchingEntry.id;
          duplicate = true;
        }
      }

      if (!entryId) {
        const inserted = await client.query<{ id: string }>(
        `insert into time_entries (
            workspace_id,
            user_id,
            project_id,
            category_id,
            place_id,
            source,
            confidence,
            review_status,
            description,
            started_at,
            stopped_at,
            created_from_event_id
         )
         values ($1, $2, $3, $4, $5, coalesce($6, 'manual_app'), $7, 'confirmed', $8, $9, $10, $11)
         returning id`,
          [
            session.workspaceId,
            session.userId,
            item.suggestedProjectId,
            item.suggestedCategoryId,
            item.suggestedPlaceId,
            item.eventSource,
            item.confidence,
            reviewItemDescriptionForConfirmedEntry(item),
            window.startedAt,
            window.stoppedAt,
            item.eventId
          ]
        );
        entryId = inserted.rows[0]?.id;
      }
    }

    if (item.eventType === "health_sleep_import" && item.eventId && entryId) {
      await recordHealthSleepResolution(client, session, item.eventId, entryId);
    }

    const resolvedStatus = action === "accept" ? "accepted" : "ignored";
    await client.query(
      `update review_items
       set status = $3,
           ignored_scope = $4,
           resolved_at = now()
       where id = $1 and workspace_id = $2 and user_id = $5`,
      [
        id,
        session.workspaceId,
        resolvedStatus,
        action === "ignore_once" ? "once" : null,
        session.userId
      ]
    );
    if (item.eventId) {
      await client.query(
        `update activity_events
         set review_status = $2
         where id = $1 and workspace_id = $3 and user_id = $4`,
        [
          item.eventId,
          resolvedStatus === "accepted" ? "confirmed" : "ignored",
          session.workspaceId,
          session.userId
        ]
      );
    }
    return { ok: true, action, status: resolvedStatus, entryId, duplicate };
    }, options);
  } catch (error) {
    throw reviewResolutionErrorForDatabaseError(error);
  }
}

function isReviewResolutionAction(value: unknown): value is ReviewResolutionAction {
  return value === "accept" || value === "ignore_once";
}

function reviewItemTimeWindow(item: {
  suggestedStartedAt: string | null;
  suggestedStoppedAt: string | null;
}) {
  if (!item.suggestedStartedAt || !item.suggestedStoppedAt) return null;
  const started = new Date(item.suggestedStartedAt);
  const stopped = new Date(item.suggestedStoppedAt);
  if (
    Number.isNaN(started.getTime()) ||
    Number.isNaN(stopped.getTime()) ||
    stopped.getTime() <= started.getTime()
  ) {
    return null;
  }
  return {
    startedAt: started.toISOString(),
    stoppedAt: stopped.toISOString()
  };
}

function reviewResolutionErrorForDatabaseError(error: unknown) {
  if (error instanceof ReviewResolutionError) return error;

  if (isUniqueViolationError(error)) {
    return new ReviewResolutionError(
      "duplicate_entry",
      "A block already exists for this activity.",
      {
        status: 409,
        cause: error
      }
    );
  }

  if (isLockNotAvailableError(error)) {
    return new ReviewResolutionError(
      "review_item_locked",
      "This Review item is being updated. Try again in a moment.",
      {
        status: 409,
        cause: error,
        details: { canonicalStatus: "unknown", reason: "lock_unavailable", retryAfterMs: 5_000,
          phase: (error as {syncPhase?:string}).syncPhase, sqlState: "55P03" }
      }
    );
  }

  if (isStatementTimeoutError(error) || error instanceof SyncOperationError) {
    const failure = syncFailureMetadata(error);
    return new ReviewResolutionError(failure.reason === "operation_timeout" ? "review_query_timeout" :
      failure.reason === "query_cancelled" ? "review_query_cancelled" : "review_service_unavailable",
      "Review could not finish. Reconcile your saved action.", {
        status: 503, details: { canonicalStatus: "unknown", ...failure, retryAfterMs: 5_000 }, cause: error
      });
  }

  if (
    isForeignKeyViolationError(error) ||
    isCheckViolationError(error) ||
    isNotNullViolationError(error) ||
    isInvalidTextRepresentationError(error)
  ) {
    return new ReviewResolutionError(
      "database_constraint",
      "This review item could not be confirmed because its stored data violates a database constraint.",
      {
        status: 422,
        cause: error,
        details: databaseErrorDetails(error)
      }
    );
  }

  return error;
}

function databaseErrorDetails(error: unknown) {
  const candidate = error as {
    code?: string;
    constraint?: string;
    column?: string;
    detail?: string;
    table?: string;
  } | null;
  return {
    code: candidate?.code,
    constraint: candidate?.constraint,
    column: candidate?.column,
    table: candidate?.table,
    detail: candidate?.detail
  };
}

type HealthReviewReprocessInput = {
  preferences?: Partial<HealthImportPreferences> | null;
  mappings?: HealthAutoLogMappings | null;
  limit?: number | null;
  batchSize?: number | null;
  force?: boolean | null;
  cursor?: string | null;
};

type HealthReviewItemRow = {
  id: string;
  eventId: string | null;
  title: string;
  suggestedProjectId: string | null;
  suggestedCategoryId: string | null;
  suggestedPlaceId: string | null;
  suggestedStartedAt: string | null;
  suggestedStoppedAt: string | null;
  confidence: string;
  eventSource: string | null;
  eventType: string | null;
  eventCategoryId: string | null;
  rawPayload: unknown;
};

export async function reprocessHealthReviewItems(
  input: HealthReviewReprocessInput = {},
  session: RequestSession = getDevSession(),
  options: SyncTransactionOptions = {}
) {
  const deadlineAt = Math.min(options.deadlineAt ?? Infinity, Date.now() + 6_000);
  const batchSize = Math.min(25, normalizeHealthReprocessBatchSize(input.limit ?? input.batchSize));
  const result = emptyHealthReprocessResult(batchSize);
  if (normalizeHealthImportPreferences(input.preferences).sleep) {
    try {
      result.repairedSleepEntryCount = await withSyncTransaction("health_category_maintenance", async ({ client }) => {
        await lockUserTimerState(client, session);
        const mapping = healthAutoLogMappingFor("sleep", normalizeHealthAutoLogMappings(input.mappings));
        const categoryId = mapping.categoryId ?? await ensureHealthEventCategoryId(client, session, "health_sleep_import");
        return repairHealthCategorySleepTimeEntries(client, session, categoryId);
      }, { ...options, deadlineAt, cleanupReserveMs: 300 });
    } catch { result.errorSummary.push("category_maintenance_deferred"); result.deferred += 1; }
  }
  const cursor = typeof input.cursor === "string" && /^[0-9a-f-]{36}$/i.test(input.cursor) ? input.cursor : null;
  const candidates = await withSyncTransaction("health_candidates", async ({ client }) => {
    const rows = await client.query<{ id: string; eventType: string; rawPayload: unknown; suggestedStartedAt: string | null; suggestedStoppedAt: string | null; confidence: string }>(
      `select ri.id, ae.event_type as "eventType", ae.raw_payload as "rawPayload",
              ri.suggested_started_at as "suggestedStartedAt", ri.suggested_stopped_at as "suggestedStoppedAt", ri.confidence
       from review_items ri join activity_events ae on ae.id=ri.event_id
         and ae.workspace_id=ri.workspace_id and ae.user_id=ri.user_id
       where ri.workspace_id=$1 and ri.user_id=$2 and ri.status='open'
         and ae.event_type in ('health_sleep_import','health_workout_import')
         and ($3::uuid is null or ri.id > $3::uuid)
       order by ri.id limit $4`, [session.workspaceId, session.userId, cursor, batchSize + 1]);
    return rows.rows;
  }, { ...options, deadlineAt, readOnly: true, cleanupReserveMs: 300 }).catch(() => null);
  if (!candidates) {
    result.partial = true; result.hasMore = true; result.stopReason = "candidate_read_unavailable";
    return result;
  }
  result.hasMore = candidates.length > batchSize;
  const selected = candidates.slice(0, batchSize);
  const done = new Set<string>();
  for (const candidate of selected) {
    if (done.has(candidate.id)) continue;
    if (options.signal?.aborted || Date.now() >= deadlineAt - 400) {
      result.deferred += selected.filter(item => !done.has(item.id)).length;
      result.stopReason = "operation_budget";
      result.hasMore = true;
      break;
    }
    let ids = [candidate.id];
    // Legacy fragments need the COMPLETE bounded same-source connected group.
    // An overflow cannot be safely split: retain it with an explicit reason.
    if (candidate.eventType === "health_sleep_import" && !Array.isArray(isRecord(candidate.rawPayload) ? candidate.rawPayload.samples : null)) {
      const legacy = await withSyncTransaction("health_legacy_candidates", async ({ client }) =>
        loadLegacySleepReviewItemsForConsolidation(client, session, Boolean(input.force)),
        { ...options, deadlineAt, readOnly: true, cleanupReserveMs: 300 }).catch(() => null);
      if (!legacy) {
        result.deferred += 1; result.hasMore = true; result.stopReason = "legacy_read_unavailable"; break;
      }
      if (legacy.length >= LEGACY_SLEEP_CONSOLIDATION_BATCH_SIZE) {
        result.deferred += 1; result.stopReason = "legacy_group_scan_limit";
        done.add(candidate.id); result.nextCursor = candidate.id; continue;
      }
      ids = legacySleepGroupIds(legacy, candidate.id);
    }
    try {
      const unit = await reprocessHealthReviewUnit(input, session, ids,
        { ...options, deadlineAt, cleanupReserveMs: 300 },
        candidate.eventType === "health_sleep_import" && !Array.isArray(isRecord(candidate.rawPayload) ? candidate.rawPayload.samples : null));
      for (const key of ["checkedCount", "confirmedCount", "ignoredCount", "leftInReviewCount", "skippedCount", "failedCount", "updatedCategoryCount"] as const) result[key] += unit[key];
      result.reasons.push(...unit.reasons); result.errorSummary.push(...unit.errorSummary);
      result.processed += unit.checkedCount;
    } catch (error) {
      const busy = error instanceof SyncOperationError || isLockNotAvailableError(error) ||
        error instanceof ReviewResolutionError && error.code === "review_item_locked";
      if (busy) result.deferred += ids.length; else result.failedCount += ids.length;
      result.errorSummary.push(busy ? "health_unit_deferred" : "health_unit_failed");
    }
    ids.forEach(id => done.add(id));
    result.nextCursor = candidate.id;
  }
  result.failed = result.failedCount;
  result.partial = result.deferred > 0 || result.failed > 0 || result.hasMore;
  // Remaining work is measured independently. Failure is UNKNOWN, not zero.
  try {
    result.remainingReviewCount = await withSyncTransaction("health_remaining", async ({ client }) => {
      const count = await client.query<{ count: number }>(
        `select count(*)::int as count from review_items ri join activity_events ae on ae.id=ri.event_id
         and ae.workspace_id=ri.workspace_id and ae.user_id=ri.user_id
         where ri.workspace_id=$1 and ri.user_id=$2 and ri.status='open'
           and ae.event_type in ('health_sleep_import','health_workout_import')`, [session.workspaceId,session.userId]);
      return count.rows[0]?.count ?? 0;
    }, { ...options, deadlineAt, readOnly: true, cleanupReserveMs: 100 });
    result.remaining = result.remainingReviewCount;
  } catch { result.remaining = null; result.partial = true; }
  if (!result.hasMore && !result.stopReason) result.stopReason = "end_of_scan";
  return result;
}

function emptyHealthReprocessResult(batchSize: number) {
  return {
    checkedCount: 0, confirmedCount: 0, ignoredCount: 0, leftInReviewCount: 0,
    skippedCount: 0, failedCount: 0, updatedCategoryCount: 0, repairedSleepEntryCount: 0,
    remainingReviewCount: 0, batchSize, partial: false, hasMore: false,
    processed: 0, deferred: 0, failed: 0, remaining: null as number | null,
    nextCursor: null as string | null, stopReason: null as string | null,
    errorSummary: [] as string[], reasons: [] as HealthReviewReason[]
  };
}

function legacySleepGroupIds(items: HealthReviewItemRow[], candidateId: string) {
  const target = items.find(item => item.id === candidateId);
  if (!target) return [candidateId];
  const identity = healthSleepImportIdentity(target.rawPayload);
  const segments = items.filter(item => {
    const other = healthSleepImportIdentity(item.rawPayload);
    return other.provider === identity.provider && other.sourceName === identity.sourceName;
  }).map(legacySleepReviewSegment).filter((item): item is SleepReviewSegment => Boolean(item))
    .sort((a,b) => a.startedMs - b.startedMs);
  let group: SleepReviewSegment[] = [];
  for (const segment of segments) {
    if (group.length && segment.startedMs - Math.max(...group.map(item => item.stoppedMs)) > HEALTH_SLEEP_SESSION_GAP_MS) {
      if (group.some(item => item.item.id === candidateId)) return group.map(item => item.item.id).sort();
      group = [];
    }
    group.push(segment);
  }
  return group.some(item => item.item.id === candidateId) ? group.map(item => item.item.id).sort() : [candidateId];
}

async function reprocessHealthReviewUnit(input: HealthReviewReprocessInput, session: RequestSession, ids: string[], options: SyncTransactionOptions, legacy: boolean) {
  const preferences = normalizeHealthImportPreferences(input.preferences);
  const mappings = normalizeHealthAutoLogMappings(input.mappings);
  const result = emptyHealthReprocessResult(ids.length);
  return withSyncTransaction("health_reprocess_unit", async ({ client, phase }) => {
    phase("owner_lock");
    await lockUserTimerState(client, session);
    phase("effect");
    if (legacy) {
      const fresh = await loadLegacySleepReviewItemsForConsolidation(client, session, Boolean(input.force));
      if (fresh.length >= LEGACY_SLEEP_CONSOLIDATION_BATCH_SIZE ||
          JSON.stringify(legacySleepGroupIds(fresh, ids[0]).sort()) !== JSON.stringify([...ids].sort())) {
        throw new ReviewResolutionError("review_item_locked", "The source group changed. Retry the bounded scan.",
          { status: 409, details: { canonicalStatus: "unknown", reason: "group_changed" } });
      }
    }

    const healthCategoryIds = new Map<string, string>();
    async function ensureReviewCategoryId(item: Pick<HealthReviewItemRow, "eventType">) {
      const spec = healthCategorySpecForEventType(item.eventType);
      const key = spec.name.toLowerCase();
      const cached = healthCategoryIds.get(key);
      if (cached) return cached;
      const categoryId = await ensureHealthEventCategoryId(client, session, item.eventType);
      healthCategoryIds.set(key, categoryId);
      return categoryId;
    }

    await ensureReviewCategoryId({ eventType: "health_workout_import" });
    if (preferences.sleep) await ensureReviewCategoryId({ eventType: "health_sleep_import" });
    phase("review_lock");
    const reviewItems = await client.query<HealthReviewItemRow>(
      `select ri.id,
              ri.event_id as "eventId",
              ri.title,
              ri.suggested_project_id as "suggestedProjectId",
              ri.suggested_category_id as "suggestedCategoryId",
              ri.suggested_place_id as "suggestedPlaceId",
              ri.suggested_started_at as "suggestedStartedAt",
              ri.suggested_stopped_at as "suggestedStoppedAt",
              ri.confidence,
              ae.source as "eventSource",
              ae.event_type as "eventType",
              ae.suggested_category_id as "eventCategoryId",
              ae.raw_payload as "rawPayload"
       from review_items ri
       join activity_events ae on ae.id = ri.event_id
       where ri.workspace_id = $1
         and ri.user_id = $2
         and ri.status = 'open'
         and ri.id = any($3::uuid[])
         and ae.workspace_id = $1
         and ae.user_id = $2
         and ae.event_type in ('health_sleep_import', 'health_workout_import')
       order by ri.id
       for update of ri nowait`,
      [session.workspaceId, session.userId, ids]
    );

    phase("effect");
    const sleepMapping = healthAutoLogMappingFor("sleep", mappings);
    const sleepCategoryId = preferences.sleep
      ? sleepMapping.categoryId ?? await ensureReviewCategoryId({ eventType: "health_sleep_import" }) : null;
    if (reviewItems.rows.length !== ids.length) {
      // A concurrent resolution changed this logical group: retry selection.
      throw new ReviewResolutionError("review_item_locked", "Health group changed before processing.", {
        status: 409, details: { canonicalStatus: "unknown", reason: "group_changed" }
      });
    }
    const sleepItems = reviewItems.rows;
    const consolidatedSleepIds = await consolidateLegacyHealthSleepReviewItems(
      client,
      sleepItems,
      session,
      sleepCategoryId,
      sleepMapping.description ?? "Sleep",
      result
    );

    for (const item of reviewItems.rows) {
      if (consolidatedSleepIds.has(item.id)) continue;
      const beforeItem = { ...result, reasons: [...result.reasons], errorSummary: [...result.errorSummary] };
      result.checkedCount += 1;
      await client.query("savepoint reprocess_health_item");
      try {
        const rawPayload = isRecord(item.rawPayload) ? item.rawPayload : {};
        const startedAt = timestampStringOrNull(rawPayload.startedAt) ?? item.suggestedStartedAt;
        const stoppedAt = timestampStringOrNull(rawPayload.stoppedAt) ?? item.suggestedStoppedAt;
        const durationSeconds = reviewDurationSeconds(rawPayload, startedAt, stoppedAt);
        const preferenceKey = healthPreferenceKeyForReviewItem(item, rawPayload);
        const mapping = healthAutoLogMappingFor(preferenceKey, mappings);
        const categoryId = mapping.categoryId ?? await ensureReviewCategoryId(item);
        const description = mapping.description ?? item.title;

        if (item.suggestedCategoryId !== categoryId || item.eventCategoryId !== categoryId) {
          await updateHealthReviewCategory(client, item, categoryId);
          result.updatedCategoryCount += 1;
        }

        if (shouldIgnoreHealthSleepStage(item, rawPayload)) {
          await resolveReprocessedHealthReviewItem(client, item, "ignored");
          result.ignoredCount += 1;
          await client.query("release savepoint reprocess_health_item");
          continue;
        }

        if (!preferences[preferenceKey]) {
          await resolveReprocessedHealthReviewItem(client, item, "ignored");
          result.ignoredCount += 1;
          await client.query("release savepoint reprocess_health_item");
          continue;
        }

        if (item.eventId && await hasTimeEntryCreatedFromEvent(client, item.eventId, session)) {
          await resolveReprocessedHealthReviewItem(client, item, "accepted");
          result.confirmedCount += 1;
          await client.query("release savepoint reprocess_health_item");
          continue;
        }

        if (!startedAt || !stoppedAt) {
          const reason = {
            reviewItemId: item.id,
            code: "missing_time_window",
            message: "Left in Review: missing start or end time."
          };
          await updateHealthReviewNotes(client, item.id, reason.message);
          addHealthReviewReason(result.reasons, reason);
          result.leftInReviewCount += 1;
          result.remainingReviewCount += 1;
          await client.query("release savepoint reprocess_health_item");
          continue;
        }

        const isGroupedHealthSleep = item.eventType === "health_sleep_import" &&
          Array.isArray(rawPayload.samples);
        if (isGroupedHealthSleep) {
          const matchingEntry = await reconcileMatchingHealthSleepTimeEntry(client, session, {
            rawPayload,
            startedAt,
            stoppedAt
          });
          if (matchingEntry) {
            if (item.eventId) await recordHealthSleepResolution(client, session, item.eventId, matchingEntry.id);
            await resolveReprocessedHealthReviewItem(client, item, "accepted");
            result.confirmedCount += 1;
            await client.query("release savepoint reprocess_health_item");
            continue;
          }
        }

        if (item.eventType === "health_sleep_import") await lockUserTimerState(client, session);
        const mayUseLegacySleepCoverage = item.eventType === "health_sleep_import" && !isGroupedHealthSleep;
        const coveredEntry = mayUseLegacySleepCoverage
          ? await findCoveringHealthTimeEntry(client, session, item, startedAt, stoppedAt)
          : null;
        if (coveredEntry) {
          if (item.eventId) await recordHealthSleepResolution(client, session, item.eventId, coveredEntry.id);
          await resolveReprocessedHealthReviewItem(client, item, "accepted");
          result.confirmedCount += 1;
          await client.query("release savepoint reprocess_health_item");
          continue;
        }

        if (!isEligibleHealthReviewItemForAutoConfirm(item, rawPayload, durationSeconds, preferenceKey, startedAt, stoppedAt)) {
          const reason = healthAutoConfirmSkipReason(item, rawPayload, durationSeconds, preferenceKey, startedAt, stoppedAt);
          await updateHealthReviewNotes(client, item.id, reason.message);
          addHealthReviewReason(result.reasons, {
            reviewItemId: item.id,
            code: reason.code,
            message: reason.message
          });
          result.leftInReviewCount += 1;
          result.remainingReviewCount += 1;
          await client.query("release savepoint reprocess_health_item");
          continue;
        }

        if (item.eventType === "health_sleep_import" &&
          await hasUnsafeHealthSleepCollision(client, session, startedAt, stoppedAt)) {
          const message = "Left in Review: this Sleep import may conflict with an existing logical session.";
          await updateHealthReviewNotes(client, item.id, message);
          addHealthReviewReason(result.reasons, { reviewItemId: item.id, code: "unsafe_sleep_session", message });
          result.leftInReviewCount += 1;
          result.remainingReviewCount += 1;
          await client.query("release savepoint reprocess_health_item");
          continue;
        }

        await insertConfirmedHealthTimeEntry(client, item, session, {
          categoryId,
          description,
          startedAt,
          stoppedAt
        });
        await resolveReprocessedHealthReviewItem(client, item, "accepted");
        result.confirmedCount += 1;
        await client.query("release savepoint reprocess_health_item");
      } catch (error) {
        await client.query("rollback to savepoint reprocess_health_item");
        await client.query("release savepoint reprocess_health_item");
        Object.assign(result, beforeItem);
        result.checkedCount += 1;
        result.failedCount += 1;
        result.skippedCount += 1;
        result.leftInReviewCount += 1;
        result.remainingReviewCount += 1;
        addCompactError(result.errorSummary, compactErrorSummary(error, `Skipped ${item.id}`));
      }
    }

    return result;
  }, options);
}

async function repairHealthCategorySleepTimeEntries(
  client: pg.PoolClient,
  session: RequestSession,
  sleepCategoryId: string
) {
  const repaired = await client.query<{ id: string }>(
    `with candidates as (
       select te.id from time_entries te
       join categories current_category on current_category.id=te.category_id
     where te.category_id = current_category.id
       and te.workspace_id = $1
       and te.user_id = $2
       and current_category.workspace_id = te.workspace_id
       and lower(current_category.name) = 'health'
       and coalesce(current_category.is_archived, false) = false
       and te.review_status in ('confirmed', 'accepted')
       and te.stopped_at is not null
       and te.user_edited_at is null
       and lower(coalesce(te.description, '')) = 'sleep'
       and (
         te.source = 'health_sleep'
         or exists (
           select 1
           from activity_events ae
           where ae.id = te.created_from_event_id
             and ae.workspace_id = te.workspace_id
             and ae.user_id = te.user_id
             and ae.event_type = 'health_sleep_import'
         )
       )

       order by te.id limit 25 for update of te skip locked
     )
     update time_entries te set category_id=$3, updated_at=now()
     from candidates where te.id=candidates.id
     returning te.id`,
    [session.workspaceId, session.userId, sleepCategoryId]
  );
  return repaired.rowCount ?? repaired.rows.length;
}

function normalizeHealthReprocessBatchSize(value: unknown) {
  const numeric = Number(value ?? DEFAULT_HEALTH_REPROCESS_BATCH_SIZE);
  if (!Number.isFinite(numeric)) return DEFAULT_HEALTH_REPROCESS_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_HEALTH_REPROCESS_BATCH_SIZE, Math.round(numeric)));
}

async function loadLegacySleepReviewItemsForConsolidation(
  client: pg.PoolClient,
  session: RequestSession,
  force: boolean
) {
  const result = await client.query<HealthReviewItemRow>(
    `select ri.id,
            ri.event_id as "eventId",
            ri.title,
            ri.suggested_project_id as "suggestedProjectId",
            ri.suggested_category_id as "suggestedCategoryId",
            ri.suggested_place_id as "suggestedPlaceId",
            ri.suggested_started_at as "suggestedStartedAt",
            ri.suggested_stopped_at as "suggestedStoppedAt",
            ri.confidence,
            ae.source as "eventSource",
            ae.event_type as "eventType",
            ae.suggested_category_id as "eventCategoryId",
            ae.raw_payload as "rawPayload"
     from review_items ri
     join activity_events ae on ae.id = ri.event_id
     where ri.workspace_id = $1
       and ri.user_id = $2
       and ri.status = 'open'
       and ae.workspace_id = $1
       and ae.user_id = $2
       and ae.event_type = 'health_sleep_import'
       and not (ae.raw_payload ? 'samples')
     order by
       case
         when ri.notes is null or ri.notes not like 'Left in Review:%' then 0
         when $3::boolean then 1
         else 2
       end asc,
       coalesce(ri.suggested_started_at, ae.occurred_at) desc,
       ri.created_at desc
     limit $4
`,
    [session.workspaceId, session.userId, force, LEGACY_SLEEP_CONSOLIDATION_BATCH_SIZE]
  );
  return result.rows;
}

async function consolidateLegacyHealthSleepReviewItems(
  client: pg.PoolClient,
  items: HealthReviewItemRow[],
  session: RequestSession,
  sleepCategoryId: string | null,
  sleepDescription: string,
  result: {
    checkedCount: number;
    confirmedCount: number;
    ignoredCount: number;
    leftInReviewCount: number;
    remainingReviewCount: number;
    updatedCategoryCount: number;
    reasons: HealthReviewReason[];
  }
) {
  const handledIds = new Set<string>();
  if (!sleepCategoryId) return handledIds;

  for (const item of items) {
    const rawPayload = isRecord(item.rawPayload) ? item.rawPayload : {};
    if (!shouldIgnoreHealthSleepStage(item, rawPayload)) continue;
    if (item.suggestedCategoryId !== sleepCategoryId || item.eventCategoryId !== sleepCategoryId) {
      await updateHealthReviewCategory(client, item, sleepCategoryId);
      result.updatedCategoryCount += 1;
    }
    await resolveReprocessedHealthReviewItem(client, item, "ignored");
    handledIds.add(item.id);
    result.checkedCount += 1;
    result.ignoredCount += 1;
  }

  const segments = items
    .filter((item) => !handledIds.has(item.id))
    .map(legacySleepReviewSegment)
    .filter((segment): segment is SleepReviewSegment => Boolean(segment))
    .sort((left, right) => left.startedMs - right.startedMs);

  const groups: SleepReviewSegment[][] = [];
  for (const segment of segments) {
    const identity = healthSleepImportIdentity(segment.item.rawPayload);
    const current = [...groups].reverse().find((group) => {
      const previous = healthSleepImportIdentity(group[0].item.rawPayload);
      return identity.provider === previous.provider && identity.sourceName === previous.sourceName;
    });
    if (!current) {
      groups.push([segment]);
      continue;
    }

    const currentStop = Math.max(...current.map((item) => item.stoppedMs));
    if (segment.startedMs - currentStop <= HEALTH_SLEEP_SESSION_GAP_MS) {
      current.push(segment);
    } else {
      groups.push([segment]);
    }
  }

  for (const group of groups) {
    if (group.length < 2) continue;

    const startedAt = new Date(Math.min(...group.map((segment) => segment.startedMs))).toISOString();
    const stoppedAt = new Date(Math.max(...group.map((segment) => segment.stoppedMs))).toISOString();
    const durationSeconds = Math.round((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1000);
    if (!shouldAutoConfirmHealthSleep({ durationSeconds, startedAt, stoppedAt })) continue;

    const beforeGroup = { ...result, reasons: [...result.reasons] };
    await client.query("savepoint consolidate_health_sleep");
    try {
      for (const segment of group) {
        if (segment.item.suggestedCategoryId !== sleepCategoryId || segment.item.eventCategoryId !== sleepCategoryId) {
          await updateHealthReviewCategory(client, segment.item, sleepCategoryId);
          result.updatedCategoryCount += 1;
        }
      }

      await lockUserTimerState(client, session);
      const existingEntry = await firstExistingEntryForHealthReviewItems(client, group.map((segment) => segment.item), session);
      const coveredEntry = existingEntry
        ? existingEntry
        : await findCoveringHealthTimeEntry(client, session, { ...group[0].item, title: sleepDescription }, startedAt, stoppedAt);
      let resolvedEntryId = coveredEntry?.id;
      if (!coveredEntry) {
        if (await hasUnsafeHealthSleepCollision(client, session, startedAt, stoppedAt)) {
          await client.query("release savepoint consolidate_health_sleep");
          continue;
        }

        resolvedEntryId = await insertConfirmedHealthTimeEntry(client, {
          ...group[0].item,
          title: sleepDescription
        }, session, {
          categoryId: sleepCategoryId,
          description: sleepDescription,
          startedAt,
          stoppedAt
        });
      }

      for (const segment of group) {
        handledIds.add(segment.item.id);
        result.checkedCount += 1;
        if (resolvedEntryId && segment.item.eventId) await recordHealthSleepResolution(client, session, segment.item.eventId, resolvedEntryId);
        await resolveReprocessedHealthReviewItem(client, segment.item, "accepted");
      }
      result.confirmedCount += 1;
      await client.query("release savepoint consolidate_health_sleep");
    } catch (error) {
      void error;
      await client.query("rollback to savepoint consolidate_health_sleep");
      await client.query("release savepoint consolidate_health_sleep");
      Object.assign(result, beforeGroup);
      handledIds.forEach((id) => {
        if (group.some((segment) => segment.item.id === id)) handledIds.delete(id);
      });
    }
  }

  return handledIds;
}

function legacySleepReviewSegment(item: HealthReviewItemRow): SleepReviewSegment | null {
  if (item.eventType !== "health_sleep_import" || !hasAutomaticConfidence(item.confidence)) return null;
  const rawPayload = isRecord(item.rawPayload) ? item.rawPayload : {};
  if (Array.isArray(rawPayload.samples) && rawPayload.samples.length > 0) return null;

  const sleepStage = healthSleepStageForReviewItem(item, rawPayload);
  if (sleepStage === "awake" || sleepStage === "in_bed") return null;

  const startedAt = timestampStringOrNull(rawPayload.startedAt) ?? item.suggestedStartedAt;
  const stoppedAt = timestampStringOrNull(rawPayload.stoppedAt) ?? item.suggestedStoppedAt;
  if (!startedAt || !stoppedAt) return null;

  const startedMs = new Date(startedAt).getTime();
  const stoppedMs = new Date(stoppedAt).getTime();
  if (!Number.isFinite(startedMs) || !Number.isFinite(stoppedMs) || stoppedMs <= startedMs) return null;

  return { item, startedAt, stoppedAt, startedMs, stoppedMs };
}

async function firstExistingEntryForHealthReviewItems(
  client: pg.PoolClient,
  items: HealthReviewItemRow[],
  session: RequestSession
) {
  for (const item of items) {
    if (!item.eventId) continue;
    const entry = await getTimeEntryCreatedFromEvent(client, item.eventId, session);
    if (entry) return entry;
  }
  return null;
}

export async function createEntity(
  entity: string,
  input: Record<string, unknown>,
  session: RequestSession = getDevSession()
) {
  switch (entity) {
    case "client":
      return query("insert into clients (workspace_id, name, color) values ($1, $2, $3)", [
        session.workspaceId,
        String(input.name ?? "New client"),
        normalizePaletteKey(input.color, String(input.name ?? "New client"))
      ]);
    case "category":
      // The legacy entities route creates activities through the one activity writer, so it
      // takes the same name lock, duplicate check and quick-start cap as /api/categories.
      return createCategory(
        {
          name: String(input.name ?? "New activity"),
          color: typeof input.color === "string" ? input.color : null,
          isPinned: Boolean(input.isPinned)
        },
        session
      );
    case "tag":
      return createTag({ name: String(input.name ?? "new-tag") }, session);
    case "project":
      return query(
        `insert into projects (workspace_id, name, client_id, category_id, color, billable)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          session.workspaceId,
          String(input.name ?? "New project"),
          nullableString(input.clientId),
          nullableString(input.categoryId),
          normalizePaletteKey(input.color, String(input.name ?? "New project")),
          Boolean(input.billable)
        ]
      );
    case "place":
      try {
        return await query(
          `insert into places (
              workspace_id,
              name,
              latitude,
              longitude,
              radius_meters,
              priority,
              default_project_id,
              default_category_id,
              default_activity_description,
              auto_start,
              logging_enabled,
              auto_log
           )
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            session.workspaceId,
            String(input.name ?? "New place"),
            nullableNumber(input.latitude),
            nullableNumber(input.longitude),
            Number(input.radiusMeters ?? 100),
            Number(input.priority ?? 5),
            nullableString(input.projectId),
            nullableString(input.categoryId),
            normalizeOptionalText(input.defaultActivityDescription),
            Boolean(input.autoStart),
            input.loggingEnabled !== false,
            input.loggingEnabled !== false && Boolean(input.autoLog)
          ]
        );
      } catch (error) {
        if (isUndefinedColumnError(error, "default_activity_description")) {
          throw missingPlaceDefaultActivityDescriptionColumnError(error);
        }
        if (isUndefinedColumnError(error, "logging_enabled")) {
          throw missingPlaceLoggingEnabledColumnError(error);
        }
        if (isUndefinedColumnError(error, "auto_log")) {
          throw missingPlaceAutoLogColumnError(error);
        }
        throw error;
      }
    default:
      throw new UnsupportedEntityError(entity);
  }
}

export function buildQuickActionEvent(projectId?: string | null, categoryId?: string | null): ActivityEventInput {
  const session = getDevSession();
  return {
    source: "mobile_app",
    type: "quick_action",
    occurredAt: new Date(),
    workspaceId: session.workspaceId,
    userId: session.userId,
    projectId: projectId ?? undefined,
    categoryId: categoryId ?? undefined,
    rawPayload: { origin: "quick_action" }
  };
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeOptionalText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function normalizeName(value: unknown, fallback: string) {
  const name = typeof value === "string" ? value.trim() : "";
  return name || fallback;
}

function normalizePlaceRadius(value: unknown) {
  const number = Number(value ?? 100);
  if (!Number.isFinite(number)) return 100;
  return Math.max(25, Math.min(2000, Math.round(number)));
}

function normalizePlacePriority(value: unknown) {
  const number = Number(value ?? 5);
  if (!Number.isFinite(number)) return 5;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function isHealthEvent(type: string) {
  return type === "health_sleep_import" || type === "health_workout_import";
}

function healthSleepStageForReviewItem(
  item: Pick<HealthReviewItemRow, "eventType" | "title">,
  rawPayload: Record<string, unknown>
) {
  if (item.eventType !== "health_sleep_import") return null;
  const explicit = stringOrNull(rawPayload.sleepStage);
  if (explicit) return explicit;
  const title = item.title.toLowerCase();
  if (title.includes("awake")) return "awake";
  if (title.includes("in bed") || title.includes("in_bed")) return "in_bed";
  if (title.includes("core")) return "asleep_core";
  if (title.includes("deep")) return "asleep_deep";
  if (title.includes("rem")) return "asleep_rem";
  return null;
}

function shouldIgnoreHealthSleepStage(
  item: Pick<HealthReviewItemRow, "eventType" | "title">,
  rawPayload: Record<string, unknown>
) {
  const sleepStage = healthSleepStageForReviewItem(item, rawPayload);
  return sleepStage === "awake" || sleepStage === "in_bed";
}

function reviewItemDescriptionForConfirmedEntry(
  item: Pick<HealthReviewItemRow, "eventType" | "title"> & { rawPayload?: Record<string, unknown> | null }
) {
  if (
    item.eventType === "commute_detected" ||
    item.eventType === "learned_place_visit" ||
    item.rawPayload?.evidenceKind === "one_off_activity"
  ) return null;
  return item.title;
}

function descriptionForCreatedTimeEntry(
  event: ReturnType<typeof ActivityEventInputSchema.parse>,
  candidate: { title: string; description?: string }
) {
  if (event.type === "commute_detected") return null;
  return event.description ?? candidate.description ?? candidate.title;
}

async function hasOverlappingTimeEntry(
  client: pg.PoolClient,
  event: ReturnType<typeof ActivityEventInputSchema.parse>,
  session: RequestSession
) {
  const startedAt = suggestedStartedAtForEvent(event);
  const stoppedAt = suggestedStoppedAtForEvent(event);
  return hasOverlappingTimeWindow(client, session, startedAt, stoppedAt);
}

async function hasOverlappingTimeWindow(
  client: pg.PoolClient,
  session: RequestSession,
  startedAt: string | Date | null | undefined,
  stoppedAt: string | Date | null | undefined
) {
  return Boolean(await findOverlappingTimeEntry(client, session, startedAt, stoppedAt));
}

export async function reconcileMatchingHealthSleepTimeEntry(
  client: pg.PoolClient,
  session: RequestSession,
  input: {
    rawPayload: unknown;
    startedAt: string;
    stoppedAt: string;
  }
) {
  await lockUserTimerState(client, session);
  const match = await findMatchingHealthSleepTimeEntry(
    client,
    session,
    input.rawPayload,
    input.startedAt,
    input.stoppedAt
  );
  if (!match) return null;
  return updateHealthSleepTimeEntryWindow(
    client,
    session,
    match,
    input.startedAt,
    input.stoppedAt
  );
}

function validHealthWindow(startedAt: unknown, stoppedAt: unknown) {
  if (!(typeof startedAt === "string" || startedAt instanceof Date) ||
    !(typeof stoppedAt === "string" || stoppedAt instanceof Date)) return false;
  const start = new Date(startedAt).getTime(), stop = new Date(stoppedAt).getTime();
  return Number.isFinite(start) && Number.isFinite(stop) && stop > start;
}

async function hasUnsafeHealthSleepCollision(
  client: pg.PoolClient, session: RequestSession,
  startedAt: string | Date | null | undefined, stoppedAt: string | Date | null | undefined
) {
  if (!validHealthWindow(startedAt, stoppedAt)) return true;
  // A safe same-source session has already reconciled before this fallback.
  // Do not turn an edited, cross-source, weak or multiple Sleep collision into
  // another entry just because ordinary activity overlaps are now allowed.
  const result = await client.query(
    `/* unsafe_health_sleep_collision */
     select te.id from time_entries te
     where te.workspace_id = $1 and te.user_id = $2
       and te.source = 'health_sleep'
       and te.review_status in ('confirmed', 'accepted')
       and te.started_at < $4::timestamptz and coalesce(te.stopped_at, $4::timestamptz) > $3::timestamptz
     limit 1`,
    [session.workspaceId, session.userId, startedAt, stoppedAt]
  );
  return result.rows.length > 0;
}

async function findMatchingHealthSleepTimeEntry(
  client: pg.PoolClient,
  session: RequestSession,
  incomingRawPayload: unknown,
  startedAt: string | Date | null | undefined,
  stoppedAt: string | Date | null | undefined
) {
  if (!startedAt || !stoppedAt) return null;
  const incomingIdentity = healthSleepImportIdentity(incomingRawPayload);
  const result = await client.query<HealthSleepTimeEntry>(
    `/* matching_health_sleep_session */
     select te.id,
            te.started_at as "startedAt",
            te.stopped_at as "stoppedAt",
            ae.raw_payload as "rawPayload"
     from time_entries te
     join activity_events ae
       on ae.id = te.created_from_event_id
      and ae.workspace_id = te.workspace_id
      and ae.user_id = te.user_id
     where te.workspace_id = $1
       and te.user_id = $2
       and te.source = 'health_sleep'
       and te.review_status in ('confirmed', 'accepted')
       and te.stopped_at is not null
       and te.user_edited_at is null
       and ae.event_type = 'health_sleep_import'
       and te.started_at < $4::timestamptz
       and te.stopped_at > $3::timestamptz
     order by te.started_at asc, te.id asc
     for update of te`,
    [session.workspaceId, session.userId, startedAt, stoppedAt]
  );
  const matches = result.rows.filter((entry) => {
    const existingIdentity = healthSleepImportIdentity(entry.rawPayload);
    if (
      existingIdentity.provider !== incomingIdentity.provider ||
      existingIdentity.sourceName !== incomingIdentity.sourceName
    ) {
      return false;
    }
    return matchHealthSleepSessionWindows(
      { startedAt: entry.startedAt, stoppedAt: entry.stoppedAt },
      { startedAt, stoppedAt }
    ).matches;
  });

  // Multiple matches indicate historical duplicates; do not choose one
  // automatically because cleanup requires row-level provenance evidence.
  return matches.length === 1 ? matches[0] : null;
}

async function updateHealthSleepTimeEntryWindow(
  client: pg.PoolClient,
  session: RequestSession,
  entry: HealthSleepTimeEntry,
  startedAt: string | Date | null | undefined,
  stoppedAt: string | Date | null | undefined
) {
  if (!startedAt || !stoppedAt) return null;
  const match = matchHealthSleepSessionWindows(
    { startedAt: entry.startedAt, stoppedAt: entry.stoppedAt },
    { startedAt, stoppedAt }
  );
  if (!match.matches || !match.mergedStartedAt || !match.mergedStoppedAt) return null;

  const result = await client.query<{ id: string; startedAt: string; stoppedAt: string }>(
    `update time_entries
     set started_at = $4,
         stopped_at = $5,
         updated_at = case
           when started_at is distinct from $4::timestamptz
             or stopped_at is distinct from $5::timestamptz
           then now()
           else updated_at
         end
     where id = $1
       and workspace_id = $2
       and user_id = $3
       and user_edited_at is null
     returning id, started_at as "startedAt", stopped_at as "stoppedAt"`,
    [entry.id, session.workspaceId, session.userId, match.mergedStartedAt, match.mergedStoppedAt]
  );
  return result.rows[0] ?? null;
}

function healthSleepImportIdentity(rawPayload: unknown) {
  const payload = isRecord(rawPayload) ? rawPayload : {};
  const samples = Array.isArray(payload.samples) ? payload.samples.filter(isRecord) : [];
  return {
    provider: normalizedHealthIdentityText(payload.provider) || "healthkit",
    sourceName: normalizedHealthIdentityText(payload.sourceName) ||
      normalizedHealthIdentityText(samples[0]?.sourceName)
  };
}

function normalizedHealthIdentityText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase() : "";
}

async function findCoveringHealthTimeEntry(
  client: pg.PoolClient,
  session: RequestSession,
  item: Pick<HealthReviewItemRow, "eventType" | "title"> & { rawPayload?: unknown },
  startedAt: string | Date | null | undefined,
  stoppedAt: string | Date | null | undefined
): Promise<OverlapBlockingEntry | null> {
  if (!startedAt || !stoppedAt) return null;
  const title = healthReviewCoverageTitle(item);
  const incomingIdentity = healthSleepImportIdentity(item.rawPayload);
  const result = await client.query<OverlapBlockingEntry & { rawPayload: unknown }>(
    `/* health_covering_entry */
     select te.id,
            te.description,
            te.source,
            te.review_status as "reviewStatus",
            te.started_at as "startedAt",
            te.stopped_at as "stoppedAt",
            c.name as "categoryName",
            false as "stoppedAtIsNull",
            ae.raw_payload as "rawPayload"
     from time_entries te
     join activity_events ae on ae.id = te.created_from_event_id
       and ae.workspace_id = te.workspace_id and ae.user_id = te.user_id
     left join categories c on c.id = te.category_id
     where te.workspace_id = $1
       and te.user_id = $2
       and te.review_status in ('confirmed', 'accepted')
       and te.stopped_at is not null
       and te.started_at <= $3::timestamptz + interval '5 minutes'
       and te.stopped_at >= $4::timestamptz - interval '5 minutes'
       and te.source = 'health_sleep'
       and te.user_edited_at is null
       and lower(coalesce(te.description, '')) = lower($5)
     order by
       case when te.source in ('health_sleep', 'health_workout') then 0 else 1 end,
       abs(extract(epoch from (te.started_at - $3::timestamptz))) asc
     for update of te`,
    [session.workspaceId, session.userId, startedAt, stoppedAt, title]
  );
  const matches = result.rows.filter((entry) => {
    const identity = healthSleepImportIdentity(entry.rawPayload);
    return identity.provider === incomingIdentity.provider && identity.sourceName === incomingIdentity.sourceName;
  });
  return matches.length === 1 ? matches[0] : null;
}

function healthReviewCoverageTitle(item: Pick<HealthReviewItemRow, "eventType" | "title">) {
  if (item.eventType === "health_sleep_import") return "Sleep";
  return (item.title || "").trim();
}

async function findOverlappingTimeEntry(
  client: pg.PoolClient,
  session: RequestSession,
  startedAt: string | Date | null | undefined,
  stoppedAt: string | Date | null | undefined
): Promise<OverlapBlockingEntry | null> {
  if (!startedAt || !stoppedAt) return {
    id: "missing-time-window",
    description: "Missing start or end time",
    source: "dayframe",
    reviewStatus: "invalid",
    startedAt: String(startedAt ?? ""),
    stoppedAt: stoppedAt ? String(stoppedAt) : null,
    categoryName: null,
    stoppedAtIsNull: stoppedAt == null
  };

  const result = await client.query<OverlapBlockingEntry>(
    `select te.id,
            te.description,
            te.source,
            te.review_status as "reviewStatus",
            te.started_at as "startedAt",
            te.stopped_at as "stoppedAt",
            c.name as "categoryName",
            (te.stopped_at is null) as "stoppedAtIsNull"
     from time_entries te
     left join categories c on c.id = te.category_id
     where te.workspace_id = $1
       and te.user_id = $2
       and te.started_at < $4::timestamptz
       and coalesce(te.stopped_at, 'infinity'::timestamptz) > $3::timestamptz
       and least(
             coalesce(te.stopped_at, 'infinity'::timestamptz),
             $4::timestamptz
           ) - greatest(te.started_at, $3::timestamptz) >= interval '1 minute'
     order by te.stopped_at is null desc, te.started_at desc
     limit 1`,
    [session.workspaceId, session.userId, startedAt, stoppedAt]
  );
  return result.rows[0] ?? null;
}

function normalizeHealthImportPreferences(input: HealthReviewReprocessInput["preferences"]) {
  const values = isRecord(input) ? input : {};
  return Object.fromEntries(
    HEALTH_IMPORT_PREFERENCE_OPTIONS.map((option) => [
      option.key,
      typeof values[option.key] === "boolean"
        ? Boolean(values[option.key])
        : DEFAULT_HEALTH_IMPORT_PREFERENCES[option.key]
    ])
  ) as HealthImportPreferences;
}

function healthPreferenceKeyForReviewItem(
  item: Pick<HealthReviewItemRow, "eventType" | "title">,
  rawPayload: Record<string, unknown>
): HealthImportPreferenceKey {
  if (item.eventType === "health_sleep_import") return "sleep";
  const hints = [
    rawPayload.workoutType,
    rawPayload.workoutLabel,
    rawPayload.activityType,
    rawPayload.type,
    item.title
  ];
  for (const hint of hints) {
    const workoutType = normalizeHealthWorkoutType(hint);
    if (workoutType !== "other") return workoutType;
  }
  return "other";
}

function isEligibleHealthReviewItemForAutoConfirm(
  item: Pick<HealthReviewItemRow, "confidence" | "eventType">,
  rawPayload: Record<string, unknown>,
  durationSeconds: number | null,
  preferenceKey: HealthImportPreferenceKey,
  startedAt: string | null,
  stoppedAt: string | null
) {
  if (!hasAutomaticConfidence(item.confidence) || !validHealthWindow(startedAt, stoppedAt)) return false;
  if (item.eventType === "health_sleep_import") {
    return shouldAutoConfirmHealthSleep({ durationSeconds, startedAt, stoppedAt });
  }
  if (item.eventType === "health_workout_import") {
    return shouldAutoConfirmHealthWorkout({ workoutType: preferenceKey, durationSeconds });
  }
  return false;
}

function healthAutoConfirmSkipReason(
  item: Pick<HealthReviewItemRow, "confidence" | "eventType">,
  rawPayload: Record<string, unknown>,
  durationSeconds: number | null,
  preferenceKey: HealthImportPreferenceKey,
  startedAt: string | null,
  stoppedAt: string | null
) {
  if (!hasAutomaticConfidence(item.confidence)) {
    return {
      code: "low_confidence",
      message: "Left in Review: confidence is not high enough for auto-log."
    };
  }

  if (!startedAt || !stoppedAt) {
    return {
      code: "missing_time_window",
      message: "Left in Review: missing start or end time."
    };
  }

  if (item.eventType === "health_sleep_import") {
    return {
      code: "sleep_threshold",
      message: "Left in Review: sleep duration is outside the auto-log range."
    };
  }

  if (item.eventType === "health_workout_import") {
    const minimumMinutes = healthWorkoutMinimumMinutes(preferenceKey);
    const actualMinutes = durationSeconds == null ? null : Math.floor(durationSeconds / 60);
    return {
      code: "workout_threshold",
      message: minimumMinutes
        ? `Left in Review: ${healthPreferenceLabel(preferenceKey)} is below the ${minimumMinutes}-minute auto-log threshold${actualMinutes == null ? "." : ` (${actualMinutes}m).`}`
        : `Left in Review: ${healthPreferenceLabel(preferenceKey)} is not auto-logged.`
    };
  }

  return {
    code: "unsupported_health_type",
    message: "Left in Review: unsupported Health activity type."
  };
}

function healthWorkoutMinimumMinutes(preferenceKey: HealthImportPreferenceKey) {
  switch (preferenceKey) {
    case "walking":
      return 5;
    case "running":
    case "cycling":
    case "swimming":
      return 10;
    case "strength_training":
      return 20;
    default:
      return null;
  }
}

function healthPreferenceLabel(preferenceKey: HealthImportPreferenceKey) {
  return HEALTH_IMPORT_PREFERENCE_OPTIONS.find((option) => option.key === preferenceKey)?.label ?? "Health activity";
}

function reviewDurationSeconds(
  rawPayload: Record<string, unknown>,
  startedAt: string | null,
  stoppedAt: string | null
) {
  const payloadDuration = wholeSecondsOrNull(rawPayload.durationSeconds);
  if (typeof payloadDuration === "number") return payloadDuration;
  if (!startedAt || !stoppedAt) return null;
  const started = new Date(startedAt).getTime();
  const stopped = new Date(stoppedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(stopped) || stopped <= started) return null;
  return Math.round((stopped - started) / 1000);
}

function compactErrorSummary(error: unknown, fallback: string) {
  const failure = syncFailureMetadata(error);
  return `${fallback}: ${failure.reason} (${failure.phase}${failure.sqlState ? `, ${failure.sqlState}` : ""})`;
}

function addCompactError(errors: string[], message: string) {
  if (errors.length < 5) errors.push(message);
}

function addHealthReviewReason(reasons: HealthReviewReason[], reason: HealthReviewReason) {
  if (reasons.length < 20) reasons.push(reason);
}



async function updateHealthReviewCategory(
  client: pg.PoolClient,
  item: Pick<HealthReviewItemRow, "id" | "eventId">,
  healthCategoryId: string
) {
  await client.query(
    `update review_items
     set suggested_category_id = $2
     where id = $1`,
    [item.id, healthCategoryId]
  );
  if (item.eventId) {
    await client.query(
      `update activity_events
       set suggested_category_id = $2
       where id = $1`,
      [item.eventId, healthCategoryId]
    );
  }
}

async function updateHealthReviewNotes(
  client: pg.PoolClient,
  id: string,
  notes: string
) {
  await client.query(
    `update review_items
     set notes = $2
     where id = $1`,
    [id, notes]
  );
}

async function resolveReprocessedHealthReviewItem(
  client: pg.PoolClient,
  item: Pick<HealthReviewItemRow, "id" | "eventId">,
  status: "accepted" | "ignored"
) {
  await client.query(
    `update review_items
     set status = $2,
         ignored_scope = case when $2 = 'ignored' then 'once' else null end,
         resolved_at = now()
     where id = $1`,
    [item.id, status]
  );
  if (item.eventId) {
    await client.query(
      `update activity_events
       set review_status = $2
       where id = $1`,
      [item.eventId, status === "accepted" ? "confirmed" : "ignored"]
    );
  }
}

export async function recordHealthSleepResolution(client: pg.PoolClient, session: RequestSession, eventId: string, entryId: string) {
  await client.query(
    `update activity_events ae set resolved_time_entry_id=te.id
     from time_entries te where ae.id=$3 and ae.workspace_id=$1 and ae.user_id=$2
       and ae.event_type='health_sleep_import' and te.id=$4
       and te.workspace_id=ae.workspace_id and te.user_id=ae.user_id`,
    [session.workspaceId,session.userId,eventId,entryId]);
}

async function hasTimeEntryCreatedFromEvent(
  client: pg.PoolClient,
  eventId: string,
  session: RequestSession
) {
  return Boolean(await getTimeEntryCreatedFromEvent(client, eventId, session));
}

async function getTimeEntryCreatedFromEvent(
  client: pg.PoolClient,
  eventId: string,
  session: RequestSession
) {
  const result = await client.query<{ id: string }>(
    `select id
     from time_entries
     where workspace_id = $1
       and user_id = $2
       and created_from_event_id = $3
     limit 1`,
    [session.workspaceId, session.userId, eventId]
  );
  return result.rows[0] ?? null;
}

async function insertConfirmedHealthTimeEntry(
  client: pg.PoolClient,
  item: Pick<
    HealthReviewItemRow,
    "eventId" | "eventSource" | "confidence" | "title" | "suggestedProjectId" | "suggestedPlaceId"
  >,
  session: RequestSession,
  input: {
    categoryId: string;
    description?: string;
    startedAt: string;
    stoppedAt: string;
  }
) {
  const result = await client.query<{id: string}>(
    `insert into time_entries (
        workspace_id,
        user_id,
        project_id,
        category_id,
        place_id,
        source,
        confidence,
        review_status,
        description,
        started_at,
        stopped_at,
        created_from_event_id
     )
     values ($1, $2, $3, $4, $5, coalesce($6, 'manual_app'), $7, 'confirmed', $8, $9, $10, $11) returning id`,
    [
      session.workspaceId,
      session.userId,
      item.suggestedProjectId,
      input.categoryId,
      item.suggestedPlaceId,
      item.eventSource,
      item.confidence,
      input.description ?? item.title,
      input.startedAt,
      input.stoppedAt,
      item.eventId
    ]
  );
  return result.rows[0]?.id;
}

function isExplicitStartEvent(type: string) {
  return (
    type === "timer_start" ||
    type === "timer_switch" ||
    type === "quick_action" ||
    type === "nfc_action" ||
    type === "shortcut_action"
  );
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function uuidStringOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

function normalizedLocationAddress(value: unknown): LocationDisplayAddress | null {
  if (!isRecord(value)) return null;
  const address: LocationDisplayAddress = {
    name: stringOrNull(value.name),
    street: stringOrNull(value.street),
    streetNumber: stringOrNull(value.streetNumber),
    district: stringOrNull(value.district),
    city: stringOrNull(value.city),
    subregion: stringOrNull(value.subregion),
    region: stringOrNull(value.region),
    postalCode: stringOrNull(value.postalCode),
    formattedAddress: stringOrNull(value.formattedAddress)
  };
  return Object.values(address).some(Boolean) ? address : null;
}

function timestampStringOrNull(value: unknown) {
  const timestamp = stringOrNull(value);
  if (!timestamp) return null;
  return Number.isNaN(new Date(timestamp).getTime()) ? null : timestamp;
}

function healthSleepSegmentsForEvent(event: ReturnType<typeof ActivityEventInputSchema.parse>) {
  const provider = stringOrNull(event.rawPayload.provider);
  const samples = Array.isArray(event.rawPayload.samples) ? event.rawPayload.samples : [];
  if (samples.length > 0) {
    return samples
      .filter(isRecord)
      .map((sample) => ({
        externalSampleId: stringOrNull(sample.externalSampleId),
        provider,
        sourceName: stringOrNull(sample.sourceName) ?? stringOrNull(event.rawPayload.sourceName),
        sleepStage: stringOrNull(sample.sleepStage),
        startedAt: timestampStringOrNull(sample.startedAt) ?? suggestedStartedAtForEvent(event),
        stoppedAt: timestampStringOrNull(sample.stoppedAt) ?? suggestedStoppedAtForEvent(event) ?? suggestedStartedAtForEvent(event),
        rawPayload: sample
      }));
  }

  return [
    {
      externalSampleId: stringOrNull(event.rawPayload.externalSampleId),
      provider,
      sourceName: stringOrNull(event.rawPayload.sourceName),
      sleepStage: stringOrNull(event.rawPayload.sleepStage),
      startedAt: stringOrNull(event.rawPayload.startedAt) ?? event.occurredAt,
      stoppedAt: stringOrNull(event.rawPayload.stoppedAt) ?? event.occurredAt,
      rawPayload: event.rawPayload
    }
  ];
}

async function upsertLearnedPlaceVisit(
  client: pg.PoolClient,
  event: ReturnType<typeof ActivityEventInputSchema.parse>,
  session: RequestSession
) {
  const latitude = numberOrNull(event.rawPayload.latitude);
  const longitude = numberOrNull(event.rawPayload.longitude);
  if (latitude === null || longitude === null) return;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return;

  const radiusMeters = Math.max(50, Math.min(500, Math.round(numberOrNull(event.rawPayload.radiusMeters) ?? 160)));
  const startedAt = timestampStringOrNull(event.rawPayload.startedAt) ?? event.occurredAt.toISOString();
  const stoppedAt = timestampStringOrNull(event.rawPayload.stoppedAt) ?? event.occurredAt.toISOString();
  const clusterKey = stringOrNull(event.rawPayload.clusterKey) ?? learnedPlaceClusterKey(latitude, longitude);
  const candidateName = readableLocationNameFromParts({
    address: event.rawPayload.address,
    latitude,
    longitude,
    fallbackName:
      event.description ??
      stringOrNull(event.rawPayload.placeName) ??
      stringOrNull(event.rawPayload.candidateName)
  });
  const sampleCount = Math.max(1, Math.round(numberOrNull(event.rawPayload.sampleCount) ?? 1));
  const evidence = locationLearningEvidenceFromPayload(event.rawPayload);
  const classification = classifyLocationLearningEvidence(evidence);
  if (classification.kind !== "place_candidate") return;
  const visitCount = evidence.visitCount;
  const firstSeenAt = timestampStringOrNull(event.rawPayload.clusterFirstSeenAt) ?? startedAt;
  const address = normalizedLocationAddress(event.rawPayload.address);
  const addressName = stringOrNull(address?.name);
  const poiName = addressName === candidateName ? addressName : null;
  const formattedAddress = locationAddressSummary(address);

  await client.query(
    `insert into learned_places (
        workspace_id,
        user_id,
        place_id,
        cluster_key,
        name,
        latitude,
        longitude,
        radius_meters,
        visit_count,
        distinct_day_count,
        sample_count,
        total_dwell_seconds,
        longest_dwell_seconds,
        average_accuracy_meters,
        max_cluster_spread_meters,
        first_seen_at,
        last_seen_at,
        last_started_at,
        last_stopped_at,
        confidence,
        classification,
        status,
        address,
        poi_name,
        formatted_address,
        geocoded_at,
        raw_payload
     )
     values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
       $16, $17, $16, $17, $18, 'place_candidate', 'candidate', $19::jsonb, $20, $21,
       case when $19::jsonb is null then null else now() end, $22::jsonb
     )
     on conflict (workspace_id, user_id, cluster_key)
     do update
       set name = case
             when excluded.address is not null or learned_places.address is null then excluded.name
             else learned_places.name
           end,
           latitude = excluded.latitude,
           longitude = excluded.longitude,
           radius_meters = greatest(learned_places.radius_meters, excluded.radius_meters),
           visit_count = greatest(learned_places.visit_count, excluded.visit_count),
           distinct_day_count = greatest(learned_places.distinct_day_count, excluded.distinct_day_count),
           sample_count = greatest(learned_places.sample_count, excluded.sample_count),
           total_dwell_seconds = greatest(learned_places.total_dwell_seconds, excluded.total_dwell_seconds),
           longest_dwell_seconds = greatest(learned_places.longest_dwell_seconds, excluded.longest_dwell_seconds),
           average_accuracy_meters = coalesce(excluded.average_accuracy_meters, learned_places.average_accuracy_meters),
           max_cluster_spread_meters = greatest(
             coalesce(learned_places.max_cluster_spread_meters, 0),
             coalesce(excluded.max_cluster_spread_meters, 0)
           ),
           first_seen_at = least(learned_places.first_seen_at, excluded.first_seen_at),
           last_seen_at = greatest(learned_places.last_seen_at, excluded.last_seen_at),
           last_started_at = excluded.last_started_at,
           last_stopped_at = excluded.last_stopped_at,
           confidence = excluded.confidence,
           classification = excluded.classification,
           address = coalesce(excluded.address, learned_places.address),
           poi_name = coalesce(excluded.poi_name, learned_places.poi_name),
           formatted_address = coalesce(excluded.formatted_address, learned_places.formatted_address),
           geocoded_at = coalesce(excluded.geocoded_at, learned_places.geocoded_at),
           raw_payload = excluded.raw_payload,
           updated_at = now()`,
    [
      session.workspaceId,
      session.userId,
      event.placeId ?? null,
      clusterKey,
      candidateName,
      latitude,
      longitude,
      radiusMeters,
      visitCount,
      evidence.distinctDays,
      sampleCount,
      Math.round(evidence.totalDwellMs / 1000),
      Math.round(evidence.longestDwellMs / 1000),
      evidence.averageAccuracyMeters,
      evidence.maxClusterSpreadMeters,
      firstSeenAt,
      stoppedAt,
      classification.confidence,
      address ? JSON.stringify(address) : null,
      poiName,
      formattedAddress,
      JSON.stringify(event.rawPayload)
    ]
  );
}

async function hasIgnoredLearnedPlaceCluster(
  client: pg.PoolClient,
  event: ReturnType<typeof ActivityEventInputSchema.parse>,
  session: RequestSession
) {
  const latitude = numberOrNull(event.rawPayload.latitude);
  const longitude = numberOrNull(event.rawPayload.longitude);
  const clusterKey =
    stringOrNull(event.rawPayload.clusterKey) ??
    (latitude !== null && longitude !== null ? learnedPlaceClusterKey(latitude, longitude) : null);
  if (!clusterKey) return false;

  const result = await client.query<{ id: string }>(
    `select id
     from learned_places
     where workspace_id = $1
       and user_id = $2
       and cluster_key = $3
       and status = 'ignored'
     limit 1`,
    [session.workspaceId, session.userId, clusterKey]
  );
  return Boolean(result.rows[0]);
}

function learnedPlaceClusterKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

function suggestedStartedAtForEvent(event: ReturnType<typeof ActivityEventInputSchema.parse>) {
  if (isExplicitStartEvent(event.type)) {
    return timestampStringOrNull(event.rawPayload.startedAt) ?? event.occurredAt;
  }

  if (event.type === "health_sleep_import" || event.type === "health_workout_import") {
    return timestampStringOrNull(event.rawPayload.startedAt) ?? event.occurredAt;
  }

  if (event.type === "unknown_stay") {
    return timestampStringOrNull(event.rawPayload.startedAt) ?? event.occurredAt;
  }

  if (event.type === "commute_detected" || event.type === "learned_place_visit") {
    return timestampStringOrNull(event.rawPayload.startedAt) ?? event.occurredAt;
  }

  if (event.type === "geofence_exit") {
    return timestampStringOrNull(event.rawPayload.startedAt) ?? timestampStringOrNull(event.rawPayload.enteredAt) ?? event.occurredAt;
  }

  return event.occurredAt;
}

function suggestedStoppedAtForEvent(event: ReturnType<typeof ActivityEventInputSchema.parse>) {
  if (event.type === "health_sleep_import" || event.type === "health_workout_import") {
    return timestampStringOrNull(event.rawPayload.stoppedAt) ?? timestampStringOrNull(event.rawPayload.endedAt);
  }

  if (event.type === "unknown_stay") {
    const stoppedAt = timestampStringOrNull(event.rawPayload.stoppedAt) ?? timestampStringOrNull(event.rawPayload.endedAt);
    if (stoppedAt) return stoppedAt;
    const durationMinutes = numberOrNull(event.rawPayload.durationMinutes);
    return durationMinutes ? new Date(event.occurredAt.getTime() + durationMinutes * 60_000).toISOString() : null;
  }

  if (event.type === "commute_detected" || event.type === "learned_place_visit") {
    return timestampStringOrNull(event.rawPayload.stoppedAt) ?? timestampStringOrNull(event.rawPayload.endedAt);
  }

  if (event.type === "geofence_exit") {
    return timestampStringOrNull(event.rawPayload.stoppedAt) ?? timestampStringOrNull(event.rawPayload.exitedAt) ?? event.occurredAt.toISOString();
  }

  return null;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function wholeSecondsOrNull(value: unknown) {
  const number = numberOrNull(value);
  return number === null ? null : Math.max(0, Math.round(number));
}

function tagNamesFromRawPayload(payload: Record<string, unknown>) {
  if (payload.tagNames === undefined) return [];
  return TimeEntryTagsPatchSchema.parse({ tagNames: payload.tagNames }).tagNames;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
