import { CONNECTIVITY_SUCCESS_NOTICE_MS, type ConnectivityStatus } from "./connectivityState";

export type ConnectivityPillVariant = "offline" | "syncing" | "online";

export type ConnectivityPillViewModel = {
  accessibilityLabel: string;
  id: string;
  text: "Offline" | "Syncing…" | "Online";
  variant: ConnectivityPillVariant;
};

export function connectivityPillColorRoles(variant: ConnectivityPillVariant) {
  if (variant === "offline") {
    return { background: "warning" as const, foreground: "onAccent" as const };
  }
  if (variant === "online") {
    return { background: "success" as const, foreground: "onAccent" as const };
  }
  return { background: "surfaceMuted" as const, foreground: "textPrimary" as const };
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
  now: number;
  pendingCount: number;
  state: ConnectivityPresentationState;
  status: ConnectivityStatus;
}) {
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
        input.status === "online"
          ? input.now + CONNECTIVITY_SUCCESS_NOTICE_MS
          : null,
      previousPendingCount: 0
    };
  } else if (state.onlineUntil !== null && state.onlineUntil <= input.now) {
    state = { ...state, onlineUntil: null };
  }

  return {
    state,
    viewModel: connectivityPillViewModel({
      completionSequence: state.completionSequence,
      now: input.now,
      onlineUntil: state.onlineUntil,
      pendingCount,
      status: input.status
    })
  };
}

export function connectivityPillViewModel(input: {
  completionSequence: number;
  now: number;
  onlineUntil: number | null;
  pendingCount: number;
  status: ConnectivityStatus;
}): ConnectivityPillViewModel | null {
  if (input.status === "offline") {
    return {
      accessibilityLabel: "Offline. Changes will sync later.",
      id: "offline",
      text: "Offline",
      variant: "offline"
    };
  }
  if (input.status === "online" && input.pendingCount > 0) {
    return {
      accessibilityLabel: "Syncing saved changes.",
      id: "syncing",
      text: "Syncing…",
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
      accessibilityLabel: "Online.",
      id: `online-${input.completionSequence}`,
      text: "Online",
      variant: "online"
    };
  }
  return null;
}

export function createDistinctConnectivityAnnouncementTracker() {
  let lastId: string | null = null;
  return {
    next(viewModel: ConnectivityPillViewModel | null) {
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
