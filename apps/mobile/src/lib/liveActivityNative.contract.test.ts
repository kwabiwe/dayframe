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

  it("stops locally before directly submitting the queued idempotent event", () => {
    const shortcuts = readFileSync(`${mobileRoot}ios/Dayframe/DayframeShortcuts.swift`, "utf8");
    const directClient = readFileSync(
      `${mobileRoot}ios/Dayframe/DayframeShortcutDirectEventClient.swift`,
      "utf8"
    );
    const stopCase = shortcuts.slice(shortcuts.indexOf("case .stop:"), shortcuts.indexOf("struct DayframeShortcutEvent"));

    expect(shortcuts.indexOf("DayframeNativeShortcutQueue.append(event)")).toBeLessThan(
      shortcuts.indexOf("DayframeLiveActivityController.stop()")
    );
    expect(stopCase.indexOf("DayframeLiveActivityController.stop()")).toBeLessThan(
      stopCase.indexOf("DayframeShortcutDirectEventClient.submit(event)")
    );
    expect(stopCase).toContain("guard queued else");
    expect(stopCase).toMatch(
      /if await DayframeShortcutDirectEventClient\.submit\(event\) \{\s+_ = DayframeNativeShortcutQueue\.remove\(localIds: \[event\.localId\]\)/
    );
    expect(directClient).toContain('clientEventId = event.localId');
    expect(directClient).toContain('/api/events');
    expect(directClient).toMatch(/statusCode == 200 \|\| httpResponse\.statusCode == 201/);
    expect(directClient).toContain('forHTTPHeaderField: "Authorization"');
  });

  it("limits background delivery to the staging and production Dayframe APIs", () => {
    const shortcuts = readFileSync(`${mobileRoot}ios/Dayframe/DayframeShortcuts.swift`, "utf8");
    const directClient = readFileSync(
      `${mobileRoot}ios/Dayframe/DayframeShortcutDirectEventClient.swift`,
      "utf8"
    );

    expect(shortcuts).toContain("static var openAppWhenRun: Bool = false");
    expect(directClient).toContain('"https://dayframe-staging.vercel.app"');
    expect(directClient).toContain('"https://dayframe-web.vercel.app"');
    expect(directClient).toContain("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly");
    expect(directClient).toContain("URLSessionConfiguration.ephemeral");
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
