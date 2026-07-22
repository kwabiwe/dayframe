import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/session";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  hasTableColumn: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query,
  hasTableColumn: mocks.hasTableColumn,
  pool: { connect: vi.fn() }
}));

import {
  resolveLocalSession,
  SESSION_LAST_USED_TOUCH_INTERVAL_SECONDS
} from "./local";

describe("local session resolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates a current session without touching its timestamp", async () => {
    mocks.query.mockResolvedValue({
      rows: [{ userId: "user-1", workspaceId: "workspace-1", lastUsedAt: new Date() }]
    });

    await expect(resolveLocalSession("valid-token")).resolves.toMatchObject({
      userId: "user-1",
      workspaceId: "workspace-1",
      authMode: "local"
    });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0][0]).toContain("from auth_sessions");
  });

  it("touches last_used_at at most once inside the ten-minute interval", async () => {
    let selectCount = 0;
    mocks.query.mockImplementation(async (statement: string) => {
      if (statement.includes("select user_id")) {
        selectCount += 1;
        return {
          rows: [{
            userId: "user-1",
            workspaceId: "workspace-1",
            lastUsedAt:
              selectCount === 1
                ? new Date(Date.now() - (SESSION_LAST_USED_TOUCH_INTERVAL_SECONDS + 60) * 1000)
                : new Date()
          }]
        };
      }
      if (statement.includes("update auth_sessions")) return { rows: [] };
      throw new Error(`Unexpected query: ${statement}`);
    });

    await resolveLocalSession("valid-token");
    await resolveLocalSession("valid-token");

    const updateCalls = mocks.query.mock.calls.filter(([statement]) =>
      String(statement).includes("update auth_sessions")
    );
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][0]).toContain("last_used_at < now() - ($2 * interval '1 second')");
    expect(updateCalls[0][1][1]).toBe(600);
  });

  it.each(["expired", "revoked"])("rejects an %s or unavailable session", async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await expect(resolveLocalSession("invalid-token")).rejects.toBeInstanceOf(AuthError);
  });

  it("preserves provider mode for a valid app session", async () => {
    mocks.query.mockResolvedValue({
      rows: [{ userId: "user-1", workspaceId: "workspace-1", lastUsedAt: new Date() }]
    });

    await expect(resolveLocalSession("valid-token", "provider")).resolves.toMatchObject({
      authMode: "provider"
    });
  });
});
