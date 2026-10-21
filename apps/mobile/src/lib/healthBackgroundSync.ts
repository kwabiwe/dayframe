// Apple Health background sync: iOS wakes Dayframe for new sleep or workout samples (HealthKit
// background delivery) or for a background app refresh, and this module runs one bounded pass per
// wake: capture through the durable journal → queue path, then upload only Health events. It is
// installed when the root layout module is evaluated, so it also runs in a cold background launch
// where no screen ever becomes active. Server reprocess, Dashboard reloads and every other queued
// event stay foreground-owned.
import type { DayframeHealthWake } from "../../modules/dayframe-health-background";
import type { HealthCaptureOptions, HealthImportStatus } from "./health";

export type HealthWake = Pick<DayframeHealthWake, "id" | "kind" | "reason">;

export const HEALTH_SLEEP_CHANGE_TYPE = "HKCategoryTypeIdentifierSleepAnalysis";
export const HEALTH_WORKOUT_CHANGE_TYPE = "HKWorkoutTypeIdentifier";
export type HealthChangeType =
  | typeof HEALTH_SLEEP_CHANGE_TYPE
  | typeof HEALTH_WORKOUT_CHANGE_TYPE;

/** Capture stops reading new pages after this, leaving time to upload what it journaled. */
export const HEALTH_WAKE_CAPTURE_MS = 12_000;
/** The whole pass, upload included; native finishes the wake at 25 s whatever happens. */
export const HEALTH_WAKE_PASS_MS = 20_000;
/** Query pages per kind per wake (250 samples each); a longer backlog continues next time. */
export const HEALTH_WAKE_MAX_PAGES = 4;

export type HealthWakeDependencies = {
  isAutomaticSyncEnabled(): Promise<boolean>;
  captureSleep(options: HealthCaptureOptions): Promise<HealthImportStatus>;
  captureWorkouts(options: HealthCaptureOptions): Promise<HealthImportStatus>;
  uploadHealthEvents(signal: AbortSignal): Promise<unknown>;
  complete(id: string, success: boolean): Promise<unknown>;
};

export type HealthWakeRunner = {
  receive(wake: HealthWake): void;
  /** Resolves once every wake received so far has been finished. */
  idle(): Promise<void>;
};

const changeListeners = new Set<(type: HealthChangeType) => void>();

/**
 * Tells a mounted screen that HealthKit reported a change, so the foreground can refresh what it
 * shows. Background capture and upload do not depend on any listener.
 */
export function subscribeHealthChanges(listener: (type: HealthChangeType) => void) {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function announceChange(wake: HealthWake) {
  if (wake.reason !== "observer" || wake.kind === "all") return;
  const type = wake.kind === "sleep" ? HEALTH_SLEEP_CHANGE_TYPE : HEALTH_WORKOUT_CHANGE_TYPE;
  for (const listener of changeListeners) {
    try {
      listener(type);
    } catch {
      // A screen's listener never blocks the pass.
    }
  }
}

export function createHealthWakeRunner(deps: HealthWakeDependencies): HealthWakeRunner {
  let pending: HealthWake[] = [];
  let running: Promise<void> | null = null;

  async function runPass(batch: HealthWake[]) {
    const capture = new AbortController();
    const pass = new AbortController();
    const captureTimer = setTimeout(() => capture.abort(), HEALTH_WAKE_CAPTURE_MS);
    const passTimer = setTimeout(() => pass.abort(), HEALTH_WAKE_PASS_MS);
    let success = true;
    try {
      if (!(await deps.isAutomaticSyncEnabled())) return;
      const kinds = new Set(batch.flatMap((wake) =>
        wake.kind === "all" ? ["sleep", "workout"] : [wake.kind]
      ));
      const options: HealthCaptureOptions = {
        observerChange: true,
        signal: capture.signal,
        maxPages: HEALTH_WAKE_MAX_PAGES
      };
      const captures = await Promise.allSettled([
        ...(kinds.has("sleep") ? [deps.captureSleep(options)] : []),
        ...(kinds.has("workout") ? [deps.captureWorkouts(options)] : [])
      ]);
      if (captures.some((result) => result.status === "rejected")) success = false;
      // Upload even when this pass found nothing new: an earlier wake may have journaled and
      // queued Health events that could not be sent then.
      if (!pass.signal.aborted) await deps.uploadHealthEvents(pass.signal);
    } catch {
      success = false;
    } finally {
      clearTimeout(captureTimer);
      clearTimeout(passTimer);
      await Promise.all(batch.map((wake) =>
        deps.complete(wake.id, success).catch(() => undefined)
      ));
    }
  }

  async function drain() {
    // Wakes that arrive during a pass share one follow-up pass.
    while (pending.length) {
      const batch = pending;
      pending = [];
      await runPass(batch);
    }
  }

  return {
    receive(wake) {
      pending.push(wake);
      announceChange(wake);
      if (!running) {
        running = drain().finally(() => {
          running = null;
        });
      }
    },
    idle() {
      return running ?? Promise.resolve();
    }
  };
}

type NativeHealthBackground = typeof import("../../modules/dayframe-health-background");

function loadNativeModule(): NativeHealthBackground | null {
  // React Native defines __DEV__ in development and release bundles; Node tests do not.
  if (typeof __DEV__ === "undefined") return null;
  try {
    return require("../../modules/dayframe-health-background") as NativeHealthBackground;
  } catch {
    return null;
  }
}

let installed = false;

/** Starts receiving Health wakes. Idempotent; a no-op without the native module. */
export function installHealthBackgroundSync(native: NativeHealthBackground | null = loadNativeModule()) {
  if (installed || !native?.isAvailable()) return;
  installed = true;
  const runner = createHealthWakeRunner({
    isAutomaticSyncEnabled: async () =>
      (await import("./health")).isHealthKitAutomaticSyncEnabled(),
    captureSleep: async (options) => (await import("./health")).importHealthKitSleep(options),
    captureWorkouts: async (options) => (await import("./health")).importHealthKitWorkouts(options),
    uploadHealthEvents: async (signal) =>
      (await import("./api")).syncQueue({ eventScope: "health", signal }),
    complete: (id, success) => native.complete(id, success)
  });
  native.addWakeListener((wake) => runner.receive(wake));
  void native.startListening()
    .then((wakes) => {
      for (const wake of wakes) runner.receive(wake);
    })
    .catch(() => undefined);
}
