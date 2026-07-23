import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleClientAuthResponse,
  resetClientAuthRedirectStateForTests
} from "./client-auth-fetch";

describe("client authentication response handling", () => {
  beforeEach(() => resetClientAuthRedirectStateForTests());

  it("uses one redirect path for repeated structured session 401 responses", async () => {
    const redirect = vi.fn();
    const environment = { pathname: "/timeline", redirect };

    await expect(handleClientAuthResponse(authResponse(401, "session_expired"), environment)).resolves.toBe(true);
    await expect(handleClientAuthResponse(authResponse(401, "session_revoked"), environment)).resolves.toBe(true);
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("does not redirect for an unstructured 401", async () => {
    const redirect = vi.fn();

    await expect(
      handleClientAuthResponse(authResponse(401), { pathname: "/", redirect })
    ).resolves.toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([403, 500])("does not convert a %s into logout", async (status) => {
    const redirect = vi.fn();

    await expect(
      handleClientAuthResponse(authResponse(status, status === 403 ? "insufficient_scope" : undefined), {
        pathname: "/",
        redirect
      })
    ).resolves.toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("does not create a redirect loop on an authentication screen", async () => {
    const redirect = vi.fn();

    await expect(
      handleClientAuthResponse(authResponse(401, "session_invalid"), {
        pathname: "/login",
        redirect
      })
    ).resolves.toBe(true);
    expect(redirect).not.toHaveBeenCalled();
  });
});

function authResponse(status: number, code?: string) {
  return new Response(JSON.stringify(code ? { code } : {}), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
