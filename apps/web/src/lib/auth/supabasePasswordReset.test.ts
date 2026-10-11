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

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: mocks.auth }) }));
// endDayframeSignIns runs one transaction on a pooled client; record its statements in order.
const client = {
  query: vi.fn(async (sql: string) => {
    if (/update users set sessions_valid_after/.test(sql)) mocks.steps.push("valid-after");
    if (/update auth_sessions set revoked_at/.test(sql)) mocks.steps.push("revoke");
    return { rows: [], rowCount: 1 };
  }),
  release: vi.fn()
};
vi.mock("@/lib/db", () => ({ pool: { query: mocks.query, connect: vi.fn(async () => client) } }));

const { completeSupabasePasswordReset, requestSupabasePasswordReset } = await import("./supabase");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic");
});

afterEach(() => {
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
    expect(mocks.steps).toEqual(["valid-after", "revoke", "password", "valid-after", "revoke"]);
    expect(client.query).toHaveBeenCalledWith("begin");
    expect(client.query).toHaveBeenCalledWith("commit");
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("changes nothing when ending the sign-ins fails first, so the link can be used again (Codex r1)", async () => {
    client.query.mockRejectedValueOnce(new Error("db down"));
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
});
