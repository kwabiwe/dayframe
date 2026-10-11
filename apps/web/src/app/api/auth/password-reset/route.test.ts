import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/session";

const mocks = vi.hoisted(() => ({
  request: vi.fn(async () => undefined),
  complete: vi.fn(async () => undefined)
}));

vi.mock("@/lib/auth/supabase", () => ({
  requestSupabasePasswordReset: mocks.request,
  completeSupabasePasswordReset: mocks.complete
}));

const { POST: requestReset } = await import("./route");
const { POST: completeReset } = await import("./complete/route");

const post = (url: string, body: unknown) => new Request(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.request.mockReset();
  mocks.complete.mockReset();
});

describe("Forgot password (UIA-317)", () => {
  it("is only offered with hosted sign-in", async () => {
    vi.stubEnv("DAYFRAME_AUTH_MODE", "local");
    expect((await requestReset(post("https://dayframe.test/api/auth/password-reset", { email: "a@example.invalid" }))).status).toBe(404);
    expect((await completeReset(post("https://dayframe.test/api/auth/password-reset/complete", {}))).status).toBe(404);
    vi.stubEnv("DAYFRAME_AUTH_MODE", "dev");
    expect((await requestReset(post("https://dayframe.test/api/auth/password-reset", { email: "a@example.invalid" }))).status).toBe(404);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("asks Supabase to email a link back to this deployment's reset page, and answers the same for any address", async () => {
    vi.stubEnv("DAYFRAME_AUTH_MODE", "provider");
    const response = await requestReset(post("https://dayframe-staging.vercel.app/api/auth/password-reset", { email: " someone@example.invalid " }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, message: "If an account uses that email, a reset link is on its way. Check your email." });
    expect(mocks.request).toHaveBeenCalledWith("someone@example.invalid", "https://dayframe-staging.vercel.app/reset-password");
  });

  it("rejects a malformed email and passes Supabase's rate limit on", async () => {
    vi.stubEnv("DAYFRAME_AUTH_MODE", "provider");
    expect((await requestReset(post("https://dayframe.test/api/auth/password-reset", { email: "nope" }))).status).toBe(400);
    mocks.request.mockRejectedValueOnce(new AuthError("Too many reset emails. Wait a minute, then try again.", 429));
    const limited = await requestReset(post("https://dayframe.test/api/auth/password-reset", { email: "a@example.invalid" }));
    expect(limited.status).toBe(429);
  });

  it("sets the new password from the link's session; short passwords and expired links are refused", async () => {
    vi.stubEnv("DAYFRAME_AUTH_MODE", "provider");
    const url = "https://dayframe.test/api/auth/password-reset/complete";
    expect((await completeReset(post(url, { accessToken: "a", refreshToken: "r", password: "short" }))).status).toBe(400);
    expect(mocks.complete).not.toHaveBeenCalled();
    const ok = await completeReset(post(url, { accessToken: "a", refreshToken: "r", password: "long enough" }));
    expect(ok.status).toBe(200);
    expect(mocks.complete).toHaveBeenCalledWith({ accessToken: "a", refreshToken: "r", password: "long enough" });
    mocks.complete.mockRejectedValueOnce(new AuthError("This reset link has expired or was already used. Ask for a new one.", 400));
    const expired = await completeReset(post(url, { accessToken: "a", refreshToken: "r", password: "long enough" }));
    expect(expired.status).toBe(400);
    expect((await expired.json()).error).toMatch(/expired/);
  });
});
