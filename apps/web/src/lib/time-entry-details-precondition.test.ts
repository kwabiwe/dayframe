import { describe, expect, it } from "vitest";
import { detailsChangedSince, ExpectedDetailsSchema, ExpectedUpdatedAtSchema, versionChangedSince } from "./time-entry-details-precondition";

const stored = { categoryId: "coding", description: "app testing", tagNormalizedNames: [] as string[] };

describe("details precondition (409 safety net)", () => {
  it("refuses a description edit based on a description changed since", () => {
    // The production report: a second tab's edit based on "BAU" after the first saved "app testing".
    expect(detailsChangedSince(stored, { description: "BAU" })).toBe(true);
  });

  it("accepts an edit whose base still matches, as the server stores it", () => {
    expect(detailsChangedSince(stored, { description: "app testing  " })).toBe(false);
    expect(detailsChangedSince({ ...stored, description: null }, { description: "" })).toBe(false);
    expect(detailsChangedSince(stored, { categoryId: "coding" })).toBe(false);
    expect(detailsChangedSince({ ...stored, categoryId: null }, { categoryId: "" })).toBe(false);
  });

  it("compares tags by normalized name in any order", () => {
    const tagged = { ...stored, tagNormalizedNames: ["cubic", "vpn"] };
    expect(detailsChangedSince(tagged, { tagNames: ["VPN", "Cubic"] })).toBe(false);
    expect(detailsChangedSince(tagged, { tagNames: ["Cubic"] })).toBe(true);
    expect(detailsChangedSince(stored, { tagNames: ["Cubic"] })).toBe(true);
  });

  it("checks only the fields the edit sends", () => {
    // Another tab changed the activity; this edit changes only the description and was based on
    // the current description, so it is accepted and leaves the activity alone.
    expect(detailsChangedSince({ ...stored, categoryId: "work" }, { description: "app testing" })).toBe(false);
    expect(detailsChangedSince(stored, {})).toBe(false);
  });

  it("accepts only the three detail fields", () => {
    expect(ExpectedDetailsSchema.safeParse({ description: "BAU", categoryId: null, tagNames: ["x"] }).success).toBe(true);
    expect(ExpectedDetailsSchema.safeParse({ startedAt: "2026-10-13T07:00:00.000Z" }).success).toBe(false);
  });
});

describe("version precondition (Codex r3 on #539)", () => {
  it("refuses a version written since, at millisecond precision", () => {
    expect(versionChangedSince(new Date("2026-07-31T15:00:00.123Z"), "2026-07-31T15:00:00.123Z")).toBe(false);
    expect(versionChangedSince("2026-07-31T15:00:00.123Z", "2026-07-31T16:00:00.123+01:00")).toBe(false);
    expect(versionChangedSince(new Date("2026-07-31T15:00:00.124Z"), "2026-07-31T15:00:00.123Z")).toBe(true);
  });

  it("accepts only an ISO date-time with an offset", () => {
    expect(ExpectedUpdatedAtSchema.safeParse("2026-07-31T15:00:00.123Z").success).toBe(true);
    expect(ExpectedUpdatedAtSchema.safeParse("yesterday").success).toBe(false);
  });
});
