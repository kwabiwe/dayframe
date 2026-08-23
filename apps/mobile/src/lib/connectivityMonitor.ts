import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { IS_DAYFRAME_STAGING } from "./config";
import { installConnectivityEvidenceReporter } from "./connectivityEvidence";
import {
  CONNECTIVITY_OFFLINE_CONFIRM_MS,
  CONNECTIVITY_ONLINE_CONFIRM_MS,
  CONNECTIVITY_FAILURE_THRESHOLD,
  CONNECTIVITY_FAILURE_WINDOW_MS,
  CONNECTIVITY_REFRESH_COOLDOWN_MS,
  CONNECTIVITY_SUCCESS_NOTICE_MS,
  beginConnectivityRecovery,
  cancelConnectivityRecovery,
  confirmHttpConnectivity,
  confirmHttpConnectivityFailure,
  confirmNativeConnectivity,
  connectivitySnapshot,
  connectivitySnapshotsEqual,
  createConnectivityMachineState,
  dismissConnectivityRecoverySuccess,
  finishConnectivityRecovery,
  isConnectivityRequestGenerationCurrent,
  observeNativeConnectivity,
  rawConnectivityObservationsEqual,
  type ConnectivityCandidate,
  type ConnectivityMachineState,
  type ConnectivitySnapshot,
  type RawConnectivityObservation
} from "./connectivityState";

type Listener = () => void;
type ConnectivityMonitorRefreshReason =
  | "foreground"
  | "native_event"
  | "transport_failure";
type PendingCandidate = {
  candidate: Exclude<ConnectivityCandidate, "ambiguous">;
  candidateRevision: number;
};

let machineState = createConnectivityMachineState();
let publicSnapshot = connectivitySnapshot(machineState);
let monitorReferenceCount = 0;
let monitorLifecycle = 0;
let nativeUnsubscribe: (() => void) | null = null;
let lastRawObservation: RawConnectivityObservation | null = null;
let pendingCandidate: PendingCandidate | null = null;
let candidateTimer: ReturnType<typeof setTimeout> | null = null;
let recoverySuccessTimer: ReturnType<typeof setTimeout> | null = null;
let refreshPromise: Promise<ConnectivitySnapshot> | null = null;
let lastTransportRefreshAt = Number.NEGATIVE_INFINITY;
let recentHttpFailures: number[] = [];
const listeners = new Set<Listener>();

export function startConnectivityMonitor() {
  monitorReferenceCount += 1;
  if (monitorReferenceCount === 1) startNativeMonitor();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    monitorReferenceCount = Math.max(0, monitorReferenceCount - 1);
    if (monitorReferenceCount === 0) stopNativeMonitor();
  };
}

export function subscribeConnectivity(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getConnectivitySnapshot() {
  return publicSnapshot;
}

export function refreshConnectivity(
  reason: Exclude<ConnectivityMonitorRefreshReason, "native_event"> = "foreground"
): Promise<ConnectivitySnapshot> {
  if (monitorReferenceCount === 0) return Promise.resolve(publicSnapshot);
  if (refreshPromise) return refreshPromise;
  recordConnectivityRefresh(reason);
  const lifecycle = monitorLifecycle;
  refreshPromise = NetInfo.refresh()
    .then((state) => {
      if (lifecycle === monitorLifecycle && monitorReferenceCount > 0) {
        handleNativeState(state, "native");
      }
      return publicSnapshot;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

export function connectivityRequestGeneration() {
  return machineState.requestGeneration;
}

export function reportHttpTransportResponse(input: {
  requestGeneration: number;
  completedAt?: number;
}) {
  const completedAt = input.completedAt ?? Date.now();
  const result = confirmHttpConnectivity({
    completedAt,
    requestGeneration: input.requestGeneration,
    state: machineState
  });
  if (!result.accepted) return;
  recentHttpFailures = [];
  recordHttpSuccess(completedAt);
  clearCandidateTimer("http_success");
  applyMachineState(result.state);
}

export function reportHttpTransportFailure(input: {
  kind?: "deadline" | "transport";
  occurredAt?: number;
  requestGeneration: number;
}) {
  if (!isConnectivityRequestGenerationCurrent({
    requestGeneration: input.requestGeneration,
    state: machineState
  })) {
    return;
  }
  const now = input.occurredAt ?? Date.now();
  recentHttpFailures = recentHttpFailures
    .filter((occurredAt) => now - occurredAt <= CONNECTIVITY_FAILURE_WINDOW_MS);
  recentHttpFailures.push(now);
  recordHttpEvidence(input.kind ?? "transport", now, recentHttpFailures.length);
  if (recentHttpFailures.length >= CONNECTIVITY_FAILURE_THRESHOLD) {
    const result = confirmHttpConnectivityFailure({
      failedAt: now,
      requestGeneration: input.requestGeneration,
      state: machineState
    });
    clearCandidateTimer("negative_http_evidence");
    applyMachineState(result.state);
  }
  if (now - lastTransportRefreshAt < CONNECTIVITY_REFRESH_COOLDOWN_MS) return;
  lastTransportRefreshAt = now;
  void refreshConnectivity("transport_failure").catch(() => undefined);
}

installConnectivityEvidenceReporter({
  requestGeneration: connectivityRequestGeneration,
  reportFailure: reportHttpTransportFailure,
  reportResponse: reportHttpTransportResponse
});

export function reportConnectivityRecoveryStarted(epoch: number) {
  clearRecoverySuccessTimer();
  applyMachineState(beginConnectivityRecovery(machineState, epoch));
}

export function reportConnectivityRecoveryFinished(input: {
  epoch: number;
  successful: boolean;
}) {
  applyMachineState(finishConnectivityRecovery(
    machineState,
    input.epoch,
    input.successful ? "success" : "failure"
  ));
  if (
    input.successful &&
    machineState.recoveryEpoch === input.epoch &&
    machineState.recoveryStatus === "success"
  ) {
    scheduleRecoverySuccessDismissal(input.epoch);
  }
}

export function reportConnectivityRecoveryCancelled(epoch: number) {
  clearRecoverySuccessTimer();
  applyMachineState(cancelConnectivityRecovery(machineState, epoch));
}

export function __resetConnectivityMonitorForTests() {
  monitorReferenceCount = 0;
  stopNativeMonitor();
  machineState = createConnectivityMachineState();
  publicSnapshot = connectivitySnapshot(machineState);
  lastRawObservation = null;
  refreshPromise = null;
  lastTransportRefreshAt = Number.NEGATIVE_INFINITY;
  recentHttpFailures = [];
  listeners.clear();
}

function startNativeMonitor() {
  const lifecycle = ++monitorLifecycle;
  NetInfo.configure({
    reachabilityShortTimeout: 2_000,
    reachabilityLongTimeout: 5_000,
    reachabilityRequestTimeout: 3_000
  });
  nativeUnsubscribe = NetInfo.addEventListener((state) => {
    if (lifecycle !== monitorLifecycle || monitorReferenceCount === 0) return;
    handleNativeState(state, "native");
  });
  void NetInfo["fetch"]()
    .then((state) => {
      if (lifecycle !== monitorLifecycle || monitorReferenceCount === 0) return;
      handleNativeState(state, "initial");
    })
    .catch(() => undefined);
}

function stopNativeMonitor() {
  monitorLifecycle += 1;
  nativeUnsubscribe?.();
  nativeUnsubscribe = null;
  clearCandidateTimer("native_observation_replaced");
  clearRecoverySuccessTimer();
  lastRawObservation = null;
  refreshPromise = null;
  if (machineState.recoveryStatus !== "idle") {
    machineState = {
      ...machineState,
      recoveryEpoch: null,
      recoveryStatus: "idle"
    };
    publicSnapshot = connectivitySnapshot(machineState);
  }
}

function handleNativeState(
  state: NetInfoState,
  source: "initial" | "native"
) {
  if (source === "native") recordConnectivityRefresh("native_event");
  const observation = rawObservation(state);
  if (rawConnectivityObservationsEqual(lastRawObservation, observation)) return;
  lastRawObservation = observation;
  const observed = observeNativeConnectivity(machineState, observation, source);
  recordRawNetInfo(observation, source);
  if (observed.candidate === "online") recentHttpFailures = [];
  applyMachineState(observed.state);
  clearCandidateTimer();
  if (observed.candidate === "ambiguous") return;
  if (observed.candidate === machineState.status) return;

  pendingCandidate = {
    candidate: observed.candidate,
    candidateRevision: observed.candidateRevision
  };
  candidateTimer = setTimeout(
    commitPendingCandidate,
    observed.candidate === "offline"
      ? CONNECTIVITY_OFFLINE_CONFIRM_MS
      : CONNECTIVITY_ONLINE_CONFIRM_MS
  );
  recordConnectivityDebounce("start", {
    candidate: observed.candidate,
    candidateRevision: observed.candidateRevision,
    delayMilliseconds: observed.candidate === "offline"
      ? CONNECTIVITY_OFFLINE_CONFIRM_MS
      : CONNECTIVITY_ONLINE_CONFIRM_MS
  });
}

function commitPendingCandidate() {
  candidateTimer = null;
  const pending = pendingCandidate;
  pendingCandidate = null;
  if (!pending || monitorReferenceCount === 0) return;
  recordConnectivityDebounce("commit", {
    candidate: pending.candidate,
    candidateRevision: pending.candidateRevision
  });
  applyMachineState(confirmNativeConnectivity({
    candidate: pending.candidate,
    candidateRevision: pending.candidateRevision,
    confirmedAt: Date.now(),
    state: machineState
  }));
}

function applyMachineState(nextState: ConnectivityMachineState) {
  const previousSnapshot = publicSnapshot;
  machineState = nextState;
  const nextSnapshot = connectivitySnapshot(nextState);
  if (nextSnapshot.status === "offline") clearRecoverySuccessTimer();
  if (connectivitySnapshotsEqual(previousSnapshot, nextSnapshot)) return;
  if (previousSnapshot.status !== nextSnapshot.status) {
    recordConnectivityTransition(previousSnapshot, nextSnapshot);
  }
  publicSnapshot = nextSnapshot;
  for (const listener of listeners) listener();
}

function scheduleRecoverySuccessDismissal(epoch: number) {
  clearRecoverySuccessTimer();
  recoverySuccessTimer = setTimeout(() => {
    recoverySuccessTimer = null;
    applyMachineState(dismissConnectivityRecoverySuccess(machineState, epoch));
  }, CONNECTIVITY_SUCCESS_NOTICE_MS);
}

function clearCandidateTimer(reason = "cancelled") {
  const cancelledCandidate = candidateTimer ? pendingCandidate : null;
  if (candidateTimer) clearTimeout(candidateTimer);
  candidateTimer = null;
  pendingCandidate = null;
  if (cancelledCandidate) {
    recordConnectivityDebounce("cancel", {
      candidate: cancelledCandidate.candidate,
      candidateRevision: cancelledCandidate.candidateRevision,
      reason
    });
  }
}

function clearRecoverySuccessTimer() {
  if (recoverySuccessTimer) clearTimeout(recoverySuccessTimer);
  recoverySuccessTimer = null;
}

function rawObservation(state: NetInfoState): RawConnectivityObservation {
  return {
    isConnected: state.isConnected,
    isInternetReachable: state.isInternetReachable,
    connectionType: state.type ? String(state.type) : null
  };
}

function recordConnectivityRefresh(reason: ConnectivityMonitorRefreshReason) {
  if (!shouldRecordConnectivityDiagnostics()) return;
  console.debug("Connectivity monitor refresh", {
    timestamp: new Date().toISOString(),
    monitorRefreshReason: reason
  });
}

function recordConnectivityTransition(
  previous: ConnectivitySnapshot,
  next: ConnectivitySnapshot
) {
  if (!shouldRecordConnectivityDiagnostics()) return;
  console.debug("Connectivity transition", {
    timestamp: new Date().toISOString(),
    previousConnectivityStatus: previous.status,
    nextConnectivityStatus: next.status,
    transitionSource: next.source,
    reconnectEpoch: next.reconnectEpoch
  });
}

function recordRawNetInfo(
  observation: RawConnectivityObservation,
  source: "initial" | "native"
) {
  if (!shouldRecordConnectivityDiagnostics()) return;
  console.debug("Connectivity NetInfo observation", {
    timestamp: new Date().toISOString(),
    observationSource: source,
    isConnected: observation.isConnected,
    isInternetReachable: observation.isInternetReachable,
    connectionType: observation.connectionType
  });
}

function recordHttpEvidence(
  kind: "deadline" | "transport",
  occurredAt: number,
  recentFailureCount: number
) {
  if (!shouldRecordConnectivityDiagnostics()) return;
  console.debug("Connectivity HTTP evidence", {
    timestamp: new Date(occurredAt).toISOString(),
    evidenceKind: kind,
    recentFailureCount
  });
}

function recordHttpSuccess(completedAt: number) {
  if (!shouldRecordConnectivityDiagnostics()) return;
  console.debug("Connectivity HTTP evidence", {
    timestamp: new Date(completedAt).toISOString(),
    evidenceKind: "success",
    recentFailureCount: 0
  });
}

function recordConnectivityDebounce(
  phase: "start" | "cancel" | "commit",
  details: Record<string, unknown>
) {
  if (!shouldRecordConnectivityDiagnostics()) return;
  console.debug("Connectivity debounce", {
    timestamp: new Date().toISOString(),
    debouncePhase: phase,
    ...details
  });
}

function shouldRecordConnectivityDiagnostics() {
  return (typeof __DEV__ !== "undefined" && __DEV__) || IS_DAYFRAME_STAGING;
}
