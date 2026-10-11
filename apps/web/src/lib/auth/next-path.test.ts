import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it("keeps a same-site path and its query", () => {
    expect(safeNextPath("/settings")).toBe("/settings");
    expect(safeNextPath(["/reports?range=week", "/x"])).toBe("/reports?range=week");
  });

  it("refuses other origins and tricks", () => {
    for (const value of [
      "https://evil.example/", "//evil.example", "/\\evil.example", "settings", "", null, undefined,
      `/${"a".repeat(600)}`, "javascript:alert(1)",
      // Dot segments that normalise into a protocol-relative URL.
      "/.//evil.example", "/a/..//evil.example", "/%2e//evil.example", "/./%2e//evil.example"
    ]) {
      expect(safeNextPath(value)).toBeNull();
    }
  });
});
