import { describe, expect, it } from "vitest";
import { authErrorResponse, databaseReadinessResponse } from "@/lib/api-errors";
import { AuthError, sessionAuthError } from "@/lib/session";

describe("auth error responses", () => {
  it("returns a safe typed session code without database details", async () => {
    const response = authErrorResponse(sessionAuthError("session_expired"));
    const payload = await response?.json();

    expect(response?.status).toBe(401);
    expect(payload).toEqual({
      error: "Your Dayframe session has expired.",
      code: "session_expired"
    });
    expect(JSON.stringify(payload)).not.toMatch(/token|hash|workspace|user|sql/i);
  });

  it("returns missing scope as a typed 403", async () => {
    const response = authErrorResponse(
      new AuthError(
        "Session is missing the required scope.",
        403,
        "insufficient_scope"
      )
    );

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      code: "insufficient_scope"
    });
  });
});


describe("Health provenance database readiness", () => {
  it("returns the exact required migration without leaking the underlying SQL or parameters", async () => {
    const response=databaseReadinessResponse({code:"42703",message:"column ae.resolved_time_entry_id does not exist",query:"PRIVATE SQL",parameters:["PRIVATE OWNER"]});
    expect(response?.status).toBe(503);
    const body=await response!.json();
    expect(body).toMatchObject({code:"database_not_ready",reason:"required_migration_missing",objectName:"activity_events.resolved_time_entry_id"});
    expect(body.migrationHint).toContain("202609040001_health_sleep_resolution_link.sql");
    expect(JSON.stringify(body)).not.toContain("PRIVATE");
  });
  it("does not misclassify an unrelated undefined column or a lock/timeout", () => {
    for (const error of [{code:"42703",message:"column something_else does not exist"},{code:"55P03"},{code:"57014"}]) expect(databaseReadinessResponse(error)).toBeNull();
  });
});
