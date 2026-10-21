import type pg from "pg";
import { placeRoleLabel, type PlaceRole } from "@dayframe/shared";
import { isUndefinedColumnError, isUniqueViolationError, missingRequiredColumnError, pool } from "./db";
import type { RequestSession } from "./session";

export type PlaceRoleAssignment = {
  role: PlaceRole;
  /** The place that should hold the role, or null to leave the role empty. */
  placeId: string | null;
  /** Optional new name for the place that loses the role, e.g. "Previous home". */
  previousPlaceName?: string | null;
  /**
   * "Replace the old place" (PRD D19 A10): archive the previous holder in the same step, but only
   * when it is within 300 m of the new one (a short move, whose two circles would overlap).
   */
  archivePrevious?: boolean;
};

export type PlaceRoleAssignmentResult =
  /** `previousPlaceId` is the old holder, or the first of the places named like the role that were renamed. */
  | { status: "assigned"; placeId: string | null; previousPlaceId: string | null; previousArchived?: boolean }
  | { status: "place_not_found" };

/** Another request moved the same role at the same moment; the client can retry. */
export class PlaceRoleConflictError extends Error {
  readonly code = "place_role_conflict";
  constructor(cause: unknown) {
    super("Another change to this place role happened at the same time. Try again.", { cause });
  }
}

/**
 * Gives `placeId` the role and takes it from whichever place held it, inside the caller's
 * transaction. Only the role moves: entries keep pointing at the place they were recorded
 * at, so the old Home's history stays on the old Home. The old holder can be renamed in
 * the same step so that history doesn't read as a street address.
 */
export async function assignPlaceRoleWith(
  client: Pick<pg.PoolClient, "query">,
  session: RequestSession,
  assignment: PlaceRoleAssignment
): Promise<PlaceRoleAssignmentResult> {
  const previousPlaceName = assignment.previousPlaceName?.trim() || null;
  try {
    // Lock the current holder and the target together, in id order, so two moves that
    // swap Home and Work between the same places cannot deadlock. NO KEY UPDATE leaves
    // the key-share locks taken by entries and segments referencing these places alone.
    // Before roles existed, a place named exactly "Home" was Home; it is the implicit
    // holder when no place holds the role, so it can be renamed in the same step.
    // An archived place (PRD D19 A10) never takes a role and is never an implicit holder.
    const locked = await client.query<{ id: string; role: PlaceRole | null; name: string; archived: boolean }>(
      `select id, role, name, archived_at is not null as archived
       from places
       where workspace_id = $1
         and (role = $2 or id = $3::uuid or (role is null and archived_at is null and lower(btrim(name)) = lower($4)))
       order by id
       for no key update`,
      [session.workspaceId, assignment.role, assignment.placeId, placeRoleLabel(assignment.role)]
    );
    const target = assignment.placeId ? locked.rows.find((row) => row.id === assignment.placeId) : null;
    if (assignment.placeId && (!target || target.archived)) return { status: "place_not_found" };

    const holder = locked.rows.find((row) => row.role === assignment.role && row.id !== assignment.placeId) ?? null;
    const holderIsTarget = locked.rows.some((row) => row.role === assignment.role && row.id === assignment.placeId);
    // Every role-less place named like the role is an implicit holder, so none keeps reading
    // "Home" beside the new Home once the person chose a new name for the old one.
    const implicit = holder || holderIsTarget
      ? []
      : locked.rows.filter((row) => row.role === null && row.id !== assignment.placeId
        && row.name.trim().toLowerCase() === placeRoleLabel(assignment.role).toLowerCase());
    const previous = holder ? [holder] : previousPlaceName ? implicit : [];
    let previousArchived = false;
    if (previous.length > 0) {
      // "Replace the old place": archived with the role cleared, only within 300 m of the new place.
      const updated = await client.query<{ archived: boolean }>(
        `update places
         set role = null,
             name = coalesce($3::text, name),
             archived_at = case
               when $4::boolean and target.latitude is not null and places.latitude is not null
                 and ST_DWithin(
                   ST_SetSRID(ST_MakePoint(places.longitude, places.latitude), 4326)::geography,
                   ST_SetSRID(ST_MakePoint(target.longitude, target.latitude), 4326)::geography,
                   300)
               then coalesce(places.archived_at, now())
               else places.archived_at
             end
         from (select latitude, longitude from places where id = $5::uuid and workspace_id = $2
               union all select null::double precision, null::double precision where $5::uuid is null) as target
         where places.id = any($1::uuid[]) and places.workspace_id = $2
         returning places.archived_at is not null as archived`,
        [previous.map((row) => row.id), session.workspaceId, previousPlaceName, Boolean(assignment.archivePrevious),
          assignment.placeId]
      );
      previousArchived = Boolean(assignment.archivePrevious) && updated.rows.some((row) => row.archived);
    }
    if (target && target.role !== assignment.role) {
      // A place holds one role: making the Work place Home leaves Work empty.
      await client.query(
        "update places set role = $3 where id = $1 and workspace_id = $2",
        [target.id, session.workspaceId, assignment.role]
      );
    }
    return {
      status: "assigned",
      placeId: target?.id ?? null,
      previousPlaceId: previous[0]?.id ?? null,
      ...(assignment.archivePrevious ? { previousArchived } : {})
    };
  } catch (error) {
    if (isUniqueViolationError(error, "places_workspace_role_idx")) throw new PlaceRoleConflictError(error);
    if (isUndefinedColumnError(error, "role")) {
      throw missingRequiredColumnError("places", "role", "supabase/migrations/202610070001_place_role.sql", error);
    }
    throw error;
  }
}

export async function assignPlaceRole(session: RequestSession, assignment: PlaceRoleAssignment) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await assignPlaceRoleWith(client, session, assignment);
    await client.query(result.status === "assigned" ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
