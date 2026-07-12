import { afterEach, describe, expect, it } from "vitest";
import { DEV_WORKSPACE_COOKIE } from "@/lib/session";
import { resolveRequestSession } from "./ingest-auth";

describe("resolveRequestSession", () => {
  const originalAuthMode = process.env.DAYFRAME_AUTH_MODE;
  const originalIngestToken = process.env.DAYFRAME_INGEST_TOKEN;

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
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
