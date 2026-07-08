import {
  ActivityEventInputSchema,
  DEFAULT_HEALTH_IMPORT_PREFERENCES,
  HEALTH_IMPORT_PREFERENCE_OPTIONS,
  normalizeHealthWorkoutType,
  normalizePaletteKey,
  normalizeActivityEvent,
  shouldAutoConfirmHealthSleep,
  shouldAutoConfirmHealthWorkout,
  type ActivityEventType,
  type ActivityEventInput,
  type HealthImportPreferenceKey,
  type HealthImportPreferences
} from "@dayframe/shared";
import {
  databaseReadinessError,
  databasePayloadError,
  isCheckViolationError,
  isForeignKeyViolationError,
  isInsufficientPrivilegeError,
  isInvalidTextRepresentationError,
  isInvalidConflictTargetError,
  isNotNullViolationError,
  isUniqueViolationError,
  isUndefinedColumnError,
  isUndefinedTableError,
  missingRequiredColumnError,
  pool,
  query
} from "./db";
import { getNormalizationContext } from "./queries";
import { getDevSession, type RequestSession } from "./session";
import type pg from "pg";

type CategoryRowLike = {
  id: string;
  name: string;
  color: string;
  isPinned: boolean;
};

type PlaceRowLike = {
  id: string;
  name: string;
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
};

export type ReviewResolutionCode =
  | "review_item_not_found"
  | "already_resolved"
  | "invalid_action"
  | "invalid_time_window"
  | "duplicate_entry"
  | "database_constraint";

export type ReviewResolutionResult = {
  ok: true;
  action: "accept" | "ignore_once" | "always_ignore_source" | "create_rule";
  status: "accepted" | "ignored";
  entryId?: string;
  duplicate?: boolean;
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

const CATEGORY_PINS_MIGRATION = "supabase/migrations/202607040001_category_pins_and_project_backfill.sql";
const MOBILE_EVENT_IDEMPOTENCY_MIGRATION =
  "supabase/migrations/202607030001_mobile_event_idempotency_and_workouts.sql";
const HEALTH_SLEEP_SCHEMA_MIGRATION =
  "supabase/migrations/202607070001_health_sleep_segments.sql";
const HEALTH_RLS_MIGRATION = "supabase/migrations/202607020001_dayframe_rls.sql";
const PLACE_DEFAULT_ACTIVITY_DESCRIPTION_MIGRATION =
  "supabase/migrations/202607070002_place_default_activity_description.sql";

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

export async function processActivityEvent(rawInput: unknown, session: RequestSession = getDevSession()) {
  const input = isRecord(rawInput) ? rawInput : {};
  const parsed = ActivityEventInputSchema.parse({
    occurredAt: new Date(),
    rawPayload: {},
    ...input,
    workspaceId: session.workspaceId,
    userId: session.userId
  });
  const context = await getNormalizationContext(session);
  let candidate = normalizeActivityEvent(parsed, context);
  const client = await pool.connect();

  try {
    await client.query("begin");

    if (parsed.clientEventId) {
      const existingEvent = await client.query<{ id: string }>(
        `select id
         from activity_events
         where workspace_id = $1 and user_id = $2 and client_event_id = $3
         limit 1`,
        [parsed.workspaceId, parsed.userId, parsed.clientEventId]
      );

      if (existingEvent.rows[0]) {
        await client.query("commit");
        return { eventId: existingEvent.rows[0].id, candidate, duplicate: true };
      }
    }

    if (isHealthEvent(parsed.type) && !candidate.categoryId) {
      candidate = {
        ...candidate,
        categoryId: await ensureHealthCategoryId(client, session)
      };
    }

    if (candidate.action === "create_time_entry" && isHealthEvent(parsed.type)) {
      const conflict = await hasOverlappingTimeEntry(client, parsed, session);
      if (conflict) {
        candidate = {
          ...candidate,
          action: "create_review_item",
          reviewStatus: "needs_review",
          reason: "This Health activity overlaps existing time and needs review before becoming confirmed time."
        };
      }
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
        JSON.stringify(parsed.rawPayload),
        candidate.projectId ?? null,
        candidate.categoryId ?? null,
        candidate.placeId ?? null,
        candidate.reviewStatus
      ]
    );
    const eventId = eventResult.rows[0].id;

    if (candidate.action === "stop_timer") {
      await client.query(
        `update time_entries
         set stopped_at = $1, updated_at = now()
         where workspace_id = $2 and user_id = $3 and stopped_at is null`,
        [parsed.occurredAt, parsed.workspaceId, parsed.userId]
      );
    } else if (candidate.action === "start_timer") {
      if (candidate.shouldClosePrevious) {
        await client.query(
          `update time_entries
           set stopped_at = $1, updated_at = now()
           where workspace_id = $2 and user_id = $3 and stopped_at is null`,
          [parsed.occurredAt, parsed.workspaceId, parsed.userId]
        );
      }

      await client.query(
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
            created_from_event_id
         )
         values ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8, $9, $10)`,
        [
          parsed.workspaceId,
          parsed.userId,
          candidate.projectId ?? null,
          candidate.categoryId ?? null,
          candidate.placeId ?? null,
          parsed.source,
          candidate.confidence,
          parsed.description ?? (isExplicitStartEvent(parsed.type) ? null : candidate.title),
          parsed.occurredAt,
          eventId
        ]
      );
    } else if (candidate.action === "create_time_entry") {
      const startedAt = suggestedStartedAtForEvent(parsed);
      const stoppedAt = suggestedStoppedAtForEvent(parsed);
      await client.query(
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
         values ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8, $9, coalesce($10, $9::timestamptz + interval '1 hour'), $11)`,
        [
          parsed.workspaceId,
          parsed.userId,
          candidate.projectId ?? null,
          candidate.categoryId ?? null,
          candidate.placeId ?? null,
          parsed.source,
          candidate.confidence,
          parsed.description ?? candidate.title,
          startedAt,
          stoppedAt,
          eventId
        ]
      );
    }

    if (candidate.reviewStatus === "needs_review") {
      const suggestedStartedAt = suggestedStartedAtForEvent(parsed);
      const suggestedStoppedAt = suggestedStoppedAtForEvent(parsed);
      await client.query(
        `insert into review_items (
            workspace_id,
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
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11)`,
        [
          parsed.workspaceId,
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

    await client.query("commit");
    return { eventId, candidate };
  } catch (error) {
    await client.query("rollback");
    throw eventSyncReadinessError(error, parsed.type) ?? error;
  } finally {
    client.release();
  }
}

export async function createManualEntry(input: {
  projectId?: string | null;
  categoryId?: string | null;
  placeId?: string | null;
  description?: string | null;
  startedAt: string;
  stoppedAt: string;
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
        JSON.stringify({ description: input.description ?? "Manual entry" }),
        nullableString(input.projectId),
        nullableString(input.categoryId),
        nullableString(input.placeId)
      ]
    );

    await client.query(
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
       values ($1, $2, $3, $4, $5, 'manual_app', 'high', 'confirmed', $6, $7, $8, $9)`,
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

    await client.query("commit");
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
  },
  session: RequestSession = getDevSession()
) {
  const name = normalizeName(input.name, "New category");
  const color = normalizePaletteKey(input.color, name);

  try {
    const result = await query<{
      id: string;
      name: string;
      color: string;
      isPinned: boolean;
    }>(
      `insert into categories (workspace_id, name, color, is_pinned)
       values ($1, $2, $3, $4)
       returning id, name, color, is_pinned as "isPinned"`,
      [
        session.workspaceId,
        name,
        color,
        Boolean(input.isPinned)
      ]
    );

    return result.rows[0];
  } catch (error) {
    if (isUndefinedColumnError(error, "is_pinned")) throw missingCategoryPinColumnError(error);
    throw error;
  }
}

export async function updateCategory(
  id: string,
  input: {
    name?: string | null;
    color?: string | null;
    isPinned?: boolean;
  },
  session: RequestSession = getDevSession()
) {
  const hasName = Object.prototype.hasOwnProperty.call(input, "name");
  const hasColor = Object.prototype.hasOwnProperty.call(input, "color");
  const hasIsPinned = Object.prototype.hasOwnProperty.call(input, "isPinned");
  const normalizedName = hasName ? normalizeName(input.name, "Category") : null;
  const normalizedColor = hasColor
    ? normalizePaletteKey(input.color, normalizedName ?? id)
    : null;

  try {
    const result = await query<CategoryRowLike>(
      `update categories
       set name = case when $3 then $4 else name end,
           color = case when $5 then $6 else color end,
           is_pinned = case when $7 then $8 else is_pinned end
       where id = $1 and workspace_id = $2 and is_archived = false
       returning id, name, color, is_pinned as "isPinned"`,
      [
        id,
        session.workspaceId,
        hasName,
        normalizedName,
        hasColor,
        normalizedColor,
        hasIsPinned,
        Boolean(input.isPinned)
      ]
    );

    return result.rows[0] ?? null;
  } catch (error) {
    if (isUndefinedColumnError(error, "is_pinned")) throw missingCategoryPinColumnError(error);
    throw error;
  }
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

export async function createPlace(
  input: {
    name: string;
    latitude?: number | null;
    longitude?: number | null;
    radiusMeters?: number | null;
    priority?: number | null;
    defaultCategoryId?: string | null;
    defaultActivityDescription?: string | null;
    autoStart?: boolean;
  },
  session: RequestSession = getDevSession()
) {
  const name = normalizeName(input.name, "New place");
  try {
    const result = await query<PlaceRowLike>(
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
            auto_start
         )
         values ($1, $2, $3, $4, $5, $6, null, $7, $8, $9)
         returning id,
                   name,
                   latitude,
                   longitude,
                   radius_meters,
                   priority,
                   default_project_id,
                   default_category_id,
                   default_activity_description,
                   auto_start
       )
       select inserted.id,
              inserted.name,
              inserted.latitude,
              inserted.longitude,
              inserted.radius_meters as "radiusMeters",
              inserted.priority,
              inserted.default_project_id as "defaultProjectId",
              p.name as "defaultProjectName",
              inserted.default_category_id as "defaultCategoryId",
              c.name as "defaultCategoryName",
              inserted.default_activity_description as "defaultActivityDescription",
              inserted.auto_start as "autoStart"
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
        Boolean(input.autoStart)
      ]
    );

    return result.rows[0];
  } catch (error) {
    if (isUndefinedColumnError(error, "default_activity_description")) {
      throw missingPlaceDefaultActivityDescriptionColumnError(error);
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
  },
  session: RequestSession = getDevSession()
) {
  const hasName = Object.prototype.hasOwnProperty.call(input, "name");
  const hasLatitude = Object.prototype.hasOwnProperty.call(input, "latitude");
  const hasLongitude = Object.prototype.hasOwnProperty.call(input, "longitude");
  const hasRadius = Object.prototype.hasOwnProperty.call(input, "radiusMeters");
  const hasPriority = Object.prototype.hasOwnProperty.call(input, "priority");
  const hasDefaultCategory = Object.prototype.hasOwnProperty.call(input, "defaultCategoryId");
  const hasDefaultActivityDescription = Object.prototype.hasOwnProperty.call(input, "defaultActivityDescription");
  const hasAutoStart = Object.prototype.hasOwnProperty.call(input, "autoStart");

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
             auto_start = case when $17 then $18 else auto_start end
         where id = $1 and workspace_id = $2
         returning id,
                   name,
                   latitude,
                   longitude,
                   radius_meters,
                   priority,
                   default_project_id,
                   default_category_id,
                   default_activity_description,
                   auto_start
       )
       select updated.id,
              updated.name,
              updated.latitude,
              updated.longitude,
              updated.radius_meters as "radiusMeters",
              updated.priority,
              updated.default_project_id as "defaultProjectId",
              p.name as "defaultProjectName",
              updated.default_category_id as "defaultCategoryId",
              c.name as "defaultCategoryName",
              updated.default_activity_description as "defaultActivityDescription",
              updated.auto_start as "autoStart"
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
        Boolean(input.autoStart)
      ]
    );

    return result.rows[0] ?? null;
  } catch (error) {
    if (isUndefinedColumnError(error, "default_activity_description")) {
      throw missingPlaceDefaultActivityDescriptionColumnError(error);
    }
    throw error;
  }
}

export async function deletePlace(id: string, session: RequestSession = getDevSession()) {
  const result = await query<{ id: string }>(
    "delete from places where id = $1 and workspace_id = $2 returning id",
    [id, session.workspaceId]
  );
  return result.rows[0] ?? null;
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
  },
  session: RequestSession = getDevSession()
) {
  const hasProjectId = Object.prototype.hasOwnProperty.call(input, "projectId");
  const hasCategoryId = Object.prototype.hasOwnProperty.call(input, "categoryId");
  const hasPlaceId = Object.prototype.hasOwnProperty.call(input, "placeId");
  const hasDescription = Object.prototype.hasOwnProperty.call(input, "description");
  const hasStartedAt = Object.prototype.hasOwnProperty.call(input, "startedAt");
  const hasStoppedAt = Object.prototype.hasOwnProperty.call(input, "stoppedAt");

  await query(
    `update time_entries
     set project_id = case when $2 then $3 else project_id end,
         category_id = case when $4 then $5 else category_id end,
         place_id = case when $6 then $7 else place_id end,
         description = case when $8 then $9 else description end,
         started_at = case when $10 then $11 else started_at end,
         stopped_at = case when $12 then $13 else stopped_at end,
         updated_at = now()
     where id = $1 and workspace_id = $14 and user_id = $15`,
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
}

export class TimeEntryNotFoundError extends Error {
  constructor() {
    super("Time entry not found.");
    this.name = "TimeEntryNotFoundError";
  }
}

export async function deleteTimeEntry(id: string, session: RequestSession = getDevSession()) {
  const result = await query(
    "delete from time_entries where id = $1 and workspace_id = $2 and user_id = $3",
    [id, session.workspaceId, session.userId]
  );
  if ((result.rowCount ?? 0) === 0) throw new TimeEntryNotFoundError();
  return { id, deleted: true };
}

export async function splitActiveEntry(session: RequestSession = getDevSession()) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const active = await client.query<{
      id: string;
      projectId: string | null;
      categoryId: string | null;
      placeId: string | null;
      source: string;
      confidence: string;
      reviewStatus: string;
      description: string | null;
    }>(
      `select id,
              project_id as "projectId",
              category_id as "categoryId",
              place_id as "placeId",
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
    if (!row) throw new Error("No active timer is available to split.");

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
        JSON.stringify({ origin: "web_timer_split", previousEntryId: row.id }),
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
          source,
          confidence,
          review_status,
          description,
          started_at,
          created_from_event_id
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10)`,
      [
        session.workspaceId,
        session.userId,
        row.projectId,
        row.categoryId,
        row.placeId,
        row.source,
        row.confidence,
        row.reviewStatus,
        row.description,
        eventResult.rows[0].id
      ]
    );

    await client.query("commit");
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
  session: RequestSession = getDevSession()
): Promise<ReviewResolutionResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (!isReviewResolutionAction(action)) {
      throw new ReviewResolutionError("invalid_action", "Unsupported review action.", {
        status: 400,
        details: { action }
      });
    }

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
    }>(
      `select ri.id,
              ri.event_id as "eventId",
              ri.title,
              ri.status,
              ri.suggested_project_id as "suggestedProjectId",
              ri.suggested_category_id as "suggestedCategoryId",
              ri.suggested_place_id as "suggestedPlaceId",
              ri.suggested_started_at as "suggestedStartedAt",
              ri.suggested_stopped_at as "suggestedStoppedAt",
              ri.confidence,
              ae.source as "eventSource",
              ae.event_type as "eventType"
       from review_items ri
       left join activity_events ae on ae.id = ri.event_id
       where ri.id = $1 and ri.workspace_id = $2
       for update of ri`,
      [id, session.workspaceId]
    );
    const item = review.rows[0];
    if (!item) {
      throw new ReviewResolutionError("review_item_not_found", "Review item not found.", { status: 404 });
    }
    if (item.status !== "open") {
      throw new ReviewResolutionError("already_resolved", "This review item has already been resolved.", {
        status: 409,
        details: { reviewItemId: item.id, status: item.status }
      });
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
            item.title,
            window.startedAt,
            window.stoppedAt,
            item.eventId
          ]
        );
        entryId = inserted.rows[0]?.id;
      }
    }

    if (action === "create_rule" && item.eventSource && item.eventType) {
      await client.query(
        `insert into automation_rules (
            workspace_id,
            name,
            trigger_source,
            trigger_type,
            place_id,
            action,
            project_id,
            category_id,
            confidence_threshold,
            enabled
         )
         values ($1, $2, $3, $4, $5, 'suggest_timer', $6, $7, $8, true)`,
        [
          session.workspaceId,
          `Suggestion from ${item.title}`,
          item.eventSource,
          item.eventType,
          item.suggestedPlaceId,
          item.suggestedProjectId,
          item.suggestedCategoryId,
          item.confidence
        ]
      );
    }

    if (action === "always_ignore_source" && item.eventSource && item.eventType) {
      await client.query(
        `insert into automation_rules (
            workspace_id,
            name,
            trigger_source,
            trigger_type,
            place_id,
            action,
            project_id,
            category_id,
            confidence_threshold,
            enabled
         )
         values ($1, $2, $3, $4, null, 'ignore_source', null, null, $5, true)`,
        [
          session.workspaceId,
          `Ignore ${item.eventSource} / ${item.eventType}`,
          item.eventSource,
          item.eventType,
          item.confidence
        ]
      );
    }

    const resolvedStatus = action === "accept" || action === "create_rule" ? "accepted" : "ignored";
    await client.query(
      `update review_items
       set status = $3,
           ignored_scope = $4,
           resolved_at = now()
       where id = $1 and workspace_id = $2`,
      [
        id,
        session.workspaceId,
        resolvedStatus,
        action === "always_ignore_source" ? "source" : action === "ignore_once" ? "once" : null
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
    await client.query("commit");
    return { ok: true, action, status: resolvedStatus, entryId, duplicate };
  } catch (error) {
    await client.query("rollback");
    throw reviewResolutionErrorForDatabaseError(error);
  } finally {
    client.release();
  }
}

function isReviewResolutionAction(
  value: unknown
): value is "accept" | "ignore_once" | "always_ignore_source" | "create_rule" {
  return (
    value === "accept" ||
    value === "ignore_once" ||
    value === "always_ignore_source" ||
    value === "create_rule"
  );
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
      "A time entry already exists for this activity.",
      {
        status: 409,
        cause: error
      }
    );
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
  session: RequestSession = getDevSession()
) {
  const preferences = normalizeHealthImportPreferences(input.preferences);
  const client = await pool.connect();
  const result = {
    checkedCount: 0,
    confirmedCount: 0,
    ignoredCount: 0,
    leftInReviewCount: 0,
    skippedCount: 0,
    failedCount: 0,
    updatedCategoryCount: 0,
    remainingReviewCount: 0,
    errorSummary: [] as string[],
    reasons: [] as HealthReviewReason[]
  };

  try {
    await client.query("begin");
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
         and ri.status = 'open'
         and ae.workspace_id = $1
         and ae.user_id = $2
         and ae.event_type in ('health_sleep_import', 'health_workout_import')
       order by ri.created_at asc
       for update of ri`,
      [session.workspaceId, session.userId]
    );

    if (reviewItems.rows.length === 0) {
      await client.query("commit");
      return result;
    }

    let healthCategoryId: string | null = null;
    try {
      healthCategoryId = await ensureHealthCategoryId(client, session);
    } catch (error) {
      result.failedCount = reviewItems.rows.length;
      result.errorSummary.push(compactErrorSummary(error, "Unable to ensure Health category"));
      await client.query("rollback");
      return result;
    }

    for (const item of reviewItems.rows) {
      result.checkedCount += 1;
      await client.query("savepoint reprocess_health_item");
      try {
        const rawPayload = isRecord(item.rawPayload) ? item.rawPayload : {};
        const startedAt = timestampStringOrNull(rawPayload.startedAt) ?? item.suggestedStartedAt;
        const stoppedAt = timestampStringOrNull(rawPayload.stoppedAt) ?? item.suggestedStoppedAt;
        const durationSeconds = reviewDurationSeconds(rawPayload, startedAt, stoppedAt);
        const preferenceKey = healthPreferenceKeyForReviewItem(item, rawPayload);

        if (item.suggestedCategoryId !== healthCategoryId || item.eventCategoryId !== healthCategoryId) {
          await updateHealthReviewCategory(client, item, healthCategoryId);
          result.updatedCategoryCount += 1;
        }

        if (!preferences[preferenceKey]) {
          await resolveReprocessedHealthReviewItem(client, item, "ignored");
          result.ignoredCount += 1;
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

        const blockingEntry = await findOverlappingTimeEntry(client, session, startedAt, stoppedAt);
        if (blockingEntry) {
          const message = overlapReviewNote(blockingEntry);
          await updateHealthReviewNotes(client, item.id, message);
          addHealthReviewReason(result.reasons, {
            reviewItemId: item.id,
            code: "overlap",
            message,
            blockingEntry
          });
          result.leftInReviewCount += 1;
          result.remainingReviewCount += 1;
          await client.query("release savepoint reprocess_health_item");
          continue;
        }

        await insertConfirmedHealthTimeEntry(client, item, session, {
          categoryId: healthCategoryId,
          startedAt,
          stoppedAt
        });
        await resolveReprocessedHealthReviewItem(client, item, "accepted");
        result.confirmedCount += 1;
        await client.query("release savepoint reprocess_health_item");
      } catch (error) {
        await client.query("rollback to savepoint reprocess_health_item");
        await client.query("release savepoint reprocess_health_item");
        result.failedCount += 1;
        result.skippedCount += 1;
        result.leftInReviewCount += 1;
        result.remainingReviewCount += 1;
        addCompactError(result.errorSummary, compactErrorSummary(error, `Skipped ${item.id}`));
      }
    }

    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
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
      try {
        return await query(
          "insert into categories (workspace_id, name, color, is_pinned) values ($1, $2, $3, $4)",
          [
            session.workspaceId,
            String(input.name ?? "New category"),
            normalizePaletteKey(input.color, String(input.name ?? "New category")),
            Boolean(input.isPinned)
          ]
        );
      } catch (error) {
        if (!isUndefinedColumnError(error, "is_pinned")) throw error;
        return query(
          "insert into categories (workspace_id, name, color) values ($1, $2, $3)",
          [
            session.workspaceId,
            String(input.name ?? "New category"),
            normalizePaletteKey(input.color, String(input.name ?? "New category"))
          ]
        );
      }
    case "tag":
      return query("insert into tags (workspace_id, name, color) values ($1, $2, $3)", [
        session.workspaceId,
        String(input.name ?? "new-tag"),
        normalizePaletteKey(input.color, String(input.name ?? "new-tag"))
      ]);
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
              auto_start
           )
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
            Boolean(input.autoStart)
          ]
        );
      } catch (error) {
        if (isUndefinedColumnError(error, "default_activity_description")) {
          throw missingPlaceDefaultActivityDescriptionColumnError(error);
        }
        throw error;
      }
    case "automation_rule":
      return query(
        `insert into automation_rules (
            workspace_id,
            name,
            trigger_source,
            trigger_type,
            place_id,
            action,
            project_id,
            category_id,
            confidence_threshold,
            enabled
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
        [
          session.workspaceId,
          String(input.name ?? "New automation"),
          String(input.triggerSource ?? "geofence_specific"),
          String(input.triggerType ?? "geofence_enter"),
          nullableString(input.placeId),
          String(input.action ?? "suggest_timer"),
          nullableString(input.projectId),
          nullableString(input.categoryId),
          String(input.confidenceThreshold ?? "medium_high")
        ]
      );
    default:
      throw new Error(`Unsupported entity: ${entity}`);
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

async function ensureHealthCategoryId(
  client: pg.PoolClient,
  session: RequestSession
) {
  const existing = await client.query<{ id: string }>(
    `select id
     from categories
     where workspace_id = $1
       and lower(name) = lower($2)
       and coalesce(is_archived, false) = false
     order by created_at asc
     limit 1`,
    [session.workspaceId, "Health"]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const created = await client.query<{ id: string }>(
    `insert into categories (workspace_id, name, color, is_pinned)
     values ($1, 'Health', 'moss', false)
     returning id`,
    [session.workspaceId]
  );
  return created.rows[0].id;
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
  if (item.confidence !== "high") return false;
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
  if (item.confidence !== "high") {
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
  const message = error instanceof Error ? error.message : String(error ?? "");
  return `${fallback}: ${message || "Unknown error"}`.replace(/\s+/g, " ").slice(0, 240);
}

function addCompactError(errors: string[], message: string) {
  if (errors.length < 5) errors.push(message);
}

function addHealthReviewReason(reasons: HealthReviewReason[], reason: HealthReviewReason) {
  if (reasons.length < 20) reasons.push(reason);
}

function overlapReviewNote(blockingEntry: OverlapBlockingEntry) {
  const title = blockingEntry.description?.trim() || blockingEntry.categoryName || blockingEntry.source;
  if (blockingEntry.stoppedAtIsNull) {
    return `Left in Review: overlaps stale open timer "${title}" with no stop time.`;
  }
  return `Left in Review: overlaps existing timer "${title}".`;
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
    startedAt: string;
    stoppedAt: string;
  }
) {
  await client.query(
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
     values ($1, $2, $3, $4, $5, coalesce($6, 'manual_app'), $7, 'confirmed', $8, $9, $10, $11)`,
    [
      session.workspaceId,
      session.userId,
      item.suggestedProjectId,
      input.categoryId,
      item.suggestedPlaceId,
      item.eventSource,
      item.confidence,
      item.title,
      input.startedAt,
      input.stoppedAt,
      item.eventId
    ]
  );
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

function suggestedStartedAtForEvent(event: ReturnType<typeof ActivityEventInputSchema.parse>) {
  if (event.type === "health_sleep_import" || event.type === "health_workout_import") {
    return timestampStringOrNull(event.rawPayload.startedAt) ?? event.occurredAt;
  }

  if (event.type === "unknown_stay") {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
