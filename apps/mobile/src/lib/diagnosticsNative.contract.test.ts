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
    // File work never runs on the queue that times JS answers (Codex r2 on #525).
    const save = service.slice(service.indexOf("private func save("), service.indexOf("/// On `ioQueue`."));
    expect(save).toContain("ioQueue.async { self.store?.save(record) }");
    for (const name of ["func overview(_ completion", "func snapshot(_ completion", "func clear(_ completion"]) {
      const body = service.slice(service.indexOf(name), service.indexOf(name) + 200);
      expect(body, name).toContain("ioQueue.async");
    }
    expect(service).toContain("self.ingest(MXMetricManager.shared.pastDiagnosticPayloads)");
    expect(service.slice(service.indexOf("func didReceive"), service.indexOf("func didReceive") + 120)).toContain("ioQueue.async");
  });

  it("samples a stalled main thread in C, names it off the watchdog's queue, for the stall it was reserved for", () => {
    const service = read("ios/Dayframe/DayframeDiagnostics.swift");
    const start = service.slice(service.indexOf("func start()"), service.indexOf("func didReceive"));
    // Main's port and stack range are read on main itself, at launch (staging QA 24 Oct 2026).
    expect(start).toContain("let mainThread = DayframeThreadSampler.currentThread()");
    expect(start).toContain("let mainStack = DayframeThreadSampler.currentStack()");
    const probe = service.slice(service.indexOf("private func probe()"), service.indexOf("private func sampleMain("));
    expect(probe).toContain("if let reservation = tracker.reserveMainSample(uptime: uptime) { sampleMain(reservation) }");
    const sampleMain = service.slice(service.indexOf("private func sampleMain("), service.indexOf("private func context("));
    // Captured at once, named on its own queue (dladdr can wait on dyld's lock), attached by stall id.
    expect(sampleMain.indexOf("DayframeThreadSampler.capture(mainThread, stack: mainStack)")).toBeLessThan(sampleMain.indexOf("samplerQueue.async"));
    expect(sampleMain.indexOf("samplerQueue.async")).toBeLessThan(sampleMain.indexOf("DayframeThreadSampler.describe(addresses)"));
    expect(sampleMain).toContain("stallId: reservation.stallId, atMs: reservation.atMs");
    expect(service).toContain("appBinary: appBinary");
  });

  it("does only system calls and stack reads while the sampled thread is suspended (Codex r1 on #577)", () => {
    const c = read("ios/Dayframe/DayframeThreadSampler.c");
    const window = c.slice(c.indexOf("if (thread_suspend(thread) != KERN_SUCCESS) return 0;"), c.indexOf("thread_resume(thread);"));
    expect(window.length).toBeGreaterThan(100);
    const calls = new Set([...window.replace(/\/\/.*$/gm, "").matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map((match) => match[1]));
    const allowed = ["if", "for", "sizeof", "thread_suspend", "thread_get_state", "arm_thread_state64_get_pc", "arm_thread_state64_get_lr",
      "arm_thread_state64_get_fp", "append", "vm_read_overwrite", "mach_task_self", "thread_state_t", "vm_address_t"];
    expect([...calls].filter((name) => !allowed.includes(name))).toEqual([]);
    // `append` itself only writes the caller's buffer.
    const append = c.slice(c.indexOf("static void append("), c.indexOf("int dayframe_thread_sample("));
    expect(append).not.toMatch(/\b(malloc|calloc|free|printf|os_log|dispatch_\w+|pthread_mutex\w*|objc_\w+|swift_\w+)\s*\(/);
    // The walk is bounded by steps and by the thread's stack, not only by frames kept.
    expect(window).toContain("step < max_steps");
    expect(window).toContain("fp < stack_low || fp + sizeof(record) > stack_high");
    expect(window).toContain("if (next <= fp) break;");
    expect(c.indexOf("thread_resume(thread);")).toBeGreaterThan(c.indexOf("thread_suspend(thread)"));
    // Swift never runs inside the window: its capture only calls the C routine.
    const core = read("ios/Dayframe/DayframeDiagnosticsCore.swift");
    expect(core).not.toMatch(/\bthread_suspend\(|\bthread_get_state\(|\bvm_read_overwrite\(/);
    expect(read("ios/Dayframe/Dayframe-Bridging-Header.h")).toContain('#import "DayframeThreadSampler.h"');
  });

  it("compiles the diagnostics into the app target only and runs the core fixture in CI", () => {
    const project = read("ios/Dayframe.xcodeproj/project.pbxproj");
    for (const file of ["DayframeDiagnosticsCore.swift", "DayframeDiagnostics.swift", "DayframeDiagnosticsModuleBridge.m", "DayframeThreadSampler.c"]) {
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

  it("keeps MetricKit's daily energy metrics as counts for Sync help (location v4 step 3)", () => {
    const service = read("ios/Dayframe/DayframeDiagnostics.swift");
    const core = read("ios/Dayframe/DayframeDiagnosticsCore.swift");
    expect(service).toContain("func didReceive(_ payloads: [MXMetricPayload])");
    expect(service).toContain("self.ingestMetrics(MXMetricManager.shared.pastPayloads)");
    expect(service).toContain('"energy": DayframeEnergySummary(');
    expect(core).toContain("struct DayframeEnergyDay: Codable");
    expect(core).toContain("static let bestAccuracyBudgetSeconds = 20.0 * 60");
    // Counts only: no positions or place names ever reach the energy record.
    expect(core.slice(core.indexOf("struct DayframeEnergyDay"), core.indexOf("struct DayframeEnergySummary"))).not.toMatch(/latitude|longitude|coordinate|place/i);
    expect(read("app/settings.tsx")).toContain('title="Location energy"');
    expect(read("app/settings.tsx")).toContain("locationEnergy: supportEnergyDiagnostics(freezes?.energy, freezes?.energyDays)");
  });
});
