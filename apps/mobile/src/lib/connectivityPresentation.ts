import { CONNECTIVITY_SUCCESS_NOTICE_MS, type ConnectivityStatus } from "./connectivityState";

export type ConnectivityStatusVariant = "offline" | "syncing" | "synced" | "attention";

export type ConnectivityStatusViewModel = {
  accessibilityLabel: string;
  id: string;
  isActionable: boolean;
  variant: ConnectivityStatusVariant;
};

export function connectivityStatusColorRole(_variant: ConnectivityStatusVariant) {
  return "textSecondary" as const;
}

export type ConnectivityPresentationState = {
  accountKey: string | null;
  completionSequence: number;
  onlineUntil: number | null;
  previousPendingCount: number;
};

export function createConnectivityPresentationState(): ConnectivityPresentationState {
  return {
    accountKey: null,
    completionSequence: 0,
    onlineUntil: null,
    previousPendingCount: 0
  };
}

export function updateConnectivityPresentation(input: {
  accountKey: string | null;
  attentionCount: number;
  now: number;
  pendingCount: number;
  state: ConnectivityPresentationState;
  status: ConnectivityStatus;
}) {
  const attentionCount = Math.max(0, Math.trunc(input.attentionCount));
  const pendingCount = Math.max(0, Math.trunc(input.pendingCount));
  let state = input.state;
  if (state.accountKey !== input.accountKey) {
    state = {
      ...state,
      accountKey: input.accountKey,
      onlineUntil: null,
      previousPendingCount: pendingCount
    };
  }

  if (pendingCount > 0) {
    if (state.previousPendingCount !== pendingCount || state.onlineUntil !== null) {
      state = {
        ...state,
        onlineUntil: null,
        previousPendingCount: pendingCount
      };
    }
  } else if (state.previousPendingCount > 0) {
    state = {
      ...state,
      completionSequence: state.completionSequence + 1,
      onlineUntil:
        input.status === "online" && attentionCount === 0
          ? input.now + CONNECTIVITY_SUCCESS_NOTICE_MS
          : null,
      previousPendingCount: 0
    };
  } else if (
    state.onlineUntil !== null &&
    (state.onlineUntil <= input.now || attentionCount > 0)
  ) {
    state = { ...state, onlineUntil: null };
  }

  return {
    state,
    viewModel: connectivityStatusViewModel({
      attentionCount,
      completionSequence: state.completionSequence,
      now: input.now,
      onlineUntil: state.onlineUntil,
      pendingCount,
      status: input.status
    })
  };
}

export function connectivityStatusViewModel(input: {
  attentionCount: number;
  completionSequence: number;
  now: number;
  onlineUntil: number | null;
  pendingCount: number;
  status: ConnectivityStatus;
}): ConnectivityStatusViewModel | null {
  if (input.status === "offline") {
    if (input.attentionCount > 0) {
      return {
        accessibilityLabel:
          "Offline. A timer or time entry sync issue also needs attention. Open Sync and diagnostics.",
        id: "offline-attention",
        isActionable: true,
        variant: "offline"
      };
    }
    return {
      accessibilityLabel: "Offline. Changes will sync later.",
      id: "offline",
      isActionable: false,
      variant: "offline"
    };
  }
  if (input.attentionCount > 0) {
    return {
      accessibilityLabel: "A timer or time entry sync issue needs attention. Open Sync and diagnostics.",
      id: "attention",
      isActionable: true,
      variant: "attention"
    };
  }
  if (input.status === "online" && input.pendingCount > 0) {
    return {
      accessibilityLabel: "Syncing saved changes.",
      id: "syncing",
      isActionable: false,
      variant: "syncing"
    };
  }
  if (
    input.status === "online" &&
    input.pendingCount === 0 &&
    input.onlineUntil !== null &&
    input.onlineUntil > input.now
  ) {
    return {
      accessibilityLabel: "Saved changes synced.",
      id: `synced-${input.completionSequence}`,
      isActionable: false,
      variant: "synced"
    };
  }
  return null;
}

export function createDistinctConnectivityAnnouncementTracker() {
  let lastId: string | null = null;
  return {
    next(viewModel: ConnectivityStatusViewModel | null) {
      if (!viewModel) {
        lastId = null;
        return null;
      }
      if (viewModel.id === lastId) return null;
      lastId = viewModel.id;
      return viewModel.accessibilityLabel;
    }
  };
}
