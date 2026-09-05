import { NextResponse } from "next/server";
import { AuthError } from "@/lib/session";

/** Match only the known additive prerequisite; never expose arbitrary SQL/error payloads. */
export function databaseReadinessResponse(error: unknown) {
  const failure = error as {
    code?: string;
    message?: string;
    columnName?: string;
    tableName?: string;
  } | null;
  const missing = (
    failure?.code === "42703" && /\bresolved_time_entry_id\b/.test(failure.message ?? "")
  ) || (
    failure?.tableName === "activity_events" && failure.columnName === "resolved_time_entry_id"
  );
  if (!missing) return null;
  return NextResponse.json({
    ok: false,
    code: "database_not_ready",
    reason: "required_migration_missing",
    error: "The Dayframe server needs its Health resolution-link database migration before sync can continue.",
    objectName: "activity_events.resolved_time_entry_id",
    migrationHint: "supabase/migrations/202609040001_health_sleep_resolution_link.sql (hosted); packages/db/migrations/006_health_sleep_resolution_link.sql (local)"
  }, { status: 503 });
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      {
        error: error.message,
        ...(error.code ? { code: error.code } : {})
      },
      { status: error.status }
    );
  }

  return null;
}
