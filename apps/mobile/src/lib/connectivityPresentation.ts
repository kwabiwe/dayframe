import { CONNECTIVITY_SUCCESS_NOTICE_MS, type ConnectivityStatus } from "./connectivityState";

// Blocks connectivity (owner decision 7 Oct, built as parity step 10c): the header slot shows only
// confirmed offline and, for about two seconds after a real return, "back online". Saving and
// syncing stay silent in the background. A rejected change that needs the user is a badge on the
// account avatar (see `syncAttentionPresentation`), not a header icon.

export type ConnectivityStatusVariant = "offline" | "online";

export type ConnectivityStatusViewModel = {
  accessibilityLabel: string;
  id: string;
  variant: ConnectivityStatusVariant;
};

export function connectivityStatusColorRole(_variant: ConnectivityStatusVariant) {
  return "textSecondary" as const;
}

export type ConnectivityPresentationState = {
  accountKey: string | null;
  /** Confirmed offline since the last "back online" (an unknown spell in between keeps it). */
  wasOffline: boolean;
  backOnlineSequence: number;
  backOnlineUntil: number | null;
};

export function createConnectivityPresentationState(): ConnectivityPresentationState {
  return {
    accountKey: null,
    wasOffline: false,
    backOnlineSequence: 0,
    backOnlineUntil: null
  };
}

export function updateConnectivityPresentation(input: {
  accountKey: string | null;
  now: number;
  state: ConnectivityPresentationState;
  status: ConnectivityStatus;
}) {
  let state = input.state;
  if (state.accountKey !== input.accountKey) {
    // A new account never inherits the previous account's notice.
    state = {
      ...state,
      accountKey: input.accountKey,
      wasOffline: input.status === "offline",
      backOnlineUntil: null
    };
  }
  if (input.status === "offline") {
    if (!state.wasOffline || state.backOnlineUntil !== null) {
      state = { ...state, wasOffline: true, backOnlineUntil: null };
    }
  } else if (input.status === "online" && state.wasOffline) {
    state = {
      ...state,
      wasOffline: false,
      backOnlineSequence: state.backOnlineSequence + 1,
      backOnlineUntil: input.now + CONNECTIVITY_SUCCESS_NOTICE_MS
    };
  } else if (state.backOnlineUntil !== null && state.backOnlineUntil <= input.now) {
    state = { ...state, backOnlineUntil: null };
  }

  return {
    state,
    viewModel: connectivityStatusViewModel({
      backOnlineSequence: state.backOnlineSequence,
      backOnlineUntil: state.backOnlineUntil,
      now: input.now,
      status: input.status
    })
  };
}

export function connectivityStatusViewModel(input: {
  backOnlineSequence: number;
  backOnlineUntil: number | null;
  now: number;
  status: ConnectivityStatus;
}): ConnectivityStatusViewModel | null {
  if (input.status === "offline") {
    return {
      accessibilityLabel: "Offline. Changes are saved on this iPhone and will sync when you're back online.",
      id: "offline",
      variant: "offline"
    };
  }
  if (input.status === "online" && input.backOnlineUntil !== null && input.backOnlineUntil > input.now) {
    return {
      accessibilityLabel: "Back online.",
      id: `online-${input.backOnlineSequence}`,
      variant: "online"
    };
  }
  return null;
}

/** The avatar's attention badge: a rejected Stop, Edit or Delete that needs the user in Sync help. */
export function syncAttentionPresentation(attentionCount: number) {
  const count = Math.max(0, Math.trunc(attentionCount));
  if (count === 0) return null;
  return {
    accessibilityLabel: `Account and settings. ${count === 1 ? "A change" : `${count} changes`} couldn't be saved and ${count === 1 ? "needs" : "need"} your attention.`,
    accessibilityHint: "Opens Sync help in Settings",
    count
  };
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
