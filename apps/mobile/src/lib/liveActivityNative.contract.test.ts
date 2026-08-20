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

  it("binds Live Activity Stop delivery and dismissal to the archived run identity", () => {
    const shortcuts = readFileSync(`${mobileRoot}ios/Dayframe/DayframeShortcuts.swift`, "utf8");
    const directClient = readFileSync(
      `${mobileRoot}ios/Dayframe/DayframeShortcutDirectEventClient.swift`,
      "utf8"
    );
    const stopCase = shortcuts.slice(
      shortcuts.indexOf("case .stopLiveActivity"),
      shortcuts.indexOf("struct DayframeShortcutEvent")
    );
    const ordinaryStop = shortcuts.slice(
      shortcuts.indexOf("case .stopEntry"),
      shortcuts.indexOf("case .stopLiveActivity")
    );

    expect(shortcuts).toContain('@Parameter(title: "Activity ID")');
    expect(shortcuts).toContain('@Parameter(title: "Timer entry ID")');
    expect(shortcuts).toContain('@Parameter(title: "API base")');
    expect(shortcuts).toContain('@Parameter(title: "Stop request ID")');
    expect(shortcuts).toContain(
      "case stopLiveActivity(activityId: String, entryId: String, apiBase: String, clientEventId: String)"
    );
    expect(shortcuts).toContain('"targetActivityId": activityId');
    expect(shortcuts).toContain('"targetEntryId": entryId');
    expect(shortcuts).toContain('"stopScope": "entry"');
    expect(shortcuts).toContain("localId = clientEventId");
    expect(stopCase).toContain("DayframeLiveActivityController.immediatePushToken(");
    expect(stopCase).toContain("DayframeShortcutDirectEventClient.submitLiveActivityStop(");
    expect(stopCase).toMatch(
      /if delivered \{\s+_ = await DayframeLiveActivityController\.stop\(\s+activityId: activityId,\s+entryId: entryId\s+\)/
    );
    expect(stopCase).not.toContain("Task(priority:");
    expect(stopCase).not.toContain("guard queued else");
    expect(shortcuts).not.toContain("DayframeLiveActivityController.stopLegacyActivities()");
    expect(shortcuts).toContain("DayframeLiveActivityController.currentCanonicalEntryId()");
    expect(shortcuts).not.toContain('"stopScope": "current"');
    expect(shortcuts).toContain("DayframeShortcutDeliveryDiagnosticStore.record(.legacyUnscoped)");
    expect(directClient).toContain('clientEventId = event.localId');
    expect(directClient).toContain('/api/events');
    expect(directClient).toContain('/api/live-activities/stop');
    expect(directClient).toMatch(/statusCode == 200 \|\| httpResponse\.statusCode == 201/);
    expect(directClient).toContain('forHTTPHeaderField: "Authorization"');
    expect(directClient).toContain("request.timeoutInterval = 8");
    expect(directClient).toContain("configuration.timeoutIntervalForResource = 10");
    expect(directClient).toContain("DayframeShortcutDeliveryDiagnosticStore.record(.started)");
    expect(directClient).toContain("DayframeShortcutDeliveryDiagnosticStore.record(.delivered)");
    expect(directClient).toContain("DayframeShortcutDeliveryDiagnosticStore.record(.contextUnavailable)");
    expect(directClient).toContain("DayframeShortcutDeliveryDiagnosticStore.record(.transportFailure)");
    const scopedSubmit = directClient.slice(
      directClient.indexOf("static func submitLiveActivityStop("),
      directClient.indexOf("private static func normalizedAPIBase(")
    );
    expect(scopedSubmit).not.toContain('forHTTPHeaderField: "Authorization"');
    expect(scopedSubmit).toContain("pushToken.lowercased()");
    expect(stopCase).toContain("if delivered {");
    expect(ordinaryStop).toMatch(
      /let delivered = await DayframeShortcutDirectEventClient\.submit\(event\)\s+if delivered \{\s+_ = await DayframeLiveActivityController\.stop/
    );
  });

  it("limits background delivery to the staging and production Dayframe APIs", () => {
    const shortcuts = readFileSync(`${mobileRoot}ios/Dayframe/DayframeShortcuts.swift`, "utf8");
    const directClient = readFileSync(
      `${mobileRoot}ios/Dayframe/DayframeShortcutDirectEventClient.swift`,
      "utf8"
    );
    const sharedStorage = readFileSync(
      `${mobileRoot}ios/Dayframe/DayframeSharedStorage.swift`,
      "utf8"
    );

    expect(shortcuts).toContain("static var openAppWhenRun: Bool = false");
    expect(sharedStorage).toContain('"https://dayframe-staging.vercel.app"');
    expect(sharedStorage).toContain('"https://dayframe-web.vercel.app"');
    expect(sharedStorage).toContain("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly");
    expect(directClient).toContain("URLSessionConfiguration.ephemeral");
  });

  it("compiles Stop and its storage into the extension with matching shared capabilities", () => {
    const project = readFileSync(`${mobileRoot}ios/Dayframe.xcodeproj/project.pbxproj`, "utf8");
    const sharedStorage = readFileSync(
      `${mobileRoot}ios/Dayframe/DayframeSharedStorage.swift`,
      "utf8"
    );
    const hostEntitlements = readFileSync(
      `${mobileRoot}ios/Dayframe/Dayframe.entitlements`,
      "utf8"
    );
    const extensionEntitlements = readFileSync(
      `${mobileRoot}ios/DayframeLiveActivity/DayframeLiveActivity.entitlements`,
      "utf8"
    );

    expect(project.match(/DayframeShortcuts\.swift in Sources/g)).toHaveLength(4);
    expect(project.match(/DayframeShortcutDirectEventClient\.swift in Sources/g)).toHaveLength(4);
    expect(project.match(/DayframeSharedStorage\.swift in Sources/g)).toHaveLength(4);
    for (const entitlements of [hostEntitlements, extensionEntitlements]) {
      expect(entitlements).toContain("com.apple.security.application-groups");
      expect(entitlements).toContain("group.com.layereight.dayframe");
      expect(entitlements).toContain("keychain-access-groups");
      expect(entitlements).toContain("$(AppIdentifierPrefix)com.layereight.dayframe.shared");
    }

    expect(sharedStorage).toContain("kSecAttrAccessGroup");
    expect(sharedStorage).toContain("containerURL(");
    expect(sharedStorage).toContain("forSecurityApplicationGroupIdentifier: appGroupIdentifier");
    expect(sharedStorage).toContain("flock(descriptor, LOCK_EX)");
    expect(sharedStorage).toContain("options: .atomic");
    expect(sharedStorage).toContain("completeUntilFirstUserAuthentication");
    expect(sharedStorage).toContain('legacyKey = "dayframe.nativeShortcutQueue.v1"');
    expect(sharedStorage).toContain('filePrefix = "dayframe-shortcut-delivery-v1."');
    expect(sharedStorage).toContain('return "context-unavailable"');
    expect(sharedStorage).toContain('return "http-auth"');
    expect(sharedStorage).toContain('return "transport-failure"');
    expect(sharedStorage).toContain('return "delivered"');
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
    const eas = JSON.parse(readFileSync(`${mobileRoot}eas.json`, "utf8"));

    expect(controller).toContain("if let token = activity.pushToken");
    expect(controller).toContain("for await token in activity.pushTokenUpdates");
    expect(infoPlist).toContain("<key>DayframeAPNSEnvironment</key>");
    expect(infoPlist).toContain("<string>$(APS_ENVIRONMENT)</string>");
    expect(module).toContain('object(forInfoDictionaryKey: "DayframeAPNSEnvironment")');
    expect(module).not.toContain("#if DEBUG");
    expect(project).toContain("APS_ENVIRONMENT = development;");
    expect(project).toContain("APS_ENVIRONMENT = production;");
    expect(eas.build.preview.distribution).toBe("internal");
    expect(eas.build.preview.ios.buildConfiguration).toBe("Release");
    expect(eas.build.production.distribution).toBe("store");
    expect(eas.build.production.ios.buildConfiguration).toBe("Release");
  });

  it("exposes identity-scoped ActivityKit state so stale activities cannot satisfy a newer run", () => {
    const controller = readFileSync(
      `${mobileRoot}ios/Dayframe/DayframeLiveActivityController.swift`,
      "utf8"
    );
    const module = readFileSync(
      `${mobileRoot}ios/Dayframe/DayframeLiveActivityModule.swift`,
      "utf8"
    );
    const bridge = readFileSync(
      `${mobileRoot}ios/Dayframe/DayframeLiveActivityModuleBridge.m`,
      "utf8"
    );
    const attributes = readFileSync(
      `${mobileRoot}ios/Dayframe/DayframeLiveActivityAttributes.swift`,
      "utf8"
    );
    const widget = readFileSync(
      `${mobileRoot}ios/DayframeLiveActivity/DayframeTimerLiveActivity.swift`,
      "utf8"
    );

    expect(attributes).toContain("var entryId: String?");
    expect(attributes).toContain("var apiBase: String?");
    expect(attributes).toContain("var canStop: Bool?");
    expect(widget).toContain("activityId: context.activityID");
    expect(widget).toContain("entryId: context.attributes.entryId");
    expect(widget).toContain("apiBase: context.attributes.apiBase");
    expect(widget).toContain("stopControlId: context.attributes.id");
    expect(widget).toContain('clientEventId: "ios-live-activity-stop-\\(stopControlId)"');
    expect(widget).toContain("context.state.canStop == true");
    expect(widget).toContain("DayframeLiveActivityStopIntent(");
    expect(controller).toContain("static func snapshots() -> [Snapshot]");
    expect(controller).toContain("activity.activityState == .active");
    expect(controller).toContain("activity.content.state.isRunning");
    expect(controller).toContain("$0.attributes.entryId == canonicalEntryId");
    expect(controller).toContain("static func stop(activityId: String, entryId: String) async -> Bool");
    expect(controller).toContain("static func immediatePushToken(activityId: String, entryId: String)");
    expect(controller).toContain("static func enableStop(activityId: String, entryId: String) async -> Bool");
    expect(controller).toContain("static func stop(activityIds: [String]) async -> Bool");
    expect(controller).toContain("static func cleanupActivities(activityIds: [String]) async -> Bool");
    expect(controller).not.toContain("scheduleEndActivities");
    expect(controller).toContain("await existing.update(ActivityContent(state: state, staleDate: nil))");
    expect(controller).not.toContain("static func stop() async -> Bool");
    const nativeStart = controller.slice(
      controller.indexOf("static func start("),
      controller.indexOf("static func pushToken(")
    );
    expect(nativeStart).not.toContain("scheduleEndActivities");
    expect(nativeStart).not.toContain("cleanupActivities");
    expect(module).toContain("DayframeLiveActivityController.snapshots()");
    expect(module).toContain(
      "resolve(await DayframeLiveActivityController.cleanupActivities(activityIds: activityIds))"
    );
    expect(bridge).toContain("RCT_EXTERN_METHOD(activitySnapshot:");
    expect(bridge).toContain("RCT_EXTERN_METHOD(cleanupActivities:");
    expect(bridge).toContain("RCT_EXTERN_METHOD(enableStop:");
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
