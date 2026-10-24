import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DAYFRAME_BLOCKS, DAYFRAME_THEME } from "@dayframe/shared";

const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("native Live Activity presentation contract", () => {
  it("keeps uncategorized shortcut starts consistent with app starts", () => {
    const shortcuts = readFileSync(`${mobileRoot}ios/Dayframe/DayframeShortcuts.swift`, "utf8");

    expect(shortcuts).toContain('event.description ?? category?.name ?? "No activity"');
    expect(shortcuts).not.toContain('event.description ?? "Tracking"');
  });

  it("refuses to create ownerless native Shortcut events while signed out", () => {
    const shortcuts = readFileSync(`${mobileRoot}ios/Dayframe/DayframeShortcuts.swift`, "utf8");
    const ownerGuard = shortcuts.indexOf(
      "guard catalog.user != nil, catalog.workspace != nil else"
    );

    expect(ownerGuard).toBeGreaterThan(-1);
    expect(ownerGuard).toBeLessThan(shortcuts.indexOf("DayframeNativeShortcutQueue.append(event)"));
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
      shortcuts.indexOf("case .stopRunning:\n      guard queued"),
      shortcuts.indexOf("case .stopLiveActivity(let activityId, let entryId, let apiBase, _)")
    );

    expect(shortcuts).toContain('@Parameter(title: "Activity ID")');
    expect(shortcuts).toContain('@Parameter(title: "Block ID")');
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
    // Optimistic once durable (owner decision 24 Oct 2026, option A): the token is read while the Activity
    // still runs, the Activity shows stopped (an update, which cannot end this process) only when the Stop
    // is queued, the Stop is delivered, and the Activity ends after delivery, delivered or queued.
    const order = [
      "let pushToken = DayframeLiveActivityController.immediatePushToken(",
      "if queued {\n        await DayframeLiveActivityController.showStopped(activityId: activityId, entryId: entryId)",
      "delivered = await DayframeShortcutDirectEventClient.submitLiveActivityStop(",
      "if delivered || queued {\n        _ = await DayframeLiveActivityController.stop("
    ].map((line) => stopCase.indexOf(line));
    expect(order.every((index) => index >= 0), String(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(stopCase).not.toMatch(/end\(|\.stop\([^)]*\)[\s\S]*submitLiveActivityStop\(/);
    const controller = readFileSync(`${mobileRoot}ios/Dayframe/DayframeLiveActivityController.swift`, "utf8");
    const showStopped = controller.slice(controller.indexOf("static func showStopped("), controller.indexOf("static func cleanupActivities("));
    expect(showStopped).toContain("$0.id == activityId && $0.attributes.entryId == entryId && $0.activityState == .active");
    expect(showStopped).toContain("await activity.update(ActivityContent(state: stoppedState(activity), staleDate: Date()))");
    expect(showStopped).not.toContain(".end(");
    expect(stopCase).not.toContain("Task(priority:");
    expect(stopCase).not.toContain("guard queued else");
    expect(shortcuts).not.toContain("DayframeLiveActivityController.stopLegacyActivities()");
    expect(shortcuts).not.toContain('"stopScope": "current"');
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
    expect(stopCase).toContain("if delivered, queued {");
    // Deliver first (ending an Activity can end the intent process), then end the Activities of blocks
    // started before the Stop, read after delivery, whether or not delivery worked (Codex r6 on #403).
    expect(ordinaryStop).toMatch(
      /if await DayframeShortcutDirectEventClient\.submit\(event\) \{\s+_ = DayframeNativeShortcutQueue\.remove\(localIds: \[event\.localId\]\)\s+\}[\s\S]*?guard DayframeShortcutCatalogStore\.catalog\.ownedBy\(event\) else \{\s+return\s+\}\s+let activityIds = DayframeLiveActivityController\.activityIds\(startedBefore: event\.occurredAt\)\s+_ = await DayframeLiveActivityController\.stop\(activityIds: activityIds\)/
    );
  });

  it("Stop tracking stops what was running when it ran, with no Live Activity or lookup (#403)", () => {
    const shortcuts = readFileSync(`${mobileRoot}ios/Dayframe/DayframeShortcuts.swift`, "utf8");
    const directClient = readFileSync(`${mobileRoot}ios/Dayframe/DayframeShortcutDirectEventClient.swift`, "utf8");
    const storage = readFileSync(`${mobileRoot}ios/Dayframe/DayframeSharedStorage.swift`, "utf8");
    const bridge = readFileSync(`${mobileRoot}ios/Dayframe/DayframeLiveActivityModuleBridge.m`, "utf8");
    const intent = shortcuts.slice(shortcuts.indexOf("struct StopTrackingIntent"), shortcuts.indexOf("struct DayframeLiveActivityStopIntent"));
    expect(intent).toContain("await DayframeShortcutPerformer.perform(.stopRunning)");
    expect(intent).not.toContain("currentCanonicalEntryId");
    expect(shortcuts).toMatch(/case \.stopRunning:\s+actionName = "stop"\s+nextType = "timer_stop"\s+payload = \[\s+"origin": "ios_app_shortcut",\s+"stopScope": "running_at"\s+\]/);
    // Direct delivery only with the app's session for the event's own account.
    const submit = directClient.slice(directClient.indexOf("private static func deliver(_ event: DayframeShortcutEvent)"), directClient.indexOf("static func submitLiveActivityStop("));
    expect(submit).toMatch(/context\.userId == userId,\s+context\.workspaceId == workspaceId\s+else \{\s+DayframeShortcutDeliveryDiagnosticStore\.record\(\.ownerUnverified\)\s+return nil/);
    expect(directClient).toContain("runsNow: payload.startOutcome == nil");
    // A Stop records its moment before delivery and before reading Activities; a Start whose Activity
    // appeared later ends it (Codex r7 on #403).
    const ordinaryStop = shortcuts.slice(
      shortcuts.indexOf("case .stopRunning:\n      guard queued"),
      shortcuts.indexOf("case .stopLiveActivity(let activityId, let entryId, let apiBase, _)")
    );
    expect(ordinaryStop.indexOf("DayframeShortcutStopMoments.record(")).toBeGreaterThan(-1);
    expect(ordinaryStop.indexOf("DayframeShortcutStopMoments.record(")).toBeLessThan(ordinaryStop.indexOf("DayframeShortcutDirectEventClient.submit(event)"));
    expect(shortcuts).toMatch(/guard DayframeShortcutCatalogStore\.catalog\.ownedBy\(event\), !stoppedAfter\(event\) else \{\s+await endThisActivity\(\)\s+return\s+\}/);
    expect(shortcuts).toMatch(/let endThisActivity = \{\s+_ = await DayframeLiveActivityController\.stop\(activityIds: \[activity\.activityId\]\)\s+\}/);
    expect(storage).toContain("enum DayframeShortcutStopMoments");
    expect(directClient).not.toContain("/api/timer-state");
    expect(storage).not.toContain("DayframeShortcutStopBarriers");
    expect(storage).toContain("var userId: String? = nil");
    expect(storage).toContain('return "owner-unverified"');
    expect(bridge).not.toContain("shortcutStopBarriers");
    expect(bridge).toContain("RCT_EXTERN_METHOD(setRuntimeContextWithOwner:(NSString *)apiBase");
  });

  it("a Shortcut Start delivers first, then starts its Live Activity for that block and registers its push token", () => {
    const shortcuts = readFileSync(`${mobileRoot}ios/Dayframe/DayframeShortcuts.swift`, "utf8");
    const directClient = readFileSync(`${mobileRoot}ios/Dayframe/DayframeShortcutDirectEventClient.swift`, "utf8");
    const start = shortcuts.slice(shortcuts.indexOf("case .start(_, let categoryName, _):"), shortcuts.indexOf("case .stopRunning:\n      guard queued"));
    const order = [
      "let delivery = await DayframeShortcutDirectEventClient.submitStart(event)",
      "_ = DayframeNativeShortcutQueue.remove(localIds: [event.localId])",
      // Ownership is checked before the Activity starts, and again (with a later Shortcut Stop's cleanup)
      // once it exists, before it is registered; a block ended elsewhere or an account change during
      // registration ends it (Codex r1 on #413).
      "guard delivery?.runsNow != false, DayframeShortcutCatalogStore.catalog.ownedBy(event) else {",
      "DayframeLiveActivityController.start(",
      "entryId: delivery?.timeEntryId,",
      "guard DayframeShortcutCatalogStore.catalog.ownedBy(event), !stoppedAfter(event) else {",
      "DayframeShortcutDirectEventClient.registerLiveActivity(",
      "if registration == .blockEnded || !DayframeShortcutCatalogStore.catalog.ownedBy(event) {"
    ].map((needle) => start.indexOf(needle));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
    expect(start).toContain("apiBase: delivery?.timeEntryId == nil ? nil : delivery?.context.apiBase,");
    expect(start).toMatch(/guard let activity = await DayframeLiveActivityController\.start\(/);
    expect(start).toMatch(/guard let delivery, let entryId = delivery\.timeEntryId else \{\s+return\s+\}/);
    // Event times are whole milliseconds, as serialized, so native moment comparisons match the server's.
    expect(shortcuts).toContain("let now = moment.date(from: moment.string(from: Date())) ?? Date()");
    expect(shortcuts).toContain("let moment = ISO8601DateFormatter()");
    const register = directClient.slice(directClient.indexOf("static func registerLiveActivity("), directClient.indexOf("static func isCanonicalEntryId("));
    expect(register).toContain("/api/live-activities");
    expect(register).toContain('forHTTPHeaderField: "Authorization"');
    expect(register).toContain("activeEntryId: entryId");
    expect(register).toContain("DayframeLiveActivityController.pushEnvironment()");
    expect(register).toMatch(/case 201:\s+break/);
    expect(register).toMatch(/case 409:\s+return \.blockEnded/);
    expect(register).toContain("return await DayframeLiveActivityController.enableStop(activityId: activityId, entryId: entryId)\n      ? .registered\n      : .failed");
    expect(directClient).toContain("runsNow: payload.startOutcome == nil");
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
      expect(entitlements).toContain("$(DAYFRAME_APP_GROUP)");
      expect(entitlements).toContain("keychain-access-groups");
      expect(entitlements).toContain("$(AppIdentifierPrefix)$(DAYFRAME_KEYCHAIN_GROUP)");
    }
    expect(project).toContain("DAYFRAME_APP_GROUP = group.com.layereight.dayframe.staging;");
    expect(project).toContain("DAYFRAME_KEYCHAIN_GROUP = com.layereight.dayframe.staging.shared;");

    expect(sharedStorage).toContain("kSecAttrAccessGroup");
    const storageConfiguration = readFileSync(
      `${mobileRoot}ios/Dayframe/DayframeSharedStorageConfiguration.swift`, "utf8"
    );
    expect(project.match(/DayframeSharedStorageConfiguration\.swift in Sources/g)).toHaveLength(4);
    expect(storageConfiguration).toContain("forSecurityApplicationGroupIdentifier: appGroupIdentifier");
    expect(storageConfiguration).toContain('forInfoDictionaryKey: "DayframeSharedAppGroupIdentifier"');
    expect(storageConfiguration).toContain("guard let appGroupIdentifier else { return nil }");
    for (const path of ["Dayframe/Info.plist", "DayframeLiveActivity/Info.plist"]) {
      expect(readFileSync(`${mobileRoot}ios/${path}`, "utf8")).toMatch(
        /<key>DayframeSharedAppGroupIdentifier<\/key>\s*<string>\$\(DAYFRAME_APP_GROUP\)<\/string>/
      );
    }
    // The cross-process queue lock lives in DayframeSharedFileLock (sharedContainerLock.contract.test.ts).
    expect(project.match(/DayframeSharedFileLock\.swift in Sources/g)).toHaveLength(4);
    expect(sharedStorage).toContain("DayframeSharedFileLock.withExclusiveLock(at: lockURL");
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
    expect(controller).toContain('object(forInfoDictionaryKey: "DayframeAPNSEnvironment")');
    expect(module).toContain("DayframeLiveActivityController.pushEnvironment()");
    expect(module).not.toContain("#if DEBUG");
    expect(project).toContain("APS_ENVIRONMENT = development;");
    expect(project).toContain("APS_ENVIRONMENT = production;");
    expect(eas.build.preview.distribution).toBe("internal");
    expect(eas.build.preview.ios.buildConfiguration).toBe("Staging");
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

  it("keeps the lock-screen rows whole: activity, description, then the digits", () => {
    const liveActivity = readFileSync(
      `${mobileRoot}ios/DayframeLiveActivity/DayframeTimerLiveActivity.swift`,
      "utf8"
    );
    const lockScreen = liveActivity.slice(liveActivity.indexOf("private struct DayframeLockScreenTimerView"));
    expect(lockScreen.indexOf("dayframeActivityName(state)")).toBeLessThan(lockScreen.indexOf("dayframeDistinctDescription(state)"));
    expect(lockScreen.indexOf("dayframeDistinctDescription(state)")).toBeLessThan(lockScreen.indexOf("size: .lockScreen"));
    expect(lockScreen).toContain(".padding(.vertical, 14)");
  });

  it("keeps the complete Dynamic Island metadata row above the clipping edge", () => {
    const liveActivity = readFileSync(
      `${mobileRoot}ios/DayframeLiveActivity/DayframeTimerLiveActivity.swift`,
      "utf8"
    );

    expect(liveActivity).toContain("dayframeExpandedMetadataLift: CGFloat = 10");
    expect(liveActivity).toMatch(
      /DayframeIslandLabel\(state: context\.state, colors: colors\)[\s\S]*?\.offset\(y: -dayframeExpandedMetadataLift\)/
    );
    expect(liveActivity).toContain("@ScaledMetric(relativeTo: .headline)");
    expect(liveActivity).toContain("@ScaledMetric(relativeTo: .subheadline)");
    expect(liveActivity).toContain(".fixedSize(horizontal: false, vertical: true)");
  });

  it("is drawn in Blocks: token colours per appearance, Bricolage digits, block markers, no SF Symbols (UIA-028)", () => {
    const liveActivity = readFileSync(
      `${mobileRoot}ios/DayframeLiveActivity/DayframeTimerLiveActivity.swift`,
      "utf8"
    );
    const plist = readFileSync(`${mobileRoot}ios/DayframeLiveActivity/Info.plist`, "utf8");
    expect(liveActivity).not.toContain("systemName:");
    expect(liveActivity).not.toContain("design: .rounded");
    expect(liveActivity).not.toContain("Circle()\n              .fill(categoryColor)");
    expect(liveActivity).toContain('"BricolageGrotesque-Bold"');
    expect(plist).toMatch(/<key>UIAppFonts<\/key>\s*<array>\s*<string>BricolageGrotesque-Bold\.ttf<\/string>/);
    expect(liveActivity).toContain("@Environment(\\.colorScheme)");
    expect(liveActivity).toContain("state.categoryColorLight ?? state.categoryColor");
    // Tokens from packages/shared (theme.ts / blocks.ts).
    const tokens: Record<string, string> = {
      accentDark: DAYFRAME_THEME.dark.accent,
      surfaceRaisedDark: DAYFRAME_THEME.dark.surfaceRaised,
      surfaceRaisedLight: DAYFRAME_THEME.light.surfaceRaised,
      textPrimaryDark: DAYFRAME_THEME.dark.textPrimary,
      textPrimaryLight: DAYFRAME_THEME.light.textPrimary,
      textMutedDark: DAYFRAME_THEME.dark.textMuted
    };
    for (const [name, hex] of Object.entries(tokens)) {
      expect(liveActivity).toContain(`static let ${name} = Color(dayframeHex: "${hex}")!`);
    }
    expect(liveActivity).toContain(`static let onBlockWhite = "${DAYFRAME_BLOCKS.onBlock.white}"`);
    expect(liveActivity).toContain(`static let onBlockInk = "${DAYFRAME_BLOCKS.onBlock.ink}"`);
    // The name is never shown twice when a block has no description.
    expect(liveActivity).toContain("title != dayframeActivityName(state)");
    // On-block text stays opaque (measured contrast), and the island chip can truncate (Codex r1).
    expect(liveActivity).not.toMatch(/colors\.text\.opacity\(/);
    expect(liveActivity).not.toContain(".fixedSize(horizontal: true");
    expect(liveActivity).toContain(".frame(minWidth: 80, alignment: .leading)");
  });
});
