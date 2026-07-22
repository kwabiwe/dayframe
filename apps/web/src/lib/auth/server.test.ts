import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestSession } from "@/lib/session";
import { AuthError } from "@/lib/session";

const mocks = vi.hoisted(() => {
  let requestId = 0;
  return {
    cookies: vi.fn(),
    headers: vi.fn(),
    redirect: vi.fn(),
    resolveLocalSession: vi.fn(),
    nextRequest: () => {
      requestId += 1;
    },
    cache: vi.fn((resolver: (...args: unknown[]) => unknown) => {
      let cachedRequestId = -1;
      let cachedResult: unknown;
      return (...args: unknown[]) => {
        if (cachedRequestId !== requestId) {
          cachedRequestId = requestId;
          cachedResult = resolver(...args);
        }
        return cachedResult;
      };
    })
  };
});

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
  headers: mocks.headers
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("react", () => ({ cache: mocks.cache }));
vi.mock("@/lib/auth/local", () => ({
  APP_SESSION_COOKIE: "dayframe_session",
  resolveLocalSession: mocks.resolveLocalSession
}));

import {
  getOptionalPageSession,
  isAuthenticatedPageSession,
  resolveOptionalPageSessionUncached
} from "./server";

const validSession: RequestSession = {
  userId: "user-1",
  workspaceId: "workspace-1",
  authMode: "local",
  scopes: ["app:read"]
};

describe("optional page session resolution", () => {
  const originalAuthMode = process.env.DAYFRAME_AUTH_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nextRequest();
    process.env.DAYFRAME_AUTH_MODE = "local";
    mocks.cookies.mockResolvedValue(cookieStore("session-token"));
  });

  afterEach(() => restoreEnv("DAYFRAME_AUTH_MODE", originalAuthMode));

  it("shares one cached result across root consumers in the same server request", async () => {
    mocks.resolveLocalSession.mockResolvedValue(validSession);

    await expect(Promise.all([getOptionalPageSession(), getOptionalPageSession()])).resolves.toEqual([
      validSession,
      validSession
    ]);
    expect(mocks.resolveLocalSession).toHaveBeenCalledTimes(1);
  });

  it("cannot select both the authenticated shell and anonymous landing for one result", () => {
    expect({
      shell: isAuthenticatedPageSession(validSession),
      landing: !isAuthenticatedPageSession(validSession)
    }).toEqual({ shell: true, landing: false });
    expect({
      shell: isAuthenticatedPageSession(null),
      landing: !isAuthenticatedPageSession(null)
    }).toEqual({ shell: false, landing: true });
  });

  it("returns a valid local session", async () => {
    mocks.resolveLocalSession.mockResolvedValue(validSession);

    await expect(resolveOptionalPageSessionUncached()).resolves.toEqual(validSession);
    expect(mocks.resolveLocalSession).toHaveBeenCalledWith("session-token", "local");
  });

  it("returns null when the session cookie is missing", async () => {
    mocks.cookies.mockResolvedValue(cookieStore());

    await expect(resolveOptionalPageSessionUncached()).resolves.toBeNull();
    expect(mocks.resolveLocalSession).not.toHaveBeenCalled();
  });

  it.each(["expired", "revoked"])("returns null for an expected %s session error", async () => {
    mocks.resolveLocalSession.mockRejectedValue(new AuthError("Login required.", 401));

    await expect(resolveOptionalPageSessionUncached()).resolves.toBeNull();
  });

  it("propagates unexpected database failures instead of rendering anonymous state", async () => {
    const databaseError = new Error("database unavailable");
    mocks.resolveLocalSession.mockRejectedValue(databaseError);

    await expect(resolveOptionalPageSessionUncached()).rejects.toBe(databaseError);
  });

  it("keeps provider page sessions on the Dayframe app-session path", async () => {
    process.env.DAYFRAME_AUTH_MODE = "provider";
    mocks.resolveLocalSession.mockResolvedValue({ ...validSession, authMode: "provider" });

    await expect(resolveOptionalPageSessionUncached()).resolves.toMatchObject({ authMode: "provider" });
    expect(mocks.resolveLocalSession).toHaveBeenCalledWith("session-token", "provider");
  });

  it("keeps dev mode valid without a database session", async () => {
    process.env.DAYFRAME_AUTH_MODE = "dev";
    mocks.cookies.mockResolvedValue(cookieStore());

    await expect(resolveOptionalPageSessionUncached()).resolves.toMatchObject({ authMode: "dev" });
    expect(mocks.resolveLocalSession).not.toHaveBeenCalled();
  });
});

function cookieStore(token?: string) {
  return {
    get: vi.fn((name: string) =>
      name === "dayframe_session" && token ? { name, value: token } : undefined
    )
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
