export const CONNECTIVITY_OFFLINE_CONFIRM_MS = 300;
export const CONNECTIVITY_ONLINE_CONFIRM_MS = 400;
export const CONNECTIVITY_SUCCESS_NOTICE_MS = 2_000;
export const CONNECTIVITY_REFRESH_COOLDOWN_MS = 500;

export type ConnectivityStatus = "unknown" | "online" | "offline";
export type ConnectivityRecoveryStatus = "idle" | "syncing" | "success" | "failure";
export type ConnectivityTransitionSource = "initial" | "native" | "http";
export type ConnectivityCandidate = "online" | "offline" | "ambiguous";

export type ConnectivitySnapshot = {
  status: ConnectivityStatus;
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  connectionType: string | null;
  changedAt: number | null;
  reconnectEpoch: number;
  recoveryEpoch: number | null;
  recoveryStatus: ConnectivityRecoveryStatus;
  source: ConnectivityTransitionSource;
};

export type RawConnectivityObservation = {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  connectionType: string | null;
};

export type ConnectivityMachineState = ConnectivitySnapshot & {
  candidateRevision: number;
  requestGeneration: number;
};

export type ConnectivityStatusViewModel = {
  accessibilityLabel: string;
  id: string;
  text: string;
  variant: "offline" | "syncing" | "success" | "failure";
};

export function createConnectivityMachineState(): ConnectivityMachineState {
  return {
    status: "unknown",
    isConnected: null,
    isInternetReachable: null,
    connectionType: null,
    changedAt: null,
    reconnectEpoch: 0,
    recoveryEpoch: null,
    recoveryStatus: "idle",
    source: "initial",
    candidateRevision: 0,
    requestGeneration: 0
  };
}

export function connectivitySnapshot(
  state: ConnectivityMachineState
): ConnectivitySnapshot {
  return {
    status: state.status,
    isConnected: state.isConnected,
    isInternetReachable: state.isInternetReachable,
    connectionType: state.connectionType,
    changedAt: state.changedAt,
    reconnectEpoch: state.reconnectEpoch,
    recoveryEpoch: state.recoveryEpoch,
    recoveryStatus: state.recoveryStatus,
    source: state.source
  };
}

export function classifyConnectivityCandidate(
  observation: RawConnectivityObservation
): ConnectivityCandidate {
  if (
    observation.isConnected === false ||
    observation.isInternetReachable === false ||
    observation.connectionType === "none"
  ) {
    return "offline";
  }
  if (
    observation.isConnected === true ||
    observation.isInternetReachable === true
  ) {
    return "online";
  }
  return "ambiguous";
}

export function observeNativeConnectivity(
  state: ConnectivityMachineState,
  observation: RawConnectivityObservation,
  source: Extract<ConnectivityTransitionSource, "initial" | "native">
) {
  const candidate = classifyConnectivityCandidate(observation);
  const candidateRevision = state.candidateRevision + 1;
  return {
    candidate,
    candidateRevision,
    state: {
      ...state,
      ...observation,
      source,
      candidateRevision
    }
  };
}

export function confirmNativeConnectivity(input: {
  candidate: Exclude<ConnectivityCandidate, "ambiguous">;
  candidateRevision: number;
  confirmedAt: number;
  state: ConnectivityMachineState;
}) {
  if (input.candidateRevision !== input.state.candidateRevision) {
    return input.state;
  }
  return commitConnectivityStatus(
    input.state,
    input.candidate,
    input.confirmedAt,
    input.state.source
  );
}

export function confirmHttpConnectivity(input: {
  completedAt: number;
  requestGeneration: number;
  state: ConnectivityMachineState;
}) {
  if (input.requestGeneration < input.state.requestGeneration) {
    return { accepted: false, state: input.state };
  }
  return {
    accepted: true,
    state: commitConnectivityStatus(
      input.state,
      "online",
      input.completedAt,
      "http"
    )
  };
}

export function beginConnectivityRecovery(
  state: ConnectivityMachineState,
  epoch: number
) {
  if (state.status !== "online" || state.reconnectEpoch !== epoch || epoch <= 0) {
    return state;
  }
  return {
    ...state,
    recoveryEpoch: epoch,
    recoveryStatus: "syncing" as const
  };
}

export function finishConnectivityRecovery(
  state: ConnectivityMachineState,
  epoch: number,
  outcome: Extract<ConnectivityRecoveryStatus, "success" | "failure">
) {
  if (
    state.status !== "online" ||
    state.reconnectEpoch !== epoch ||
    state.recoveryEpoch !== epoch
  ) {
    return state;
  }
  return { ...state, recoveryStatus: outcome };
}

export function dismissConnectivityRecoverySuccess(
  state: ConnectivityMachineState,
  epoch: number
) {
  if (
    state.status !== "online" ||
    state.recoveryEpoch !== epoch ||
    state.recoveryStatus !== "success"
  ) {
    return state;
  }
  return { ...state, recoveryEpoch: null, recoveryStatus: "idle" as const };
}

export function cancelConnectivityRecovery(
  state: ConnectivityMachineState,
  epoch: number
) {
  if (state.recoveryEpoch !== epoch) return state;
  return { ...state, recoveryEpoch: null, recoveryStatus: "idle" as const };
}

export function connectivityStatusViewModel(
  snapshot: ConnectivitySnapshot
): ConnectivityStatusViewModel | null {
  if (snapshot.status === "offline") {
    return {
      accessibilityLabel:
        "Offline — changes will sync later",
      id: `offline-${snapshot.changedAt ?? 0}`,
      text: "Offline — changes will sync later",
      variant: "offline"
    };
  }
  if (snapshot.status !== "online" || snapshot.recoveryStatus === "idle") {
    return null;
  }
  if (snapshot.recoveryStatus === "syncing") {
    return {
      accessibilityLabel: "Back online, syncing…",
      id: `recovery-${snapshot.recoveryEpoch ?? 0}`,
      text: "Back online, syncing…",
      variant: "syncing"
    };
  }
  if (snapshot.recoveryStatus === "success") {
    return {
      accessibilityLabel: "All changes synced",
      id: `recovery-${snapshot.recoveryEpoch ?? 0}`,
      text: "All changes synced",
      variant: "success"
    };
  }
  return {
    accessibilityLabel: "Some changes haven’t synced",
    id: `recovery-${snapshot.recoveryEpoch ?? 0}`,
    text: "Some changes haven’t synced",
    variant: "failure"
  };
}

export function connectivitySnapshotsEqual(
  left: ConnectivitySnapshot,
  right: ConnectivitySnapshot
) {
  return left.status === right.status &&
    left.isConnected === right.isConnected &&
    left.isInternetReachable === right.isInternetReachable &&
    left.connectionType === right.connectionType &&
    left.changedAt === right.changedAt &&
    left.reconnectEpoch === right.reconnectEpoch &&
    left.recoveryEpoch === right.recoveryEpoch &&
    left.recoveryStatus === right.recoveryStatus &&
    left.source === right.source;
}

export function rawConnectivityObservationsEqual(
  left: RawConnectivityObservation | null,
  right: RawConnectivityObservation
) {
  return left?.isConnected === right.isConnected &&
    left?.isInternetReachable === right.isInternetReachable &&
    left?.connectionType === right.connectionType;
}

function commitConnectivityStatus(
  state: ConnectivityMachineState,
  status: Exclude<ConnectivityStatus, "unknown">,
  changedAt: number,
  source: ConnectivityTransitionSource
): ConnectivityMachineState {
  if (state.status === status) {
    return {
      ...state,
      source
    };
  }
  if (state.status === "offline" && status === "online") {
    return {
      ...state,
      status,
      changedAt,
      reconnectEpoch: state.reconnectEpoch + 1,
      recoveryEpoch: null,
      recoveryStatus: "idle",
      source
    };
  }
  return {
    ...state,
    status,
    changedAt,
    recoveryEpoch: null,
    recoveryStatus: "idle",
    requestGeneration:
      status === "offline"
        ? state.requestGeneration + 1
        : state.requestGeneration,
    source
  };
}
