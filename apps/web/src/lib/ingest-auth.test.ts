import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEV_WORKSPACE_COOKIE } from "@/lib/session";

const mocks = vi.hoisted(() => ({
  query: vi.fn()
}));

vi.mock("./db", () => ({ query: mocks.query }));

const {
  INTEGRATION_TOKEN_LAST_USED_TOUCH_INTERVAL_SECONDS,
  resolveRequestSession
} = await import("./ingest-auth");

describe("resolveRequestSession", () => {
  const originalAuthMode = process.env.DAYFRAME_AUTH_MODE;
  const originalIngestToken = process.env.DAYFRAME_INGEST_TOKEN;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    restoreEnv("DAYFRAME_AUTH_MODE", originalAuthMode);
    restoreEnv("DAYFRAME_INGEST_TOKEN", originalIngestToken);
  });

  it("uses the dev workspace cookie when resolving dev API sessions", async () => {
    const workspaceId = "00000000-0000-4000-8000-000000000011";
    const session = await resolveRequestSession(
      new Request("https://dayframe.test/api/bootstrap", {
        headers: { cookie: `${DEV_WORKSPACE_COOKIE}=${workspaceId}` }
      })
    );

    expect(session.authMode).toBe("dev");
    expect(session.workspaceId).toBe(workspaceId);
  });

  it("accepts bearer integration tokens when a route opts in", async () => {
    process.env.DAYFRAME_AUTH_MODE = "local";
    process.env.DAYFRAME_INGEST_TOKEN = "integration-token";

    const session = await resolveRequestSession(
      new Request("https://dayframe.test/api/integrations/v1/time/current", {
        headers: { Authorization: "Bearer integration-token" }
      }),
      {
        allowIngestToken: true,
        allowBearerIntegrationToken: true,
        requiredScopes: ["time:read"]
      }
    );

    expect(session.authMode).toBe("token");
    expect(session.scopes).toContain("time:read");
  });

  it("accepts the ingest header with time:read and rate-limits last-used writes", async () => {
    process.env.DAYFRAME_AUTH_MODE = "provider";
    delete process.env.DAYFRAME_INGEST_TOKEN;
    mocks.query.mockResolvedValueOnce({
      rows: [{
        id: "token-1",
        userId: "00000000-0000-4000-8000-000000000001",
        workspaceId: "00000000-0000-4000-8000-000000000010",
        scopes: ["time:read"]
      }]
    });

    const session = await resolveRequestSession(
      new Request("https://dayframe.test/api/timer-state", {
        headers: { "x-dayframe-ingest-token": "desk-token" }
      }),
      { allowIngestToken: true, requiredScopes: ["time:read"] }
    );

    expect(session).toMatchObject({
      authMode: "token",
      scopes: ["time:read"]
    });
    expect(mocks.query).toHaveBeenCalledOnce();
    const [statement, values] = mocks.query.mock.calls[0];
    expect(statement).toContain("integration_token.last_used_at is null");
    expect(statement).toContain("integration_token.last_used_at < now() - ($2 * interval '1 second')");
    expect(values).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/),
      INTEGRATION_TOKEN_LAST_USED_TOUCH_INTERVAL_SECONDS
    ]);
  });

  it("rejects an integration token that lacks time:read", async () => {
    process.env.DAYFRAME_AUTH_MODE = "provider";
    delete process.env.DAYFRAME_INGEST_TOKEN;
    mocks.query.mockResolvedValueOnce({
      rows: [{
        id: "token-1",
        userId: "00000000-0000-4000-8000-000000000001",
        workspaceId: "00000000-0000-4000-8000-000000000010",
        scopes: ["events:write"]
      }]
    });

    await expect(resolveRequestSession(
      new Request("https://dayframe.test/api/timer-state", {
        headers: { "x-dayframe-ingest-token": "write-only-token" }
      }),
      { allowIngestToken: true, requiredScopes: ["time:read"] }
    )).rejects.toMatchObject({ status: 403, code: "insufficient_scope" });
  });

  it("returns a typed 403 when a valid session lacks a required scope", async () => {
    await expect(
      resolveRequestSession(new Request("https://dayframe.test/api/export"), {
        requiredScopes: ["scope:not-present"]
      })
    ).rejects.toMatchObject({
      status: 403,
      code: "insufficient_scope"
    });
  });

  it("returns a typed missing-session reason without exposing identifiers", async () => {
    process.env.DAYFRAME_AUTH_MODE = "local";
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(
      resolveRequestSession(new Request("https://dayframe.test/api/bootstrap"))
    ).rejects.toMatchObject({
      status: 401,
      code: "session_cookie_missing"
    });
    expect(log).toHaveBeenCalledWith(
      "Dayframe auth session",
      expect.objectContaining({
        reason: "session_cookie_missing",
        pathname: "/api/bootstrap",
        method: "GET",
        cookiePresent: false
      })
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /userId|workspaceId|email|tokenHash|cookie:/
    );
    log.mockRestore();
  });

  it.each(["local", "provider"] as const)(
    "sanitizes coordinate-bearing diagnostic paths in %s auth mode",
    async (authMode) => {
      process.env.DAYFRAME_AUTH_MODE = authMode;
      const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

      await expect(
        resolveRequestSession(
          new Request("https://dayframe.test/api/map-tiles/20/742111/506821"),
          { diagnosticPathname: "/api/map-tiles/[z]/[x]/[y]" }
        )
      ).rejects.toMatchObject({
        status: 401,
        code: "session_cookie_missing"
      });
      expect(log).toHaveBeenCalledWith(
        "Dayframe auth session",
        expect.objectContaining({
          reason: "session_cookie_missing",
          pathname: "/api/map-tiles/[z]/[x]/[y]"
        })
      );
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/742111|506821/);
      log.mockRestore();
    }
  );
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
