import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    resetPasswordForEmail: vi.fn(async () => ({ error: null as null | { status?: number; message: string } })),
    setSession: vi.fn(async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } }, error: null as null | { message: string } })),
    updateUser: vi.fn(async () => ({ error: null as null | { status?: number; message: string } })),
    signOut: vi.fn(async () => ({ error: null }))
  },
  query: vi.fn(async () => ({ rows: [] })),
  steps: [] as string[]
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: mocks.auth }),
  isAuthRetryableFetchError: (error: unknown) => (error as { name?: string } | null)?.name === "AuthRetryableFetchError"
}));
// Provisioning and endSignInsAfterPasswordChange run transactions on a pooled client; record the
// statements that matter, in order. `userRows` is what the user row's lock finds.
let userRows = 1;
async function answer(sql: string) {
  {
    if (/insert into users/.test(sql)) {
      mocks.steps.push("provision");
      return { rows: [{ id: "00000000-0000-4000-8000-000000000001", email: "a@example.invalid", name: "A", passwordHash: null }], rowCount: 1 };
    }
    if (/from workspaces/.test(sql)) return { rows: [{ id: "w-1", name: "My Dayframe" }], rowCount: 1 };
    if (/select id from users where id = \$1 for update/.test(sql)) return { rows: [], rowCount: userRows };
    if (/insert into user_session_fences/.test(sql)) mocks.steps.push("fence");
    if (/update auth_sessions set revoked_at/.test(sql)) mocks.steps.push("revoke");
    if (/where email = \$1 and id <> \$2/.test(sql)) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  }
}
const client = { query: vi.fn(answer), release: vi.fn() };
vi.mock("@/lib/db", () => ({ pool: { query: mocks.query, connect: vi.fn(async () => client) } }));

const { completeSupabasePasswordReset, requestSupabasePasswordReset } = await import("./supabase");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic");
});

afterEach(() => {
  userRows = 1;
  client.query.mockImplementation(answer);
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Supabase password reset (UIA-317)", () => {
  it("asks Supabase for the reset email with a normalised address and the reset page", async () => {
    await requestSupabasePasswordReset("Someone@Example.invalid", "https://dayframe.test/reset-password");
    expect(mocks.auth.resetPasswordForEmail).toHaveBeenCalledWith("someone@example.invalid", { redirectTo: "https://dayframe.test/reset-password" });
  });

  it("turns a Supabase failure into a neutral message, keeping its rate limit", async () => {
    mocks.auth.resetPasswordForEmail.mockResolvedValueOnce({ error: { status: 429, message: "rate limited" } });
    await expect(requestSupabasePasswordReset("a@example.invalid", "https://dayframe.test/reset-password")).rejects.toMatchObject({ status: 429 });
    mocks.auth.resetPasswordForEmail.mockResolvedValueOnce({ error: { status: 500, message: "smtp" } });
    await expect(requestSupabasePasswordReset("a@example.invalid", "https://dayframe.test/reset-password"))
      .rejects.toMatchObject({ status: 502, message: "Dayframe couldn't send the reset email. Try again later." });
  });

  it("ends every Dayframe sign-in, sets the password, ends them again and signs the recovery session out", async () => {
    mocks.steps.length = 0;
    mocks.auth.updateUser.mockImplementationOnce(async () => { mocks.steps.push("password"); return { error: null }; });
    await completeSupabasePasswordReset({ accessToken: "access", refreshToken: "refresh", password: "a new password" });
    expect(mocks.auth.setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
    expect(mocks.steps).toEqual(["provision", "fence", "revoke", "password", "fence", "revoke"]);
    expect(client.query).toHaveBeenCalledWith("begin");
    expect(client.query).toHaveBeenCalledWith("commit");
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("changes nothing when ending the sign-ins fails first, so the link can be used again (Codex r1)", async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (/user_session_fences/.test(sql)) throw new Error("db down");
      return { rows: [{ id: "00000000-0000-4000-8000-000000000001", name: "My Dayframe" }], rowCount: 1 };
    });
    await expect(completeSupabasePasswordReset({ accessToken: "a", refreshToken: "r", password: "a new password" })).rejects.toThrow();
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });

  it("a retry after a later step failed carries on when the password is already the new one (Codex r2)", async () => {
    mocks.auth.updateUser.mockResolvedValueOnce({ error: { status: 422, message: "same", code: "same_password" } as never });
    await completeSupabasePasswordReset({ accessToken: "a", refreshToken: "r", password: "a new password" });
    expect(mocks.auth.signOut).toHaveBeenCalled();
  });

  it("reports a failed recovery sign-out so the page can try again (Codex r2)", async () => {
    mocks.auth.signOut.mockResolvedValueOnce({ error: { message: "network" } } as never);
    await expect(completeSupabasePasswordReset({ accessToken: "a", refreshToken: "r", password: "a new password" }))
      .rejects.toMatchObject({ status: 502 });
  });

  it("refuses an expired or used link without changing anything", async () => {
    mocks.auth.setSession.mockResolvedValueOnce({ data: { user: null }, error: { message: "expired" } } as never);
    await expect(completeSupabasePasswordReset({ accessToken: "a", refreshToken: "r", password: "a new password" }))
      .rejects.toMatchObject({ status: 400 });
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  it("fails closed before the password changes when the account has no Dayframe row to fence (Codex r3)", async () => {
    userRows = 0;
    await expect(completeSupabasePasswordReset({ accessToken: "a", refreshToken: "r", password: "a new password" }))
      .rejects.toMatchObject({ status: 503 });
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });

  it("keeps the link usable when the sign-in service is briefly down (Codex r3)", async () => {
    const retryable = Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError", status: 0 });
    mocks.auth.setSession.mockResolvedValueOnce({ data: { user: null }, error: retryable } as never);
    await expect(completeSupabasePasswordReset({ accessToken: "a", refreshToken: "r", password: "a new password" }))
      .rejects.toMatchObject({ status: 503 });
    mocks.auth.setSession.mockResolvedValueOnce({ data: { user: null }, error: { message: "unavailable", status: 503 } } as never);
    await expect(completeSupabasePasswordReset({ accessToken: "a", refreshToken: "r", password: "a new password" }))
      .rejects.toMatchObject({ status: 503 });
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });
});
