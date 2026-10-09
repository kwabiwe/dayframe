import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createEntity: vi.fn(),
  resolveRequestSession: vi.fn()
}));

vi.mock("@/lib/event-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/event-service")>("@/lib/event-service");
  return { CategoryConflictError: actual.CategoryConflictError, UnsupportedEntityError: actual.UnsupportedEntityError, createEntity: mocks.createEntity };
});

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

const { POST } = await import("./route");
const { CategoryConflictError, UnsupportedEntityError } = await import("@/lib/event-service");

describe("POST /api/entities", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue({ workspaceId: "w", userId: "u" });
  });

  it("answers a retired or unknown entity with a structured 400", async () => {
    mocks.createEntity.mockRejectedValue(new UnsupportedEntityError("automation_rule"));
    const response = await POST(new Request("http://localhost/api/entities", {
      method: "POST",
      body: JSON.stringify({ entity: "automation_rule", values: {} })
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "unsupported_entity" });
  });

  it("answers an activity name clash with 409 name_taken", async () => {
    mocks.createEntity.mockRejectedValue(new CategoryConflictError());
    const response = await POST(new Request("http://localhost/api/entities", {
      method: "POST",
      body: JSON.stringify({ entity: "category", values: { name: "Focus" } })
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "name_taken" });
  });
});
