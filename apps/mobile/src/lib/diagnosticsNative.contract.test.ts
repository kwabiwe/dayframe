import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The freeze and crash diagnostics (staging freeze, 22 Oct 2026). The logic itself is exercised on macOS
// by scripts/fixtures/ios-diagnostics (validate-ios-diagnostics.sh, run in CI).

const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${mobileRoot}${path}`, "utf8");

describe("native freeze and crash diagnostics", () => {
  it("starts before React Native, so a freeze on the first screen is caught", () => {
    const appDelegate = read("ios/Dayframe/AppDelegate.swift");
    const start = appDelegate.indexOf("DayframeDiagnosticsService.shared.start()");

    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(appDelegate.indexOf("factory.startReactNative"));
  });

  it("subscribes to MetricKit, keeps past payloads, and stores privately outside the App Group", () => {
    const service = read("ios/Dayframe/DayframeDiagnostics.swift");
    const core = read("ios/Dayframe/DayframeDiagnosticsCore.swift");

    expect(service).toContain("MXMetricManager.shared.add(self)");
    // Past payloads are read on the diagnostics queue, not on the launch path.
    const start = service.slice(service.indexOf("func start()"), service.indexOf("func didReceive"));
    expect(start).toContain("self.ingest(MXMetricManager.shared.pastDiagnosticPayloads)");
    expect(start.indexOf("queue.async")).toBeLessThan(start.indexOf("pastDiagnosticPayloads"));
    // Reports are saved only in their allowlisted form.
    expect(read("ios/Dayframe/DayframeDiagnosticsCore.swift")).toContain("let clean = DayframeMetricKitSummary.sanitize(payload)");
    expect(service).toContain(".applicationSupportDirectory");
    expect(service + core).not.toMatch(/forSecurityApplicationGroupIdentifier|DayframeSharedStorageConfiguration/);
    expect(core).toContain("values.isExcludedFromBackup = true");
  });

  it("probes only while in front and gives React Native its own queue", () => {
    const service = read("ios/Dayframe/DayframeDiagnostics.swift");
    const setActive = service.slice(service.indexOf("private func setActive"), service.indexOf("private func probe"));

    expect(setActive).toContain("timer?.cancel()");
    expect(setActive).toContain("tracker.resignedActive(uptime: uptime, context: context(for: .js)).forEach(save)");
    // Main is timed from an unanswered probe, so a late tick never counts against it (Codex r1 on #525).
    expect(service.indexOf("tracker.sentMainProbe(uptime: uptime)")).toBeLessThan(service.indexOf("DispatchQueue.main.async { [weak self] in"));
    expect(service).toContain("UIApplication.willResignActiveNotification");
    expect(service).toContain("@objc var methodQueue: DispatchQueue { DayframeDiagnosticsService.shared.queue }");
  });

  it("compiles the diagnostics into the app target only and runs the core fixture in CI", () => {
    const project = read("ios/Dayframe.xcodeproj/project.pbxproj");
    for (const file of ["DayframeDiagnosticsCore.swift", "DayframeDiagnostics.swift", "DayframeDiagnosticsModuleBridge.m"]) {
      expect(project.match(new RegExp(`${file.replace(".", "\\.")} in Sources`, "g")), file).toHaveLength(2);
    }
    const workflow = readFileSync(`${repositoryRoot}.github/workflows/review-location-validation.yml`, "utf8");
    expect(workflow).toContain("bash scripts/validate-ios-diagnostics.sh");
  });

  it("labels the long JS work a stall can name", () => {
    const labelled: Array<[string, string]> = [
      ["src/lib/api.ts", 'withJsTask("bootstrap"'],
      ["src/lib/api.ts", 'withJsTask("sync-queue"'],
      ["src/lib/healthBackgroundSync.ts", 'withJsTask("health-wake"'],
      ["src/lib/location/runtime.ts", 'withJsTask("location-foreground"'],
      ["src/lib/location/runtime.ts", 'withJsTask("location-replay"'],
      ["src/lib/location/runtime.ts", 'withJsTask("location-drain"'],
      ["src/lib/reviewSyncStore.ts", 'withJsTask("review-bootstrap"']
    ];
    for (const [path, call] of labelled) expect(read(path), path).toContain(call);
    expect(read("app/_layout.tsx")).toContain("installStallWatchdog(NativeModules.DayframeDiagnosticsModule");
    expect(read("app/settings.tsx")).toContain("freezes: supportFreezeDiagnostics(freezes)");
  });
});
