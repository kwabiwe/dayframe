import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./InlineTagInput.tsx", import.meta.url)),
  "utf8"
);

describe("web tag editor interaction contract", () => {
  it("opens an icon-triggered search/select/create picker with mobile-safe semantics", () => {
    expect(source).toContain('aria-label="Add or filter tags"');
    expect(source).toContain('placeholder="Add/filter tags"');
    expect(source).toContain("pickerMatches.map");
    expect(source).toContain("pickerCreateName");
    expect(source).toContain("aria-pressed={selected}");
  });

  it("keeps manual hashtag entry but consumes the command into separate selected-tag state", () => {
    expect(source).toContain("findActiveHashtag");
    expect(source).toContain("consumeActiveHashtag");
    expect(source).toContain("onSelectedTagNamesChange");
    expect(source).not.toContain("replaceActiveHashtag");
    expect(source).not.toContain("tagNamesFromDescription");
    expect(source).not.toContain("Type # to add a tag");
  });
});
