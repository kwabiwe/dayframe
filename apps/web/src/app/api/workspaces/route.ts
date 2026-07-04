import { NextResponse } from "next/server";
import { normalizePaletteKey } from "@dayframe/shared";
import { sessionTokenFromRequest, switchLocalSessionWorkspace } from "@/lib/auth/local";
import { authErrorResponse } from "@/lib/api-errors";
import { hasTableColumn, pool } from "@/lib/db";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function POST(request: Request) {
  const client = await pool.connect();
  try {
    const session = await resolveRequestSession(request);
    const body = (await request.json()) as { name?: string };
    const name = body.name?.trim() || "New workspace";

    await client.query("begin");
    const workspace = await client.query<{ id: string; name: string }>(
      `insert into workspaces (name)
       values ($1)
       returning id, name`,
      [name.slice(0, 120)]
    );
    const workspaceId = workspace.rows[0].id;

    await client.query(
      `insert into workspace_members (workspace_id, user_id, role)
       values ($1, $2, 'owner')
       on conflict (workspace_id, user_id) do nothing`,
      [workspaceId, session.userId]
    );

    const clientRow = await client.query<{ id: string }>(
      `insert into clients (workspace_id, name, color)
       values ($1, 'Personal', $2)
       returning id`,
      [workspaceId, normalizePaletteKey("steel", "Personal")]
    );
    const supportsPinnedCategories = await hasTableColumn(client, "categories", "is_pinned");
    const categoryRow = supportsPinnedCategories
      ? await client.query<{ id: string }>(
          `insert into categories (workspace_id, name, color, is_pinned)
           values ($1, 'General', $2, true)
           returning id`,
          [workspaceId, normalizePaletteKey("blue", "General")]
        )
      : await client.query<{ id: string }>(
          `insert into categories (workspace_id, name, color)
           values ($1, 'General', $2)
           returning id`,
          [workspaceId, normalizePaletteKey("blue", "General")]
        );
    await client.query(
      `insert into projects (workspace_id, client_id, category_id, name, color, billable)
       values ($1, $2, $3, 'General', $4, false)`,
      [workspaceId, clientRow.rows[0].id, categoryRow.rows[0].id, normalizePaletteKey("blue", "General")]
    );
    await client.query(
      `insert into event_sources (workspace_id, source, display_name)
       values
         ($1, 'manual_app', 'Manual web app'),
         ($1, 'mobile_app', 'Mobile app'),
         ($1, 'shortcut', 'Shortcut or deep link'),
         ($1, 'geofence_specific', 'Specific geofence'),
         ($1, 'geofence_broad', 'Broad geofence'),
         ($1, 'health_sleep', 'Health sleep import'),
         ($1, 'health_workout', 'Health workout import')
       on conflict (workspace_id, source) do nothing`,
      [workspaceId]
    );

    await client.query("commit");

    if (session.authMode === "local") {
      await switchLocalSessionWorkspace(sessionTokenFromRequest(request), workspaceId);
    }

    return NextResponse.json({ workspace: workspace.rows[0] }, { status: 201 });
  } catch (error) {
    await client.query("rollback");
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  } finally {
    client.release();
  }
}
