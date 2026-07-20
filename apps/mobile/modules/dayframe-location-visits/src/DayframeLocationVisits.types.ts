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
  metadata: {
    visitDepartureOpen?: string;
    authorizationStatus?: string;
    accuracyAuthorization?: string;
    errorCode?: string;
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
