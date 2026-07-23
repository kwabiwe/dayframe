import { beforeEach, describe, expect, it, vi } from "vitest";

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
  revokeLocalSession,
  resolveLocalSession,
  SESSION_LAST_USED_TOUCH_INTERVAL_SECONDS
} from "./local";

describe("local session resolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates a current session without touching its timestamp", async () => {
    mocks.query.mockResolvedValue({
      rows: [currentSessionRow()]
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
            ...currentSessionRow(),
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

  it("distinguishes a missing session cookie without querying the database", async () => {
    await expect(resolveLocalSession(null)).rejects.toMatchObject({
      status: 401,
      code: "session_cookie_missing"
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("distinguishes an invalid session token", async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await expect(resolveLocalSession("invalid-token")).rejects.toMatchObject({
      status: 401,
      code: "session_invalid"
    });
  });

  it("distinguishes an expired session", async () => {
    mocks.query.mockResolvedValue({
      rows: [currentSessionRow({ expiresAt: new Date(Date.now() - 1_000) })]
    });

    await expect(resolveLocalSession("expired-token")).rejects.toMatchObject({
      status: 401,
      code: "session_expired"
    });
  });

  it("distinguishes a revoked session", async () => {
    mocks.query.mockResolvedValue({
      rows: [currentSessionRow({ revokedAt: new Date() })]
    });

    await expect(resolveLocalSession("revoked-token")).rejects.toMatchObject({
      status: 401,
      code: "session_revoked"
    });
  });

  it("propagates database failures instead of converting them into authentication state", async () => {
    const failure = new Error("database unavailable");
    mocks.query.mockRejectedValue(failure);

    await expect(resolveLocalSession("valid-token")).rejects.toBe(failure);
  });

  it("preserves provider mode for a valid app session", async () => {
    mocks.query.mockResolvedValue({
      rows: [currentSessionRow()]
    });

    await expect(resolveLocalSession("valid-token", "provider")).resolves.toMatchObject({
      authMode: "provider"
    });
  });

  it("revokes one current session once and treats repetition as a safe no-op", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: "session-1" }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(revokeLocalSession("valid-token")).resolves.toBe(true);
    await expect(revokeLocalSession("valid-token")).resolves.toBe(false);

    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[0][0]).toContain("revoked_at is null");
    expect(mocks.query.mock.calls[0][0]).toContain("returning id");
  });
});

function currentSessionRow(
  overrides: Partial<{
    expiresAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
  }> = {}
) {
  return {
    userId: "user-1",
    workspaceId: "workspace-1",
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    ...overrides
  };
}
