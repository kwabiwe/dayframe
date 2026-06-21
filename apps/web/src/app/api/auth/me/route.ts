import { NextResponse } from "next/server";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { AuthError } from "@/lib/session";
import { query } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const result = await query<{
      userId: string;
      email: string;
      name: string;
      workspaceId: string;
      workspaceName: string;
    }>(
      `select u.id as "userId",
              u.email,
              u.name,
              w.id as "workspaceId",
              w.name as "workspaceName"
       from users u
       join workspaces w on w.id = $2
       where u.id = $1`,
      [session.userId, session.workspaceId]
    );
    const row = result.rows[0];
    return NextResponse.json({
      user: { id: row.userId, email: row.email, name: row.name },
      workspace: { id: row.workspaceId, name: row.workspaceName },
      authMode: session.authMode
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
