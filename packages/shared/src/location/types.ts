import type { LocationEngineConfig } from "./config";

export type LocationEvidenceKind =
  | "standard_location"
  | "significant_change"
  | "visit"
  | "geofence_enter"
  | "geofence_exit"
  | "geofence_state"
  | "location_paused"
  | "location_resumed"
  | "provider_status";

export type LocationEvidenceMetadata = {
  visitDepartureOpen?: boolean;
  geofenceState?: "inside" | "outside" | "unknown";
  providerEnabled?: boolean;
  authorizationStatus?: "not_determined" | "restricted" | "denied" | "when_in_use" | "always";
  accuracyAuthorization?: "full" | "reduced" | "unknown";
  errorCode?: string;
  signalSequence?: number;
};

export type LocationEvidence = {
  clientEvidenceId: string;
  deviceId: string;
  algorithmVersion: string;
  kind: LocationEvidenceKind;
  occurredAt: string;
  endedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  horizontalAccuracyMeters?: number | null;
  altitudeMeters?: number | null;
  speedMetersPerSecond?: number | null;
  courseDegrees?: number | null;
  savedPlaceId?: string | null;
  geofenceIdentifier?: string | null;
  sourceTimestamp?: string | null;
  receivedAt: string;
  timeZone: string;
  isSimulated?: boolean | null;
  metadata?: LocationEvidenceMetadata;
};

export type SavedPlaceForMatching = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  priority?: number;
  loggingEnabled?: boolean;
  correctionScore?: number;
};

export type LearnedPlaceForMatching = SavedPlaceForMatching & {
  accepted: true;
};

export type LocationMatchClass = "strong" | "plausible" | "outside";

export type PlaceMatchCandidate = {
  id: string;
  source: "saved" | "learned";
  matchClass: LocationMatchClass;
  distanceMeters: number;
  radiusMeters: number;
  priority: number;
};

export type PlaceMatch = {
  kind: "saved" | "learned" | "unknown" | "ambiguous";
  placeId: string | null;
  candidates: PlaceMatchCandidate[];
};

export type LocationSegmentStatus =
  | "candidate"
  | "open"
  | "closed"
  | "finalised"
  | "superseded"
  | "ignored";

export type ContinuityStatus =
  | "continuous"
  | "supported_by_visit"
  | "uncertain_gap"
  | "broken_by_other_place"
  | "manual";

export type StaySegment = {
  kind: "stay";
  clientSegmentId: string;
  algorithmVersion: string;
  status: LocationSegmentStatus;
  startedAt: string;
  stoppedAt?: string | null;
  startLowerBoundAt?: string | null;
  startUpperBoundAt?: string | null;
  stopLowerBoundAt?: string | null;
  stopUpperBoundAt?: string | null;
  placeId?: string | null;
  learnedPlaceId?: string | null;
  placeMatchKind: "saved" | "learned" | "unknown" | "ambiguous";
  candidatePlaceIds: string[];
  centreLatitude?: number | null;
  centreLongitude?: number | null;
  radiusMeters?: number | null;
  sampleCount: number;
  continuityStatus: ContinuityStatus;
  confidence: "low" | "medium" | "medium_high" | "high";
  evidenceIds: string[];
  parentSegmentId?: string | null;
  supersedesSegmentId?: string | null;
};

export type CommuteSegment = {
  kind: "commute";
  clientSegmentId: string;
  algorithmVersion: string;
  status: LocationSegmentStatus;
  startedAt: string;
  stoppedAt: string;
  fromStaySegmentId: string;
  toStaySegmentId: string;
  fromPlaceId?: string | null;
  toPlaceId?: string | null;
  routeDistanceMeters?: number | null;
  straightLineDistanceMeters?: number | null;
  routeSampleCount: number;
  gapDurationSeconds: number;
  continuityStatus: ContinuityStatus;
  confidence: "low" | "medium" | "medium_high" | "high";
  evidenceIds: string[];
};

export type LocationSegment = StaySegment | CommuteSegment;

export type ClassifiedEvidence = {
  evidence: LocationEvidence;
  match: PlaceMatch | null;
  impliedSpeedMetersPerSecond: number | null;
};

export type RejectedEvidence = {
  clientEvidenceId: string;
  kind: LocationEvidenceKind;
  occurredAt: string;
  reason:
    | "duplicate"
    | "invalid_timestamp"
    | "invalid_coordinate"
    | "invalid_accuracy"
    | "accuracy_too_broad"
    | "implausible_speed";
};

export type LocationEngineState = {
  algorithmVersion: string;
  mode: "idle" | "candidate_stay" | "staying" | "moving" | "uncertain_gap";
  activeSegmentId: string | null;
  processedEvidenceIds: string[];
  lastProcessedAt: string | null;
};

export type LocationEngineDiagnostics = {
  inputCount: number;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  stayCount: number;
  commuteCount: number;
  ambiguousMatchCount: number;
  warningCodes: string[];
};

export type LocationEngineInput = {
  priorState: LocationEngineState;
  evidence: LocationEvidence[];
  savedPlaces: SavedPlaceForMatching[];
  acceptedLearnedPlaces: LearnedPlaceForMatching[];
  config: LocationEngineConfig;
  processingAt: string;
};

export type LocationEngineOutput = {
  nextState: LocationEngineState;
  acceptedEvidence: ClassifiedEvidence[];
  rejectedEvidence: RejectedEvidence[];
  segmentUpserts: LocationSegment[];
  finalisedSegments: LocationSegment[];
  diagnostics: LocationEngineDiagnostics;
};

export const EMPTY_LOCATION_ENGINE_STATE: LocationEngineState = {
  algorithmVersion: "location-v2.0",
  mode: "idle",
  activeSegmentId: null,
  processedEvidenceIds: [],
  lastProcessedAt: null
};
