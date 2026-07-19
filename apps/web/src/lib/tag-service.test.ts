import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pool: { connect: vi.fn() },
  query: vi.fn()
}));

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return { ...actual, pool: mocks.pool, query: mocks.query };
});

const {
  attachTagToTimeEntry,
  createTag,
  deleteTag,
  detachTagFromTimeEntry,
  listTags,
  renameTag
} = await import("./tag-service");

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

describe("workspace tag persistence", () => {
  beforeEach(() => vi.resetAllMocks());

  it("lists autocomplete results and usage only inside the request workspace", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{
      id: tagId(), name: "Planning", normalizedName: "planning", usageCount: 2
    }] });

    await expect(listTags(session, "Pl")).resolves.toHaveLength(1);

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("where tag.workspace_id = $1"),
      [session.workspaceId, "pl"]
    );
    expect(mocks.query.mock.calls[0][0]).toContain("tet.workspace_id = tag.workspace_id");
  });

  it("converges concurrent case-insensitive creates on the normalized unique row", async () => {
    const persisted = { id: tagId(), name: "Planning", normalizedName: "planning" };
    mocks.query.mockResolvedValue({ rows: [persisted] });

    const [first, second] = await Promise.all([
      createTag({ name: "Planning" }, session),
      createTag({ name: "planning" }, session)
    ]);

    expect(first).toEqual(persisted);
    expect(second).toEqual(persisted);
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[0][0]).toContain("on conflict (workspace_id, normalized_name)");
    expect(mocks.query.mock.calls[1][1]).toEqual([
      session.workspaceId,
      "planning",
      "planning",
      session.userId
    ]);
  });

  it("renames an in-use tag and rewrites its inline canonical token in one transaction", async () => {
    const client = transactionClient((statement) => {
      if (statement.includes("select normalized_name")) return { rows: [{ normalizedName: "deep-work" }] };
      if (statement.includes("update tags")) {
        return { rows: [{ id: tagId(), name: "Focused work", normalizedName: "focused-work" }] };
      }
      return { rows: [] };
    });
    mocks.pool.connect.mockResolvedValueOnce(client);

    await expect(renameTag(tagId(), { name: "Focused work" }, session)).resolves.toMatchObject({
      normalizedName: "focused-work"
    });

    const descriptionUpdate = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("regexp_replace")
    );
    expect(descriptionUpdate?.[0]).toContain("tet.workspace_id = $1");
    expect(descriptionUpdate?.[1]).toEqual([
      session.workspaceId,
      tagId(),
      "(^|[^A-Za-z0-9_@/.:?=&%#+-])#deep-work([^A-Za-z0-9_-]|$)",
      "\\1#focused-work\\2"
    ]);
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("deletes only the scoped tag, leaving time entries to the join cascade", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: tagId() }] });
    await expect(deleteTag(tagId(), session)).resolves.toEqual({ id: tagId(), deleted: true });
    expect(mocks.query).toHaveBeenCalledWith(
      "delete from tags where id = $1 and workspace_id = $2 returning id",
      [tagId(), session.workspaceId]
    );
  });

  it("attaches idempotently and detaches through workspace-and-user scoped entry joins", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ tagId: tagId() }] })
      .mockResolvedValueOnce({ rows: [] });

    await attachTagToTimeEntry(entryId(), tagId(), session);
    await detachTagFromTimeEntry(entryId(), tagId(), session);

    expect(mocks.query.mock.calls[0][0]).toContain("entry.workspace_id = $1");
    expect(mocks.query.mock.calls[0][0]).toContain("entry.user_id = $2");
    expect(mocks.query.mock.calls[0][0]).toContain("on conflict (time_entry_id, tag_id) do nothing");
    expect(mocks.query.mock.calls[1][0]).toContain("tet.workspace_id = $1");
    expect(mocks.query.mock.calls[1][1]).toEqual([
      session.workspaceId, entryId(), tagId(), session.userId
    ]);
  });
});

function transactionClient(
  response: (statement: string, values?: unknown[]) => { rows: unknown[] }
) {
  return {
    query: vi.fn(async (statement: string, values?: unknown[]) => response(statement, values)),
    release: vi.fn()
  };
}

function tagId() {
  return "50000000-0000-4000-8000-000000000001";
}

function entryId() {
  return "80000000-0000-4000-8000-000000000001";
}
