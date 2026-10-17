import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { hashPassword, verifyPassword } from "@/lib/auth/local";
import { changeSupabasePassword } from "@/lib/auth/supabase";
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
      /** "Log trips automatically" (PRD D19, A4). */
      logTripsAutomatically?: boolean;
      currentPassword?: string;
      newPassword?: string;
      /** A change made for one account (Settings › Your day) never lands on another signed in since. */
      expectedUserId?: string;
    };
    if (body.expectedUserId !== undefined && body.expectedUserId !== session.userId) {
      return NextResponse.json({ error: "You're signed in to a different account now. Reload Settings." }, { status: 409 });
    }
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

    if (body.logTripsAutomatically !== undefined && typeof body.logTripsAutomatically !== "boolean") {
      return NextResponse.json({ error: "Choose whether to log trips automatically." }, { status: 400 });
    }

    if (newPassword) {
      if (session.authMode !== "local" && session.authMode !== "provider") {
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
      const user = await query<{ email: string; passwordHash: string | null }>(
        `select email, password_hash as "passwordHash" from users where id = $1`,
        [session.userId]
      );
      if (session.authMode === "provider") {
        const email = user.rows[0]?.email;
        if (!email) return NextResponse.json({ error: "Unable to find this account." }, { status: 404 });
        await changeSupabasePassword(email, currentPassword, newPassword);
      } else {
        const passwordHash = user.rows[0]?.passwordHash;
        if (!passwordHash || !(await verifyPassword(currentPassword, passwordHash))) {
          return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
        }
        await query("update users set password_hash = $1 where id = $2", [
          await hashPassword(newPassword),
          session.userId
        ]);
      }
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

    let goals: { dailyGoalMinutes: number; weeklyGoalMinutes: number; goalsRevision: number } | undefined;
    if (dailyGoalMinutes !== undefined || weeklyGoalMinutes !== undefined) {
      // The server orders goal changes: each one bumps goals_revision in the same row update, and
      // the reply carries the goals as stored with that revision (UIA-309).
      const updated = await query<{ dailyGoalMinutes: number; weeklyGoalMinutes: number; goalsRevision: string | number }>(
        `update users
         set daily_goal_minutes = coalesce($1, daily_goal_minutes),
             weekly_goal_minutes = coalesce($2, weekly_goal_minutes),
             goals_revision = goals_revision + 1
         where id = $3
         returning daily_goal_minutes as "dailyGoalMinutes",
                   weekly_goal_minutes as "weeklyGoalMinutes",
                   goals_revision as "goalsRevision"`,
        [dailyGoalMinutes ?? null, weeklyGoalMinutes ?? null, session.userId]
      );
      const row = updated.rows[0];
      if (row) goals = { ...row, goalsRevision: Number(row.goalsRevision) };
    }

    let logTripsAutomatically: boolean | undefined;
    if (body.logTripsAutomatically !== undefined) {
      const updated = await query<{ value: boolean }>(
        `update users set log_trips_automatically = $1 where id = $2 returning log_trips_automatically as value`,
        [body.logTripsAutomatically, session.userId]
      );
      logTripsAutomatically = updated.rows[0]?.value;
    }

    return NextResponse.json({ ok: true, ...(goals ? { goals } : {}), ...(logTripsAutomatically !== undefined ? { logTripsAutomatically } : {}) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
