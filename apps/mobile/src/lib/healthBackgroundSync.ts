// Apple Health background sync: iOS wakes Dayframe for new sleep or workout samples (HealthKit
// background delivery) or for a background app refresh, and this module runs one bounded pass per
// wake: capture through the durable journal → queue path, then upload only Health events. It is
// installed when the root layout module is evaluated, so it also runs in a cold background launch
// where no screen ever becomes active. Server reprocess, Dashboard reloads and every other queued
// event stay foreground-owned.
import type { DayframeHealthWake } from "../../modules/dayframe-health-background";
import type { HealthCaptureOptions, HealthImportStatus } from "./health";

/** `receivedAt` (epoch ms, when native got the wake) anchors the pass deadlines; it defaults to now. */
export type HealthWake = Pick<DayframeHealthWake, "id" | "kind" | "reason"> & { receivedAt?: number };

export const HEALTH_SLEEP_CHANGE_TYPE = "HKCategoryTypeIdentifierSleepAnalysis";
export const HEALTH_WORKOUT_CHANGE_TYPE = "HKWorkoutTypeIdentifier";
export type HealthChangeType =
  | typeof HEALTH_SLEEP_CHANGE_TYPE
  | typeof HEALTH_WORKOUT_CHANGE_TYPE;

/**
 * Measured from when the earliest wake of a pass reached native, so a follow-up pass never runs
 * past its own wake: capture stops waiting after this, leaving time to upload what it journaled.
 */
export const HEALTH_WAKE_CAPTURE_MS = 12_000;
/** The whole pass, upload included; native finishes the wake at 25 s whatever happens. */
export const HEALTH_WAKE_PASS_MS = 20_000;
/** Query pages per kind per wake (250 samples each); a longer backlog continues next time. */
export const HEALTH_WAKE_MAX_PAGES = 4;

export type HealthWakeDependencies = {
  isAutomaticSyncEnabled(): Promise<boolean>;
  captureSleep(options: HealthCaptureOptions): Promise<HealthImportStatus>;
  captureWorkouts(options: HealthCaptureOptions): Promise<HealthImportStatus>;
  /** Resolves true only when every queued Health event was sent. */
  uploadHealthEvents(signal: AbortSignal): Promise<boolean>;
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

function wakeKinds(wake: HealthWake): Array<"sleep" | "workout"> {
  return wake.kind === "all" ? ["sleep", "workout"] : [wake.kind];
}

/** Resolves when the signal aborts (at once if it already has). */
function whenAborted(signal: AbortSignal) {
  return new Promise<"aborted">((resolve) => {
    if (signal.aborted) resolve("aborted");
    else signal.addEventListener("abort", () => resolve("aborted"), { once: true });
  });
}

type ActivePass = {
  wakes: HealthWake[];
  captures: Promise<unknown>[];
  captureSignal: AbortSignal;
  /** Still waiting for captures: a new wake joins this pass instead of queueing behind it. */
  capturing: boolean;
};

export function createHealthWakeRunner(deps: HealthWakeDependencies): HealthWakeRunner {
  let pending: HealthWake[] = [];
  let running: Promise<void> | null = null;
  let active: ActivePass | null = null;

  function startCaptures(pass: ActivePass, wake: HealthWake) {
    const options: HealthCaptureOptions = {
      observerChange: true,
      signal: pass.captureSignal,
      maxPages: HEALTH_WAKE_MAX_PAGES
    };
    for (const kind of wakeKinds(wake)) {
      // A capture already running (a foreground one included) is joined, with one follow-up.
      const capture = kind === "sleep" ? deps.captureSleep(options) : deps.captureWorkouts(options);
      // A capture the pass stopped waiting for still settles somewhere.
      capture.catch(() => undefined);
      pass.captures.push(capture);
    }
  }

  async function runPass(batch: HealthWake[]) {
    const anchoredAt = Math.min(...batch.map((wake) => wake.receivedAt ?? Date.now()));
    const capture = new AbortController();
    const pass = new AbortController();
    const captureTimer = setTimeout(() => capture.abort(), Math.max(0, anchoredAt + HEALTH_WAKE_CAPTURE_MS - Date.now()));
    const passTimer = setTimeout(() => pass.abort(), Math.max(0, anchoredAt + HEALTH_WAKE_PASS_MS - Date.now()));
    const current: ActivePass = { wakes: [...batch], captures: [], captureSignal: capture.signal, capturing: true };
    let success = true;
    try {
      if (!(await deps.isAutomaticSyncEnabled())) return;
      active = current;
      for (const wake of batch) startCaptures(current, wake);
      // Wait for every capture, including those a joining wake starts, but never past the capture
      // deadline: a joined capture keeps its own caller's options, and its journal is durable.
      let waited = 0;
      while (waited < current.captures.length) {
        const slice = current.captures.slice(waited);
        waited = current.captures.length;
        const outcome = await Promise.race([Promise.allSettled(slice), whenAborted(capture.signal)]);
        if (outcome === "aborted") {
          success = false;
          break;
        }
        if (outcome.some((result) => result.status === "rejected")) success = false;
      }
      current.capturing = false;
      // Upload even when this pass found nothing new: an earlier wake may have journaled and
      // queued Health events that could not be sent then.
      const uploaded = pass.signal.aborted
        ? "aborted"
        : await Promise.race([deps.uploadHealthEvents(pass.signal), whenAborted(pass.signal)]);
      if (uploaded !== true) success = false;
    } catch {
      success = false;
    } finally {
      current.capturing = false;
      if (active === current) active = null;
      clearTimeout(captureTimer);
      clearTimeout(passTimer);
      await Promise.all(current.wakes.map((wake) =>
        deps.complete(wake.id, success).catch(() => undefined)
      ));
    }
  }

  async function drain() {
    // A wake that arrives once a pass has stopped capturing gets a follow-up pass.
    while (pending.length) {
      const batch = pending;
      pending = [];
      await runPass(batch);
    }
  }

  return {
    receive(input) {
      const wake = { ...input, receivedAt: input.receivedAt ?? Date.now() };
      announceChange(wake);
      if (active?.capturing && !active.captureSignal.aborted) {
        active.wakes.push(wake);
        startCaptures(active, wake);
        return;
      }
      pending.push(wake);
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
    uploadHealthEvents: async (signal) => {
      const result = await (await import("./api")).syncQueue({ eventScope: "health", signal });
      return !result.firstError && !result.stopped && result.remainingCount === 0;
    },
    complete: (id, success) => native.complete(id, success)
  });
  native.addWakeListener((wake) => runner.receive(wake));
  void native.startListening()
    .then((wakes) => {
      for (const wake of wakes) runner.receive(wake);
    })
    .catch(() => undefined);
}
