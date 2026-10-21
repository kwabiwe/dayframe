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

const queued: HealthImportStatus = { provider: "healthkit", status: "queued", notes: "", importedCount: 1 };

function dependencies(overrides: Partial<HealthWakeDependencies> = {}) {
  const deps = {
    isAutomaticSyncEnabled: vi.fn(async () => true),
    captureSleep: vi.fn(async (_options: HealthCaptureOptions) => queued),
    captureWorkouts: vi.fn(async (_options: HealthCaptureOptions) => queued),
    uploadHealthEvents: vi.fn(async (_signal: AbortSignal): Promise<unknown> => undefined),
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
    deps.uploadHealthEvents.mockImplementation(async () => { order.push("upload"); });
    deps.complete.mockImplementation(async () => { order.push("complete"); return true; });
    const runner = createHealthWakeRunner(deps);
    runner.receive({ id: "w1", kind: "workout", reason: "observer" });
    await runner.idle();
    expect(deps.captureSleep).not.toHaveBeenCalled();
    expect(deps.captureWorkouts).toHaveBeenCalledWith(expect.objectContaining({
      observerChange: true,
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

  it("joins wakes that arrive during a pass into one follow-up pass", async () => {
    let release!: () => void;
    const deps = dependencies();
    deps.captureWorkouts.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(queued); }));
    const runner = createHealthWakeRunner(deps);
    runner.receive({ id: "w1", kind: "workout", reason: "observer" });
    await vi.waitFor(() => expect(deps.captureWorkouts).toHaveBeenCalledTimes(1));
    runner.receive({ id: "w2", kind: "workout", reason: "observer" });
    runner.receive({ id: "w3", kind: "sleep", reason: "observer" });
    release();
    await runner.idle();
    expect(deps.captureWorkouts).toHaveBeenCalledTimes(2);
    expect(deps.captureSleep).toHaveBeenCalledTimes(1);
    expect(deps.uploadHealthEvents).toHaveBeenCalledTimes(2);
    expect(deps.complete.mock.calls.map(([id]) => id)).toEqual(["w1", "w2", "w3"]);
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
      uploadHealthEvents: vi.fn((signal: AbortSignal) => new Promise<void>((resolve) => {
        uploadSignal = signal;
        signal.addEventListener("abort", () => resolve());
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
    expect(deps.complete).toHaveBeenCalledWith("w1", true);
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
  });
});
