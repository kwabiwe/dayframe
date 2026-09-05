import type pg from "pg";
import type { RequestSession } from "./session";

export type PriorHealthSource = {
  eventId: string;
  reviewStatus: string;
  sampleIds: string[];
  timeEntryId: string | null;
};
export type HealthSourceDecision =
  | { kind: "none" }
  | {
      kind: "ignored" | "resolution_unavailable" | "needs_review";
      priorEventIds: string[];
    }
  | { kind: "existing_workout"; priorEventIds: string[]; timeEntryId: string };

export function healthSourceSampleIds(
  payload: Record<string, unknown> | null | undefined,
) {
  if (!payload) return [];
  const ids: string[] = [];
  if (Array.isArray(payload.sourceSampleIds))
    for (const value of payload.sourceSampleIds)
      if (typeof value === "string" && value) ids.push(value);
  if (Array.isArray(payload.samples))
    for (const sample of payload.samples) {
      const value = (sample as { externalSampleId?: unknown } | null)
        ?.externalSampleId;
      if (typeof value === "string" && value) ids.push(value);
    }
  // A session fingerprint is not a source-sample identity.
  if (
    !ids.length &&
    typeof payload.externalSampleId === "string" &&
    payload.workoutType
  )
    ids.push(payload.externalSampleId);
  return [...new Set(ids)];
}

export function decideHealthSourceRevision(
  kind: string,
  ids: string[],
  prior: PriorHealthSource[],
  truncated = false,
): HealthSourceDecision {
  if (truncated) return { kind: "needs_review", priorEventIds: [] };
  const matches = prior.filter((row) =>
    row.sampleIds.some((id) => ids.includes(id)),
  );
  if (!matches.length) return { kind: "none" };
  const priorEventIds = matches.map((row) => row.eventId);
  const ignored = new Set(
    matches
      .filter((row) => row.reviewStatus === "ignored")
      .flatMap((row) => row.sampleIds),
  );
  if (ids.every((id) => ignored.has(id)))
    return { kind: "ignored", priorEventIds };
  // A newly added source phase does not undo a previous explicit ignore decision.
  if (ids.some((id) => ignored.has(id)))
    return { kind: "needs_review", priorEventIds };
  const linkedIds = new Set(
    matches.filter((row) => row.timeEntryId).flatMap((row) => row.sampleIds),
  );
  const unavailable = matches.filter(
    (row) =>
      row.reviewStatus === "confirmed" &&
      !row.timeEntryId &&
      row.sampleIds.some((id) => ids.includes(id) && !linkedIds.has(id)),
  );
  if (unavailable.length)
    return { kind: "resolution_unavailable", priorEventIds };
  const entries = [
    ...new Set(
      matches.flatMap((row) => (row.timeEntryId ? [row.timeEntryId] : [])),
    ),
  ];
  if (entries.length > 1) return { kind: "needs_review", priorEventIds };
  if (
    kind === "health_workout_import" &&
    entries.length === 1 &&
    ids.every((id) => linkedIds.has(id))
  )
    return { kind: "existing_workout", timeEntryId: entries[0], priorEventIds };
  // Untouched Sleep retains its existing logical matcher and union-of-windows policy.
  return { kind: "none" };
}

export async function inspectHealthSourceRevision(
  client: pg.PoolClient,
  session: RequestSession,
  kind: string,
  payload: Record<string, unknown>,
): Promise<HealthSourceDecision> {
  const ids = healthSourceSampleIds(payload);
  if (!ids.length) return { kind: "none" };
  if (ids.length > 5_000) return { kind: "needs_review", priorEventIds: [] };
  const result = await client.query<{
    eventId: string;
    reviewStatus: string;
    rawPayload: Record<string, unknown>;
    timeEntryId: string | null;
  }>(
    `select ae.id as "eventId",ae.review_status as "reviewStatus",ae.raw_payload as "rawPayload",
       te.id as "timeEntryId"
     from activity_events ae
     left join lateral(select id from time_entries where workspace_id=ae.workspace_id and user_id=ae.user_id
       and (created_from_event_id=ae.id or id=ae.resolved_time_entry_id) limit 1) te on true
     where ae.workspace_id=$1 and ae.user_id=$2 and ae.event_type=$3
       and coalesce(ae.raw_payload->>'provider','healthkit')='healthkit'
       and ((ae.raw_payload->'sourceSampleIds') ?| $4::text[]
         or (ae.raw_payload->>'externalSampleId'=any($4::text[]) and ae.event_type='health_workout_import')
         or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(ae.raw_payload->'samples')='array' then ae.raw_payload->'samples' else '[]'::jsonb end) sample
           where sample->>'externalSampleId'=any($4::text[])))
     order by ae.created_at,ae.id limit 501`,
    [session.workspaceId, session.userId, kind, ids],
  );
  return decideHealthSourceRevision(
    kind,
    ids,
    result.rows.map((row) => ({
      ...row,
      sampleIds: healthSourceSampleIds(row.rawPayload),
    })),
    result.rows.length > 500,
  );
}
