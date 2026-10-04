export type DayframeLocationNativeSignal = {
  id: string;
  kind:
    | "visit"
    | "significant_change"
    | "provider_status"
    | "location_paused"
    | "location_resumed";
  occurredAt: string;
  endedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  horizontalAccuracyMeters?: number | null;
  /** Significant-change fixes only; null when iOS reports no valid speed. */
  speedMetersPerSecond?: number | null;
  metadata: {
    visitDepartureOpen?: string;
    authorizationStatus?: string;
    accuracyAuthorization?: string;
    errorCode?: string;
    /** ISO time, with milliseconds, when the native callback ran. */
    nativeCallbackAt?: string;
  };
};

export type DayframeLocationNativeStatus = {
  enabled: boolean;
  authorizationStatus: string;
  accuracyAuthorization: string;
  locationServicesEnabled: boolean;
  backgroundRefreshStatus: string;
  pendingSignalCount: number;
  monitoringVisits: boolean;
  monitoringSignificantChanges: boolean;
  restoredForLocationRelaunch: boolean;
  nativeStoreErrorCode?: string | null;
};
