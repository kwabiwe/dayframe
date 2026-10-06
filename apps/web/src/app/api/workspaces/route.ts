import { NextResponse } from "next/server";
import { seedDefaultWorkspaceData, sessionTokenFromRequest, switchLocalSessionWorkspace } from "@/lib/auth/local";
import { authErrorResponse } from "@/lib/api-errors";
import { pool } from "@/lib/db";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { devWorkspaceCookieOptions, DEV_WORKSPACE_COOKIE } from "@/lib/session";

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

    await seedDefaultWorkspaceData(client, workspaceId);

    await client.query("commit");

    if (session.authMode === "local" || session.authMode === "provider") {
      await switchLocalSessionWorkspace(sessionTokenFromRequest(request), workspaceId);
    }

    const response = NextResponse.json({ workspace: workspace.rows[0] }, { status: 201 });
    if (session.authMode === "dev") {
      response.cookies.set(DEV_WORKSPACE_COOKIE, workspaceId, devWorkspaceCookieOptions());
    }
    return response;
  } catch (error) {
    await client.query("rollback");
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  } finally {
    client.release();
  }
}
