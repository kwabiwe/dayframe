import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/session";

const authPayload = {
  token: "synthetic-session-token",
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "synthetic@example.invalid",
    name: "Synthetic User"
  },
  workspace: {
    id: "00000000-0000-4000-8000-000000000010",
    name: "Synthetic Workspace"
  },
  expiresAt: "2026-08-22T12:00:00.000Z"
};

const mocks = vi.hoisted(() => ({
  loginLocalAccount: vi.fn(),
  loginSupabaseAccount: vi.fn()
}));

vi.mock("@/lib/auth/local", () => ({
  APP_SESSION_COOKIE: "dayframe_session",
  loginLocalAccount: mocks.loginLocalAccount,
  sessionCookieOptions: () => ({
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 2_592_000
  })
}));

vi.mock("@/lib/auth/supabase", () => ({
  loginSupabaseAccount: mocks.loginSupabaseAccount
}));

const { POST } = await import("./route");

describe("/api/auth/login", () => {
  const originalAuthMode = process.env.DAYFRAME_AUTH_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DAYFRAME_AUTH_MODE = "local";
    mocks.loginLocalAccount.mockResolvedValue(authPayload);
    mocks.loginSupabaseAccount.mockResolvedValue(authPayload);
  });

  afterEach(() => restoreEnv("DAYFRAME_AUTH_MODE", originalAuthMode));

  it("sets the HTTP-only Dayframe cookie after local login", async () => {
    const response = await POST(loginRequest());

    expect(response.status).toBe(200);
    expect(mocks.loginLocalAccount).toHaveBeenCalledTimes(1);
    expect(mocks.loginSupabaseAccount).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(
      "dayframe_session=synthetic-session-token"
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("uses provider authentication while retaining the Dayframe app-session cookie", async () => {
    process.env.DAYFRAME_AUTH_MODE = "provider";

    const response = await POST(loginRequest());

    expect(response.status).toBe(200);
    expect(mocks.loginSupabaseAccount).toHaveBeenCalledTimes(1);
    expect(mocks.loginLocalAccount).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(
      "dayframe_session=synthetic-session-token"
    );
  });

  it("returns bounded credential failures without setting a cookie", async () => {
    mocks.loginLocalAccount.mockRejectedValue(
      new AuthError("Invalid email or password.", 401)
    );

    const response = await POST(loginRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid email or password."
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps unexpected server failures on the 500 path", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.loginLocalAccount.mockRejectedValue(new Error("database unavailable"));

    const response = await POST(loginRequest());

    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toBeNull();
    consoleError.mockRestore();
  });
});

function loginRequest() {
  return new Request("https://dayframe.test/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Synthetic test browser"
    },
    body: JSON.stringify({
      email: "synthetic@example.invalid",
      password: "synthetic-password"
    })
  });
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
