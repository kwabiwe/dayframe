import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("native Live Activity presentation contract", () => {
  it("keeps uncategorized shortcut starts consistent with app starts", () => {
    const shortcuts = readFileSync(`${mobileRoot}ios/Dayframe/DayframeShortcuts.swift`, "utf8");

    expect(shortcuts).toContain('event.description ?? category?.name ?? "Uncategorized"');
    expect(shortcuts).not.toContain('event.description ?? "Tracking"');
  });

  it("lifts both lock-screen metadata rows clear of the lower clipping edge", () => {
    const liveActivity = readFileSync(
      `${mobileRoot}ios/DayframeLiveActivity/DayframeTimerLiveActivity.swift`,
      "utf8"
    );

    expect(liveActivity).toMatch(
      /DayframeLiveActivityLabel\(state: state, size: \.lockScreen\)\s+\.offset\(y: -4\)/
    );
  });
});
