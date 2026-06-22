import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { hashPassword, verifyPassword } from "@/lib/auth/local";
import { query } from "@/lib/db";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function PATCH(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = (await request.json()) as {
      name?: string;
      workspaceName?: string;
      currentPassword?: string;
      newPassword?: string;
    };
    const name = body.name?.trim();
    const workspaceName = body.workspaceName?.trim();
    const currentPassword = body.currentPassword ?? "";
    const newPassword = body.newPassword ?? "";

    if (newPassword) {
      if (newPassword.length < 8) {
        return NextResponse.json(
          { error: "New password must be at least 8 characters." },
          { status: 400 }
        );
      }
      if (!currentPassword) {
        return NextResponse.json(
          { error: "Enter your current password to change password." },
          { status: 400 }
        );
      }
      const user = await query<{ passwordHash: string | null }>(
        `select password_hash as "passwordHash" from users where id = $1`,
        [session.userId]
      );
      const passwordHash = user.rows[0]?.passwordHash;
      if (!passwordHash || !(await verifyPassword(currentPassword, passwordHash))) {
        return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
      }
      await query("update users set password_hash = $1 where id = $2", [
        await hashPassword(newPassword),
        session.userId
      ]);
    }

    if (name) {
      await query("update users set name = $1 where id = $2", [name.slice(0, 120), session.userId]);
    }

    if (workspaceName) {
      await query("update workspaces set name = $1 where id = $2", [
        workspaceName.slice(0, 120),
        session.workspaceId
      ]);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
