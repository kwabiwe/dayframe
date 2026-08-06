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

  it("registers the immediate ActivityKit token with the APNs environment baked into signing", () => {
    const controller = readFileSync(
      `${mobileRoot}ios/Dayframe/DayframeLiveActivityController.swift`,
      "utf8"
    );
    const module = readFileSync(
      `${mobileRoot}ios/Dayframe/DayframeLiveActivityModule.swift`,
      "utf8"
    );
    const infoPlist = readFileSync(`${mobileRoot}ios/Dayframe/Info.plist`, "utf8");
    const project = readFileSync(`${mobileRoot}ios/Dayframe.xcodeproj/project.pbxproj`, "utf8");

    expect(controller).toContain("if let token = activity.pushToken");
    expect(controller).toContain("for await token in activity.pushTokenUpdates");
    expect(infoPlist).toContain("<key>DayframeAPNSEnvironment</key>");
    expect(infoPlist).toContain("<string>$(APS_ENVIRONMENT)</string>");
    expect(module).toContain('object(forInfoDictionaryKey: "DayframeAPNSEnvironment")');
    expect(module).not.toContain("#if DEBUG");
    expect(project).toContain("APS_ENVIRONMENT = development;");
    expect(project).toContain("APS_ENVIRONMENT = production;");
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

  it("keeps the complete Dynamic Island metadata row above the clipping edge", () => {
    const liveActivity = readFileSync(
      `${mobileRoot}ios/DayframeLiveActivity/DayframeTimerLiveActivity.swift`,
      "utf8"
    );

    expect(liveActivity).toContain("dayframeExpandedMetadataLift: CGFloat = 10");
    expect(liveActivity).toMatch(
      /DayframeLiveActivityLabel\(state: context\.state, size: \.expandedIsland\)[\s\S]*?\.offset\(y: -dayframeExpandedMetadataLift\)/
    );
    expect(liveActivity).toContain("@ScaledMetric(relativeTo: .headline)");
    expect(liveActivity).toContain("@ScaledMetric(relativeTo: .subheadline)");
    expect(liveActivity).toContain(".fixedSize(horizontal: false, vertical: true)");
    expect(liveActivity).toContain(".frame(minHeight: categorySize + 2, alignment: .topLeading)");
  });
});
