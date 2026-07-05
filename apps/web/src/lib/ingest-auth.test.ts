import { describe, expect, it } from "vitest";
import { DEV_WORKSPACE_COOKIE } from "@/lib/session";
import { resolveRequestSession } from "./ingest-auth";

describe("resolveRequestSession", () => {
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
});
