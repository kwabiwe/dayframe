/**
 * Settings › Location's one access action (UIA-111): iOS Settings first (a restart can't succeed
 * until iOS allows location again), then Restart, Refresh or Enable. The visible label and what
 * VoiceOver says come from the same action.
 */
export type LocationAccessAction = "settings" | "restart" | "refresh" | "enable";

export function locationAccessAction(input: {
  needsIosSettings: boolean;
  captureNeedsRetry: boolean;
  monitoringAllowed: boolean;
}): LocationAccessAction {
  if (input.needsIosSettings) return "settings";
  if (input.captureNeedsRetry) return "restart";
  return input.monitoringAllowed ? "refresh" : "enable";
}

export function locationAccessLabels(action: LocationAccessAction) {
  return {
    settings: { label: "Open Settings", accessibilityLabel: "Open iPhone Settings to allow location" },
    restart: { label: "Restart location", accessibilityLabel: "Restart location" },
    refresh: { label: "Refresh", accessibilityLabel: "Refresh location access" },
    enable: { label: "Enable", accessibilityLabel: "Enable location access" }
  }[action];
}

/** The suggestions switch's hint: turning it on opens iOS Settings when iOS won't ask again. */
export function locationSuggestionsSwitchHint(input: { needsIosSettings: boolean; consentOn: boolean }) {
  return input.needsIosSettings && !input.consentOn
    ? "Opens iPhone Settings, where location must be allowed first."
    : "Saves your choice for this account. Location access is set separately.";
}

/** Only the newest of overlapping reads may publish; invalidate() voids any still running. */
export function createLatestRead() {
  let latest = 0;
  return {
    begin: () => ++latest,
    isLatest: (token: number) => token === latest,
    invalidate: () => {
      latest += 1;
    }
  };
}
