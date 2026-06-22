import { NextResponse } from "next/server";
import { sessionTokenFromRequest, switchLocalSessionWorkspace } from "@/lib/auth/local";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = (await request.json()) as { workspaceId?: string };
    const workspaceId = body.workspaceId?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace is required." }, { status: 400 });
    }

    if (session.authMode === "local") {
      await switchLocalSessionWorkspace(sessionTokenFromRequest(request), workspaceId);
      return NextResponse.json({ ok: true });
    }

    if (workspaceId === session.workspaceId) {
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: "Workspace switching requires local auth in this environment." },
      { status: 400 }
    );
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
