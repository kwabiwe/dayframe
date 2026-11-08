import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionAuthError } from "@/lib/session";

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  getCalendarWeek: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/queries", () => ({ getCalendarWeek: mocks.getCalendarWeek }));

const { GET } = await import("./route");

const session = {
  userId: "session-user",
  workspaceId: "session-workspace",
  authMode: "provider",
  scopes: ["app:read"]
};
const data = { user: { id: session.userId }, workspace: { id: session.workspaceId }, weekEntries: [] };
const url = "https://dayframe.test/api/calendar/week";

describe("Calendar List week read", () => {
  beforeEach(() => {
    mocks.resolveRequestSession.mockReset().mockResolvedValue(session);
    mocks.getCalendarWeek.mockReset().mockResolvedValue(data);
  });

  it("uses only the resolved session and viewer zone", async () => {
    const request = new Request(`${url}?date=2028-02-29&workspaceId=other&userId=other`, {
      headers: { cookie: "dayframe_tz=Europe/London" }
    });
    const response = await GET(request);
    expect(mocks.resolveRequestSession).toHaveBeenCalledWith(request, { requiredScopes: ["app:read"] });
    expect(mocks.getCalendarWeek).toHaveBeenCalledWith(session, {
      selectedDate: "2028-02-29",
      timeZone: "Europe/London"
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(data);
  });

  it("rejects missing or impossible dates before querying entries", async () => {
    for (const suffix of ["", "?date=2026-02-29", "?date=2026-2-01"]) {
      expect((await GET(new Request(url + suffix))).status).toBe(400);
    }
    expect(mocks.getCalendarWeek).not.toHaveBeenCalled();
  });

  it("does not query entries without an app session", async () => {
    mocks.resolveRequestSession.mockRejectedValue(sessionAuthError("session_cookie_missing"));
    expect((await GET(new Request(`${url}?date=2026-11-02`))).status).toBe(401);
    expect(mocks.getCalendarWeek).not.toHaveBeenCalled();
  });
});
