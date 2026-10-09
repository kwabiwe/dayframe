import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("@/lib/db", () => ({ pool: { connect: mocks.connect } }));

const { openReviewCountFor, withReviewCount } = await import("./review-count");

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

function fakeClient(count: number | Error) {
  const calls: string[] = [];
  const client = {
    calls,
    release: vi.fn(),
    query: vi.fn(async (text: string) => {
      calls.push(text.trim().split(/\s+/).slice(0, 3).join(" "));
      if (text.includes("review_items")) {
        if (count instanceof Error) throw count;
        return { rows: [{ reviewCount: count }] };
      }
      return { rows: [] };
    })
  };
  return client;
}

describe("openReviewCountFor", () => {
  beforeEach(() => {
    mocks.connect.mockReset();
  });

  it("counts the user's open Review items under a statement timeout, then releases the connection", async () => {
    const client = fakeClient(3);
    mocks.connect.mockResolvedValue(client);
    await expect(openReviewCountFor(session)).resolves.toBe(3);
    expect(client.calls).toEqual(["begin read only", "set local statement_timeout", "select count(*)::int as", "commit"]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = 'open'"), [session.workspaceId, session.userId]);
    expect(client.release).toHaveBeenCalledWith(undefined);
  });

  it("gives integration tokens nothing", async () => {
    await expect(openReviewCountFor({ ...session, authMode: "token" })).resolves.toBeUndefined();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("leaves the count out when the read fails and drops that connection", async () => {
    const client = fakeClient(new Error("canceling statement due to statement timeout"));
    mocks.connect.mockResolvedValue(client);
    await expect(openReviewCountFor(session)).resolves.toBeUndefined();
    expect(client.calls).toContain("rollback");
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it("gives up waiting for a busy pool and releases a connection that arrives late", async () => {
    let deliver: (client: unknown) => void = () => undefined;
    mocks.connect.mockReturnValue(new Promise((resolve) => { deliver = resolve; }));
    const startedAt = Date.now();
    await expect(openReviewCountFor(session)).resolves.toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    const late = fakeClient(1);
    deliver(late);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(late.release).toHaveBeenCalledOnce();
    expect(late.query).not.toHaveBeenCalled();
  });

  it("adds the count only when it is known", () => {
    expect(withReviewCount({ ok: true }, 2)).toEqual({ ok: true, reviewCount: 2 });
    expect(withReviewCount({ ok: true }, undefined)).toEqual({ ok: true });
  });
});
