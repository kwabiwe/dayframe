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
  | "provider_status"
  | "motion_activity";

/** Core Motion's activity classification. Never a position: motion evidence carries no coordinates. */
export type MotionActivity = "stationary" | "walking" | "running" | "cycling" | "automotive" | "unknown";
export type MotionConfidence = "low" | "medium" | "high";
/** How a journey was travelled, from medium- or high-confidence motion activity. */
export type MotionTravelMode = "walking" | "running" | "cycling" | "automotive";

export type LocationEvidenceMetadata = {
  visitDepartureOpen?: boolean;
  geofenceState?: "inside" | "outside" | "unknown";
  providerEnabled?: boolean;
  authorizationStatus?: "not_determined" | "restricted" | "denied" | "when_in_use" | "always";
  accuracyAuthorization?: "full" | "reduced" | "unknown";
  errorCode?: string;
  signalSequence?: number;
  nativeCallbackAt?: string;
  /** motion_activity only: the activity that began at `occurredAt`. */
  motionActivity?: MotionActivity;
  /** motion_activity only: Core Motion's confidence in that activity. */
  motionConfidence?: MotionConfidence;
  /** motion_activity only: the history query at `occurredAt` still reported this activity (coverage, not a change). */
  motionContinuation?: boolean;
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
  /** Home or Work; the phone describes a role place by its label. */
  role?: "home" | "work" | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  priority?: number;
  loggingEnabled?: boolean;
  correctionScore?: number;
  /**
   * Archived (PRD D19 A10): the place matches only evidence from before this moment, so replay
   * keeps its past visits as they were and no new visit matches it.
   */
  archivedAt?: string | null;
  /**
   * "Replace the old place": the place matches only evidence from this moment, when it replaced an
   * archived place nearby, so history before then keeps the old place's visits.
   */
  matchingStartsAt?: string | null;
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
  approximateArrival?: true;
  /**
   * The stay's end from location evidence alone, when Motion & Fitness moved
   * `stoppedAt`. Persisted, so journeys re-derived from a decided stay still
   * qualify on location evidence and stay Review-only when motion timed them.
   */
  locationOnlyStoppedAt?: string;
  /** Set when the stay was formed from physical stop evidence rather than identity/dwell gates. */
  formation?: "physical_stop";
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

/**
 * One mode inside a trip (location v4 §4, §8): its own times, mode, confidence and distance along its
 * accurate readings. Waits and changes between legs are not legs. Walk, run, cycle and drive come from
 * Core Motion and speed (build step 6); train, Underground and tram from the bundled stations (step 7).
 */
export type TripLegMode = MotionTravelMode | "bus" | "train" | "underground" | "tram";

export type TripLeg = {
  startedAt: string;
  stoppedAt: string;
  mode: TripLegMode;
  /**
   * Sure: Core Motion and speed agree, or for rail and Underground both ends are at stations of the kind;
   * likely: one input; unsure: a guess, such as an Underground leg read from a silence.
   */
  confidence: "sure" | "likely" | "unsure";
  /** The next most likely mode of an unsure leg ("Underground or train?"). */
  runnerUp?: TripLegMode;
  /** No position was observed during the leg (underground, or no signal): its route is unknown. */
  unobserved?: true;
  distanceMeters: number | null;
};

export type CommuteSegment = {
  kind: "commute";
  clientSegmentId: string;
  algorithmVersion: string;
  status: LocationSegmentStatus;
  startedAt: string;
  stoppedAt: string;
  startLowerBoundAt?: string | null;
  startUpperBoundAt?: string | null;
  stopLowerBoundAt?: string | null;
  stopUpperBoundAt?: string | null;
  fromStaySegmentId: string;
  toStaySegmentId: string;
  fromPlaceId?: string | null;
  toPlaceId?: string | null;
  routeDistanceMeters?: number | null;
  straightLineDistanceMeters?: number | null;
  routeSampleCount: number;
  gapDurationSeconds: number;
  maximumObservationGapSeconds: number;
  continuityStatus: ContinuityStatus;
  confidence: "low" | "medium" | "medium_high" | "high";
  qualificationReason?: CommuteQualificationReason;
  /** Short stops inside one trip. Coordinate-free; each refers to its own stay segment. */
  stops?: CommuteStop[];
  /** How the journey was travelled, when Motion & Fitness activity shows one mode for most of its movement. */
  travelMode?: MotionTravelMode;
  /** The trip's legs in time order (location v4 step 6); absent when nothing could tell them apart. */
  tripLegs?: TripLeg[];
  /**
   * Set when Motion & Fitness activity, not GPS, showed the movement that qualified
   * this journey (a short drive or a drive during a GPS gap). Such journeys are Review-only.
   */
  motionSupported?: true;
  /** Set when Motion & Fitness moved the journey's start or end. Such journeys are Review-only. */
  motionTimed?: true;
  /**
   * Qualified legs replaced by this trip. Never persisted; replay restores them
   * only when protected history blocks the trip itself.
   */
  legs?: CommuteSegment[];
  /**
   * Set on a leg that stands only because its whole outing qualified (PRD D19, `outingLegsAround`):
   * the outing's stays in order, its two anchors first and last. Never persisted; replay re-checks the
   * outing against decided boundaries before rebuilding the leg.
   */
  outingStayIds?: string[];
  evidenceIds: string[];
};

export type CommuteStop = {
  staySegmentId: string;
  startedAt: string;
  stoppedAt: string;
  startLowerBoundAt: string | null;
  startUpperBoundAt: string | null;
  stopLowerBoundAt: string | null;
  stopUpperBoundAt: string | null;
  candidatePlaceIds: string[];
};

export type CommuteQualificationReason =
  | "significant_endpoint_displacement"
  | "significant_route_distance"
  | "endpoint_only_significant_distance"
  | "same_place_meaningful_round_trip"
  /** Time away from a saved or learned place with no qualifying journey: always Review-only. */
  | "same_place_outing";

export type CommuteRejectionReason =
  | "local_pedestrian_movement"
  | "insufficient_displacement"
  | "looping_local_movement"
  | "insufficient_evidence"
  | "same_place_insufficient_route";

export type CommuteQualification =
  | {
      qualifies: true;
      reason: CommuteQualificationReason;
      confidence: CommuteSegment["confidence"];
    }
  | {
      qualifies: false;
      reason: CommuteRejectionReason;
    };

export type CommuteEvidenceSummary = {
  routeSampleCount: number;
  speedBearingSampleCount: number;
  credibleSpeedSampleCount: number;
  credibleFasterSampleCount: number;
  medianSpeedMetersPerSecond: number | null;
  upperQuartileSpeedMetersPerSecond: number | null;
  routeDistanceMeters: number | null;
  straightLineDistanceMeters: number | null;
  routeEfficiency: number | null;
  maximumDisplacementFromOriginMeters: number | null;
  maximumObservationGapSeconds: number;
  sameKnownPlace: boolean;
  strongEndpoints: boolean;
  hasCredibleFasterMovement: boolean;
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

/**
 * A journey in progress (location v4 §9): the device left its last stay and is
 * still on the move. It is never a segment and never logged; it ends when the
 * next stay begins and the finished journey replaces it.
 */
export type OpenTrip = {
  kind: "open_trip";
  clientSegmentId: string;
  fromStaySegmentId: string;
  fromPlaceId: string | null;
  startedAt: string;
  /** The latest observation of the journey so far. */
  lastObservedAt: string;
  routeSampleCount: number;
  /** Distance along the readings so far, from the origin; null with fewer than two. */
  routeDistanceMeters: number | null;
  travelMode?: MotionTravelMode;
  /** The legs so far. */
  tripLegs?: TripLeg[];
  evidenceIds: string[];
};

export type LocationEngineOutput = {
  nextState: LocationEngineState;
  acceptedEvidence: ClassifiedEvidence[];
  rejectedEvidence: RejectedEvidence[];
  /**
   * When genuine readings too broad to accept (worse than `maxAcceptedHorizontalAccuracyMeters`) but better
   * than cell-only (`tripUnseenObservedAccuracyMeters`) were taken, sorted, in epoch ms: times only, never
   * positions. They show the phone was seen, so a trip's silence is no silence (location v4 step 7).
   */
  broadReadingTimes?: number[];
  segmentUpserts: LocationSegment[];
  finalisedSegments: LocationSegment[];
  /** The journey in progress, when there is one. Never persisted as a segment and never logged. */
  openTrip?: OpenTrip | null;
  diagnostics: LocationEngineDiagnostics;
};

export const EMPTY_LOCATION_ENGINE_STATE: LocationEngineState = {
  algorithmVersion: "location-v2.0",
  mode: "idle",
  activeSegmentId: null,
  processedEvidenceIds: [],
  lastProcessedAt: null
};
