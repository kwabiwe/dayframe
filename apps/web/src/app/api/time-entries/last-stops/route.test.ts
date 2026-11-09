import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionAuthError } from "@/lib/session";

const mocks = vi.hoisted(() => ({ resolveRequestSession: vi.fn(), query: vi.fn(), phase: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/sync-transaction", async (original) => ({
  ...await original<typeof import("@/lib/sync-transaction")>(),
  withSyncTransaction: mocks.transaction
}));
const { GET } = await import("./route");

const session = { workspaceId: "real-workspace", userId: "real-owner" };
const url = "https://dayframe.test/api/time-entries/last-stops";
const from = "2026-10-24T23:00:00.000Z";
const through = "2026-10-25T23:59:59.999Z";
const exclude = "09e18c37-92f1-4f29-9cc2-edf8bbb65eef";

function request(params: Record<string, string> = {}) {
  return new Request(`${url}?${new URLSearchParams({ from, through, ...params })}`);
}

describe("authenticated Last stop candidates", () => {
  beforeEach(() => {
    mocks.resolveRequestSession.mockReset().mockResolvedValue(session);
    mocks.query.mockReset().mockResolvedValue({ rows: [] });
    mocks.transaction.mockReset().mockImplementation((_name, read) => read({ client: { query: mocks.query }, phase: mocks.phase }));
  });

  it("accepts a 25-hour local day and uses the authenticated owner, stop range and excluded block", async () => {
    const input = request({ userId: "other-owner", workspaceId: "other-workspace", exclude });
    const response = await GET(input);
    expect(mocks.resolveRequestSession).toHaveBeenCalledWith(input, { requiredScopes: ["app:read"] });
    expect(mocks.transaction).toHaveBeenCalledWith("last_stop_candidates", expect.any(Function), {
      readOnly: true, signal: input.signal, deadlineAt: expect.any(Number)
    });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringMatching(/workspace_id = \$1 and user_id = \$2[\s\S]*stopped_at >= \$3::timestamptz and stopped_at <= \$4::timestamptz[\s\S]*order by stopped_at desc, id/),
      [session.workspaceId, session.userId, from, through, exclude, 129]);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ rows: [], truncated: false });
  });

  it("marks a capped result without claiming that older blocks are missing", async () => {
    const rows = Array.from({ length: 129 }, (_, index) => ({ id: `block-${index}`, stoppedAt: through }));
    mocks.query.mockResolvedValue({ rows });
    expect(await (await GET(request())).json()).toEqual({ rows: rows.slice(0, 128), truncated: true });
  });

  it("does no data read on invalid ranges, invalid IDs or a missing session", async () => {
    expect((await GET(request({ from: "not-a-date" }))).status).toBe(400);
    expect((await GET(request({ through: "2026-10-27T02:00:00Z" }))).status).toBe(400);
    expect((await GET(request({ exclude: "local-id" }))).status).toBe(400);
    mocks.resolveRequestSession.mockRejectedValue(sessionAuthError("session_cookie_missing"));
    expect((await GET(request())).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
