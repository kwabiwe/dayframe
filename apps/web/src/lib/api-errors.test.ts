import { describe, expect, it } from "vitest";
import { authErrorResponse } from "@/lib/api-errors";
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
