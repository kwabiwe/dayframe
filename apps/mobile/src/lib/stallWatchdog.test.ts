import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetJsTasksForTests, withJsTask, type JsTaskLabel } from "./jsTasks";
import {
  freezeDiagnosticsSummary,
  installStallWatchdog,
  NATIVE_STALL_THRESHOLD_MS,
  RN_TIMING_SLEEP_THRESHOLD_MS,
  STALL_ANSWER_INTERVAL_MS,
  supportFreezeDiagnostics,
  type NativeDiagnostics
} from "./stallWatchdog";

function fakeAppState(initial: string) {
  let listener: ((state: string) => void) | null = null;
  return {
    currentState: initial,
    addEventListener: vi.fn((_type: "change", next: (state: string) => void) => {
      listener = next;
      return { remove: vi.fn(() => { listener = null; }) };
    }),
    emit(state: string) {
      this.currentState = state;
      listener?.(state);
    }
  };
}

function fakeNative() {
  return {
    jsAnswered: vi.fn<() => void>(),
    setJsTasks: vi.fn<(tasks: JsTaskLabel[], last: JsTaskLabel | null) => void>(),
    overview: vi.fn(async () => ({ stalls: [], reports: [], reportCount: 0 })),
    snapshot: vi.fn(async () => ({ stalls: [], reports: [] })),
    clear: vi.fn(async () => undefined)
  } satisfies NativeDiagnostics;
}

describe("JS stall watchdog", () => {
  it("answers rarely enough to let React Native's timer sleep, and often enough for native's threshold", () => {
    // At 1000 ms the display link never paused while Dayframe was in front (RCTTiming sleeps only when
    // the next timer is more than 1 s away).
    expect(STALL_ANSWER_INTERVAL_MS).toBeGreaterThanOrEqual(RN_TIMING_SLEEP_THRESHOLD_MS + 200);
    // One late answer must not reach native's silence threshold on its own.
    expect(STALL_ANSWER_INTERVAL_MS * 2).toBeLessThanOrEqual(NATIVE_STALL_THRESHOLD_MS);
  });

  it("matches the native and React Native constants it is sized against", () => {
    const at = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
    const core = readFileSync(at("apps/mobile/ios/Dayframe/DayframeDiagnosticsCore.swift"), "utf8");
    expect(core).toMatch(new RegExp(`static let threshold: TimeInterval = ${NATIVE_STALL_THRESHOLD_MS / 1000}\\b`));
    const timing = readFileSync(at("node_modules/react-native/React/CoreModules/RCTTiming.mm"), "utf8");
    expect(timing).toMatch(new RegExp(`kMinimumSleepInterval = ${RN_TIMING_SLEEP_THRESHOLD_MS / 1000};`));
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetJsTasksForTests();
  });

  it("answers on its interval only while Dayframe is in front", () => {
    vi.useFakeTimers();
    const native = fakeNative();
    const appState = fakeAppState("background");
    const stop = installStallWatchdog(native, appState);

    vi.advanceTimersByTime(5 * STALL_ANSWER_INTERVAL_MS);
    expect(native.jsAnswered).not.toHaveBeenCalled();

    appState.emit("active");
    expect(native.jsAnswered).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3 * STALL_ANSWER_INTERVAL_MS);
    expect(native.jsAnswered).toHaveBeenCalledTimes(4);

    appState.emit("inactive");
    vi.advanceTimersByTime(10 * STALL_ANSWER_INTERVAL_MS);
    expect(native.jsAnswered).toHaveBeenCalledTimes(4);

    appState.emit("active");
    appState.emit("active");
    vi.advanceTimersByTime(STALL_ANSWER_INTERVAL_MS);
    expect(native.jsAnswered).toHaveBeenCalledTimes(6);

    stop();
    vi.advanceTimersByTime(10 * STALL_ANSWER_INTERVAL_MS);
    expect(native.jsAnswered).toHaveBeenCalledTimes(6);
  });

  it("hands native the labelled tasks as they change", async () => {
    const native = fakeNative();
    installStallWatchdog(native, fakeAppState("background"));
    await withJsTask("location-foreground", async () => {
      expect(native.setJsTasks).toHaveBeenLastCalledWith(["location-foreground"], "location-foreground");
    });
    expect(native.setJsTasks).toHaveBeenLastCalledWith([], null);
  });

  it("does nothing without the native module", () => {
    const appState = fakeAppState("active");
    expect(() => installStallWatchdog(undefined, appState)()).not.toThrow();
    expect(appState.addEventListener).not.toHaveBeenCalled();
  });

  it("shares stalls and report summaries, with only the newest full reports", () => {
    const report = (n: number) => ({ receivedAt: `r${n}`, summary: [{ kind: "hang" }], payload: { n } });
    const shared = supportFreezeDiagnostics({ stalls: [], reports: [report(1), report(2), report(3), report(4)] });
    expect(shared?.reports.map((item) => "payload" in item)).toEqual([true, true, true, false]);
    expect(supportFreezeDiagnostics(null)).toBeNull();
  });

  it("summarises what was recorded for Sync help", () => {
    const stall = {
      id: "a", thread: "js" as const, startedAt: "2026-10-22T05:36:00.000Z", durationMs: 41_600,
      outcome: "left" as const, jsTasks: ["location-replay"], lastJsTask: "location-replay"
    };
    expect(freezeDiagnosticsSummary({ stalls: [], reports: [] }, () => "x")).toBeNull();
    expect(freezeDiagnosticsSummary({ stalls: [stall], reports: [{ summary: [] }] }, () => "06:36")).toBe(
      "1 pause, last 06:36 for 42 s · 1 system report"
    );
    // The overview carries a count instead of the reports themselves.
    expect(freezeDiagnosticsSummary({ stalls: [], reports: [], reportCount: 2 }, () => "x")).toBe("2 system reports");
    // The overview lists the last few pauses but counts them all (Codex r2 on #525).
    expect(freezeDiagnosticsSummary({ stalls: [stall], reports: [], stallCount: 10 }, () => "06:36")).toBe(
      "10 pauses, last 06:36 for 42 s"
    );
  });
});
