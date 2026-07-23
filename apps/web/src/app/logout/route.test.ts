import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revokeLocalSession: vi.fn(),
  sessionTokenFromRequest: vi.fn()
}));

vi.mock("@/lib/auth/local", () => ({
  APP_SESSION_COOKIE: "dayframe_session",
  expiredSessionCookieOptions: () => ({
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 0
  }),
  revokeLocalSession: mocks.revokeLocalSession,
  sessionTokenFromRequest: mocks.sessionTokenFromRequest
}));

const { GET, POST } = await import("./route");

describe("/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionTokenFromRequest.mockReturnValue("synthetic-session");
    mocks.revokeLocalSession.mockResolvedValue(true);
  });

  it("keeps GET side-effect free", async () => {
    const response = await GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.sessionTokenFromRequest).not.toHaveBeenCalled();
    expect(mocks.revokeLocalSession).not.toHaveBeenCalled();
  });

  it("revokes and clears the current browser session only after one explicit POST", async () => {
    const request = new Request("https://dayframe.test/logout", {
      method: "POST",
      headers: { cookie: "dayframe_session=synthetic-session" }
    });
    const response = await POST(request);

    expect(mocks.sessionTokenFromRequest).toHaveBeenCalledTimes(1);
    expect(mocks.sessionTokenFromRequest).toHaveBeenCalledWith(request);
    expect(mocks.revokeLocalSession).toHaveBeenCalledTimes(1);
    expect(mocks.revokeLocalSession).toHaveBeenCalledWith("synthetic-session");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?signedOut=1");
    expect(response.headers.get("set-cookie")).toContain("dayframe_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("keeps repeated POST safe when the session is already revoked", async () => {
    mocks.revokeLocalSession
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const request = () =>
      new Request("https://dayframe.test/logout", {
        method: "POST",
        headers: { cookie: "dayframe_session=synthetic-session" }
      });

    await expect(POST(request())).resolves.toMatchObject({ status: 303 });
    await expect(POST(request())).resolves.toMatchObject({ status: 303 });
    expect(mocks.revokeLocalSession).toHaveBeenCalledTimes(2);
  });
});
