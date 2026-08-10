import { describe, expect, it } from "vitest";
import type { MobileBootstrap } from "./api";
import { mergePersistedMobileTag } from "./mobileTags";

describe("mobile tag catalogue", () => {
  it("adds a persisted tag without waiting for a time-entry save", () => {
    const data = bootstrap();
    const next = mergePersistedMobileTag(data, {
      id: "tag-planning",
      name: "Planning",
      normalizedName: "planning"
    });

    expect(next?.tags).toEqual([
      { id: "tag-focus", name: "Focus", normalizedName: "focus" },
      { id: "tag-planning", name: "Planning", normalizedName: "planning" }
    ]);
    expect(next?.entries).toBe(data.entries);
  });

  it("converges a duplicate normalized tag on the server row", () => {
    const next = mergePersistedMobileTag(bootstrap(), {
      id: "tag-focus-server",
      name: "Focus",
      normalizedName: "focus",
      usageCount: 4
    });

    expect(next?.tags).toEqual([{
      id: "tag-focus-server",
      name: "Focus",
      normalizedName: "focus",
      usageCount: 4
    }]);
  });
});

function bootstrap(): MobileBootstrap {
  return {
    user: { id: "user", email: "user@example.test", name: "User" },
    workspace: { id: "workspace", name: "Workspace" },
    activeEntry: null,
    projects: [],
    categories: [],
    tags: [{ id: "tag-focus", name: "Focus", normalizedName: "focus" }],
    entries: [],
    places: [],
    reviewItems: []
  };
}
