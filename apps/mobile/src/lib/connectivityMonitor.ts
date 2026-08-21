import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { installConnectivityEvidenceReporter } from "./connectivityEvidence";
import {
  CONNECTIVITY_OFFLINE_CONFIRM_MS,
  CONNECTIVITY_ONLINE_CONFIRM_MS,
  CONNECTIVITY_REFRESH_COOLDOWN_MS,
  CONNECTIVITY_SUCCESS_NOTICE_MS,
  beginConnectivityRecovery,
  cancelConnectivityRecovery,
  confirmHttpConnectivity,
  confirmNativeConnectivity,
  connectivitySnapshot,
  connectivitySnapshotsEqual,
  createConnectivityMachineState,
  dismissConnectivityRecoverySuccess,
  finishConnectivityRecovery,
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
  const result = confirmHttpConnectivity({
    completedAt: input.completedAt ?? Date.now(),
    requestGeneration: input.requestGeneration,
    state: machineState
  });
  if (!result.accepted) return;
  clearCandidateTimer();
  applyMachineState(result.state);
}

export function reportHttpTransportFailure() {
  const now = Date.now();
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
  listeners.clear();
}

function startNativeMonitor() {
  const lifecycle = ++monitorLifecycle;
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
  clearCandidateTimer();
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
}

function commitPendingCandidate() {
  candidateTimer = null;
  const pending = pendingCandidate;
  pendingCandidate = null;
  if (!pending || monitorReferenceCount === 0) return;
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

function clearCandidateTimer() {
  if (candidateTimer) clearTimeout(candidateTimer);
  candidateTimer = null;
  pendingCandidate = null;
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
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  console.debug("Connectivity monitor refresh", {
    monitorRefreshReason: reason
  });
}

function recordConnectivityTransition(
  previous: ConnectivitySnapshot,
  next: ConnectivitySnapshot
) {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  console.debug("Connectivity transition", {
    previousConnectivityStatus: previous.status,
    nextConnectivityStatus: next.status,
    transitionSource: next.source,
    reconnectEpoch: next.reconnectEpoch
  });
}
