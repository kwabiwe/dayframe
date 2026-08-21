export const CONNECTIVITY_OFFLINE_CONFIRM_MS = 300;
export const CONNECTIVITY_ONLINE_CONFIRM_MS = 600;
export const CONNECTIVITY_RECONNECTED_NOTICE_MS = 2_500;
export const CONNECTIVITY_REFRESH_COOLDOWN_MS = 500;

export type ConnectivityStatus = "unknown" | "online" | "offline";
export type ConnectivityTransitionSource = "initial" | "native" | "http";
export type ConnectivityCandidate = "online" | "offline" | "ambiguous";

export type ConnectivitySnapshot = {
  status: ConnectivityStatus;
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  connectionType: string | null;
  changedAt: number | null;
  reconnectEpoch: number;
  reconnectNoticeId: number | null;
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
  reconnectNoticeSequence: number;
};

export type ConnectivityBannerViewModel = {
  accessibilityLabel: string;
  body: string | null;
  id: string;
  title: string;
  variant: "offline" | "reconnected";
};

export function createConnectivityMachineState(): ConnectivityMachineState {
  return {
    status: "unknown",
    isConnected: null,
    isInternetReachable: null,
    connectionType: null,
    changedAt: null,
    reconnectEpoch: 0,
    reconnectNoticeId: null,
    source: "initial",
    candidateRevision: 0,
    requestGeneration: 0,
    reconnectNoticeSequence: 0
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
    reconnectNoticeId: state.reconnectNoticeId,
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

export function dismissConnectivityReconnectNotice(
  state: ConnectivityMachineState,
  noticeId: number
) {
  if (state.reconnectNoticeId !== noticeId) return state;
  return { ...state, reconnectNoticeId: null };
}

export function connectivityBannerViewModel(
  snapshot: ConnectivitySnapshot
): ConnectivityBannerViewModel | null {
  if (snapshot.status === "offline") {
    return {
      accessibilityLabel:
        "You’re offline. Changes will sync when you’re back online.",
      body: "Changes will sync when you’re back online",
      id: `offline-${snapshot.changedAt ?? 0}`,
      title: "You’re offline",
      variant: "offline"
    };
  }
  if (snapshot.status === "online" && snapshot.reconnectNoticeId !== null) {
    return {
      accessibilityLabel: "Back online. Checking saved changes.",
      body: "Checking saved changes",
      id: `reconnected-${snapshot.reconnectNoticeId}`,
      title: "Back online",
      variant: "reconnected"
    };
  }
  return null;
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
    left.reconnectNoticeId === right.reconnectNoticeId &&
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
      source,
      reconnectNoticeId: status === "offline" ? null : state.reconnectNoticeId
    };
  }
  if (state.status === "offline" && status === "online") {
    const reconnectNoticeId = state.reconnectNoticeSequence + 1;
    return {
      ...state,
      status,
      changedAt,
      reconnectEpoch: state.reconnectEpoch + 1,
      reconnectNoticeId,
      reconnectNoticeSequence: reconnectNoticeId,
      source
    };
  }
  return {
    ...state,
    status,
    changedAt,
    reconnectNoticeId: null,
    requestGeneration:
      status === "offline"
        ? state.requestGeneration + 1
        : state.requestGeneration,
    source
  };
}
