import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));

const { openReviewCountFor, withReviewCount } = await import("./review-count");

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

describe("openReviewCountFor", () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it("counts the user's open Review items in their workspace", async () => {
    mocks.query.mockResolvedValue({ rows: [{ reviewCount: 3 }] });
    await expect(openReviewCountFor(session)).resolves.toBe(3);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("status = 'open'"), [session.workspaceId, session.userId]);
  });

  it("gives integration tokens nothing", async () => {
    await expect(openReviewCountFor({ ...session, authMode: "token" })).resolves.toBeUndefined();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("leaves the count out when the read fails", async () => {
    mocks.query.mockRejectedValue(new Error("boom"));
    await expect(openReviewCountFor(session)).resolves.toBeUndefined();
  });

  it("leaves the count out rather than waiting on a slow read", async () => {
    mocks.query.mockReturnValue(new Promise(() => undefined));
    const startedAt = Date.now();
    await expect(openReviewCountFor(session)).resolves.toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("adds the count only when it is known", () => {
    expect(withReviewCount({ ok: true }, 2)).toEqual({ ok: true, reviewCount: 2 });
    expect(withReviewCount({ ok: true }, undefined)).toEqual({ ok: true });
  });
});
