import { NextResponse } from "next/server";
import { sessionTokenFromRequest, switchLocalSessionWorkspace } from "@/lib/auth/local";
import { authErrorResponse } from "@/lib/api-errors";
import { query } from "@/lib/db";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { devWorkspaceCookieOptions, DEV_WORKSPACE_COOKIE } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = (await request.json()) as { workspaceId?: string };
    const workspaceId = body.workspaceId?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace is required." }, { status: 400 });
    }

    if (session.authMode === "dev") {
      const allowed = await query<{ id: string }>(
        `select w.id
         from workspaces w
         join workspace_members wm on wm.workspace_id = w.id
         where w.id = $1 and wm.user_id = $2
         limit 1`,
        [workspaceId, session.userId]
      );
      if (!allowed.rows[0]) {
        return NextResponse.json({ error: "Workspace is not available for this account." }, { status: 403 });
      }

      const response = NextResponse.json({ ok: true, workspaceId });
      response.cookies.set(DEV_WORKSPACE_COOKIE, workspaceId, devWorkspaceCookieOptions());
      return response;
    }

    if (session.authMode === "local" || session.authMode === "provider") {
      await switchLocalSessionWorkspace(sessionTokenFromRequest(request), workspaceId);
      return NextResponse.json({ ok: true, workspaceId });
    }

    if (workspaceId === session.workspaceId) {
      return NextResponse.json({ ok: true, workspaceId });
    }

    return NextResponse.json(
      { error: "Workspace switching is not available for this session." },
      { status: 400 }
    );
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
