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
      dailyGoalMinutes?: number;
      weeklyGoalMinutes?: number;
      currentPassword?: string;
      newPassword?: string;
    };
    const name = body.name?.trim();
    const workspaceName = body.workspaceName?.trim();
    const currentPassword = body.currentPassword ?? "";
    const newPassword = body.newPassword ?? "";
    const dailyGoalMinutes = body.dailyGoalMinutes;
    const weeklyGoalMinutes = body.weeklyGoalMinutes;

    if (body.name !== undefined && !name) {
      return NextResponse.json({ error: "Enter your name." }, { status: 400 });
    }

    if (body.workspaceName !== undefined && !workspaceName) {
      return NextResponse.json({ error: "Enter a workspace name." }, { status: 400 });
    }

    if (
      (dailyGoalMinutes !== undefined && (!Number.isInteger(dailyGoalMinutes) || dailyGoalMinutes < 1 || dailyGoalMinutes > 1440)) ||
      (weeklyGoalMinutes !== undefined && (!Number.isInteger(weeklyGoalMinutes) || weeklyGoalMinutes < 1 || weeklyGoalMinutes > 10080))
    ) {
      return NextResponse.json({ error: "Enter valid daily and weekly goals." }, { status: 400 });
    }

    if (newPassword) {
      if (session.authMode !== "local") {
        return NextResponse.json(
          { error: "Password changes are available only for local sign-in." },
          { status: 400 }
        );
      }
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

    if (dailyGoalMinutes !== undefined || weeklyGoalMinutes !== undefined) {
      await query(
        `update users
         set daily_goal_minutes = coalesce($1, daily_goal_minutes),
             weekly_goal_minutes = coalesce($2, weekly_goal_minutes)
         where id = $3`,
        [dailyGoalMinutes ?? null, weeklyGoalMinutes ?? null, session.userId]
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
