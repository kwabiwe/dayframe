import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./ActiveTimerEditSheet.tsx", import.meta.url),
  "utf8"
);
const theme = readFileSync(
  new URL("../lib/mobileTheme.ts", import.meta.url),
  "utf8"
);

describe("running timer suggestion metadata", () => {
  it("renders every suggested tag and includes it in the accessible action name", () => {
    expect(source).toContain("suggestion.tagNames.map((tag) => `#${tag}`)");
    expect(source).toContain("style={styles.taskSuggestionTags}");
    expect(source).toContain("tagLabel ? `with ${tagLabel}` : null");
  });

  it("keeps the running Done action above and clear of the Stop control", () => {
    expect(theme).toMatch(/sheetHeaderRunning:[\s\S]*minHeight: 36/);
    expect(theme).toMatch(/sheetHeaderRunning:[\s\S]*marginBottom: 4/);
  });
});
