import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    resetPasswordForEmail: vi.fn(async () => ({ error: null as null | { status?: number; message: string } })),
    setSession: vi.fn(async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } }, error: null as null | { message: string } })),
    updateUser: vi.fn(async () => ({ error: null as null | { status?: number; message: string } })),
    signOut: vi.fn(async () => ({ error: null }))
  },
  query: vi.fn(async () => ({ rows: [] }))
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: mocks.auth }) }));
vi.mock("@/lib/db", () => ({ pool: { query: mocks.query, connect: vi.fn() } }));

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

  it("ends every Dayframe sign-in before and after setting the password from the link's session", async () => {
    const calls: string[] = [];
    mocks.query.mockImplementation(async () => { calls.push("revoke"); return { rows: [] }; });
    mocks.auth.updateUser.mockImplementationOnce(async () => { calls.push("update"); return { error: null }; });
    await completeSupabasePasswordReset({ accessToken: "access", refreshToken: "refresh", password: "a new password" });
    expect(mocks.auth.setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
    expect(mocks.auth.updateUser).toHaveBeenCalledWith({ password: "a new password" });
    expect(calls).toEqual(["revoke", "update", "revoke"]);
    expect(mocks.query).toHaveBeenCalledWith(
      "update auth_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",
      ["00000000-0000-4000-8000-000000000001"]
    );
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("changes nothing when ending the sign-ins fails first, so the link can be used again (Codex r1)", async () => {
    mocks.query.mockRejectedValueOnce(new Error("db down"));
    await expect(completeSupabasePasswordReset({ accessToken: "a", refreshToken: "r", password: "a new password" })).rejects.toThrow();
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuses an expired or used link without changing anything", async () => {
    mocks.auth.setSession.mockResolvedValueOnce({ data: { user: null }, error: { message: "expired" } } as never);
    await expect(completeSupabasePasswordReset({ accessToken: "a", refreshToken: "r", password: "a new password" }))
      .rejects.toMatchObject({ status: 400 });
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
