import { describe, expect, it, vi } from "vitest";
import {
  confirmedLocationCategoryId,
  confirmedLocationDescription
} from "./location-review-service";
import type { RequestSession } from "../session";

vi.mock("../db", () => ({
  pool: { connect: vi.fn() },
  isLockNotAvailableError: vi.fn(() => false)
}));

const session: RequestSession = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  authMode: "dev",
  scopes: []
};

function categoryClient() {
  return {
    query: vi.fn(async (statement: string) => {
      if (statement.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (statement.includes("from categories")) return { rows: [] };
      if (statement.includes("insert into categories")) {
        return { rows: [{ id: "created-commute" }] };
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    })
  } as unknown as import("pg").PoolClient;
}

describe("location review confirmation semantics", () => {
  it("keeps generated commute titles out of confirmed descriptions", () => {
    expect(confirmedLocationDescription("commute", "Possible journey", undefined)).toBeNull();
    expect(
      confirmedLocationDescription("commute", "Possible journey", { description: "  Train home  " })
    ).toBe("Train home");
    expect(
      confirmedLocationDescription("commute", "Possible journey", { description: "   " })
    ).toBeNull();
  });

  it("keeps current visit-title fallback semantics", () => {
    expect(confirmedLocationDescription("stay", "Visit the library", undefined)).toBe(
      "Visit the library"
    );
    expect(
      confirmedLocationDescription("stay", "Visit the library", { description: "   " })
    ).toBe("Visit the library");
  });

  it("self-heals a legacy null-category commute", async () => {
    await expect(
      confirmedLocationCategoryId(categoryClient(), session, "commute", null, undefined)
    ).resolves.toBe("created-commute");
  });

  it("preserves stored and explicitly edited categories", async () => {
    const client = categoryClient();

    await expect(
      confirmedLocationCategoryId(client, session, "commute", "stored-category", undefined)
    ).resolves.toBe("stored-category");
    await expect(
      confirmedLocationCategoryId(client, session, "commute", null, {
        categoryId: "30000000-0000-4000-8000-000000000001"
      })
    ).resolves.toBe("30000000-0000-4000-8000-000000000001");
    await expect(
      confirmedLocationCategoryId(client, session, "commute", null, { categoryId: null })
    ).resolves.toBeNull();
    expect(vi.mocked(client.query)).not.toHaveBeenCalled();
  });
});
