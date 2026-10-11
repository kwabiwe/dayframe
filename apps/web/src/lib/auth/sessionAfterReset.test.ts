import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ pool: { query: vi.fn(), connect: vi.fn() }, query: vi.fn() }));

const { createSession } = await import("./local");
const { AuthError } = await import("@/lib/session");

/** A client whose answers follow the SQL: `fenced` = a reset at or after the sign-in exists. */
function fakeClient({ fenced = false, userExists = true } = {}) {
  return {
    query: vi.fn(async (sql: string) => {
      if (/from users where id = \$1 for share/.test(sql)) return { rows: [], rowCount: userExists ? 1 : 0 };
      if (/from user_session_fences/.test(sql)) return { rows: [], rowCount: fenced ? 1 : 0 };
      return { rows: [], rowCount: 1 };
    })
  };
}

describe("sessions after a password reset (UIA-317)", () => {
  it("locks the user row, then reads the fence in a later statement, and refuses a sign-in a reset came after", async () => {
    const client = fakeClient({ fenced: true });
    const authenticatedAt = new Date("2026-10-12T09:00:00.000Z");
    await expect(createSession(client as never, "user-1", "workspace-1", "agent", authenticatedAt))
      .rejects.toBeInstanceOf(AuthError);
    const calls = client.query.mock.calls as unknown as Array<[string, unknown[]]>;
    expect(calls[0][0]).toMatch(/for share/);
    expect(calls[1][0]).toMatch(/sessions_valid_after >= \$2::timestamptz/);
    expect(calls[1][1][1]).toBe(authenticatedAt);
    expect(calls.some(([sql]) => /insert into auth_sessions/.test(sql))).toBe(false);
  });

  it("refuses when the user row is missing", async () => {
    await expect(createSession(fakeClient({ userExists: false }) as never, "user-1", "workspace-1", null, new Date()))
      .rejects.toBeInstanceOf(AuthError);
  });

  it("creates the session when no reset came after the sign-in", async () => {
    const client = fakeClient();
    const session = await createSession(client as never, "user-1", "workspace-1", null, new Date());
    expect(session.token).toEqual(expect.any(String));
    expect((client.query.mock.calls as unknown as Array<[string]>).at(-1)?.[0]).toMatch(/insert into auth_sessions/);
  });
});
