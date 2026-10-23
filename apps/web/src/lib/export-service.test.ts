import { beforeEach, describe, expect, it, vi } from "vitest";
import { placeDisplayNameSql } from "./place-display";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ query: mocks.query }));

import { buildJsonExport, buildTimeEntriesCsv, buildWorkspaceExport } from "./export-service";

const session = {
  authMode: "provider" as const,
  userId: "user-1",
  workspaceId: "workspace-1",
  scopes: []
};

describe("time-entry exports", () => {
  beforeEach(() => mocks.query.mockReset());

  it("exports one-time labels through the public place columns", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await buildTimeEntriesCsv(session);
    const sql = String(mocks.query.mock.calls[0]?.[0]);
    expect(sql).toContain(`coalesce(${placeDisplayNameSql("pl")}, te.place_label) as place`);
    expect(sql).toContain("when te.place_label is not null then 'one_time'");
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([session.workspaceId, session.userId]);
  });

  it("adds a resolved place name and kind to JSON exports", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await buildJsonExport("time_entries_json", session);
    const sql = String(mocks.query.mock.calls[0]?.[0]);
    expect(sql).toContain(`coalesce(${placeDisplayNameSql("pl")}, te.place_label) as place_name`);
    expect(sql).toContain("end as place_kind");
    expect(sql).toContain("te.workspace_id = $1 and te.user_id = $2");
  });

  it("includes which blocks a person edited and the end they set, scoped to the session", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const exported = await buildWorkspaceExport(session);
    expect(exported.timeEntryEdits).toEqual([]);
    const call = mocks.query.mock.calls.find(([sql]) => String(sql).includes("from audit_log"));
    const sql = String(call?.[0]);
    expect(sql).toContain("select entity_id as time_entry_id, action, metadata->>'stoppedAt' as stopped_at, created_at");
    expect(sql).toContain("action in ('time_entry.end_set', 'time_entry.edited')");
    expect(call?.[1]).toEqual([session.workspaceId, session.userId]);
  });
});
