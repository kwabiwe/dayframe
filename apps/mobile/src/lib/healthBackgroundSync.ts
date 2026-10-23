// Apple Health background sync: iOS wakes Dayframe for new sleep or workout samples (HealthKit
// background delivery) or for a background app refresh, and this module runs one bounded pass per
// wake: capture through the durable journal → queue path, then upload only Health events. It is
// installed when the root layout module is evaluated, so it also runs in a cold background launch
// where no screen ever becomes active. Server reprocess, Dashboard reloads and every other queued
// event stay foreground-owned.
import type { DayframeHealthWake } from "../../modules/dayframe-health-background";
import type { HealthCaptureOptions, HealthImportStatus } from "./health";
import { withJsTask } from "./jsTasks";

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

type CaptureKind = "sleep" | "workout";

type ActivePass = {
  wakes: HealthWake[];
  captureSignal: AbortSignal;
  /** Still capturing: a new wake joins this pass instead of queueing behind it. */
  capturing: boolean;
  failed: boolean;
  /** Per kind, whether a wake still needs a capture that starts after it, and the loop doing it. */
  kinds: Map<CaptureKind, { needed: boolean; loop: Promise<void> | null }>;
};

export function createHealthWakeRunner(deps: HealthWakeDependencies): HealthWakeRunner {
  let pending: HealthWake[] = [];
  let running: Promise<void> | null = null;
  let active: ActivePass | null = null;

  function requestCaptures(pass: ActivePass, wake: HealthWake) {
    for (const kind of wakeKinds(wake)) {
      const state = pass.kinds.get(kind) ?? { needed: false, loop: null };
      pass.kinds.set(kind, state);
      state.needed = true;
      if (state.loop) continue;
      // One capture at a time per kind, each started after the wakes it serves (`fresh`), so a
      // change during a capture is read by the next one inside this pass, never by an unowned one.
      state.loop = (async () => {
        while (state.needed && !pass.captureSignal.aborted) {
          state.needed = false;
          const options: HealthCaptureOptions = {
            observerChange: true,
            fresh: true,
            background: true,
            signal: pass.captureSignal,
            maxPages: HEALTH_WAKE_MAX_PAGES
          };
          try {
            await (kind === "sleep" ? deps.captureSleep(options) : deps.captureWorkouts(options));
          } catch {
            pass.failed = true;
          }
        }
      })().finally(() => {
        state.loop = null;
      });
    }
  }

  function runPass(batch: HealthWake[]) {
    return withJsTask("health-wake", () => runPassNow(batch));
  }

  async function runPassNow(batch: HealthWake[]) {
    const now = Date.now();
    // Native times the wake on a monotonic clock; a wall clock set back since then must never
    // lengthen the budget, so the anchor is at most now.
    const anchoredAt = Math.min(now, ...batch.map((wake) => wake.receivedAt ?? now));
    const capture = new AbortController();
    const pass = new AbortController();
    const captureTimer = setTimeout(() => capture.abort(), Math.max(0, anchoredAt + HEALTH_WAKE_CAPTURE_MS - now));
    const passTimer = setTimeout(() => pass.abort(), Math.max(0, anchoredAt + HEALTH_WAKE_PASS_MS - now));
    const current: ActivePass = {
      wakes: [...batch],
      captureSignal: capture.signal,
      capturing: true,
      failed: false,
      kinds: new Map()
    };
    let success = true;
    try {
      const enabled = await Promise.race([deps.isAutomaticSyncEnabled(), whenAborted(capture.signal)]);
      if (enabled === "aborted") {
        success = false;
        return;
      }
      if (!enabled) return;
      active = current;
      for (const wake of batch) requestCaptures(current, wake);
      // Wait for every kind's captures, including those a joining wake asks for, but never past
      // the capture deadline: a capture cut short keeps its committed pages in the journal.
      for (;;) {
        const loops = [...current.kinds.values()].flatMap((state) => (state.loop ? [state.loop] : []));
        if (!loops.length) break;
        const outcome = await Promise.race([Promise.all(loops), whenAborted(capture.signal)]);
        if (outcome === "aborted") {
          current.failed = true;
          break;
        }
      }
      current.capturing = false;
      if (current.failed) success = false;
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
        requestCaptures(active, wake);
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
  // No wakes while no account is signed in (stability audit 22 Oct 2026, health-4).
  void import("./healthSignOut")
    .then(({ watchSignedOutHealthBackground }) => watchSignedOutHealthBackground(native))
    .catch(() => undefined);
  void native.startListening()
    .then((wakes) => {
      for (const wake of wakes) runner.receive(wake);
    })
    .catch(() => undefined);
}
