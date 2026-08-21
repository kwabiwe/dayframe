export type ConnectivityRecoveryStepName =
  | "timer_stops_ready"
  | "activity_queue"
  | "timer_stops_after_correlation"
  | "review_outbox"
  | "location_intelligence"
  | "bootstrap";

export type ConnectivityRecoveryStepResult =
  | "continue"
  | "transport_failure";

export type ConnectivityRecoveryPassResult =
  | "completed"
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
};

export type LocationConnectivityRecoveryResult = {
  synced: boolean;
  reason?:
    | "v1"
    | "session_unavailable"
    | "no_session"
    | "payload_too_large"
    | "request_failed"
    | "invalid_batch"
    | "replay_failed";
};

export function reviewConnectivityRecoveryStepResult(
  result: ReviewConnectivityRecoveryResult
): ConnectivityRecoveryStepResult {
  return result.reason === "retryable_failure"
    ? "transport_failure"
    : "continue";
}

export function locationConnectivityRecoveryStepResult(
  result: LocationConnectivityRecoveryResult
): ConnectivityRecoveryStepResult {
  return result.reason === "request_failed" || result.reason === "replay_failed"
    ? "transport_failure"
    : "continue";
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
      recordOutcome("application_error");
    }
    if (!input.canContinue()) {
      if (!outcomeRecorded) recordOutcome("interrupted");
      return "interrupted";
    }
    if (!outcomeRecorded) recordOutcome("completed");
  }
  return "completed";
}

export function createConnectivityRecoveryCoordinator(input: {
  canStart: () => boolean;
  runPass: (epoch: number) => Promise<ConnectivityRecoveryPassResult>;
}) {
  let lastHandledReconnectEpoch = 0;
  let reconnectRecoveryInFlight: Promise<void> | null = null;
  let queuedReconnectEpoch = 0;

  const drain = async () => {
    while (
      queuedReconnectEpoch > lastHandledReconnectEpoch &&
      input.canStart()
    ) {
      const epoch = queuedReconnectEpoch;
      queuedReconnectEpoch = 0;
      lastHandledReconnectEpoch = epoch;
      const result = await input.runPass(epoch);
      if (result === "authentication_required") break;
    }
  };

  return {
    ignore(epoch: number) {
      lastHandledReconnectEpoch = Math.max(lastHandledReconnectEpoch, epoch);
      if (queuedReconnectEpoch <= lastHandledReconnectEpoch) {
        queuedReconnectEpoch = 0;
      }
    },
    request(epoch: number) {
      if (
        epoch <= lastHandledReconnectEpoch ||
        epoch <= 0 ||
        !input.canStart()
      ) {
        return reconnectRecoveryInFlight ?? Promise.resolve();
      }
      queuedReconnectEpoch = Math.max(queuedReconnectEpoch, epoch);
      reconnectRecoveryInFlight ??= drain().finally(() => {
        reconnectRecoveryInFlight = null;
      });
      return reconnectRecoveryInFlight;
    },
    snapshot() {
      return {
        inFlight: reconnectRecoveryInFlight !== null,
        lastHandledReconnectEpoch,
        queuedReconnectEpoch
      };
    }
  };
}
