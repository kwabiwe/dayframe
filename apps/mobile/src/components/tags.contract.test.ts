import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sheet = readFileSync(fileURLToPath(new URL("./ActiveTimerEditSheet.tsx", import.meta.url)), "utf8");
const dashboard = readFileSync(fileURLToPath(new URL("./DayframeDashboard.tsx", import.meta.url)), "utf8");

describe("mobile tag interaction contract", () => {
  it("keeps the autocomplete owned by the description field with bounded interruptible motion", () => {
    expect(sheet).toContain("findActiveHashtag");
    expect(sheet).toContain("duration: 140");
    expect(sheet).toContain("outputRange: reduceMotion ? [0, 0] : [-4, 0]");
    expect(sheet).toContain("useNativeDriver: true");
    expect(sheet).toContain("keyboardShouldPersistTaps=\"always\"");
  });

  it("distinguishes existing and create actions for VoiceOver and never persists from selection alone", () => {
    expect(sheet).toContain("Existing\"} tag,");
    expect(sheet).toContain("Create new tag,");
    expect(sheet).not.toContain("createTag(");
    expect(sheet).toContain("tagNames: appliedTagNames");
  });

  it("uses a compact shortcut and consumes selected hashtag commands into separate tag state", () => {
    expect(sheet).toContain("accessibilityLabel=\"Add a tag\"");
    expect(sheet).toContain("insertHashtagStarter");
    expect(sheet).toContain("consumeActiveHashtag");
    expect(sheet).toContain("setSelectedTagNames");
    expect(sheet).not.toContain("descriptionWithTagTokens");
    expect(sheet).not.toContain("Type # to add a tag");
  });

  it("rolls a failed optimistic save back to the exact pre-edit dashboard snapshot", () => {
    expect(dashboard).toContain("const previousData = latestData.current");
    expect(dashboard).toContain("latestData.current = previousData");
    expect(dashboard).toContain("setData(previousData)");
    expect(dashboard).not.toContain("ActivityIndicator");
  });
});
