export type ConnectivityRecoveryStepName =
  | "timer_stops_ready"
  | "activity_queue"
  | "time_entry_outbox"
  | "timer_stops_after_correlation"
  | "review_outbox"
  | "location_intelligence"
  | "bootstrap";

export type ConnectivityRecoveryStepResult =
  | "continue"
  | "application_failure"
  | "transport_failure";

export type ConnectivityRecoveryPassResult =
  | "completed"
  | "failed"
  | "interrupted"
  | "transport_failure"
  | "authentication_required";

export type ConnectivityRecoveryStepOutcome =
  | "completed"
  | "interrupted"
  | "transport_failure"
  | "authentication_required"
  | "application_error";

export type ConnectivityRecoveryStep = {
  name: ConnectivityRecoveryStepName;
  run: () => Promise<ConnectivityRecoveryStepResult | void>;
};

export type ReviewConnectivityRecoveryResult = {
  reason?: "no_account" | "no_session" | "retryable_failure";
  waitingCount?: number;
  needsAttentionCount?: number;
};

export type LocationConnectivityRecoveryResult = {
  synced: boolean;
  reason?:
    | "v1"
    | "session_unavailable"
    | "no_session"
    | "session_changed"
    | "payload_too_large"
    | "request_failed"
    | "invalid_batch"
    | "replay_failed";
};

export type ConnectivityRecoveryRequest = {
  epoch: number;
  options?: { forcePass?: boolean; queuedWorkArrived?: boolean };
};

export function connectivityRecoveryRequest(input: {
  accountKey: string | null;
  appActive: boolean;
  isOnline: boolean;
  pendingCount: number;
  reconnectEpoch: number;
}): ConnectivityRecoveryRequest | null {
  if (!input.accountKey || !input.appActive || !input.isOnline) return null;
  if (input.reconnectEpoch > 0) return { epoch: input.reconnectEpoch };
  if (input.pendingCount > 0) {
    return { epoch: 0, options: { queuedWorkArrived: true } };
  }
  return null;
}

export function foregroundRecoveryRequest(input: {
  accountKey: string | null;
  isOnline: boolean;
  reconnectEpoch: number;
}): ConnectivityRecoveryRequest | null {
  if (!input.accountKey || !input.isOnline) return null;
  return {
    epoch: input.reconnectEpoch,
    options: { forcePass: true }
  };
}

export function shouldRetryConnectivityRecovery(
  result: ConnectivityRecoveryPassResult,
  pendingCount: number
) {
  return result === "transport_failure" || (
    result !== "authentication_required" &&
    result !== "interrupted" &&
    pendingCount > 0
  );
}

export function reviewConnectivityRecoveryStepResult(
  result: ReviewConnectivityRecoveryResult
): ConnectivityRecoveryStepResult {
  if (result.reason === "retryable_failure") return "transport_failure";
  if (
    result.reason === "no_session" ||
    (result.waitingCount ?? 0) > 0 ||
    (result.needsAttentionCount ?? 0) > 0
  ) {
    return "application_failure";
  }
  return "continue";
}

export function locationConnectivityRecoveryStepResult(
  result: LocationConnectivityRecoveryResult
): ConnectivityRecoveryStepResult {
  if (result.reason === "request_failed" || result.reason === "replay_failed") {
    return "transport_failure";
  }
  if (!result.synced && result.reason !== "v1") return "application_failure";
  return "continue";
}

export function createSharedInFlightOperation<Result>() {
  let inFlight: Promise<Result> | null = null;

  return {
    run(operation: () => Promise<Result>) {
      if (inFlight) return inFlight;
      const shared = Promise.resolve()
        .then(operation)
        .finally(() => {
          if (inFlight === shared) inFlight = null;
        });
      inFlight = shared;
      return shared;
    },
    snapshot() {
      return { inFlight: inFlight !== null };
    }
  };
}

export async function runConnectivityRecoveryPass(input: {
  canContinue: () => boolean;
  isAuthenticationRequired: (error: unknown) => boolean;
  isTransportFailure: (error: unknown) => boolean;
  onAuthenticationRequired: () => void;
  onStepError?: (step: ConnectivityRecoveryStepName, error: unknown) => void;
  onStepOutcome?: (input: {
    step: ConnectivityRecoveryStepName;
    durationMilliseconds: number;
    outcome: ConnectivityRecoveryStepOutcome;
  }) => void;
  steps: ConnectivityRecoveryStep[];
}): Promise<ConnectivityRecoveryPassResult> {
  let hadApplicationFailure = false;
  for (const step of input.steps) {
    if (!input.canContinue()) return "interrupted";
    const startedAt = Date.now();
    let outcomeRecorded = false;
    const recordOutcome = (outcome: ConnectivityRecoveryStepOutcome) => {
      outcomeRecorded = true;
      input.onStepOutcome?.({
        step: step.name,
        durationMilliseconds: Math.max(0, Date.now() - startedAt),
        outcome
      });
    };
    try {
      const result = await step.run();
      if (result === "transport_failure") {
        recordOutcome("transport_failure");
        return "transport_failure";
      }
      if (result === "application_failure") {
        hadApplicationFailure = true;
        recordOutcome("application_error");
      }
    } catch (error) {
      if (input.isAuthenticationRequired(error)) {
        recordOutcome("authentication_required");
        input.onAuthenticationRequired();
        return "authentication_required";
      }
      if (input.isTransportFailure(error)) {
        recordOutcome("transport_failure");
        return "transport_failure";
      }
      input.onStepError?.(step.name, error);
      hadApplicationFailure = true;
      recordOutcome("application_error");
    }
    if (!input.canContinue()) {
      if (!outcomeRecorded) recordOutcome("interrupted");
      return "interrupted";
    }
    if (!outcomeRecorded) recordOutcome("completed");
  }
  return hadApplicationFailure ? "failed" : "completed";
}

export function createConnectivityRecoveryCoordinator(input: {
  canStart: () => boolean;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  hasPendingWork?: () => boolean;
  now?: () => number;
  onPassFinished?: (input: {
    epoch: number;
    hasPendingPass: boolean;
    result: ConnectivityRecoveryPassResult;
  }) => void;
  onPassStarted?: (epoch: number) => void;
  onRetryScheduled?: (input: {
    attempt: number;
    epoch: number;
    retryAt: number;
  }) => void;
  random?: () => number;
  runPass: (epoch: number) => Promise<ConnectivityRecoveryPassResult>;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  shouldRetry?: (result: ConnectivityRecoveryPassResult) => boolean;
}) {
  let lastHandledReconnectEpoch = 0;
  let reconnectRecoveryInFlight: Promise<void> | null = null;
  let queuedReconnectEpoch = 0;
  let queuedWorkRevision = 0;
  let handledWorkRevision = 0;
  let interruptedReconnectEpoch = 0;
  let ownershipRevision = 0;
  let retryAttempt = 0;
  let retryAt: number | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = input.clearTimer ?? clearTimeout;
  const now = input.now ?? Date.now;
  const random = input.random ?? Math.random;
  const setTimer = input.setTimer ?? setTimeout;

  const clearScheduledRetry = () => {
    if (retryTimer) clearTimer(retryTimer);
    retryTimer = null;
    retryAt = null;
  };

  const scheduleRetry = (epoch: number) => {
    clearScheduledRetry();
    retryAttempt += 1;
    const baseMilliseconds = [1_000, 2_500, 5_000, 15_000, 30_000, 60_000][
      Math.min(retryAttempt, 6) - 1
    ];
    const jitter = 0.8 + Math.max(0, Math.min(random(), 1)) * 0.4;
    const delay = Math.round(baseMilliseconds * jitter);
    retryAt = now() + delay;
    input.onRetryScheduled?.({ attempt: retryAttempt, epoch, retryAt });
    retryTimer = setTimer(() => {
      retryTimer = null;
      retryAt = null;
      void request(epoch, { forcePass: true });
    }, delay) as ReturnType<typeof setTimeout>;
  };

  const drain = async () => {
    while (
      (
        queuedReconnectEpoch > lastHandledReconnectEpoch ||
        queuedWorkRevision > handledWorkRevision ||
        interruptedReconnectEpoch > 0
      ) &&
      input.canStart()
    ) {
      const epoch = Math.max(
        queuedReconnectEpoch,
        lastHandledReconnectEpoch,
        interruptedReconnectEpoch
      );
      queuedReconnectEpoch = 0;
      interruptedReconnectEpoch = 0;
      lastHandledReconnectEpoch = epoch;
      handledWorkRevision = queuedWorkRevision;
      const passOwnershipRevision = ownershipRevision;
      input.onPassStarted?.(epoch);
      const result = await input.runPass(epoch);
      if (
        result === "interrupted" &&
        passOwnershipRevision === ownershipRevision
      ) {
        interruptedReconnectEpoch = epoch;
      }
      const hasPendingPass =
        queuedReconnectEpoch > lastHandledReconnectEpoch ||
        queuedWorkRevision > handledWorkRevision ||
        interruptedReconnectEpoch > 0;
      input.onPassFinished?.({ epoch, hasPendingPass, result });
      const shouldRetry = input.shouldRetry?.(result) ?? result === "transport_failure";
      const hasPendingWork = input.hasPendingWork?.() ?? shouldRetry;
      if (!hasPendingPass && shouldRetry && input.canStart()) {
        scheduleRetry(epoch);
      } else if (!hasPendingPass && !shouldRetry && !hasPendingWork) {
        retryAttempt = 0;
      }
      if (result === "authentication_required") break;
      if (result === "interrupted" && !input.canStart()) break;
    }
  };

  const request = (
    epoch: number,
    options: { forcePass?: boolean; queuedWorkArrived?: boolean } = {}
  ) => {
    const queuedWorkArrived = options.queuedWorkArrived === true;
    const passRequested = queuedWorkArrived || options.forcePass === true;
    if (epoch > lastHandledReconnectEpoch || queuedWorkArrived) {
      clearScheduledRetry();
      retryAttempt = 0;
    }
    if (
      (
        !passRequested &&
        epoch <= lastHandledReconnectEpoch &&
        interruptedReconnectEpoch === 0
      ) ||
      epoch < 0 ||
      (epoch === 0 && !passRequested) ||
      !input.canStart()
    ) {
      return reconnectRecoveryInFlight ?? Promise.resolve();
    }
    if (passRequested) queuedWorkRevision += 1;
    queuedReconnectEpoch = Math.max(queuedReconnectEpoch, epoch);
    reconnectRecoveryInFlight ??= drain().finally(() => {
      reconnectRecoveryInFlight = null;
    });
    return reconnectRecoveryInFlight;
  };

  return {
    dispose() {
      clearScheduledRetry();
      ownershipRevision += 1;
    },
    ignore(epoch: number) {
      clearScheduledRetry();
      retryAttempt = 0;
      ownershipRevision += 1;
      lastHandledReconnectEpoch = Math.max(lastHandledReconnectEpoch, epoch);
      handledWorkRevision = queuedWorkRevision;
      interruptedReconnectEpoch = 0;
      if (queuedReconnectEpoch <= lastHandledReconnectEpoch) {
        queuedReconnectEpoch = 0;
      }
    },
    pause() {
      clearScheduledRetry();
    },
    request,
    snapshot() {
      return {
        inFlight: reconnectRecoveryInFlight !== null,
        interruptedReconnectEpoch,
        lastHandledReconnectEpoch,
        queuedReconnectEpoch,
        queuedWorkPending: queuedWorkRevision > handledWorkRevision,
        retryAttempt,
        retryAt
      };
    }
  };
}
