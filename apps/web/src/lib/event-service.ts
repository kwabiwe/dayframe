import {
  ActivityEventInputSchema,
  normalizePaletteKey,
  normalizeActivityEvent,
  type ActivityEventInput
} from "@dayframe/shared";
import { pool, query } from "./db";
import { USER_ID, WORKSPACE_ID } from "./constants";
import { getNormalizationContext } from "./queries";

export async function processActivityEvent(rawInput: unknown) {
  const parsed = ActivityEventInputSchema.parse({
    occurredAt: new Date(),
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    rawPayload: {},
    ...(rawInput as Record<string, unknown>)
  });
  const context = await getNormalizationContext();
  const candidate = normalizeActivityEvent(parsed, context);
  const client = await pool.connect();

  try {
    await client.query("begin");
    const eventResult = await client.query<{ id: string }>(
      `insert into activity_events (
          workspace_id,
          user_id,
          device_id,
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
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
       returning id`,
      [
        parsed.workspaceId,
        parsed.userId,
        parsed.deviceId ?? null,
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
    } else if (candidate.action === "start_timer" && candidate.projectId) {
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
          candidate.projectId,
          candidate.categoryId ?? null,
          candidate.placeId ?? null,
          parsed.source,
          candidate.confidence,
          parsed.description ?? candidate.title,
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
  projectId: string;
  categoryId?: string | null;
  placeId?: string | null;
  description?: string | null;
  startedAt: string;
  stoppedAt: string;
}) {
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
        WORKSPACE_ID,
        USER_ID,
        input.startedAt,
        JSON.stringify({ description: input.description ?? "Manual entry" }),
        input.projectId,
        input.categoryId ?? null,
        input.placeId ?? null
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
        WORKSPACE_ID,
        USER_ID,
        input.projectId,
        input.categoryId ?? null,
        input.placeId ?? null,
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

export async function updateTimeEntry(
  id: string,
  input: {
    projectId?: string | null;
    categoryId?: string | null;
    placeId?: string | null;
    description?: string | null;
    startedAt?: string;
    stoppedAt?: string | null;
  }
) {
  await query(
    `update time_entries
     set project_id = coalesce($2, project_id),
         category_id = $3,
         place_id = $4,
         description = $5,
         started_at = coalesce($6, started_at),
         stopped_at = $7,
         updated_at = now()
     where id = $1 and workspace_id = $8`,
    [
      id,
      input.projectId ?? null,
      input.categoryId ?? null,
      input.placeId ?? null,
      input.description ?? null,
      input.startedAt ?? null,
      input.stoppedAt ?? null,
      WORKSPACE_ID
    ]
  );
}

export async function deleteTimeEntry(id: string) {
  await query("delete from time_entries where id = $1 and workspace_id = $2", [id, WORKSPACE_ID]);
}

export async function resolveReviewItem(
  id: string,
  action: "accept" | "ignore_once" | "always_ignore_source" | "create_rule"
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
      [id, WORKSPACE_ID]
    );
    const item = review.rows[0];
    if (!item) throw new Error("Review item not found");

    if (action === "accept" && item.suggestedProjectId && item.suggestedStartedAt) {
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
          WORKSPACE_ID,
          USER_ID,
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
          WORKSPACE_ID,
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
          WORKSPACE_ID,
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
        WORKSPACE_ID,
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

export async function createEntity(entity: string, input: Record<string, unknown>) {
  switch (entity) {
    case "client":
      return query("insert into clients (workspace_id, name, color) values ($1, $2, $3)", [
        WORKSPACE_ID,
        String(input.name ?? "New client"),
        normalizePaletteKey(input.color, String(input.name ?? "New client"))
      ]);
    case "category":
      return query("insert into categories (workspace_id, name, color) values ($1, $2, $3)", [
        WORKSPACE_ID,
        String(input.name ?? "New category"),
        normalizePaletteKey(input.color, String(input.name ?? "New category"))
      ]);
    case "tag":
      return query("insert into tags (workspace_id, name, color) values ($1, $2, $3)", [
        WORKSPACE_ID,
        String(input.name ?? "new-tag"),
        normalizePaletteKey(input.color, String(input.name ?? "new-tag"))
      ]);
    case "project":
      return query(
        `insert into projects (workspace_id, name, client_id, category_id, color, billable)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          WORKSPACE_ID,
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
          WORKSPACE_ID,
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
          WORKSPACE_ID,
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

export function buildQuickActionEvent(projectId: string, categoryId?: string | null): ActivityEventInput {
  return {
    source: "mobile_app",
    type: "quick_action",
    occurredAt: new Date(),
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    projectId,
    categoryId: categoryId ?? undefined,
    rawPayload: { origin: "quick_action" }
  };
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
