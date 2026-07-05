import {
  ActivityEventInputSchema,
  normalizePaletteKey,
  normalizeActivityEvent,
  type ActivityEventInput
} from "@dayframe/shared";
import { isUndefinedColumnError, missingRequiredColumnError, pool, query } from "./db";
import { getNormalizationContext } from "./queries";
import { getDevSession, type RequestSession } from "./session";

type CategoryRowLike = {
  id: string;
  name: string;
  color: string;
  isPinned: boolean;
};

const CATEGORY_PINS_MIGRATION = "supabase/migrations/202607040001_category_pins_and_project_backfill.sql";

function missingCategoryPinColumnError(cause: unknown) {
  return missingRequiredColumnError("categories", "is_pinned", CATEGORY_PINS_MIGRATION, cause);
}

export async function processActivityEvent(rawInput: unknown, session: RequestSession = getDevSession()) {
  const parsed = ActivityEventInputSchema.parse({
    occurredAt: new Date(),
    workspaceId: session.workspaceId,
    userId: session.userId,
    rawPayload: {},
    ...(rawInput as Record<string, unknown>)
  });
  const context = await getNormalizationContext(session);
  const candidate = normalizeActivityEvent(parsed, context);
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
    }

    if (candidate.reviewStatus === "needs_review") {
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
            confidence,
            status,
            notes
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10)`,
        [
          parsed.workspaceId,
          eventId,
          `${parsed.type}_suggestion`,
          candidate.title,
          candidate.projectId ?? null,
          candidate.categoryId ?? null,
          candidate.placeId ?? null,
          parsed.occurredAt,
          candidate.confidence,
          candidate.reason
        ]
      );
    }

    if (parsed.type === "health_sleep_import") {
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
         on conflict (workspace_id, provider, external_sample_id) do nothing`,
        [
          parsed.workspaceId,
          parsed.userId,
          stringOrNull(parsed.rawPayload.externalSampleId),
          stringOrNull(parsed.rawPayload.provider),
          stringOrNull(parsed.rawPayload.sourceName),
          stringOrNull(parsed.rawPayload.sleepStage),
          stringOrNull(parsed.rawPayload.startedAt) ?? parsed.occurredAt,
          stringOrNull(parsed.rawPayload.stoppedAt) ?? parsed.occurredAt,
          JSON.stringify(parsed.rawPayload)
        ]
      );
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
         on conflict (workspace_id, provider, external_sample_id) do nothing`,
        [
          parsed.workspaceId,
          parsed.userId,
          stringOrNull(parsed.rawPayload.externalSampleId),
          stringOrNull(parsed.rawPayload.provider),
          stringOrNull(parsed.rawPayload.workoutType),
          stringOrNull(parsed.rawPayload.startedAt) ?? parsed.occurredAt,
          stringOrNull(parsed.rawPayload.stoppedAt) ?? parsed.occurredAt,
          numberOrNull(parsed.rawPayload.durationSeconds),
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
    throw error;
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

export async function deleteTimeEntry(id: string, session: RequestSession = getDevSession()) {
  await query("delete from time_entries where id = $1 and workspace_id = $2", [
    id,
    session.workspaceId
  ]);
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
  action: "accept" | "ignore_once" | "always_ignore_source" | "create_rule",
  session: RequestSession = getDevSession()
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const review = await client.query<{
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
    }>(
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
              ae.event_type as "eventType"
       from review_items ri
       left join activity_events ae on ae.id = ri.event_id
       where ri.id = $1 and ri.workspace_id = $2
       for update of ri`,
      [id, session.workspaceId]
    );
    const item = review.rows[0];
    if (!item) throw new Error("Review item not found");

    if (action === "accept" && item.suggestedStartedAt) {
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
         values ($1, $2, $3, $4, $5, coalesce($6, 'manual_app'), $7, 'accepted', $8, $9, coalesce($10, $9::timestamptz + interval '1 hour'), $11)`,
        [
          session.workspaceId,
          session.userId,
          item.suggestedProjectId,
          item.suggestedCategoryId,
          item.suggestedPlaceId,
          item.eventSource,
          item.confidence,
          item.title,
          item.suggestedStartedAt,
          item.suggestedStoppedAt,
          item.eventId
        ]
      );
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

    await client.query(
      `update review_items
       set status = $3,
           ignored_scope = $4,
           resolved_at = now()
       where id = $1 and workspace_id = $2`,
      [
        id,
        session.workspaceId,
        action === "accept" || action === "create_rule" ? "accepted" : "ignored",
        action === "always_ignore_source" ? "source" : action === "ignore_once" ? "once" : null
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
      return query(
        `insert into places (
            workspace_id,
            name,
            latitude,
            longitude,
            radius_meters,
            priority,
            default_project_id,
            default_category_id,
            auto_start
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          session.workspaceId,
          String(input.name ?? "New place"),
          nullableNumber(input.latitude),
          nullableNumber(input.longitude),
          Number(input.radiusMeters ?? 100),
          Number(input.priority ?? 5),
          nullableString(input.projectId),
          nullableString(input.categoryId),
          Boolean(input.autoStart)
        ]
      );
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

function normalizeName(value: unknown, fallback: string) {
  const name = typeof value === "string" ? value.trim() : "";
  return name || fallback;
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

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
