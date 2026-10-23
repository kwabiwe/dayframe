import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHealthWakeRunner,
  HEALTH_WAKE_CAPTURE_MS,
  HEALTH_WAKE_MAX_PAGES,
  HEALTH_WAKE_PASS_MS,
  installHealthBackgroundSync,
  subscribeHealthChanges,
  type HealthWakeDependencies
} from "./healthBackgroundSync";
import type { HealthCaptureOptions, HealthImportStatus } from "./health";
import { createHealthCaptureCoalescer } from "./healthCaptureLifecycle";

const healthSignOut = vi.hoisted(() => ({ watch: vi.fn() }));
vi.mock("./healthSignOut", () => ({ watchSignedOutHealthBackground: healthSignOut.watch }));

const queued: HealthImportStatus = { provider: "healthkit", status: "queued", notes: "", importedCount: 1 };

function dependencies(overrides: Partial<HealthWakeDependencies> = {}) {
  const deps = {
    isAutomaticSyncEnabled: vi.fn(async () => true),
    captureSleep: vi.fn(async (_options: HealthCaptureOptions) => queued),
    captureWorkouts: vi.fn(async (_options: HealthCaptureOptions) => queued),
    uploadHealthEvents: vi.fn(async (_signal: AbortSignal): Promise<boolean> => true),
    complete: vi.fn(async (_id: string, _success: boolean): Promise<unknown> => true)
  };
  // Overrides are mocks too; the cast keeps their mock helpers visible to the tests.
  return Object.assign(deps, overrides) as typeof deps;
}

afterEach(() => vi.useRealTimers());

describe("Apple Health wake runner", () => {
  it("captures the woken kind with a page cap, uploads Health events, then finishes the wake", async () => {
    const deps = dependencies();
    const order: string[] = [];
    deps.captureWorkouts.mockImplementation(async () => { order.push("capture"); return queued; });
    deps.uploadHealthEvents.mockImplementation(async () => { order.push("upload"); return true; });
    deps.complete.mockImplementation(async () => { order.push("complete"); return true; });
    const runner = createHealthWakeRunner(deps);
    runner.receive({ id: "w1", kind: "workout", reason: "observer" });
    await runner.idle();
    expect(deps.captureSleep).not.toHaveBeenCalled();
    expect(deps.captureWorkouts).toHaveBeenCalledWith(expect.objectContaining({
      observerChange: true,
      fresh: true,
      background: true,
      maxPages: HEALTH_WAKE_MAX_PAGES,
      signal: expect.any(AbortSignal)
    }));
    expect(order).toEqual(["capture", "upload", "complete"]);
    expect(deps.complete).toHaveBeenCalledWith("w1", true);
  });

  it("captures both kinds for a background app refresh", async () => {
    const deps = dependencies();
    const runner = createHealthWakeRunner(deps);
    runner.receive({ id: "r1", kind: "all", reason: "refresh" });
    await runner.idle();
    expect(deps.captureSleep).toHaveBeenCalledOnce();
    expect(deps.captureWorkouts).toHaveBeenCalledOnce();
    expect(deps.complete).toHaveBeenCalledWith("r1", true);
  });

  it("finishes the wake without capture when automatic Health sync is off", async () => {
    const deps = dependencies({ isAutomaticSyncEnabled: vi.fn(async () => false) });
    const runner = createHealthWakeRunner(deps);
    runner.receive({ id: "w1", kind: "sleep", reason: "observer" });
    await runner.idle();
    expect(deps.captureSleep).not.toHaveBeenCalled();
    expect(deps.uploadHealthEvents).not.toHaveBeenCalled();
    expect(deps.complete).toHaveBeenCalledWith("w1", true);
  });

  it("still uploads earlier Health events and reports failure when a capture rejects", async () => {
    const deps = dependencies({ captureSleep: vi.fn(async () => { throw new Error("protected data unavailable"); }) });
    const runner = createHealthWakeRunner(deps);
    runner.receive({ id: "w1", kind: "sleep", reason: "observer" });
    await runner.idle();
    expect(deps.uploadHealthEvents).toHaveBeenCalledOnce();
    expect(deps.complete).toHaveBeenCalledWith("w1", false);
  });

  it("finishes the wake when the upload fails", async () => {
    const deps = dependencies({ uploadHealthEvents: vi.fn(async () => { throw new Error("offline"); }) });
    const runner = createHealthWakeRunner(deps);
    runner.receive({ id: "w1", kind: "workout", reason: "observer" });
    await runner.idle();
    expect(deps.complete).toHaveBeenCalledWith("w1", false);
  });

  it("lets wakes that arrive while a pass captures join it, and finishes them together", async () => {
    let release!: () => void;
    const deps = dependencies();
    deps.captureWorkouts.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(queued); }));
    const runner = createHealthWakeRunner(deps);
    runner.receive({ id: "w1", kind: "workout", reason: "observer" });
    await vi.waitFor(() => expect(deps.captureWorkouts).toHaveBeenCalledTimes(1));
    runner.receive({ id: "w2", kind: "workout", reason: "observer" });
    runner.receive({ id: "w3", kind: "sleep", reason: "observer" });
    // The second workout capture starts only once the first settles, so it reads w2's change.
    expect(deps.captureWorkouts).toHaveBeenCalledTimes(1);
    expect(deps.captureSleep).toHaveBeenCalledTimes(1);
    expect(deps.complete).not.toHaveBeenCalled();
    release();
    await runner.idle();
    expect(deps.captureWorkouts).toHaveBeenCalledTimes(2);
    expect(deps.captureWorkouts.mock.calls.every(([options]) => options.fresh === true)).toBe(true);
    expect(deps.uploadHealthEvents).toHaveBeenCalledTimes(1);
    expect(deps.complete.mock.calls.map(([id]) => id)).toEqual(["w1", "w2", "w3"]);
  });

  it("keeps every capture a wake needs inside its pass, with the real capture coalescer", async () => {
    const coalescer = createHealthCaptureCoalescer();
    const starts: Array<() => void> = [];
    const events: string[] = [];
    const work = () => new Promise<HealthImportStatus>((resolve) => {
      events.push(`start ${starts.length + 1}`);
      starts.push(() => resolve(queued));
    });
    const captureWorkouts = (options: HealthCaptureOptions) => options.fresh
      ? coalescer.runFresh("owner:workout", work, options.signal)
      : coalescer.run("owner:workout", work, options.observerChange);
    const deps = dependencies({ captureWorkouts: vi.fn(captureWorkouts) });
    deps.complete.mockImplementation(async (id: string) => { events.push(`complete ${id}`); return true; });
    const runner = createHealthWakeRunner(deps);
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    void captureWorkouts({});                       // Today's foreground capture: start 1
    runner.receive({ id: "w1", kind: "workout", reason: "observer" });
    await flush();
    expect(starts).toHaveLength(1);                 // w1 waits for a capture that starts after it
    starts[0]();
    await vi.waitFor(() => expect(starts).toHaveLength(2));
    runner.receive({ id: "w2", kind: "workout", reason: "observer" });
    void captureWorkouts({ observerChange: true }); // Today hears the same change: entry follow-up
    starts[1]();
    await vi.waitFor(() => expect(starts).toHaveLength(3));
    runner.receive({ id: "w3", kind: "workout", reason: "observer" });
    void captureWorkouts({ observerChange: true }); // and the third change
    starts[2]();
    await vi.waitFor(() => expect(starts).toHaveLength(4));
    starts[3]();
    await runner.idle();
    await flush();
    await flush();
    expect(starts).toHaveLength(4);                 // nothing starts after the wakes are finished
    expect(events.slice(-3)).toEqual(["complete w1", "complete w2", "complete w3"]);
    expect(events.indexOf("start 4")).toBeLessThan(events.indexOf("complete w1"));
  });

  it("never starts a capture after its wait for Today's capture was cut off", async () => {
    vi.useFakeTimers();
    const coalescer = createHealthCaptureCoalescer();
    const starts: Array<() => void> = [];
    const work = () => new Promise<HealthImportStatus>((resolve) => { starts.push(() => resolve(queued)); });
    const captureWorkouts = (options: HealthCaptureOptions) => options.fresh
      ? coalescer.runFresh("owner:workout", work, options.signal)
      : coalescer.run("owner:workout", work, options.observerChange);
    const deps = dependencies({ captureWorkouts: vi.fn(captureWorkouts) });
    const runner = createHealthWakeRunner(deps);
    void captureWorkouts({});                       // Today's capture, still running at the deadline
    runner.receive({ id: "w1", kind: "workout", reason: "observer" });
    await vi.advanceTimersByTimeAsync(HEALTH_WAKE_CAPTURE_MS);
    await runner.idle();
    expect(deps.complete).toHaveBeenCalledWith("w1", false);
    starts[0]();
    await vi.advanceTimersByTimeAsync(10);
    expect(starts).toHaveLength(1);
  });

  it("finishes the wake when the automatic-sync check stalls past the capture deadline", async () => {
    vi.useFakeTimers();
    const deps = dependencies({ isAutomaticSyncEnabled: vi.fn(() => new Promise<boolean>(() => undefined)) });
    const runner = createHealthWakeRunner(deps);
    runner.receive({ id: "w1", kind: "workout", reason: "observer" });
    await vi.advanceTimersByTimeAsync(HEALTH_WAKE_CAPTURE_MS);
    await runner.idle();
    expect(deps.captureWorkouts).not.toHaveBeenCalled();
    expect(deps.complete).toHaveBeenCalledWith("w1", false);
  });

  it("never lengthens the budget when the wall clock moved back after the wake", async () => {
    vi.useFakeTimers();
    let uploadSignal: AbortSignal | undefined;
    const deps = dependencies({
      uploadHealthEvents: vi.fn((signal: AbortSignal) => {
        uploadSignal = signal;
        return new Promise<boolean>((resolve) => signal.addEventListener("abort", () => resolve(false)));
      })
    });
    const runner = createHealthWakeRunner(deps);
    runner.receive({ id: "w1", kind: "workout", reason: "observer", receivedAt: Date.now() + 60_000 });
    await vi.advanceTimersByTimeAsync(HEALTH_WAKE_PASS_MS);
    await runner.idle();
    expect(uploadSignal?.aborted).toBe(true);
  });

  it("gives a wake that arrives during the upload a follow-up pass", async () => {
    let release!: () => void;
    const deps = dependencies();
    deps.uploadHealthEvents.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(true); }));
    const runner = createHealthWakeRunner(deps);
    runner.receive({ id: "w1", kind: "workout", reason: "observer" });
    await vi.waitFor(() => expect(deps.uploadHealthEvents).toHaveBeenCalledTimes(1));
    runner.receive({ id: "w2", kind: "sleep", reason: "observer" });
    release();
    await runner.idle();
    expect(deps.captureSleep).toHaveBeenCalledTimes(1);
    expect(deps.uploadHealthEvents).toHaveBeenCalledTimes(2);
    expect(deps.complete.mock.calls.map(([id]) => id)).toEqual(["w1", "w2"]);
  });

  it("stops waiting for a joined capture that ignores the wake's signal, and still uploads", async () => {
    vi.useFakeTimers();
    // A foreground capture already running keeps its own options: it never sees this signal.
    const deps = dependencies({ captureWorkouts: vi.fn(() => new Promise<HealthImportStatus>(() => undefined)) });
    const runner = createHealthWakeRunner(deps);
    runner.receive({ id: "w1", kind: "workout", reason: "observer" });
    await vi.advanceTimersByTimeAsync(HEALTH_WAKE_CAPTURE_MS);
    await runner.idle();
    expect(deps.uploadHealthEvents).toHaveBeenCalledOnce();
    expect(deps.complete).toHaveBeenCalledWith("w1", false);
  });

  it("anchors a follow-up pass's deadlines to when its own wake arrived", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    let followUpSignal: AbortSignal | undefined;
    const deps = dependencies({
      uploadHealthEvents: vi.fn((signal: AbortSignal) => {
        if (!release) return new Promise<boolean>((resolve) => { release = () => resolve(true); });
        followUpSignal = signal;
        return new Promise<boolean>((resolve) => signal.addEventListener("abort", () => resolve(false)));
      })
    });
    const runner = createHealthWakeRunner(deps);
    runner.receive({ id: "w1", kind: "workout", reason: "observer" });
    await vi.waitFor(() => expect(deps.uploadHealthEvents).toHaveBeenCalledTimes(1));
    runner.receive({ id: "w2", kind: "workout", reason: "observer" });
    await vi.advanceTimersByTimeAsync(15_000);
    release();
    await vi.waitFor(() => expect(followUpSignal).toBeDefined());
    // w2 arrived about 15 s before its pass began, so only about 5 s of its 20 s remain.
    await vi.advanceTimersByTimeAsync(HEALTH_WAKE_PASS_MS - 15_000);
    await runner.idle();
    expect(followUpSignal?.aborted).toBe(true);
    expect(deps.complete).toHaveBeenLastCalledWith("w2", false);
  });

  it("reports an upload that left Health events unsent as unsuccessful", async () => {
    const deps = dependencies({ uploadHealthEvents: vi.fn(async () => false) });
    const runner = createHealthWakeRunner(deps);
    runner.receive({ id: "r1", kind: "all", reason: "refresh" });
    await runner.idle();
    expect(deps.complete).toHaveBeenCalledWith("r1", false);
  });

  it("stops capture and upload at their deadlines and still finishes the wake", async () => {
    vi.useFakeTimers();
    let captureSignal: AbortSignal | undefined;
    let uploadSignal: AbortSignal | undefined;
    const deps = dependencies({
      captureWorkouts: vi.fn((options) => new Promise<HealthImportStatus>((resolve) => {
        captureSignal = options.signal;
        options.signal?.addEventListener("abort", () => resolve(queued));
      })),
      uploadHealthEvents: vi.fn((signal: AbortSignal) => new Promise<boolean>((resolve) => {
        uploadSignal = signal;
        signal.addEventListener("abort", () => resolve(true));
      }))
    });
    const runner = createHealthWakeRunner(deps);
    runner.receive({ id: "w1", kind: "workout", reason: "observer" });
    await vi.advanceTimersByTimeAsync(HEALTH_WAKE_CAPTURE_MS);
    expect(captureSignal?.aborted).toBe(true);
    expect(uploadSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(HEALTH_WAKE_PASS_MS - HEALTH_WAKE_CAPTURE_MS);
    await runner.idle();
    expect(uploadSignal?.aborted).toBe(true);
    // The capture was cut short and the upload ran out of time.
    expect(deps.complete).toHaveBeenCalledWith("w1", false);
  });

  it("tells mounted screens about observer changes, not about refreshes", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeHealthChanges(listener);
    const runner = createHealthWakeRunner(dependencies());
    runner.receive({ id: "w1", kind: "sleep", reason: "observer" });
    runner.receive({ id: "r1", kind: "all", reason: "refresh" });
    await runner.idle();
    unsubscribe();
    runner.receive({ id: "w2", kind: "workout", reason: "observer" });
    await runner.idle();
    expect(listener.mock.calls).toEqual([["HKCategoryTypeIdentifierSleepAnalysis"]]);
  });

  it("drains wakes that arrived before JavaScript listened, once", async () => {
    let onWake: ((wake: { id: string; kind: "workout"; reason: "observer"; receivedAt: number }) => void) | undefined;
    const native = {
      isAvailable: () => true,
      addWakeListener: vi.fn((listener) => { onWake = listener; return { remove: vi.fn() }; }),
      startListening: vi.fn(async () => [{ id: "cold", kind: "workout" as const, reason: "observer" as const, receivedAt: 1 }]),
      complete: vi.fn(async () => true),
      setEnabled: vi.fn(),
      getStatus: vi.fn()
    };
    installHealthBackgroundSync(native as never);
    installHealthBackgroundSync(native as never);
    expect(native.addWakeListener).toHaveBeenCalledOnce();
    expect(native.startListening).toHaveBeenCalledOnce();
    expect(onWake).toBeTypeOf("function");
    // A signed-out launch, and every later sign-out, turns HealthKit's wakes off (health-4).
    await vi.waitFor(() => expect(healthSignOut.watch).toHaveBeenCalledWith(native));
    expect(healthSignOut.watch).toHaveBeenCalledOnce();
  });
});
