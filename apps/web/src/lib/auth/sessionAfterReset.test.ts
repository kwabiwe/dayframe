import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ pool: { query: vi.fn(), connect: vi.fn() }, query: vi.fn() }));

const { createSession } = await import("./local");
const { AuthError } = await import("@/lib/session");

describe("sessions after a password reset (UIA-317)", () => {
  it("locks the user row and refuses a sign-in authenticated before the last reset", async () => {
    const client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    const authenticatedAt = new Date("2026-10-12T09:00:00.000Z");
    await expect(createSession(client as never, "user-1", "workspace-1", "agent", authenticatedAt))
      .rejects.toBeInstanceOf(AuthError);
    const [sql, params] = client.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/for share/);
    expect(sql).toMatch(/sessions_valid_after < \$6::timestamptz/);
    expect(params[5]).toBe(authenticatedAt);
  });

  it("creates the session when no reset came after the sign-in", async () => {
    const client = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) };
    const session = await createSession(client as never, "user-1", "workspace-1", null, new Date());
    expect(session.token).toEqual(expect.any(String));
  });
});
