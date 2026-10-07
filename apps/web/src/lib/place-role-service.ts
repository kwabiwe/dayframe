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
};

export type PlaceRoleAssignmentResult =
  | { status: "assigned"; placeId: string | null; previousPlaceId: string | null }
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
    const locked = await client.query<{ id: string; role: PlaceRole | null; name: string }>(
      `select id, role, name
       from places
       where workspace_id = $1
         and (role = $2 or id = $3::uuid or (role is null and lower(btrim(name)) = lower($4)))
       order by id
       for no key update`,
      [session.workspaceId, assignment.role, assignment.placeId, placeRoleLabel(assignment.role)]
    );
    const target = assignment.placeId ? locked.rows.find((row) => row.id === assignment.placeId) : null;
    if (assignment.placeId && !target) return { status: "place_not_found" };

    const holder = locked.rows.find((row) => row.role === assignment.role && row.id !== assignment.placeId) ?? null;
    const holderIsTarget = locked.rows.some((row) => row.role === assignment.role && row.id === assignment.placeId);
    const implicit = holder || holderIsTarget
      ? null
      : locked.rows.find((row) => row.role === null && row.id !== assignment.placeId
        && row.name.trim().toLowerCase() === placeRoleLabel(assignment.role).toLowerCase()) ?? null;
    const previous = holder ?? (implicit && previousPlaceName ? implicit : null);
    if (previous) {
      await client.query(
        `update places
         set role = null,
             name = coalesce($3::text, name)
         where id = $1 and workspace_id = $2`,
        [previous.id, session.workspaceId, previousPlaceName]
      );
    }
    if (target && target.role !== assignment.role) {
      // A place holds one role: making the Work place Home leaves Work empty.
      await client.query(
        "update places set role = $3 where id = $1 and workspace_id = $2",
        [target.id, session.workspaceId, assignment.role]
      );
    }
    return { status: "assigned", placeId: target?.id ?? null, previousPlaceId: previous?.id ?? null };
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
