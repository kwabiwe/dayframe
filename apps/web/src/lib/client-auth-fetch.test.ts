import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleClientAuthResponse,
  resetClientAuthRedirectStateForTests
} from "./client-auth-fetch";

describe("client authentication response handling", () => {
  beforeEach(() => resetClientAuthRedirectStateForTests());

  it("uses one redirect path for repeated genuine 401 responses", () => {
    const redirect = vi.fn();
    const environment = { pathname: "/timeline", redirect };

    expect(handleClientAuthResponse({ status: 401 }, environment)).toBe(true);
    expect(handleClientAuthResponse({ status: 401 }, environment)).toBe(true);
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("does not convert a transient 500 into logout", () => {
    const redirect = vi.fn();

    expect(handleClientAuthResponse({ status: 500 }, { pathname: "/", redirect })).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("does not create a redirect loop on an authentication screen", () => {
    const redirect = vi.fn();

    expect(handleClientAuthResponse({ status: 401 }, { pathname: "/login", redirect })).toBe(true);
    expect(redirect).not.toHaveBeenCalled();
  });
});
