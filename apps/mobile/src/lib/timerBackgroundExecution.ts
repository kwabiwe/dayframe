import type { DayframeBackgroundExecutionExpiration } from
  "../../modules/dayframe-background-execution";

export type TimerBackgroundExecutionEndReason =
  | "success"
  | "failure"
  | "cancelled"
  | "expired"
  | "logout"
  | "account_changed"
  | "teardown";

export type TimerBackgroundExecutionLease = {
  readonly signal: AbortSignal;
  end(reason: TimerBackgroundExecutionEndReason): Promise<void>;
};

export type TimerBackgroundExecutionSnapshot = {
  activeLeaseCount: number;
  revision: number;
};

type NativeExpirationSubscription = { remove(): void } | null;

export type TimerBackgroundExecutionNativeAdapter = {
  addExpirationListener(
    listener: (event: DayframeBackgroundExecutionExpiration) => void
  ): NativeExpirationSubscription;
  begin(name: string): Promise<string | null>;
  end(leaseToken: string, reason: string): Promise<boolean>;
  endAll(reason: string): Promise<number>;
};

type ActiveLease = {
  controller: AbortController;
  finished: boolean;
  generation: number;
  localToken: string;
  nativeToken: string | null;
};

type TimerBackgroundExecutionReservation = Promise<TimerBackgroundExecutionLease>;

export class TimerBackgroundExecutionExpiredError extends Error {
  constructor() {
    super("iOS background execution time expired. The saved timer change will retry.");
    this.name = "TimerBackgroundExecutionExpiredError";
  }
}

export class TimerBackgroundExecutionCancelledError extends Error {
  readonly reason: TimerBackgroundExecutionEndReason;

  constructor(reason: TimerBackgroundExecutionEndReason) {
    super(`Timer background execution ended: ${reason}.`);
    this.name = "TimerBackgroundExecutionCancelledError";
    this.reason = reason;
  }
}

export function createTimerBackgroundExecutionManager(
  native: TimerBackgroundExecutionNativeAdapter
) {
  const active = new Map<string, ActiveLease>();
  const expiredBeforeRegistration = new Set<string>();
  const listeners = new Set<() => void>();
  let revision = 0;
  let lifecycleGeneration = 0;
  let localSequence = 0;
  let currentSnapshot: TimerBackgroundExecutionSnapshot = {
    activeLeaseCount: 0,
    revision: 0
  };
  const expirationSubscription = native.addExpirationListener((event) => {
    for (const nativeToken of event.leaseTokens) {
      const lease = [...active.values()].find((candidate) =>
        candidate.nativeToken === nativeToken
      );
      if (!lease) {
        expiredBeforeRegistration.add(nativeToken);
        continue;
      }
      finishLocally(lease, "expired");
    }
  });

  function snapshot(): TimerBackgroundExecutionSnapshot {
    return currentSnapshot;
  }

  function publish() {
    revision += 1;
    currentSnapshot = { activeLeaseCount: active.size, revision };
    for (const listener of listeners) listener();
  }

  function finishLocally(
    lease: ActiveLease,
    reason: TimerBackgroundExecutionEndReason
  ) {
    if (lease.finished) return false;
    lease.finished = true;
    active.delete(lease.localToken);
    if (reason === "expired") {
      lease.controller.abort(new TimerBackgroundExecutionExpiredError());
    } else if (
      reason === "cancelled" ||
      reason === "logout" ||
      reason === "account_changed" ||
      reason === "teardown"
    ) {
      lease.controller.abort(new TimerBackgroundExecutionCancelledError(reason));
    }
    publish();
    return true;
  }

  async function begin(name: string): Promise<TimerBackgroundExecutionLease> {
    const controller = new AbortController();
    const localToken = `timer-background:${Date.now()}:${++localSequence}`;
    const lease: ActiveLease = {
      controller,
      finished: false,
      generation: lifecycleGeneration,
      localToken,
      nativeToken: null
    };
    active.set(localToken, lease);
    publish();

    const nativeToken = await native.begin(name).catch(() => null);
    if (lease.finished || lease.generation !== lifecycleGeneration) {
      if (nativeToken) {
        await native.end(nativeToken, "cancelled").catch(() => false);
      }
    } else {
      lease.nativeToken = nativeToken;
    }

    if (nativeToken && expiredBeforeRegistration.delete(nativeToken)) {
      finishLocally(lease, "expired");
    }

    return {
      signal: controller.signal,
      async end(reason) {
        if (!finishLocally(lease, reason)) return;
        if (nativeToken) {
          await native.end(nativeToken, reason).catch(() => false);
        }
      }
    };
  }

  async function endAll(reason: TimerBackgroundExecutionEndReason) {
    lifecycleGeneration += 1;
    const leases = [...active.values()];
    for (const lease of leases) finishLocally(lease, reason);
    expiredBeforeRegistration.clear();
    await native.endAll(reason).catch(() => 0);
  }

  return {
    begin,
    endAll,
    snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    waitUntilIdle() {
      if (active.size === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const listener = () => {
          if (active.size > 0) return;
          listeners.delete(listener);
          resolve();
        };
        listeners.add(listener);
      });
    },
    dispose() {
      expirationSubscription?.remove();
      return endAll("teardown");
    }
  };
}

const defaultManager = createTimerBackgroundExecutionManager(createLazyNativeAdapter());
const defaultReservations = new Map<string, TimerBackgroundExecutionReservation>();

export const beginTimerBackgroundExecution = (name: string) =>
  defaultManager.begin(name);

export const endAllTimerBackgroundExecution = (
  reason: Extract<
    TimerBackgroundExecutionEndReason,
    "logout" | "account_changed" | "teardown" | "cancelled"
  >
) => {
  defaultReservations.clear();
  return defaultManager.endAll(reason);
};

export const getTimerBackgroundExecutionSnapshot = () => defaultManager.snapshot();

export const subscribeTimerBackgroundExecution = (listener: () => void) =>
  defaultManager.subscribe(listener);

export const waitForTimerBackgroundExecutionToSettle = () =>
  defaultManager.waitUntilIdle();

/**
 * Reserves the process-wide UIKit task immediately after a durable timer write.
 * The matching drain consumes this lease, so storage/correlation preparation
 * cannot introduce a suspension window between persistence and native begin.
 */
export async function reserveTimerBackgroundExecution(
  key: string,
  name: string
) {
  const existing = defaultReservations.get(key);
  if (existing) {
    await existing;
    return;
  }
  const reservation = beginTimerBackgroundExecution(name);
  defaultReservations.set(key, reservation);
  void reservation.then((lease) => {
    if (lease.signal.aborted && defaultReservations.get(key) === reservation) {
      defaultReservations.delete(key);
      return;
    }
    lease.signal.addEventListener("abort", () => {
      if (defaultReservations.get(key) === reservation) {
        defaultReservations.delete(key);
      }
    }, { once: true });
  });
  await reservation;
}

export function hasTimerBackgroundExecutionReservation(key: string) {
  return defaultReservations.has(key);
}

export async function withTimerBackgroundExecutionReservation<Result>(
  key: string,
  name: string,
  operation: (signal: AbortSignal | undefined) => Promise<Result>,
  options: { beginIfMissing: boolean }
) {
  const reserved = defaultReservations.get(key);
  if (reserved) defaultReservations.delete(key);
  if (!reserved && !options.beginIfMissing) return operation(undefined);
  const lease = await (reserved ?? beginTimerBackgroundExecution(name));
  return runWithTimerBackgroundExecutionLease(lease, operation);
}

export async function withTimerBackgroundExecution<Result>(
  name: string,
  operation: (signal: AbortSignal) => Promise<Result>
) {
  const lease = await beginTimerBackgroundExecution(name);
  return runWithTimerBackgroundExecutionLease(lease, operation);
}

async function runWithTimerBackgroundExecutionLease<Result>(
  lease: TimerBackgroundExecutionLease,
  operation: (signal: AbortSignal) => Promise<Result>
) {
  try {
    if (lease.signal.aborted) throw lease.signal.reason;
    const result = await operation(lease.signal);
    await lease.end("success");
    return result;
  } catch (error) {
    await lease.end(lease.signal.aborted ? "cancelled" : "failure");
    throw error;
  }
}

function createLazyNativeAdapter(): TimerBackgroundExecutionNativeAdapter {
  type NativeModule = typeof import("../../modules/dayframe-background-execution");
  const expirationListeners = new Set<
    (event: DayframeBackgroundExecutionExpiration) => void
  >();
  let module: NativeModule | null = loadNativeModuleSynchronously();
  let nativeExpirationSubscription: { remove(): void } | null = null;

  function loadNativeModuleSynchronously() {
    // React Native defines __DEV__ in both development and release bundles.
    // Node-based behavioral tests do not, so they exercise the same durable
    // queue path with a deliberately unavailable platform assertion.
    if (typeof __DEV__ === "undefined") return null;
    try {
      // Metro resolves this static require into the native Expo module before
      // an immediate post-save call can yield back to the app lifecycle.
      return require("../../modules/dayframe-background-execution") as NativeModule;
    } catch {
      return null;
    }
  }

  const subscribeToNativeExpiration = () => {
    if (!module || nativeExpirationSubscription) return;
    nativeExpirationSubscription = module.addExpirationListener((event) => {
      for (const listener of expirationListeners) listener(event);
    });
  };
  subscribeToNativeExpiration();

  return {
    addExpirationListener(listener) {
      expirationListeners.add(listener);
      subscribeToNativeExpiration();
      return {
        remove() {
          expirationListeners.delete(listener);
          if (expirationListeners.size === 0) {
            nativeExpirationSubscription?.remove();
            nativeExpirationSubscription = null;
          }
        }
      };
    },
    begin(name) {
      return module?.begin(name) ?? Promise.resolve(null);
    },
    async end(leaseToken, reason) {
      return module?.end(leaseToken, reason) ?? false;
    },
    async endAll(reason) {
      return module?.endAll(reason) ?? 0;
    }
  };
}
