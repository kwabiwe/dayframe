import { LOCATION_ENGINE_V2_CONFIG, type LocationEngineConfig } from "./config";
import { assembleTripsThroughStops, deriveCommutes } from "./commute";
import { detectPhysicalStops, type PhysicalStop } from "./physicalStops";
import { accuracyWeightedCentre, distanceMeters, midpointTimeIso, stableLocationId } from "./geo";
import { matchLocationToPlaces } from "./placeMatcher";
import { analyseSavedPlaceArrivalEvidence } from "./savedPlaceArrivalSupport";
import type {
  ClassifiedEvidence,
  ContinuityStatus,
  LocationEngineInput,
  LocationEngineOutput,
  LocationEvidence,
  PlaceMatch,
  RejectedEvidence,
  StaySegment
} from "./types";

const SOURCE_PRECEDENCE: Record<LocationEvidence["kind"], number> = {
  visit: 0,
  geofence_exit: 1,
  geofence_enter: 2,
  geofence_state: 3,
  significant_change: 4,
  standard_location: 5,
  location_resumed: 6,
  location_paused: 7,
  provider_status: 8
};

type WorkingStay = {
  /** Evidence attached as support that never defines the stay's ID (early-dated arrivals and their completions). */
  identityExcluded?: Set<ClassifiedEvidence>;
  key: string;
  placeMatchKind: StaySegment["placeMatchKind"];
  placeId: string | null;
  learnedPlaceId: string | null;
  candidatePlaceIds: string[];
  evidence: ClassifiedEvidence[];
  startedAt: string;
  stoppedAt: string | null;
  startLowerBoundAt: string | null;
  startUpperBoundAt: string | null;
  stopLowerBoundAt: string | null;
  stopUpperBoundAt: string | null;
  continuityStatus: ContinuityStatus;
  outside: ClassifiedEvidence[];
  supportedByVisit: boolean;
  approximateArrival: boolean;
  visitSupportUntilAt: string | null;
  /** Latest end of a completed Visit that arrived within this stay; support reused from an earlier episode never sets it. */
  episodeVisitUntilAt: string | null;
  pendingExit?: ClassifiedEvidence;
  inferredContinuity?: boolean;
  inferredBoundary?: boolean;
  lastStrongInside?: ClassifiedEvidence;
  /** Visits reused from an earlier episode as interval support; never proof of identity. */
  reusedVisits?: Set<ClassifiedEvidence>;
  /** Incremental edge-cluster scan of `evidence` (see edgeOnly); evidence only grows. */
  edgeScan?: { index: number; inside: boolean; still: boolean };
  /** Set when a corroborated arrival-only Visit at this saved place joins the stay. */
  arrivalPresence?: boolean;
  /** Departure iOS reported for that arrival's Visit, if completed; presence never runs past it. */
  arrivalPresenceUntilAt?: string | null;
  /** Arrival time of the Visit whose corroborated arrival owns `arrivalPresence`. */
  arrivalPresenceFromAt?: string;
  /** Set while that Visit is an early arrival attached at its observed arrival. */
  arrivalPresenceDeferred?: boolean;
};

function pointFor(evidence: LocationEvidence) {
  return evidence.latitude == null || evidence.longitude == null
    ? null
    : { latitude: evidence.latitude, longitude: evidence.longitude };
}

function matchKey(match: PlaceMatch | null, evidence: LocationEvidence) {
  if (evidence.savedPlaceId && !pointFor(evidence)) return `saved:${evidence.savedPlaceId}`;
  if (!match || match.kind === "unknown") return "unknown";
  if (match.kind === "ambiguous") {
    return `ambiguous:${match.candidates.map((candidate) => candidate.id).sort().join(",")}`;
  }
  return `${match.kind}:${match.placeId}`;
}

function matchingActive(match: PlaceMatch | null, active: WorkingStay) {
  if (!match) return false;
  if (active.placeId && match.kind === "ambiguous") {
    return match.candidates.some((candidate) => candidate.id === active.placeId);
  }
  if ((match.kind === "saved" || match.kind === "learned") && match.placeId) {
    return `${match.kind}:${match.placeId}` === active.key;
  }
  return match.kind === "unknown" && active.key === "unknown";
}

function makeWorkingStay(item: ClassifiedEvidence): WorkingStay {
  const { evidence, match } = item;
  const kind = match?.kind ?? "unknown";
  return {
    key: matchKey(match, evidence),
    placeMatchKind: kind,
    placeId: kind === "saved" ? match?.placeId ?? evidence.savedPlaceId ?? null : evidence.savedPlaceId ?? null,
    learnedPlaceId: kind === "learned" ? match?.placeId ?? null : null,
    candidatePlaceIds: match?.candidates.filter((candidate) => candidate.matchClass !== "outside").map((candidate) => candidate.id) ?? [],
    evidence: [item],
    startedAt: evidence.occurredAt,
    stoppedAt: evidence.kind === "visit" && evidence.endedAt ? evidence.endedAt : null,
    startLowerBoundAt: evidence.occurredAt,
    startUpperBoundAt: evidence.occurredAt,
    stopLowerBoundAt: evidence.endedAt ?? null,
    stopUpperBoundAt: evidence.endedAt ?? null,
    continuityStatus: evidence.kind === "visit" ? "supported_by_visit" : "continuous",
    outside: [],
    supportedByVisit: evidence.kind === "visit",
    approximateArrival: false,
    visitSupportUntilAt: evidence.kind === "visit" ? evidence.endedAt ?? null : null,
    episodeVisitUntilAt: evidence.kind === "visit" ? evidence.endedAt ?? null : null
  };
}

function evidenceCentre(items: ClassifiedEvidence[]) {
  return accuracyWeightedCentre(
    items.flatMap(({ evidence }) => {
      const point = pointFor(evidence);
      return point ? [{ ...point, accuracyMeters: evidence.horizontalAccuracyMeters }] : [];
    })
  );
}

function sameUnknownCluster(active: WorkingStay, item: ClassifiedEvidence, radius: number) {
  const centre = evidenceCentre(active.evidence);
  const point = pointFor(item.evidence);
  return Boolean(centre && point && distanceMeters(centre, point) <= radius);
}

/**
 * Where the cluster an edge stay would be begins: its first Visit or
 * non-moving reading, as an unknown cluster starts (moving readings never
 * start one). Readings before it (a drive through the circle before parking
 * beside it) are route evidence, not the cluster.
 */
function edgeClusterStart(stay: WorkingStay, input: LocationEngineInput) {
  const index = stay.evidence.findIndex((item) => {
    const { evidence } = item;
    if (evidence.kind === "visit") return !stay.reusedVisits?.has(item) && pointFor(evidence) != null;
    if (evidence.kind !== "standard_location" && evidence.kind !== "significant_change" || !pointFor(evidence)) return false;
    const speed = evidence.speedMetersPerSecond ?? item.impliedSpeedMetersPerSecond;
    return speed == null || !Number.isFinite(speed) || speed < input.config.movementSpeedThresholdMps;
  });
  return index < 0 ? 0 : index;
}

/** Within `radius` of the centre of an edge stay's cluster (edgeClusterStart onwards), as for an unknown cluster. */
function nearEdgeCluster(active: WorkingStay, item: ClassifiedEvidence, input: LocationEngineInput, radius: number) {
  const centre = evidenceCentre(active.evidence.slice(edgeClusterStart(active, input)));
  const point = pointFor(item.evidence);
  return Boolean(centre && point && distanceMeters(centre, point) <= radius);
}

function hasPairedGeofenceEnter(
  items: ClassifiedEvidence[],
  exit: LocationEvidence,
  toleranceMs = 5_000
) {
  if (!exit.savedPlaceId) return false;
  const exitAt = Date.parse(exit.occurredAt);
  return items.some(({ evidence }) =>
    evidence.kind === "geofence_enter" &&
    evidence.savedPlaceId === exit.savedPlaceId &&
    evidence.deviceId === exit.deviceId &&
    Math.abs(Date.parse(evidence.occurredAt) - exitAt) <= toleranceMs
  );
}

function closeAtTransition(
  active: WorkingStay,
  nextAt: string,
  continuityStatus: ContinuityStatus,
  config: LocationEngineConfig,
  exact = false
) {
  const lastAt = lastInsideAt(active, nextAt);
  if (
    active.inferredBoundary &&
    active.visitSupportUntilAt &&
    Date.parse(active.visitSupportUntilAt) <= Date.parse(nextAt) &&
    Date.parse(active.visitSupportUntilAt) >= Date.parse(lastAt)
  ) {
    const lowerBound = active.stopLowerBoundAt && Date.parse(active.stopLowerBoundAt) >= Date.parse(lastAt)
      ? active.stopLowerBoundAt
      : lastAt;
    active.stoppedAt = active.visitSupportUntilAt;
    active.stopLowerBoundAt = lowerBound;
    active.stopUpperBoundAt = active.visitSupportUntilAt;
    active.continuityStatus = active.inferredBoundary ? "uncertain_gap" : continuityStatus;
    return;
  }
  // A completed Visit supplies the departure itself, even when a later GPS
  // sample was received within that Visit. Use it only while the transition
  // and latest inside observation do not contradict that boundary.
  if (
    active.visitSupportUntilAt &&
    Date.parse(active.visitSupportUntilAt) <= Date.parse(nextAt) &&
    Date.parse(active.visitSupportUntilAt) >= Date.parse(lastAt)
  ) {
    active.stoppedAt = active.visitSupportUntilAt;
    active.stopLowerBoundAt = active.visitSupportUntilAt;
    active.stopUpperBoundAt = active.visitSupportUntilAt;
    active.continuityStatus = continuityStatus;
    return;
  }
  // The earliest credible departure evidence: a buffered outside reading, a
  // pending exit or the closing item.
  const earliestDepartureAt = [nextAt, active.outside[0]?.evidence.occurredAt, active.pendingExit?.evidence.occurredAt]
    .filter((at): at is string => at != null && Date.parse(at) >= Date.parse(lastAt))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? nextAt;
  // iOS reports a Visit's departure a little after the device leaves. A completed
  // saved-place Visit ending shortly after the departure evidence still says the
  // device was present through the silence, as its arrival-only callback did. A
  // Visit far outlasting that evidence is contradicted and keeps the midpoint. Only
  // a Visit that arrived within this stay counts: support reused from an earlier
  // episode was already broken, whichever Visit ends later.
  const lateVisitDeparture = active.placeMatchKind === "saved" && active.episodeVisitUntilAt != null &&
    Date.parse(active.episodeVisitUntilAt) > Date.parse(nextAt) &&
    Date.parse(active.episodeVisitUntilAt) - Date.parse(earliestDepartureAt) <= config.savedPlaceVisitDepartureLagMaximumMs;
  // Presence ends at the arrival's reported departure; observations after it are
  // ordinary evidence, never presence.
  const presence = active.arrivalPresence === true && (active.arrivalPresenceUntilAt == null ||
    Date.parse(active.arrivalPresenceUntilAt) >= Date.parse(lastAt));
  // With presence the stay lasted until the earliest departure evidence; the
  // silence before it is not an even split of unknown time.
  const departureAt = !exact && (presence || lateVisitDeparture) ? earliestDepartureAt : null;
  active.stoppedAt = exact ? lastAt : departureAt ?? midpointTimeIso(lastAt, nextAt);
  active.stopLowerBoundAt = lastAt;
  active.stopUpperBoundAt = departureAt ?? nextAt;
  active.continuityStatus = continuityStatus;
}

/** Shared defensive guard for automated saved/learned windows, never manual entries. */
export function hasMeaningfulKnownPlaceWindow(startedAt: string, stoppedAt: string | null | undefined,
  minimumMs = LOCATION_ENGINE_V2_CONFIG.savedPlaceMinimumDwellMs) {
  if (!stoppedAt) return false;
  const duration = Date.parse(stoppedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= minimumMs;
}

function lastInsideAt(active: WorkingStay, before: string) {
  return active.evidence.reduce((latest, { evidence }) => {
    if (evidence.kind.startsWith("geofence_")) return latest;
    // A reused Visit may start before this episode. Never use its future end as a point.
    const at = evidence.endedAt && !active.inferredBoundary && Date.parse(evidence.endedAt) <= Date.parse(before)
      ? evidence.endedAt : evidence.occurredAt;
    return Date.parse(at) > Date.parse(latest) ? at : latest;
  }, active.startedAt);
}

function accurateCoordinate(item: ClassifiedEvidence, input: LocationEngineInput) {
  return pointFor(item.evidence) != null && item.evidence.horizontalAccuracyMeters != null &&
    item.evidence.horizontalAccuracyMeters <= input.config.highQualityHorizontalAccuracyMeters;
}

type UnknownVisitArrivalBound = {
  lower: string;
  upper: string | null;
};

function lastDisplacedMovementBeforeVisit(
  accepted: ClassifiedEvidence[],
  visit: ClassifiedEvidence,
  input: LocationEngineInput,
  reference: ClassifiedEvidence = visit
) {
  const point = pointFor(reference.evidence)!;
  const at = Date.parse(visit.evidence.occurredAt);
  for (let index = accepted.length - 1; index >= 0; index -= 1) {
    const candidate = accepted[index];
    const e = candidate.evidence;
    const time = Date.parse(e.occurredAt);
    if (time >= at) continue;
    if (at - time > input.config.savedPlaceArrivalCorroborationWindowMs) break;
    const candidatePoint = pointFor(e);
    if ((e.kind === "standard_location" || e.kind === "significant_change") &&
        e.deviceId === visit.evidence.deviceId && e.isSimulated === false &&
        candidatePoint && accurateCoordinate(candidate, input) &&
        e.speedMetersPerSecond != null && Number.isFinite(e.speedMetersPerSecond) &&
        e.speedMetersPerSecond >= input.config.movementSpeedThresholdMps &&
        e.speedMetersPerSecond <= 120 &&
        distanceMeters(candidatePoint, point) >= input.config.movementDisplacementThresholdMeters) {
      return e.occurredAt;
    }
  }
  return null;
}

/** A native Visit supplies an estimate, not a timestamped stationary observation. */
function unknownVisitArrivalBounds(accepted: ClassifiedEvidence[], input: LocationEngineInput) {
  const bounds = new Map<string, UnknownVisitArrivalBound>();
  const visits = accepted.filter((item) => item.evidence.kind === "visit" &&
    item.match?.kind === "unknown" && pointFor(item.evidence));
  const groups = new Map<string, ClassifiedEvidence[]>();
  for (const item of visits) {
    const key = `${item.evidence.deviceId}:${item.evidence.occurredAt}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const group of groups.values()) {
    const completed = group.filter(({ evidence }) => evidence.endedAt);
    const open = group.filter(({ evidence }) => !evidence.endedAt);
    // Two callbacks can share one episode only when the existing source fields
    // identify exactly one pair. A coordinate overlap is compatibility, not a
    // new episode ID or independent arrival confirmation.
    const complete = completed.length === 1 ? completed[0] : null;
    const arrival = complete && open.length === 1 && group.length === 2 ? open[0] : null;
    const completePoint = complete && pointFor(complete.evidence);
    const arrivalPoint = arrival && pointFor(arrival.evidence);
    const overlapping = complete && arrival && completePoint && arrivalPoint &&
      complete.evidence.horizontalAccuracyMeters != null &&
      arrival.evidence.horizontalAccuracyMeters != null &&
      distanceMeters(completePoint, arrivalPoint) <=
        complete.evidence.horizontalAccuracyMeters + arrival.evidence.horizontalAccuracyMeters;
    const competingVisit = complete && accepted.some(({ evidence }) =>
      evidence.kind === "visit" && evidence.deviceId === complete.evidence.deviceId &&
      evidence.clientEvidenceId !== complete.evidence.clientEvidenceId &&
      evidence.clientEvidenceId !== arrival?.evidence.clientEvidenceId &&
      Date.parse(evidence.occurredAt) < Date.parse(complete.evidence.endedAt!) &&
      Date.parse(evidence.occurredAt) >= Date.parse(complete.evidence.occurredAt)
    );
    const paired = Boolean(overlapping && !competingVisit);
    if (paired && arrival && complete) {
      // Spatial accuracy chooses a single reference centre, not a more exact
      // arrival time. Equal accuracy favours the arrival callback by role.
      const reference = arrival.evidence.horizontalAccuracyMeters! <=
        complete.evidence.horizontalAccuracyMeters! ? arrival : complete;
      const movementAt = lastDisplacedMovementBeforeVisit(accepted, complete, input, reference);
      const completedBound = complete.evidence.horizontalAccuracyMeters! >
        input.config.highQualityHorizontalAccuracyMeters && movementAt
        ? { lower: movementAt, upper: complete.evidence.endedAt! }
        : { lower: complete.evidence.occurredAt, upper: complete.evidence.occurredAt };
      bounds.set(complete.evidence.clientEvidenceId, completedBound);
      bounds.set(arrival.evidence.clientEvidenceId, completedBound);
      continue;
    }
    for (const item of group) {
      const current = item.evidence;
      const movementAt = lastDisplacedMovementBeforeVisit(accepted, item, input);
      if (current.endedAt && current.horizontalAccuracyMeters != null &&
          current.horizontalAccuracyMeters > input.config.highQualityHorizontalAccuracyMeters && movementAt) {
        bounds.set(current.clientEvidenceId, {
          lower: movementAt,
          upper: current.endedAt
        });
      } else if (!current.endedAt && movementAt) {
        bounds.set(current.clientEvidenceId, {
          lower: movementAt,
          upper: null
        });
      }
    }
  }
  return bounds;
}

function strongSavedPoint(item: ClassifiedEvidence, placeId: string | null, input: LocationEngineInput) {
  return item.evidence.kind !== "visit" && !item.evidence.kind.startsWith("geofence_") &&
    accurateCoordinate(item, input) && item.match?.kind === "saved" && item.match.placeId === placeId &&
    item.match.candidates.some(candidate => candidate.id === placeId && candidate.matchClass === "strong");
}

/** An accurate GPS fix taken while still: native speed, else the implied speed, below the movement threshold. */
function stationaryFix(item: ClassifiedEvidence, input: LocationEngineInput) {
  const { evidence } = item;
  if ((evidence.kind !== "standard_location" && evidence.kind !== "significant_change") || evidence.isSimulated === true ||
    !accurateCoordinate(item, input)) return false;
  const speed = evidence.speedMetersPerSecond ?? item.impliedSpeedMetersPerSecond;
  return speed == null || !Number.isFinite(speed) || speed < input.config.movementSpeedThresholdMps;
}

/** A saved place's circle, with the matcher's 20 m floor. */
function savedCircle(placeId: string | null, input: LocationEngineInput) {
  const place = placeId ? input.savedPlaces.find((candidate) => candidate.id === placeId) : undefined;
  return place ? { place, radius: Math.max(20, place.radiusMeters) } : null;
}

/**
 * iOS itself placed the device inside the saved place's circle during one
 * episode, between `fromMs` and `atMs`: a Visit callback of this episode lies
 * wholly inside (its accuracy included), or the latest genuine geofence
 * transition for the place in that window is an entry. Visits reused from an
 * earlier episode, simulated callbacks and same-place registration snapshot
 * pairs (an exit and an entry within seconds, paired across the whole journal
 * so a pair straddling the window cannot leave half behind) are not proof, and
 * an entry followed by an exit (a drive through the circle) is not presence.
 * Matcher tolerance never proves presence: a reading in the tolerance band can
 * lie wholly outside the circle.
 */
function iosPlacedInside(placeId: string, evidence: ClassifiedEvidence[], reused: ReadonlySet<ClassifiedEvidence> | undefined,
  accepted: ClassifiedEvidence[], fromMs: number, atMs: number, input: LocationEngineInput) {
  const circle = savedCircle(placeId, input);
  if (!circle) return false;
  const within = (iso: string) => Date.parse(iso) >= fromMs && Date.parse(iso) <= atMs;
  if (evidence.some((item) => {
    const visit = item.evidence;
    const point = pointFor(visit);
    return visit.kind === "visit" && !reused?.has(item) && visit.isSimulated !== true && point != null &&
      visit.horizontalAccuracyMeters != null && within(visit.occurredAt) &&
      distanceMeters(point, circle.place) + visit.horizontalAccuracyMeters <= circle.radius;
  })) return true;
  const transitions = accepted.filter(({ evidence: callback }) =>
    (callback.kind === "geofence_enter" || callback.kind === "geofence_exit") && callback.savedPlaceId === placeId &&
    callback.isSimulated !== true);
  const genuine = transitions.filter((item) => !transitions.some((other) => other.evidence.kind !== item.evidence.kind &&
    Math.abs(Date.parse(other.evidence.occurredAt) - Date.parse(item.evidence.occurredAt)) <= GEOFENCE_SNAPSHOT_PAIR_MS));
  return genuine.filter(({ evidence: callback }) => within(callback.occurredAt)).at(-1)?.evidence.kind === "geofence_enter";
}

const GEOFENCE_SNAPSHOT_PAIR_MS = 5_000;

/**
 * A saved-place stay with still GPS fixes, none of them inside the place's
 * circle (still matches only in the tolerance band or beyond), without a
 * corroborated arrival: the cluster an unknown stay would be. It keeps an
 * unknown cluster's continuity, membership and departure; identity is decided
 * separately (stayIdentity). A stay with no still fix (a lone Visit or geofence
 * callback) is not a cluster. One still fix inside the circle makes the stay
 * ordinary; moving fixes (a drive through the circle) and simulated fixes do
 * not. Membership and departure are measured from the still fixes
 * (nearEdgeCluster). The scan is incremental because evidence only grows.
 */
function edgeOnly(stay: WorkingStay, input: LocationEngineInput) {
  if (stay.placeMatchKind !== "saved" || stay.arrivalPresence || stay.inferredBoundary) return false;
  const circle = savedCircle(stay.placeId, input);
  if (!circle) return false;
  const scan = stay.edgeScan ??= { index: 0, inside: false, still: false };
  for (; scan.index < stay.evidence.length && !scan.inside; scan.index += 1) {
    const item = stay.evidence[scan.index];
    const { evidence } = item;
    const point = pointFor(evidence);
    if (!point || !stationaryFix(item, input)) continue;
    if (distanceMeters(point, circle.place) <= circle.radius) scan.inside = true;
    else scan.still = true;
  }
  return !scan.inside && scan.still;
}

/**
 * Whether one still period's evidence places the device at the saved place:
 * its still accurate fixes centre inside the circle, or, when they do not or
 * there are none, iOS placed it inside during this episode by the last still
 * fix. Corroborated arrival timing never decides identity on its own.
 */
function stillAtSavedPlace(placeId: string, evidence: ClassifiedEvidence[], accepted: ClassifiedEvidence[],
  startedAtMs: number, input: LocationEngineInput, reused?: ReadonlySet<ClassifiedEvidence>) {
  const circle = savedCircle(placeId, input);
  if (!circle) return true;
  const stationary = evidence.filter((item) => stationaryFix(item, input));
  const centre = evidenceCentre(stationary);
  if (centre && distanceMeters(centre, circle.place) <= circle.radius) return true;
  const lastMs = Math.max(...(stationary.length ? stationary : evidence).map(({ evidence: item }) => Date.parse(item.occurredAt)));
  return iosPlacedInside(placeId, evidence, reused, accepted,
    startedAtMs - input.config.savedPlaceArrivalCorroborationWindowMs, lastMs, input);
}

type StayIdentity = Pick<WorkingStay, "placeMatchKind" | "placeId" | "learnedPlaceId" | "candidatePlaceIds">;

/**
 * A stay is at a saved place when its still readings centre inside the place's
 * circle. Readings near the edge match the place plausibly, but a phone whose
 * still readings centre outside the circle was beside the place: the place is
 * then only a candidate (owner decision, 4 Oct). Moving readings (the drive
 * away can cross the circle) never set the centre. iOS's own inside signals
 * for this episode keep the saved identity (iosPlacedInside); without any
 * still fix, only they do. Corroborated arrivals and broad-Visit support shape
 * a stay's timing, not its identity: their corroboration rests on matcher
 * classes, whose tolerance band extends beyond the circle.
 */
function stayIdentity(working: WorkingStay, accepted: ClassifiedEvidence[], input: LocationEngineInput): StayIdentity {
  const own: StayIdentity = {
    placeMatchKind: working.placeMatchKind, placeId: working.placeId,
    learnedPlaceId: working.learnedPlaceId, candidatePlaceIds: working.candidatePlaceIds
  };
  if (working.placeMatchKind !== "saved" || !working.placeId ||
    stillAtSavedPlace(working.placeId, working.evidence, accepted, Date.parse(working.startedAt), input, working.reusedVisits)) return own;
  return {
    placeMatchKind: "unknown", placeId: null, learnedPlaceId: null,
    candidatePlaceIds: [...new Set([working.placeId, ...working.candidatePlaceIds])]
  };
}

type CorroboratedArrival = {
  /** Departure reported by the Visit's selected completed callback; presence ends there. */
  departedAt: string | null;
  /** That callback when it joins with the arrival; null when the corroborated broad-Visit path supports it instead. */
  completion: ClassifiedEvidence | null;
  /**
   * For an early-dated arrival, the first evidence at the place after the
   * approach (its entry or a strong inside fix). The Visit joins the stay there
   * instead of at its own time, which precedes the device's arrival.
   */
  observedArrival?: ClassifiedEvidence;
};

/**
 * Arrival-only Visits at a saved place, corroborated within the arrival window
 * by that place's geofence entry or an accurate strong inside fix. Such an
 * arrival establishes presence that continues through stationary silence.
 *
 * iOS later reports the same Visit again with its departure (same device and
 * arrival time). Its coordinate is a broader average, often too broad to use on
 * its own, so these companion callbacks never remove presence and are paired
 * before corroboration: they never contradict their own arrival. The earliest-
 * ending companion that is spatially compatible with the place, with no other
 * Visit starting inside it, is the arrival's interval support: presence ends at
 * its departure, and it joins the stay with the arrival (or through the
 * corroborated broad-Visit path, which already handles it). Every other
 * companion is consumed unused, so none can move the departure, support or
 * dwell. Without a usable companion, presence is as if none had arrived.
 * Computed once per run.
 */
function corroboratedVisitArrivals(
  accepted: ClassifiedEvidence[],
  input: LocationEngineInput,
  corroboratedVisits: ReadonlyMap<string, { savedPlaceId: string }>
) {
  const completions = new Map<string, ClassifiedEvidence[]>();
  for (const item of accepted) {
    if (item.evidence.kind !== "visit" || !item.evidence.endedAt) continue;
    const key = `${item.evidence.deviceId}:${item.evidence.occurredAt}`;
    completions.set(key, [...(completions.get(key) ?? []), item]);
  }
  const windowMs = input.config.savedPlaceArrivalCorroborationWindowMs;
  const order = new Map(accepted.map((item, index) => [item, index]));
  // Corroboration must come from the same episode: nothing between the two may
  // show the device leaving or being elsewhere.
  const contradicts = (item: ClassifiedEvidence, placeId: string) => {
    const e = item.evidence;
    if (e.kind === "geofence_exit") return e.savedPlaceId === placeId;
    // Accurate fixes and accurate Visits elsewhere are episode boundaries, as in ordinary segmentation.
    return (e.kind === "standard_location" || e.kind === "significant_change" || e.kind === "visit") &&
      accurateCoordinate(item, input) &&
      !(item.match?.candidates.some((candidate) => candidate.id === placeId && candidate.matchClass !== "outside") ?? false);
  };
  // The arrival's own companions are the same Visit, never a boundary; Visits
  // with any other start still are.
  const companionOf = (item: ClassifiedEvidence, arrival: ClassifiedEvidence) => item.evidence.kind === "visit" &&
    item.evidence.deviceId === arrival.evidence.deviceId && item.evidence.occurredAt === arrival.evidence.occurredAt;
  const sameEpisode = (a: ClassifiedEvidence, b: ClassifiedEvidence, placeId: string) => {
    const [low, high] = [order.get(a)!, order.get(b)!].sort((x, y) => x - y);
    for (let index = low + 1; index < high; index += 1) {
      if (!companionOf(accepted[index], a) && contradicts(accepted[index], placeId)) return false;
    }
    return true;
  };
  // An arrival Visit dated before the device arrived: every contradiction after
  // it is an accurate fix away within `savedPlaceVisitEarlyArrivalMaximumMs`
  // (the approach; never the place's exit), and the place's entry or a strong
  // inside fix follows the last of them within that time. That evidence is
  // where the device was observed to arrive. Null when the Visit is not one.
  const earlyArrivalAnchor = (visit: ClassifiedEvidence, placeId: string, corroborates: (other: ClassifiedEvidence) => boolean) => {
    const arrivalMs = Date.parse(visit.evidence.occurredAt);
    const limitMs = arrivalMs + input.config.savedPlaceVisitEarlyArrivalMaximumMs;
    let approached = false;
    for (let index = order.get(visit)! + 1; index < accepted.length; index += 1) {
      const other = accepted[index];
      if (Date.parse(other.evidence.occurredAt) > limitMs) break;
      if (other.evidence.deviceId !== visit.evidence.deviceId || companionOf(other, visit)) continue;
      if (other.evidence.kind === "geofence_exit" && other.evidence.savedPlaceId === placeId) return null;
      if (contradicts(other, placeId)) {
        if (other.evidence.kind === "visit") return null;
        approached = true;
        continue;
      }
      if (approached && corroborates(other)) return other;
    }
    return null;
  };
  const arrivals = new Map<string, CorroboratedArrival>();
  const consumedCompletionIds = new Set<string>();
  for (const item of accepted) {
    const e = item.evidence;
    const placeId = item.match?.kind === "saved" ? item.match.placeId : null;
    if (e.kind !== "visit" || e.endedAt || e.isSimulated === true || !placeId || !accurateCoordinate(item, input) ||
      !item.match!.candidates.some((candidate) => candidate.id === placeId && candidate.matchClass === "strong")) continue;
    const arrivalMs = Date.parse(e.occurredAt);
    const corroborates = (other: ClassifiedEvidence) => other !== item && other.evidence.deviceId === e.deviceId &&
      ((other.evidence.kind === "geofence_enter" && other.evidence.savedPlaceId === placeId) || strongSavedPoint(other, placeId, input));
    const observedArrival = accepted.some((other) => corroborates(other) &&
      Math.abs(Date.parse(other.evidence.occurredAt) - arrivalMs) <= windowMs && sameEpisode(item, other, placeId))
      ? undefined
      : earlyArrivalAnchor(item, placeId, corroborates);
    if (observedArrival === null) continue;
    const companions = completions.get(`${e.deviceId}:${e.occurredAt}`) ?? [];
    const usable = (completion: ClassifiedEvidence) => {
      const departedMs = Date.parse(completion.evidence.endedAt!);
      const inferred = corroboratedVisits.get(completion.evidence.clientEvidenceId);
      return completion.evidence.isSimulated !== true &&
        !accepted.some(({ evidence }) => evidence.kind === "visit" && evidence.deviceId === e.deviceId &&
          evidence.occurredAt !== e.occurredAt &&
          Date.parse(evidence.occurredAt) > arrivalMs && Date.parse(evidence.occurredAt) < departedMs) &&
        (inferred ? inferred.savedPlaceId === placeId
          : completion.match?.candidates.some((candidate) => candidate.id === placeId && candidate.matchClass !== "outside") ?? false);
    };
    // The earliest usable departure bounds presence; ties resolve by client ID.
    const selected = companions.filter(usable).sort((a, b) =>
      Date.parse(a.evidence.endedAt!) - Date.parse(b.evidence.endedAt!) ||
      a.evidence.clientEvidenceId.localeCompare(b.evidence.clientEvidenceId))[0] ?? null;
    const inferred = selected != null && corroboratedVisits.has(selected.evidence.clientEvidenceId);
    // An early-dated arrival must still be under way at its observed arrival (a Visit already departed is an
    // earlier visit), and an episode the broad-Visit path already supports keeps that path.
    if (observedArrival && (companions.some((companion) => corroboratedVisits.has(companion.evidence.clientEvidenceId)) ||
      selected != null && Date.parse(selected.evidence.endedAt!) <= Date.parse(observedArrival.evidence.occurredAt))) continue;
    arrivals.set(e.clientEvidenceId, {
      departedAt: selected?.evidence.endedAt ?? null,
      completion: selected && !inferred ? selected : null,
      ...(observedArrival ? { observedArrival } : {})
    });
    // Only a selected companion on the corroborated broad-Visit path is segmented as before.
    for (const companion of companions) if (companion !== selected || !inferred) consumedCompletionIds.add(companion.evidence.clientEvidenceId);
  }
  return { arrivals, consumedCompletionIds };
}

function latestObservationMs(working: WorkingStay) {
  return working.evidence.reduce((latest, { evidence }) =>
    evidence.kind.startsWith("geofence_") ? latest : Math.max(latest, Date.parse(evidence.occurredAt)),
  Date.parse(working.startedAt));
}

function resolveUnsupportedExit(active: WorkingStay, config: LocationEngineConfig) {
  const exit = active.pendingExit!;
  closeAtTransition(active, exit.evidence.occurredAt, "uncertain_gap", config);
  active.evidence.push(exit);
  active.pendingExit = undefined;
  active.inferredContinuity = true;
}

function closeAtCorroboratedDeparture(active: WorkingStay, nextAt: string, config: LocationEngineConfig) {
  const exit = active.pendingExit;
  const exactVisitDeparture = active.visitSupportUntilAt && Date.parse(active.visitSupportUntilAt) <= Date.parse(nextAt);
  const exitAt = exit?.evidence.occurredAt;
  const boundary = !exactVisitDeparture && exitAt && Date.parse(exitAt) >= Date.parse(lastInsideAt(active, nextAt))
    ? exitAt : nextAt;
  closeAtTransition(active, boundary, "broken_by_other_place", config);
  if (exit) active.evidence.push(exit);
  active.pendingExit = undefined;
}

function supportedKnownPlaceEnd(working: WorkingStay, processingAt: string) {
  const latestPoint = working.evidence.reduce((latest, { evidence }) =>
    evidence.kind.startsWith("geofence_") ? latest : Math.max(latest, Date.parse(evidence.occurredAt)),
  Date.parse(working.startedAt));
  const intervalEnd = working.visitSupportUntilAt ? Date.parse(working.visitSupportUntilAt) : latestPoint;
  // Clip actual support to the resolved window. A short/contradicted old Visit cannot
  // promote the unsupported midpoint between a passing fix and a distant later point.
  return new Date(Math.min(Date.parse(working.stoppedAt ?? processingAt), Math.max(latestPoint, intervalEnd))).toISOString();
}

/**
 * An edge stay as the cluster it would be: from its first Visit or non-moving
 * reading (edgeClusterStart). Movement before that (a drive through the circle
 * before parking beside it) stays route evidence and does not lengthen it.
 */
function edgeStayFromClusterStart(working: WorkingStay, input: LocationEngineInput): WorkingStay {
  const start = edgeOnly(working, input) ? edgeClusterStart(working, input) : 0;
  if (start === 0) return working;
  const evidence = working.evidence.slice(start);
  const startedAt = evidence[0].evidence.occurredAt;
  return { ...working, evidence, startedAt, startLowerBoundAt: startedAt, startUpperBoundAt: startedAt, edgeScan: undefined };
}

function stayFromWorking(
  original: WorkingStay,
  processingAt: string,
  input: LocationEngineInput,
  accepted: ClassifiedEvidence[]
): StaySegment | null {
  const working = edgeStayFromClusterStart(original, input);
  const endedAt = working.stoppedAt;
  const duration = Date.parse(endedAt ?? processingAt) - Date.parse(working.startedAt);
  const coordinateEvidence = working.evidence.filter(({ evidence }) =>
    pointFor(evidence) && (!working.inferredBoundary || evidence.kind !== "visit")
  );
  // Identity first: a stay beside a saved place is promoted and described as unknown.
  const identity = stayIdentity(working, accepted, input);
  const knownPlace = identity.placeMatchKind === "saved" || identity.placeMatchKind === "learned";
  const completedVisit = working.evidence.some(
    ({ evidence }) => evidence.kind === "visit" && evidence.endedAt && Date.parse(evidence.endedAt) > Date.parse(evidence.occurredAt)
  );
  // After a corroborated arrival the device was present until departure
  // evidence, or until now for an open stay. Clock-based presence is suspended
  // while an exit or outside reading is unresolved, and never exceeds the cap
  // or the departure iOS reported for that Visit.
  const presenceCapMs = Math.min(latestObservationMs(working) + input.config.savedPlaceOpenVisitPresenceMaximumMs,
    working.arrivalPresenceUntilAt ? Date.parse(working.arrivalPresenceUntilAt) : Number.POSITIVE_INFINITY);
  const presenceEndMs = !working.arrivalPresence
    ? null
    : endedAt
      ? Math.min(Date.parse(endedAt), presenceCapMs)
      : !working.pendingExit && working.outside.length === 0
        ? Math.min(Date.parse(processingAt), presenceCapMs)
        : null;
  const knownPlaceEnd = presenceEndMs != null
    ? new Date(Math.max(Date.parse(supportedKnownPlaceEnd(working, processingAt)), presenceEndMs)).toISOString()
    : supportedKnownPlaceEnd(working, processingAt);
  // A saved stay described as unknown with no still fix and no Visit is
  // movement through the circle, which no unknown cluster would start.
  const movementOnly = working.placeMatchKind === "saved" && !knownPlace &&
    !working.evidence.some((item) => item.evidence.kind === "visit" || stationaryFix(item, input));
  const promotable = knownPlace
    ? hasMeaningfulKnownPlaceWindow(working.startedAt,
        knownPlaceEnd,
        input.config.savedPlaceMinimumDwellMs)
    : !movementOnly && duration >= input.config.unknownStayCandidateDwellMs &&
      (coordinateEvidence.length >= input.config.minimumGpsSamplesForUnanchoredStay || completedVisit);
  if (!promotable || (endedAt && Date.parse(endedAt) <= Date.parse(working.startedAt))) return null;

  const centre = evidenceCentre(
    working.inferredBoundary
      ? working.evidence.filter(({ evidence }) => evidence.kind !== "visit")
      : working.evidence
  );
  const evidenceIds = working.evidence.map(({ evidence }) => evidence.clientEvidenceId);
  const identityEvidence = working.identityExcluded
    ? working.evidence.filter((item) => !working.identityExcluded!.has(item)) : working.evidence;
  const firstEvidenceId = (identityEvidence[0] ?? working.evidence[0]).evidence.clientEvidenceId;
  const lastEvidenceId = (identityEvidence.at(-1) ?? working.evidence.at(-1)!).evidence.clientEvidenceId;
  const simulated = working.evidence.some(({ evidence }) => evidence.isSimulated);
  const highQualityCount = working.evidence.filter(
    ({ evidence }) =>
      evidence.horizontalAccuracyMeters != null &&
      evidence.horizontalAccuracyMeters <= input.config.highQualityHorizontalAccuracyMeters
  ).length;
  const confidence = simulated
    ? "low"
    : working.inferredBoundary
      ? "medium"
    : working.inferredContinuity
      ? "medium"
    : working.supportedByVisit || knownPlace
      ? highQualityCount > 0
        ? "medium_high"
        : "medium"
      : highQualityCount >= input.config.minimumGpsSamplesForUnanchoredStay
        ? "medium"
        : "low";
  const stoppedAtMs = endedAt ? Date.parse(endedAt) : null;
  return {
    kind: "stay",
    // A stay described as unknown beside a saved place is a different segment
    // from the saved-place stay the same evidence becomes once iOS places the
    // device inside, so replay retires the earlier segment and its open Review.
    clientSegmentId: stableLocationId("stay", [
      input.config.algorithmVersion,
      working.evidence[0].evidence.deviceId,
      firstEvidenceId,
      lastEvidenceId,
      working.key,
      ...(identity.placeMatchKind === working.placeMatchKind ? [] : [identity.placeMatchKind])
    ]),
    algorithmVersion: input.config.algorithmVersion,
    status:
      stoppedAtMs == null
        ? "open"
        : Date.parse(processingAt) - stoppedAtMs >= input.config.segmentFinalisationLagMs
          ? "finalised"
          : "closed",
    startedAt: working.startedAt,
    stoppedAt: endedAt,
    startLowerBoundAt: working.startLowerBoundAt,
    startUpperBoundAt: working.startUpperBoundAt,
    stopLowerBoundAt: working.stopLowerBoundAt,
    stopUpperBoundAt: working.stopUpperBoundAt,
    placeId: identity.placeId,
    learnedPlaceId: identity.learnedPlaceId,
    placeMatchKind: identity.placeMatchKind,
    candidatePlaceIds: identity.candidatePlaceIds,
    centreLatitude: centre?.latitude ?? null,
    centreLongitude: centre?.longitude ?? null,
    radiusMeters: knownPlace
      ? working.evidence[0].match?.candidates.find((candidate) => candidate.id === (identity.placeId ?? identity.learnedPlaceId))
          ?.radiusMeters ?? null
      : input.config.unknownStayBaseRadiusMeters,
    sampleCount: coordinateEvidence.length,
    continuityStatus: working.continuityStatus,
    confidence,
    ...(working.approximateArrival ? { approximateArrival: true as const } : {}),
    evidenceIds
  };
}

function stayFromPhysicalStop(stop: PhysicalStop, accepted: ClassifiedEvidence[], input: LocationEngineInput): StaySegment {
  const deviceId = accepted.find(({ evidence }) => evidence.clientEvidenceId === stop.evidenceIds[0])?.evidence.deviceId ??
    accepted[0].evidence.deviceId;
  const approximate = stop.startLowerBoundAt !== stop.startUpperBoundAt;
  return {
    kind: "stay",
    clientSegmentId: stableLocationId("stay", [
      input.config.algorithmVersion,
      deviceId,
      stop.evidenceIds[0],
      stop.evidenceIds[stop.evidenceIds.length - 1],
      "physical_stop"
    ]),
    algorithmVersion: input.config.algorithmVersion,
    status: Date.parse(input.processingAt) - Date.parse(stop.stoppedAt) >= input.config.segmentFinalisationLagMs
      ? "finalised"
      : "closed",
    startedAt: stop.startedAt,
    stoppedAt: stop.stoppedAt,
    startLowerBoundAt: stop.startLowerBoundAt,
    startUpperBoundAt: stop.startUpperBoundAt,
    stopLowerBoundAt: stop.stopLowerBoundAt,
    stopUpperBoundAt: stop.stopUpperBoundAt,
    placeId: null,
    learnedPlaceId: null,
    // Identity stays unknown: proximity to a saved area is a candidate, not proof of attendance.
    placeMatchKind: "unknown",
    ...(approximate ? { approximateArrival: true as const } : {}),
    formation: "physical_stop",
    candidatePlaceIds: stop.candidatePlaceIds,
    centreLatitude: stop.centre.latitude,
    centreLongitude: stop.centre.longitude,
    radiusMeters: input.config.unknownStayBaseRadiusMeters,
    sampleCount: stop.slowSampleCount,
    continuityStatus: stop.supportedByVisit ? "supported_by_visit" : "continuous",
    confidence: "medium",
    evidenceIds: stop.evidenceIds
  };
}

/**
 * The evidence and identity of one stay over a physical stop and the promoted
 * fragments of it it covers: a saved place applies only when every fragment was
 * that place and the merged evidence places the device there (stillAtSavedPlace).
 */
function absorbedIdentity(stop: PhysicalStop, fragments: StaySegment[], accepted: ClassifiedEvidence[], input: LocationEngineInput,
  reused: ReadonlySet<ClassifiedEvidence>) {
  const order = new Map(accepted.map((item, index) => [item.evidence.clientEvidenceId, index]));
  const evidenceIds = [...new Set([...stop.evidenceIds, ...fragments.flatMap((stay) => stay.evidenceIds)])]
    .filter((id) => order.has(id))
    .sort((left, right) => order.get(left)! - order.get(right)!);
  const items = evidenceIds.map((id) => accepted[order.get(id)!]);
  const startMs = Math.min(Date.parse(stop.startedAt), ...fragments.map((stay) => Date.parse(stay.startedAt)));
  // A Visit that arrived before this episode began (one a fragment reused, or
  // an earlier visit's carried in with the stop's evidence) is interval
  // support of that earlier episode only: never identity proof here.
  const earlier = new Set([...reused, ...items.filter((item) =>
    item.evidence.kind === "visit" && Date.parse(item.evidence.occurredAt) < startMs)]);
  const placeIds = [...new Set(fragments.map((stay) => stay.placeMatchKind === "saved" ? stay.placeId : null))];
  const placeId = placeIds.length === 1 && placeIds[0] &&
    stillAtSavedPlace(placeIds[0], items, accepted, startMs, input, earlier) ? placeIds[0] : null;
  return { evidenceIds, items, placeId, startMs, earlier };
}

/**
 * One stay over a physical stop that covers promoted fragments of it, starting
 * at `startMs` (see the absorption loop) and ending where the stop or its last
 * fragment does.
 */
function stayAbsorbingFragments(stop: PhysicalStop, fragments: StaySegment[], identity: ReturnType<typeof absorbedIdentity>,
  startMs: number, accepted: ClassifiedEvidence[], input: LocationEngineInput): StaySegment {
  const base = stayFromPhysicalStop(stop, accepted, input);
  const { evidenceIds, items, placeId } = identity;
  // A fragment's own (possibly corroborated) arrival bounds win a tie with the stop's estimate.
  const startingStay = [...fragments, base].find((stay) => Date.parse(stay.startedAt) === startMs);
  const observedStart = new Date(startMs).toISOString();
  const earliest = startingStay ?? { startedAt: observedStart, startLowerBoundAt: observedStart, startUpperBoundAt: observedStart };
  const latest = [base, ...fragments].reduce((last, stay) => Date.parse(stay.stoppedAt!) > Date.parse(last.stoppedAt!) ? stay : last);
  const circle = savedCircle(placeId, input);
  const stoppedAt = latest.stoppedAt!;
  const shape: StaySegment = { ...base };
  delete shape.approximateArrival;
  return {
    ...shape,
    // As for an edge stay, the identity is part of the ID, so a late iOS entry
    // that proves the place makes replay retire the unknown segment's Review.
    clientSegmentId: stableLocationId("stay", [
      input.config.algorithmVersion, items[0].evidence.deviceId, evidenceIds[0], evidenceIds[evidenceIds.length - 1], "physical_stop",
      ...(placeId ? ["saved", placeId] : [])
    ]),
    status: Date.parse(input.processingAt) - Date.parse(stoppedAt) >= input.config.segmentFinalisationLagMs ? "finalised" : "closed",
    startedAt: earliest.startedAt,
    startLowerBoundAt: earliest.startLowerBoundAt,
    startUpperBoundAt: earliest.startUpperBoundAt,
    stoppedAt,
    stopLowerBoundAt: latest.stopLowerBoundAt,
    stopUpperBoundAt: latest.stopUpperBoundAt,
    placeId,
    placeMatchKind: placeId ? "saved" : "unknown",
    ...(startingStay?.approximateArrival ? { approximateArrival: true as const } : {}),
    candidatePlaceIds: [...new Set([
      ...fragments.flatMap((stay) => stay.placeId ? [stay.placeId] : []),
      ...fragments.flatMap((stay) => stay.candidatePlaceIds ?? []),
      ...stop.candidatePlaceIds
    ])].sort(),
    radiusMeters: circle ? circle.radius : input.config.unknownStayBaseRadiusMeters,
    evidenceIds
  };
}

/**
 * The longest silence in [from, to] (between observations, or an end and the
 * nearest one) that reaches time no fragment covers, counted in full: a
 * fragment's own end can be an estimate, never an observation. A silence a
 * Visit's interval spans is supported.
 */
function longestNewSilenceMs(from: number, to: number, observedMs: number[], covered: Array<[number, number]>,
  visitSpans: Array<[number, number]>) {
  let longest = 0;
  let previous = from;
  for (const at of [...observedMs.filter((time) => time > from && time < to).sort((a, b) => a - b), to]) {
    const withinFragment = covered.some(([start, end]) => start <= previous && end >= at);
    const supported = visitSpans.some(([start, end]) => start <= previous && end >= at);
    if (!withinFragment && !supported) longest = Math.max(longest, at - previous);
    previous = at;
  }
  return longest;
}

function preprocess(input: LocationEngineInput) {
  const rejectedEvidence: RejectedEvidence[] = [];
  const seen = new Set<string>();
  const sorted = input.evidence.map((evidence) => ({ ...evidence, metadata: evidence.metadata ? { ...evidence.metadata } : undefined })).sort((a, b) => {
    const timeDifference = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    return timeDifference || SOURCE_PRECEDENCE[a.kind] - SOURCE_PRECEDENCE[b.kind] || a.clientEvidenceId.localeCompare(b.clientEvidenceId);
  });
  const accepted: ClassifiedEvidence[] = [];
  let previousPoint: LocationEvidence | null = null;
  for (const evidence of sorted) {
    if (seen.has(`${evidence.deviceId}:${evidence.clientEvidenceId}`)) {
      rejectedEvidence.push({ clientEvidenceId: evidence.clientEvidenceId, kind: evidence.kind, occurredAt: evidence.occurredAt, reason: "duplicate" });
      continue;
    }
    seen.add(`${evidence.deviceId}:${evidence.clientEvidenceId}`);
    const occurredAtMs = Date.parse(evidence.occurredAt);
    if (!Number.isFinite(occurredAtMs) || occurredAtMs > Date.parse(input.processingAt) + 10 * 60_000) {
      rejectedEvidence.push({ clientEvidenceId: evidence.clientEvidenceId, kind: evidence.kind, occurredAt: evidence.occurredAt, reason: "invalid_timestamp" });
      continue;
    }
    const hasOneCoordinate = (evidence.latitude == null) !== (evidence.longitude == null);
    if (
      hasOneCoordinate ||
      (evidence.latitude != null && (evidence.latitude < -90 || evidence.latitude > 90)) ||
      (evidence.longitude != null && (evidence.longitude < -180 || evidence.longitude > 180))
    ) {
      rejectedEvidence.push({ clientEvidenceId: evidence.clientEvidenceId, kind: evidence.kind, occurredAt: evidence.occurredAt, reason: "invalid_coordinate" });
      continue;
    }
    if (evidence.horizontalAccuracyMeters != null && evidence.horizontalAccuracyMeters < 0) {
      rejectedEvidence.push({ clientEvidenceId: evidence.clientEvidenceId, kind: evidence.kind, occurredAt: evidence.occurredAt, reason: "invalid_accuracy" });
      continue;
    }
    if (
      evidence.latitude != null &&
      evidence.horizontalAccuracyMeters != null &&
      evidence.horizontalAccuracyMeters > input.config.maxAcceptedHorizontalAccuracyMeters
    ) {
      rejectedEvidence.push({ clientEvidenceId: evidence.clientEvidenceId, kind: evidence.kind, occurredAt: evidence.occurredAt, reason: "accuracy_too_broad" });
      continue;
    }
    let impliedSpeedMetersPerSecond: number | null = null;
    if (previousPoint && evidence.latitude != null && evidence.longitude != null) {
      const elapsedSeconds = (occurredAtMs - Date.parse(previousPoint.occurredAt)) / 1000;
      if (elapsedSeconds > 0) {
        impliedSpeedMetersPerSecond = distanceMeters(
          { latitude: previousPoint.latitude!, longitude: previousPoint.longitude! },
          { latitude: evidence.latitude, longitude: evidence.longitude }
        ) / elapsedSeconds;
      }
      if (impliedSpeedMetersPerSecond != null && impliedSpeedMetersPerSecond > 120 && evidence.kind === "standard_location") {
        rejectedEvidence.push({ clientEvidenceId: evidence.clientEvidenceId, kind: evidence.kind, occurredAt: evidence.occurredAt, reason: "implausible_speed" });
        continue;
      }
    }
    const normalisedEvidence = {
      ...evidence,
      endedAt: evidence.kind === "visit" && evidence.endedAt &&
        Number.isFinite(Date.parse(evidence.endedAt)) && Date.parse(evidence.endedAt) > occurredAtMs &&
        Date.parse(evidence.endedAt) <= Date.parse(input.processingAt) ? evidence.endedAt : null,
      speedMetersPerSecond:
        evidence.speedMetersPerSecond != null && evidence.speedMetersPerSecond >= 0
          ? evidence.speedMetersPerSecond
          : null,
      courseDegrees:
        evidence.courseDegrees != null && evidence.courseDegrees >= 0 && evidence.courseDegrees <= 360
          ? evidence.courseDegrees
          : null
    };
    let match: PlaceMatch | null = null;
    if (normalisedEvidence.latitude != null && normalisedEvidence.longitude != null) {
      match = matchLocationToPlaces(
        {
          latitude: normalisedEvidence.latitude,
          longitude: normalisedEvidence.longitude,
          horizontalAccuracyMeters: normalisedEvidence.horizontalAccuracyMeters ?? null,
          savedPlaceIdHint: normalisedEvidence.savedPlaceId
        },
        input.savedPlaces,
        input.acceptedLearnedPlaces,
        input.config
      );
      // A completed Visit's coordinate averages its whole interval, so it is
      // never a position at its arrival time to judge the next fix's speed by.
      if (!(normalisedEvidence.kind === "visit" && normalisedEvidence.endedAt)) previousPoint = normalisedEvidence;
    } else if (normalisedEvidence.savedPlaceId) {
      match = {
        kind: "saved",
        placeId: normalisedEvidence.savedPlaceId,
        candidates: []
      };
    }
    accepted.push({ evidence: normalisedEvidence, match, impliedSpeedMetersPerSecond });
  }
  return { accepted, rejectedEvidence };
}

function resolveCorroboratedCoincidentVisits(accepted: ClassifiedEvidence[], input: LocationEngineInput) {
  const minimumCount = input.config.savedPlaceArrivalMinimumStrongPointCount;
  const windowMs = input.config.savedPlaceArrivalCorroborationWindowMs;
  for (const item of accepted) {
    const { evidence, match } = item;
    if (evidence.kind !== "visit" || !evidence.endedAt || evidence.isSimulated ||
        match?.kind !== "ambiguous" || match.candidates.length !== 2) continue;
    const saved = match.candidates.find((candidate) => candidate.source === "saved" && candidate.matchClass === "strong");
    const learned = match.candidates.find((candidate) => candidate.source === "learned" && candidate.matchClass === "strong");
    if (!saved || !learned) continue;
    const startedAtMs = Date.parse(evidence.occurredAt);
    const stoppedAtMs = Date.parse(evidence.endedAt);
    if (!Number.isFinite(stoppedAtMs) || stoppedAtMs - startedAtMs < input.config.savedPlaceMinimumDwellMs) continue;
    const independent = accepted.filter((candidate) => {
      const at = Date.parse(candidate.evidence.occurredAt);
      return at >= startedAtMs && at <= stoppedAtMs &&
        (candidate.evidence.kind === "standard_location" || candidate.evidence.kind === "significant_change") &&
        !candidate.evidence.isSimulated && accurateCoordinate(candidate, input);
    });
    if (independent.some((candidate) =>
      !strongSavedPoint(candidate, saved.id, input) ||
      (candidate.evidence.speedMetersPerSecond ?? 0) >= input.config.movementSpeedThresholdMps
    )) continue;
    const early = independent.filter((candidate) =>
      Date.parse(candidate.evidence.occurredAt) <= startedAtMs + windowMs
    );
    const late = independent.filter((candidate) =>
      Date.parse(candidate.evidence.occurredAt) >= stoppedAtMs - windowMs
    );
    if (new Set(early.map((candidate) => candidate.evidence.occurredAt)).size < minimumCount ||
        new Set(late.map((candidate) => candidate.evidence.occurredAt)).size < minimumCount) continue;
    item.match = { ...match, kind: "saved", placeId: saved.id };
  }
}

function resolveCorroboratedCoincidentArrivals(accepted: ClassifiedEvidence[], input: LocationEngineInput) {
  // Preserve a weak approach observation as the saved episode's boundary only
  // after later independent saved points prove that continuation. An isolated
  // plausible overlap keeps its ambiguous match.
  const minimumCount = input.config.savedPlaceArrivalMinimumStrongPointCount;
  const arrivalWindowMs = input.config.savedPlaceArrivalCorroborationWindowMs;
  const continuityWindowMs = input.config.maxContinuityGapMs;
  for (let index = 0; index < accepted.length; index += 1) {
    const item = accepted[index];
    const { evidence, match } = item;
    if ((evidence.kind !== "standard_location" && evidence.kind !== "significant_change") ||
        evidence.isSimulated || match?.kind !== "ambiguous" || match.candidates.length !== 2 ||
        !accurateCoordinate(item, input)) continue;
    const saved = match.candidates.find((candidate) => candidate.source === "saved" && candidate.matchClass === "plausible");
    const learned = match.candidates.find((candidate) => candidate.source === "learned" && candidate.matchClass === "plausible");
    if (!saved || !learned) continue;
    const atMs = Date.parse(evidence.occurredAt);
    const strongTimes = new Set<number>();
    let contradicted = false;
    for (let nextIndex = index + 1; nextIndex < accepted.length; nextIndex += 1) {
      const next = accepted[nextIndex];
      const nextAtMs = Date.parse(next.evidence.occurredAt);
      if (nextAtMs > atMs + continuityWindowMs) break;
      if (next.evidence.kind === "geofence_exit" && next.evidence.savedPlaceId === saved.id) {
        contradicted = true;
        break;
      }
      if (!accurateCoordinate(next, input) || next.evidence.isSimulated) continue;
      if ((next.evidence.kind !== "standard_location" && next.evidence.kind !== "significant_change") ||
          !strongSavedPoint(next, saved.id, input) ||
          Math.max(next.evidence.speedMetersPerSecond ?? 0, next.impliedSpeedMetersPerSecond ?? 0) >=
            input.config.movementSpeedThresholdMps) {
        contradicted = true;
        break;
      }
      if (strongTimes.size === 0 && nextAtMs > atMs + arrivalWindowMs) break;
      strongTimes.add(nextAtMs);
      if (strongTimes.size >= minimumCount) break;
    }
    if (!contradicted && strongTimes.size >= minimumCount) {
      item.match = { ...match, kind: "saved", placeId: saved.id };
    }
  }
}

function minimumConfidence(
  left: StaySegment["confidence"],
  right: StaySegment["confidence"]
): StaySegment["confidence"] {
  const order: StaySegment["confidence"][] = ["low", "medium", "medium_high", "high"];
  return order[Math.min(order.indexOf(left), order.indexOf(right))];
}

function coalescedContinuity(left: StaySegment, right: StaySegment): ContinuityStatus {
  if (left.continuityStatus === "uncertain_gap" || right.continuityStatus === "uncertain_gap") {
    return "uncertain_gap";
  }
  return "supported_by_visit";
}

function weightedStayCentre(left: StaySegment, right: StaySegment) {
  if (
    left.centreLatitude == null ||
    left.centreLongitude == null ||
    right.centreLatitude == null ||
    right.centreLongitude == null
  ) {
    return null;
  }
  const leftWeight = Math.max(1, left.sampleCount);
  const rightWeight = Math.max(1, right.sampleCount);
  const totalWeight = leftWeight + rightWeight;
  return {
    latitude:
      (left.centreLatitude * leftWeight + right.centreLatitude * rightWeight) / totalWeight,
    longitude:
      (left.centreLongitude * leftWeight + right.centreLongitude * rightWeight) / totalWeight
  };
}

function transitionRouteDistance(
  left: StaySegment,
  routeEvidence: ClassifiedEvidence[],
  right: StaySegment
) {
  const points = [
    left.centreLatitude != null && left.centreLongitude != null
      ? { latitude: left.centreLatitude, longitude: left.centreLongitude }
      : null,
    ...routeEvidence.map(({ evidence }) =>
      evidence.latitude != null && evidence.longitude != null
        ? { latitude: evidence.latitude, longitude: evidence.longitude }
        : null
    ),
    right.centreLatitude != null && right.centreLongitude != null
      ? { latitude: right.centreLatitude, longitude: right.centreLongitude }
      : null
  ].filter((point): point is { latitude: number; longitude: number } => point != null);
  if (points.length < 2) return null;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distanceMeters(points[index - 1], points[index]);
  }
  return total;
}

function upperQuartile(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.75) - 1)];
}

/**
 * Joins only evidence-backed unknown stays that look like two parts of one
 * large-site visit. It intentionally does not infer site identity for saved or
 * learned places and requires an actual visit observation on one side.
 */
export function coalesceCompatibleUnknownStays(
  stays: StaySegment[],
  acceptedEvidence: ClassifiedEvidence[],
  input: LocationEngineInput
) {
  const evidenceById = new Map(
    acceptedEvidence.map((item) => [item.evidence.clientEvidenceId, item])
  );
  const evidenceOrder = new Map(
    acceptedEvidence.map((item, index) => [item.evidence.clientEvidenceId, index])
  );
  const result: StaySegment[] = [];

  for (const nextStay of stays) {
    const previousStay = result.at(-1);
    if (
      !previousStay ||
      previousStay.placeMatchKind !== "unknown" ||
      nextStay.placeMatchKind !== "unknown" ||
      previousStay.stoppedAt == null ||
      previousStay.centreLatitude == null ||
      previousStay.centreLongitude == null ||
      nextStay.centreLatitude == null ||
      nextStay.centreLongitude == null
    ) {
      result.push(nextStay);
      continue;
    }

    const transitionMs = Date.parse(nextStay.startedAt) - Date.parse(previousStay.stoppedAt);
    const endpointDistance = distanceMeters(
      {
        latitude: previousStay.centreLatitude,
        longitude: previousStay.centreLongitude
      },
      {
        latitude: nextStay.centreLatitude,
        longitude: nextStay.centreLongitude
      }
    );
    const hasVisitSupport = [...previousStay.evidenceIds, ...nextStay.evidenceIds].some(
      (evidenceId) => evidenceById.get(evidenceId)?.evidence.kind === "visit"
    );
    const occupiedEvidence = new Set([
      ...previousStay.evidenceIds,
      ...nextStay.evidenceIds
    ]);
    const routeEvidence = acceptedEvidence.filter((item) => {
      if (occupiedEvidence.has(item.evidence.clientEvidenceId)) return false;
      const at = Date.parse(item.evidence.occurredAt);
      return (
        at > Date.parse(previousStay.stoppedAt!) &&
        at < Date.parse(nextStay.startedAt) &&
        item.evidence.latitude != null &&
        item.evidence.longitude != null
      );
    });
    const credibleTransitionSpeeds = routeEvidence.flatMap((item) => {
      if (
        item.evidence.horizontalAccuracyMeters != null &&
        item.evidence.horizontalAccuracyMeters > input.config.commuteMaximumSpeedAccuracyMeters
      ) {
        return [];
      }
      const speed = item.evidence.speedMetersPerSecond ?? item.impliedSpeedMetersPerSecond;
      return speed != null && Number.isFinite(speed) && speed >= 0 ? [speed] : [];
    });
    const routeDistance = transitionRouteDistance(previousStay, routeEvidence, nextStay);
    const pedestrianTransition =
      routeEvidence.length >= 2 &&
      credibleTransitionSpeeds.length >= 2 &&
      (upperQuartile(credibleTransitionSpeeds) ?? Number.POSITIVE_INFINITY) <=
        input.config.visitContinuityPedestrianSpeedThresholdMps;
    const compatible =
      hasVisitSupport &&
      transitionMs >= 0 &&
      transitionMs <= input.config.visitContinuityMaximumTransitionMs &&
      endpointDistance <= input.config.visitContinuityMaximumEndpointDistanceMeters &&
      routeDistance != null &&
      routeDistance <= input.config.visitContinuityMaximumRouteDistanceMeters &&
      pedestrianTransition;

    if (!compatible) {
      result.push(nextStay);
      continue;
    }

    const centre = weightedStayCentre(previousStay, nextStay);
    const evidenceIds = [
      ...new Set([
        ...previousStay.evidenceIds,
        ...routeEvidence.map(({ evidence }) => evidence.clientEvidenceId),
        ...nextStay.evidenceIds
      ])
    ].sort(
      (left, right) =>
        (evidenceOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (evidenceOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
    );
    const radiusMeters =
      Math.ceil(
        endpointDistance / 2 +
        Math.max(previousStay.radiusMeters ?? 0, nextStay.radiusMeters ?? 0)
      );
    result[result.length - 1] = {
      ...previousStay,
      // Preserve the earliest stay identity so PR #115 can update an open
      // semantic row in place and replay cannot create a competing identity
      // for a manually resolved/corrected segment.
      clientSegmentId: previousStay.clientSegmentId,
      status: nextStay.status,
      stoppedAt: nextStay.stoppedAt,
      stopLowerBoundAt: nextStay.stopLowerBoundAt,
      stopUpperBoundAt: nextStay.stopUpperBoundAt,
      centreLatitude: centre?.latitude ?? previousStay.centreLatitude,
      centreLongitude: centre?.longitude ?? previousStay.centreLongitude,
      radiusMeters,
      sampleCount: previousStay.sampleCount + nextStay.sampleCount,
      continuityStatus: coalescedContinuity(previousStay, nextStay),
      confidence: minimumConfidence(previousStay.confidence, nextStay.confidence),
      evidenceIds
    };
  }

  return result;
}

export function runLocationEngine(input: LocationEngineInput): LocationEngineOutput {
  if (new Set(input.evidence.map(evidence => evidence.deviceId)).size > 1) {
    throw new Error("Location engine replay requires evidence from one device.");
  }
  if (input.config.algorithmVersion !== input.priorState.algorithmVersion && input.priorState.processedEvidenceIds.length > 0) {
    throw new Error("Location engine state version does not match the requested configuration.");
  }
  if (!Number.isFinite(Date.parse(input.processingAt))) throw new Error("processingAt must be a valid instant.");

  // A corroborated arrival's unused companion callbacks are the same Visit and
  // carry nothing the arrival has not: segment as if they were never delivered,
  // so none can act as a speed predecessor, contradiction, stop boundary or
  // route evidence. Removal only grows, so this settles in a few passes. They
  // stay in the raw journal and count as processed.
  const excluded = new Set<string>();
  for (;;) {
    const pass = runLocationEnginePass(excluded.size === 0 ? input
      : { ...input, evidence: input.evidence.filter((evidence) => !excluded.has(evidence.clientEvidenceId)) });
    const fresh = pass.unusedCompanionIds.filter((id) => !excluded.has(id));
    if (fresh.length === 0) {
      const output = pass.output;
      if (excluded.size === 0) return output;
      return {
        ...output,
        nextState: {
          ...output.nextState,
          processedEvidenceIds: [...new Set([...output.nextState.processedEvidenceIds, ...excluded])].sort()
        },
        diagnostics: { ...output.diagnostics, inputCount: input.evidence.length }
      };
    }
    for (const id of fresh) excluded.add(id);
  }
}

function runLocationEnginePass(input: LocationEngineInput): { output: LocationEngineOutput; unusedCompanionIds: string[] } {
  const { accepted, rejectedEvidence } = preprocess(input);
  resolveCorroboratedCoincidentVisits(accepted, input);
  resolveCorroboratedCoincidentArrivals(accepted, input);
  const arrivalAnalysis = analyseSavedPlaceArrivalEvidence(accepted, input);
  const unknownArrivalBounds = unknownVisitArrivalBounds(accepted, input);
  const { arrivals: corroboratedArrivals, consumedCompletionIds } =
    corroboratedVisitArrivals(accepted, input, arrivalAnalysis.corroboratedVisits);
  const acceptedOrder = new Map(accepted.map((item, index) => [item, index]));
  const attachedCompletions = new Set([...corroboratedArrivals.values()].flatMap(({ completion }) => completion ? [completion] : []));
  const unusedCompanionIds = accepted.filter((item) =>
    consumedCompletionIds.has(item.evidence.clientEvidenceId) && !attachedCompletions.has(item)).map((item) => item.evidence.clientEvidenceId);
  const markArrivalPresence = (stay: WorkingStay, item: ClassifiedEvidence) => {
    const arrival = corroboratedArrivals.get(item.evidence.clientEvidenceId);
    if (!arrival || stay.placeMatchKind !== "saved" || item.match?.placeId !== stay.placeId) return;
    stay.arrivalPresence = true;
    stay.arrivalPresenceUntilAt = arrival.departedAt;
    stay.arrivalPresenceFromAt = item.evidence.occurredAt;
    stay.arrivalPresenceDeferred = false;
    const completion = arrival.completion;
    if (!completion || stay.evidence.includes(completion)) return;
    // The arrival's own completed callback joins here, whatever its delivery
    // order, as the same Visit's interval support. An accurate one keeps the
    // position it always had beside the arrival, so stay identities do not
    // change; a broad one, which was never used before, follows the arrival, so
    // the stay keeps its identity when it is delivered. Support resting on a
    // broad callback stays inferred: medium confidence, never automatic.
    const endedAt = completion.evidence.endedAt!;
    const arrivalIndex = stay.evidence.lastIndexOf(item);
    const before = accurateCoordinate(completion, input) && acceptedOrder.get(completion)! < acceptedOrder.get(item)!;
    stay.evidence.splice(before ? arrivalIndex : arrivalIndex + 1, 0, completion);
    stay.supportedByVisit = true;
    if (!stay.visitSupportUntilAt || Date.parse(endedAt) > Date.parse(stay.visitSupportUntilAt)) stay.visitSupportUntilAt = endedAt;
    if (Date.parse(completion.evidence.occurredAt) >= Date.parse(stay.startedAt) &&
      (!stay.episodeVisitUntilAt || Date.parse(endedAt) > Date.parse(stay.episodeVisitUntilAt))) stay.episodeVisitUntilAt = endedAt;
    stay.stoppedAt = endedAt;
    stay.stopLowerBoundAt = endedAt;
    stay.stopUpperBoundAt = endedAt;
    stay.continuityStatus = "supported_by_visit";
    if (!accurateCoordinate(completion, input)) stay.inferredContinuity = true;
  };
  // Early-dated arrivals join a stay of their place at the evidence that showed
  // the device arriving (their anchor), never at their own earlier time. If
  // another branch set the anchor aside (another saved stay was active), the
  // next evidence there within the corroboration window takes its place. They
  // and their completions never define the stay's identity, so its ID does not
  // change when the completion is delivered later.
  const pendingEarlyArrivals = accepted.flatMap((item) => {
    const anchor = corroboratedArrivals.get(item.evidence.clientEvidenceId)?.observedArrival;
    return item.evidence.kind === "visit" && anchor && item.match?.placeId
      ? [{ visit: item, placeId: item.match.placeId, anchor, anchorMs: Date.parse(anchor.evidence.occurredAt) }] : [];
  });
  const earlyArrivals = new Set(pendingEarlyArrivals.map(({ visit }) => visit));
  // Whether the device left or was elsewhere between two items, in accepted
  // order: the place's exit, or an accurate fix or Visit not matching it.
  const brokenBetween = (from: ClassifiedEvidence, to: ClassifiedEvidence, placeId: string) => {
    for (let index = acceptedOrder.get(from)! + 1; index < acceptedOrder.get(to)!; index += 1) {
      const between = accepted[index].evidence;
      if (between.kind === "geofence_exit" && between.savedPlaceId === placeId) return true;
      if ((between.kind === "standard_location" || between.kind === "significant_change" || between.kind === "visit") &&
        accurateCoordinate(accepted[index], input) &&
        !(accepted[index].match?.candidates.some((candidate) => candidate.id === placeId && candidate.matchClass !== "outside") ?? false)) return true;
    }
    return false;
  };
  const attachEarlyArrival = (stay: WorkingStay, item: ClassifiedEvidence) => {
    if (stay.placeMatchKind !== "saved" || pendingEarlyArrivals.length === 0) return;
    const atMs = Date.parse(item.evidence.occurredAt);
    for (let index = 0; index < pendingEarlyArrivals.length; index += 1) {
      const pending = pendingEarlyArrivals[index];
      if (pending.placeId !== stay.placeId || atMs < pending.anchorMs ||
        atMs - pending.anchorMs > input.config.savedPlaceArrivalCorroborationWindowMs) continue;
      pendingEarlyArrivals.splice(index--, 1);
      // Never across an episode boundary or past the Visit's own departure, and
      // never over presence a newer arrival already owns.
      const departedAt = corroboratedArrivals.get(pending.visit.evidence.clientEvidenceId)?.departedAt;
      if (departedAt && Date.parse(departedAt) <= atMs) continue;
      if (item !== pending.anchor && brokenBetween(pending.anchor, item, pending.placeId)) continue;
      // A newer Visit already in the stay, completed or arrival-only, owns its
      // episode, as does a newer Visit there seen since the early one (one
      // corroborated for the place, or an accurate one matching it, such as
      // another deferred arrival), even if it could not join (broad) or came
      // before the stay began.
      const pendingMs = Date.parse(pending.visit.evidence.occurredAt);
      if (stay.evidence.some((joined) => joined.evidence.kind === "visit" && Date.parse(joined.evidence.occurredAt) > pendingMs)) continue;
      if (accepted.slice(acceptedOrder.get(pending.visit)! + 1, acceptedOrder.get(item)! + 1).some((seen) =>
        seen.evidence.kind === "visit" && Date.parse(seen.evidence.occurredAt) > pendingMs &&
        (arrivalAnalysis.corroboratedVisits.get(seen.evidence.clientEvidenceId)?.savedPlaceId === pending.placeId ||
          accurateCoordinate(seen, input) &&
          (seen.match?.candidates.some((candidate) => candidate.id === pending.placeId && candidate.matchClass !== "outside") ?? false)))) continue;
      if (stay.arrivalPresence && stay.arrivalPresenceFromAt && Date.parse(stay.arrivalPresenceFromAt) > pendingMs) continue;
      stay.evidence.push(pending.visit);
      markArrivalPresence(stay, pending.visit);
      if (stay.arrivalPresenceFromAt === pending.visit.evidence.occurredAt) stay.arrivalPresenceDeferred = true;
      const completion = corroboratedArrivals.get(pending.visit.evidence.clientEvidenceId)?.completion;
      stay.identityExcluded ??= new Set();
      stay.identityExcluded.add(pending.visit);
      if (completion) stay.identityExcluded.add(completion);
    }
  };
  // iOS reports one Visit at a time, so presence an older early arrival lent the
  // stay ends by the departure of a newer Visit that joins it later.
  const capDeferredPresence = (stay: WorkingStay, item: ClassifiedEvidence) => {
    if (!stay.arrivalPresenceDeferred || item.evidence.kind !== "visit" || !stay.arrivalPresenceFromAt ||
      Date.parse(item.evidence.occurredAt) <= Date.parse(stay.arrivalPresenceFromAt)) return;
    const departedAt = item.evidence.endedAt ?? arrivalAnalysis.corroboratedVisits.get(item.evidence.clientEvidenceId)?.departedAt;
    if (departedAt && (stay.arrivalPresenceUntilAt == null || Date.parse(departedAt) < Date.parse(stay.arrivalPresenceUntilAt))) {
      stay.arrivalPresenceUntilAt = departedAt;
    }
  };
  const completed: WorkingStay[] = [];
  let active: WorkingStay | null = null;
  // Callbacks iOS sent for one Visit share the device and arrival time.
  const visitEpisodes = new Map<string, ClassifiedEvidence[]>();
  for (const item of accepted) {
    if (item.evidence.kind !== "visit" || !pointFor(item.evidence)) continue;
    const key = `${item.evidence.deviceId}:${item.evidence.occurredAt}`;
    visitEpisodes.set(key, [...(visitEpisodes.get(key) ?? []), item]);
  }
  // iOS sends a Visit's arrival and completion with one arrival time. When an
  // accurate, genuine one lies in an edge cluster, the Visit is that stay's own,
  // so a callback beyond the cluster is displaced (an averaged completion,
  // possibly matching a neighbouring saved place), in whichever order they
  // arrive. A broad or simulated callback in the cluster does not make it own.
  const ownVisitDisplaced = (stay: WorkingStay, item: ClassifiedEvidence) => {
    const radius = input.config.unknownStayBaseRadiusMeters;
    if (nearEdgeCluster(stay, item, input, radius)) return false;
    return (visitEpisodes.get(`${item.evidence.deviceId}:${item.evidence.occurredAt}`) ?? []).some((callback) =>
      callback !== item && callback.evidence.isSimulated !== true && accurateCoordinate(callback, input) &&
      nearEdgeCluster(stay, callback, input, radius));
  };
  // Occurrence-ordered, owner/device-local interval support; never a second durable store.
  const visits = new Map<string, ClassifiedEvidence>();
  const applyUnknownVisitArrivalBound = (stay: WorkingStay, item: ClassifiedEvidence) => {
    const unknownBound = unknownArrivalBounds.get(item.evidence.clientEvidenceId);
    if (stay.key === "unknown" && unknownBound) {
      stay.startLowerBoundAt = unknownBound.lower;
      stay.startUpperBoundAt = unknownBound.upper;
      stay.approximateArrival = unknownBound.lower !== stay.startedAt;
    }
  };
  const startStay = (item: ClassifiedEvidence) => {
    const stay = makeWorkingStay(item);
    applyUnknownVisitArrivalBound(stay, item);
    const corroboratedSupport = arrivalAnalysis.corroboratedVisits.get(item.evidence.clientEvidenceId);
    if (corroboratedSupport) {
      stay.inferredBoundary = true;
      stay.inferredContinuity = true;
      stay.supportedByVisit = true;
      stay.visitSupportUntilAt = corroboratedSupport.departedAt;
      stay.episodeVisitUntilAt = corroboratedSupport.departedAt;
      stay.startedAt = corroboratedSupport.arrivedAt;
      stay.startLowerBoundAt = corroboratedSupport.arrivedAt;
      stay.startUpperBoundAt = corroboratedSupport.arrivalUpperBoundAt;
      stay.stoppedAt = corroboratedSupport.departedAt;
      stay.stopLowerBoundAt = corroboratedSupport.departureLowerBoundAt;
      stay.stopUpperBoundAt = corroboratedSupport.departedAt;
      stay.continuityStatus = "uncertain_gap";
    } else if (strongSavedPoint(item, stay.placeId, input)) {
      stay.lastStrongInside = item;
      const visit = visits.get(`${item.evidence.deviceId}:${stay.key}`);
      if (visit?.evidence.endedAt && Date.parse(visit.evidence.endedAt) >= Date.parse(stay.startedAt)) {
        stay.evidence.push(visit);
        (stay.reusedVisits ??= new Set()).add(visit);
        stay.supportedByVisit = true;
        stay.visitSupportUntilAt = visit.evidence.endedAt;
        stay.stoppedAt = visit.evidence.endedAt;
        stay.stopLowerBoundAt = visit.evidence.endedAt;
        stay.stopUpperBoundAt = visit.evidence.endedAt;
        stay.continuityStatus = "supported_by_visit";
      }
    }
    markArrivalPresence(stay, item);
    return stay;
  };

  for (const item of accepted) {
    const evidence = item.evidence;
    const point = pointFor(evidence);
    if (!point && !evidence.savedPlaceId && evidence.kind !== "visit") continue;
    const itemKey = matchKey(item.match, evidence);
    const atMs = Date.parse(evidence.occurredAt);
    // A corroborated arrival's companions join with it, in whichever order they
    // were delivered, or are consumed unused; neither is ordinary evidence, and
    // an unused one is never reused as support either.
    const consumed = consumedCompletionIds.has(evidence.clientEvidenceId);
    if (consumed && !attachedCompletions.has(item)) continue;
    if (evidence.kind === "visit" && evidence.endedAt && item.match?.kind === "saved" && accurateCoordinate(item, input)) {
      const key = `${evidence.deviceId}:${itemKey}`;
      const previous = visits.get(key);
      if (!previous?.evidence.endedAt || Date.parse(evidence.endedAt) > Date.parse(previous.evidence.endedAt)) visits.set(key, item);
    }
    if (consumed) continue;
    if (earlyArrivals.has(item)) continue;
    // Registration/overlapping-region context must not split a quiet saved stay before
    // its next actual observation can resolve continuity. It remains in the raw journal.
    if (active?.placeMatchKind === "saved" && evidence.kind.startsWith("geofence_") &&
        (evidence.kind === "geofence_state" || itemKey !== active.key)) continue;
    // Evidence that cannot move the cluster an edge stay would be is set aside
    // before gap and exit handling: its own place's region callbacks (entries,
    // exits, registration snapshots; the cluster was never inside the circle,
    // and identity proof reads them from the journal), simulated evidence, and
    // a displaced callback of the cluster's own Visit.
    if (active && edgeOnly(active, input) && (
      evidence.kind.startsWith("geofence_") && itemKey === active.key ||
      evidence.isSimulated === true ||
      evidence.kind === "visit" && ownVisitDisplaced(active, item))) continue;
    // Do not promote broad points to place/departure evidence. Keep them in accepted raw evidence.
    const corroboratedSupport = arrivalAnalysis.corroboratedVisits.get(evidence.clientEvidenceId);
    const sameSavedActiveEpisode = corroboratedSupport != null && active?.placeMatchKind === "saved" &&
      active.placeId === corroboratedSupport.savedPlaceId;
    // A later Visit cannot move the start of an already-running same-place episode
    // backwards or turn an earlier episode into one inferred interval.
    const canApplyCorroboratedSupport = corroboratedSupport != null &&
      (active == null || !sameSavedActiveEpisode ||
        Date.parse(active.startedAt) >= Date.parse(corroboratedSupport.arrivedAt));
    // A newer corroborated Visit there still bounds presence an early arrival
    // lent the running stay, even when it cannot join it (broad, and arriving
    // after the stay began); the stay's arrival is unchanged.
    if (active && sameSavedActiveEpisode) capDeferredPresence(active, item);
    if (point && (active?.placeMatchKind === "saved" || item.match?.kind === "saved" || item.match?.kind === "learned") &&
        !evidence.kind.startsWith("geofence_") && !accurateCoordinate(item, input) && !canApplyCorroboratedSupport) continue;

    if (active?.pendingExit) {
      const elapsed = atMs - Date.parse(active.pendingExit.evidence.occurredAt);
      const sameSaved = active.placeMatchKind === "saved" && itemKey === active.key;
      const intervalSupports = active.visitSupportUntilAt != null && atMs <= Date.parse(active.visitSupportUntilAt);
      if (sameSaved && active.outside.length < input.config.outsideConfirmationCount &&
          ((elapsed <= input.config.savedPlaceExitReentryGraceMs && strongSavedPoint(item, active.placeId, input)) ||
           (intervalSupports && (strongSavedPoint(item, active.placeId, input) || evidence.kind === "geofence_enter")))) {
        active.evidence.push(active.pendingExit);
        active.pendingExit = undefined;
      } else if (sameSaved && elapsed > input.config.savedPlaceExitReentryGraceMs && !intervalSupports) {
        resolveUnsupportedExit(active, input.config);
        completed.push(active);
        active = null;
      }
    }

    if (active) {
      const observedAt = lastInsideAt(active, evidence.occurredAt);
      const lastAt = active.visitSupportUntilAt && Date.parse(active.visitSupportUntilAt) > Date.parse(observedAt)
        ? active.visitSupportUntilAt
        : observedAt;
      const observationGapMs = atMs - Date.parse(lastAt);
      const boundedSparseSameUnknown =
        active.key === "unknown" &&
        itemKey === "unknown" &&
        sameUnknownCluster(active, item, input.config.sparseUnknownContinuityMaximumDistanceMeters) &&
        observationGapMs <= input.config.sparseUnknownContinuityMaximumGapMs;
      // Without the saved place, a tight unknown cluster bridges sparse silence.
      // A parked phone just outside a saved place's circle forms the same
      // cluster from merely plausible matches; the place must not make
      // continuity stricter than it would be without it.
      const boundedSparseEdge = observationGapMs > input.config.maxContinuityGapMs &&
        !active.pendingExit && active.outside.length === 0 &&
        (itemKey === active.key || (itemKey === "unknown" && stationaryFix(item, input))) &&
        observationGapMs <= input.config.sparseUnknownContinuityMaximumGapMs &&
        edgeOnly(active, input) &&
        nearEdgeCluster(active, item, input, input.config.sparseUnknownContinuityMaximumDistanceMeters);
      const previousPoint = active.lastStrongInside;
      // Strong matches extend 25 m beyond the circle, so an edge cluster's silence
      // is bridged only by its own (unknown-cluster) rule above.
      const boundedSavedGap = active.placeMatchKind === "saved" && !active.pendingExit && active.outside.length === 0 &&
        !edgeOnly(active, input) &&
        previousPoint != null && previousPoint.evidence.clientEvidenceId !== evidence.clientEvidenceId &&
        strongSavedPoint(item, active.placeId, input) &&
        atMs - Date.parse(previousPoint.evidence.occurredAt) <= input.config.savedPlaceQuietGapMaxMs;
      // After a corroborated arrival, silence does not end the stay: the next
      // observation goes through the ordinary departure rules (exit grace,
      // outside confirmation, other place) within the presence cap.
      const openVisitPresence = observationGapMs > input.config.maxContinuityGapMs &&
        active.arrivalPresence === true &&
        (active.arrivalPresenceUntilAt == null || atMs <= Date.parse(active.arrivalPresenceUntilAt)) &&
        atMs - Date.parse(observedAt) <= input.config.savedPlaceOpenVisitPresenceMaximumMs;
      if (observationGapMs > input.config.maxContinuityGapMs && !boundedSparseSameUnknown && !boundedSparseEdge && !boundedSavedGap && !openVisitPresence) {
        closeAtTransition(active, evidence.occurredAt, "uncertain_gap", input.config, true);
        completed.push(active);
        active = null;
      } else if (observationGapMs > input.config.maxContinuityGapMs) {
        active.continuityStatus = "uncertain_gap";
        if (boundedSavedGap || openVisitPresence) active.inferredContinuity = true;
      }
    }

    if (!active) {
      // State snapshots and departures describe an already-running monitor; they
      // are supporting evidence, never proof that a new visit began.
      if (evidence.kind === "geofence_state" || evidence.kind === "geofence_exit") continue;
      const moving =
        (evidence.speedMetersPerSecond ?? item.impliedSpeedMetersPerSecond ?? 0) >= input.config.movementSpeedThresholdMps;
      if (itemKey === "unknown" && moving && evidence.kind !== "visit") continue;
      active = startStay(item);
      attachEarlyArrival(active, item);
      continue;
    }

    if (
      evidence.kind === "geofence_exit" &&
      evidence.savedPlaceId &&
      evidence.savedPlaceId === active.placeId
    ) {
      // Core Location can emit a same-place exit/enter pair while monitored
      // regions are being restored. That is a state snapshot, not a departure.
      if (hasPairedGeofenceEnter(accepted, evidence)) continue;
      active.pendingExit ??= item;
      continue;
    }

    // A departure for another monitored region is not evidence that the active
    // stay ended. iOS can deliver overlapping region callbacks, especially at
    // registration and with reduced precision.
    if (evidence.kind === "geofence_exit") continue;

    // An edge cluster ends where an unknown cluster would, before any admission
    // can clear the evidence: at an accurate reading beyond its stationary core,
    // whatever place it matches or however fast it moves (another stop on the
    // circle's far side, a drive through the circle), or a credible Visit
    // elsewhere (its own Visit's displaced callbacks were set aside above).
    if (edgeOnly(active, input) && evidence.isSimulated !== true && accurateCoordinate(item, input) &&
      !nearEdgeCluster(active, item, input, input.config.unknownStayBaseRadiusMeters)) {
      closeAtCorroboratedDeparture(active, evidence.occurredAt, input.config);
      completed.push(active);
      active = startStay(item);
      continue;
    }

    const sameKnownPlace = itemKey !== "unknown" && (itemKey === active.key || matchingActive(item.match, active));
    const sameUnknown = itemKey === "unknown" && active.key === "unknown" && sameUnknownCluster(active, item, input.config.unknownStayBaseRadiusMeters);
    // A still reading just beyond the tolerance band belongs to an edge-only
    // stay exactly as it would to the unknown cluster that stay would be.
    const sameEdgeCluster = itemKey === "unknown" && active.placeMatchKind === "saved" && stationaryFix(item, input) &&
      !active.pendingExit && active.outside.length === 0 &&
      edgeOnly(active, input) && nearEdgeCluster(active, item, input, input.config.unknownStayBaseRadiusMeters);
    if (sameKnownPlace || sameUnknown || sameEdgeCluster) {
      active.evidence.push(item);
      markArrivalPresence(active, item);
      capDeferredPresence(active, item);
      attachEarlyArrival(active, item);
      if (!active.pendingExit) active.outside = [];
      if (strongSavedPoint(item, active.placeId, input)) active.lastStrongInside = item;
      if (canApplyCorroboratedSupport) {
        active.inferredBoundary = true;
        active.inferredContinuity = true;
        active.supportedByVisit = true;
        active.visitSupportUntilAt = corroboratedSupport.departedAt;
        if (Date.parse(corroboratedSupport.arrivedAt) >= Date.parse(active.startedAt)) active.episodeVisitUntilAt = corroboratedSupport.departedAt;
        active.startLowerBoundAt = corroboratedSupport.arrivedAt;
        active.startUpperBoundAt = corroboratedSupport.arrivalUpperBoundAt;
        active.stopLowerBoundAt = corroboratedSupport.departureLowerBoundAt;
        active.stopUpperBoundAt = corroboratedSupport.departedAt;
        active.stoppedAt = corroboratedSupport.departedAt;
        active.continuityStatus = "uncertain_gap";
      } else if (evidence.kind === "visit") {
        active.supportedByVisit = true;
        const bound = unknownArrivalBounds.get(evidence.clientEvidenceId);
        if (bound && active.key === "unknown" &&
            active.startedAt === evidence.occurredAt &&
            active.evidence[0].evidence.clientEvidenceId !== evidence.clientEvidenceId &&
            active.evidence[0].evidence.kind === "visit" &&
            unknownArrivalBounds.get(active.evidence[0].evidence.clientEvidenceId) === bound) {
          active.startLowerBoundAt = bound.lower;
          active.startUpperBoundAt = bound.upper;
          active.approximateArrival = bound.lower !== active.startedAt;
        }
        if (
          evidence.endedAt &&
          (!active.visitSupportUntilAt || Date.parse(evidence.endedAt) > Date.parse(active.visitSupportUntilAt))
        ) active.visitSupportUntilAt = evidence.endedAt;
        if (
          evidence.endedAt && Date.parse(evidence.occurredAt) >= Date.parse(active.startedAt) &&
          (!active.episodeVisitUntilAt || Date.parse(evidence.endedAt) > Date.parse(active.episodeVisitUntilAt))
        ) active.episodeVisitUntilAt = evidence.endedAt;
      }
      if (evidence.kind === "visit" && evidence.endedAt && !canApplyCorroboratedSupport) {
        active.stoppedAt = evidence.endedAt;
        active.stopLowerBoundAt = evidence.endedAt;
        active.stopUpperBoundAt = evidence.endedAt;
        active.continuityStatus = "supported_by_visit";
      } else if (active.visitSupportUntilAt && atMs > Date.parse(active.visitSupportUntilAt)) {
        active.stoppedAt = null;
        if (!active.inferredBoundary) active.stopLowerBoundAt = active.visitSupportUntilAt;
        active.stopUpperBoundAt = evidence.occurredAt;
      }
      continue;
    }

    const credibleOtherPlace = itemKey !== "unknown" && !itemKey.startsWith("ambiguous:");
    const sustainedUnknownCluster = active.key === "unknown" && itemKey === "unknown" && !sameUnknown;
    if (credibleOtherPlace || sustainedUnknownCluster) {
      closeAtCorroboratedDeparture(active, evidence.occurredAt, input.config);
      completed.push(active);
      active = startStay(item);
      attachEarlyArrival(active, item);
      continue;
    }

    active.outside.push(item);
    const activeCentre = evidenceCentre(active.evidence);
    const displaced = activeCentre && point
      ? distanceMeters(activeCentre, point) >= input.config.movementDisplacementThresholdMeters
      : false;
    const moving =
      (evidence.speedMetersPerSecond ?? item.impliedSpeedMetersPerSecond ?? 0) >= input.config.movementSpeedThresholdMps;
    if (active.outside.length >= input.config.outsideConfirmationCount && (displaced || moving || itemKey === "unknown")) {
      closeAtCorroboratedDeparture(active, active.outside[0].evidence.occurredAt, input.config);
      completed.push(active);
      const outside = active.outside;
      active = null;
      const stationaryOutside = outside.filter(
        (candidate) =>
          (candidate.evidence.speedMetersPerSecond ?? candidate.impliedSpeedMetersPerSecond ?? 0) <
          input.config.movementSpeedThresholdMps
      );
      if (stationaryOutside.length > 0) {
        active = makeWorkingStay(stationaryOutside[0]);
        applyUnknownVisitArrivalBound(active, stationaryOutside[0]);
        for (const candidate of stationaryOutside.slice(1)) {
          if (sameUnknownCluster(active, candidate, input.config.unknownStayBaseRadiusMeters)) {
            active.evidence.push(candidate);
          }
        }
      }
    }
  }

  if (active?.pendingExit && (!active.visitSupportUntilAt ||
      Date.parse(active.visitSupportUntilAt) < Date.parse(active.pendingExit.evidence.occurredAt)) &&
      Date.parse(input.processingAt) - Date.parse(active.pendingExit.evidence.occurredAt) >= input.config.savedPlaceExitReentryGraceMs) {
    resolveUnsupportedExit(active, input.config);
  }
  if (active) completed.push(active);
  const rawStayRecords = completed
    .map((working) => ({ working, segment: stayFromWorking(working, input.processingAt, input, accepted) }))
    .filter((record): record is { working: WorkingStay; segment: StaySegment } => Boolean(record.segment));
  const promotedStays = rawStayRecords.map(({ segment }) => segment);
  // Physical stops exist even when identity fragments them or they are too
  // short to name. Physical evidence decides whether and when the device
  // stopped: a stop that covers promoted stays and extends them by at least
  // physicalStopAbsorbExtensionMs shows place logic split or shortened one
  // stop (at a silence, an exit or edge matches), so the stop replaces them.
  // It may only claim silences the saved-place rules would bridge. Otherwise
  // promoted stays keep precedence over the same time.
  const absorbed = new Set<StaySegment>();
  const physicalStays: StaySegment[] = [];
  const reusedBySegment = new Map(rawStayRecords.map(({ working, segment }) => [segment, working.reusedVisits]));
  for (const stop of detectPhysicalStops(accepted, input.config)) {
    const stopStartMs = Date.parse(stop.startedAt);
    const stopEndMs = Date.parse(stop.stoppedAt);
    const overlapping = promotedStays.filter((stay) =>
      Date.parse(stay.startedAt) < stopEndMs && Date.parse(stay.stoppedAt ?? input.processingAt) > stopStartMs);
    if (!overlapping.length) {
      physicalStays.push(stayFromPhysicalStop(stop, accepted, input));
      continue;
    }
    const tolerance = input.config.physicalStopAbsorbToleranceMs;
    const covered = overlapping.every((stay) => stay.stoppedAt != null && !absorbed.has(stay) &&
      Date.parse(stay.startedAt) >= stopStartMs - tolerance && Date.parse(stay.stoppedAt) <= stopEndMs + tolerance);
    if (!covered) continue;
    // Visits a fragment reused from an earlier episode stay interval support only.
    const reused = new Set(overlapping.flatMap((stay) => [...(reusedBySegment.get(stay) ?? [])]));
    const identity = absorbedIdentity(stop, overlapping, accepted, input, reused);
    const fragmentsStartMs = Math.min(...overlapping.map((stay) => Date.parse(stay.startedAt)));
    const fragmentsEndMs = Math.max(...overlapping.map((stay) => Date.parse(stay.stoppedAt!)));
    // Only accurate, genuine fixes are observations: geofence callbacks, broad
    // and simulated readings never show the device stayed through a silence.
    const observation = (item: ClassifiedEvidence) =>
      (item.evidence.kind === "standard_location" || item.evidence.kind === "significant_change") &&
      item.evidence.isSimulated !== true && accurateCoordinate(item, input);
    const observedMs = identity.items.filter(observation).map(({ evidence }) => Date.parse(evidence.occurredAt));
    // Interval support from this episode's own qualified Visits: a genuine one
    // that arrived within it (never simulated, nor an earlier episode's: see
    // absorbedIdentity), and that the saved-place rules corroborated for the
    // replacement's place, over its corroborated interval, or an accurate
    // completed Visit at that place (for an unknown replacement, within its
    // radius of the stop).
    const visitSpans = identity.items.flatMap((item): Array<[number, number]> => {
      const { evidence } = item;
      if (evidence.kind !== "visit" || evidence.isSimulated === true || identity.earlier.has(item)) return [];
      const corroborated = arrivalAnalysis.corroboratedVisits.get(evidence.clientEvidenceId);
      if (corroborated && identity.placeId && corroborated.savedPlaceId === identity.placeId) {
        return Date.parse(corroborated.arrivedAt) < identity.startMs ? []
          : [[Date.parse(corroborated.arrivedAt), Date.parse(corroborated.departedAt)]];
      }
      const point = pointFor(evidence);
      if (!evidence.endedAt || !point || !accurateCoordinate(item, input)) return [];
      const compatible = identity.placeId
        ? item.match?.candidates.some((candidate) => candidate.id === identity.placeId && candidate.matchClass !== "outside") ?? false
        : distanceMeters(stop.centre, point) <= input.config.unknownStayBaseRadiusMeters;
      return compatible ? [[Date.parse(evidence.occurredAt), Date.parse(evidence.endedAt)]] : [];
    });
    // A saved replacement never starts before an observation at the place (in
    // its circle or tolerance band): the stop's start can be an estimate
    // between the last fix away and the first one there, and readings beyond
    // the band are not attendance. Saved attendance never begins before its
    // observed arrival; a fragment's own supported arrival stands.
    const placeId = identity.placeId;
    const atPlaceMs = placeId ? identity.items.filter((item) => observation(item) &&
      (item.match?.candidates.some((candidate) => candidate.id === placeId && candidate.matchClass !== "outside") ?? false))
      .map(({ evidence }) => Date.parse(evidence.occurredAt)) : [];
    const startMs = placeId
      ? Math.min(fragmentsStartMs, ...atPlaceMs.filter((time) => time >= Math.min(stopStartMs, fragmentsStartMs)))
      : Math.min(stopStartMs, fragmentsStartMs);
    const endMs = Math.max(stopEndMs, fragmentsEndMs);
    if (Math.max(fragmentsStartMs - startMs, endMs - fragmentsEndMs) < input.config.physicalStopAbsorbExtensionMs) continue;
    const fragmentSpans = overlapping.map((stay): [number, number] => [Date.parse(stay.startedAt), Date.parse(stay.stoppedAt!)]);
    if (longestNewSilenceMs(startMs, endMs, observedMs, fragmentSpans, visitSpans) > input.config.savedPlaceQuietGapMaxMs) continue;
    for (const stay of overlapping) absorbed.add(stay);
    physicalStays.push(stayAbsorbingFragments(stop, overlapping, identity, startMs, accepted, input));
  }
  const rawStays = [...promotedStays.filter((stay) => !absorbed.has(stay)), ...physicalStays]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const stays = coalesceCompatibleUnknownStays(rawStays, accepted, input);
  // A stay inherits an inferred boundary from every promoted stay it absorbed
  // or coalesced (whose evidence it contains), so commutes ending there stay
  // low-confidence whatever its own ID.
  const inferredStays = rawStayRecords.filter(({ working }) => working.inferredBoundary).map(({ segment }) => segment);
  const inferredBoundaryStayIds = new Set(stays.filter((stay) => {
    const evidenceIds = new Set(stay.evidenceIds);
    return inferredStays.some((inferred) => inferred.clientSegmentId === stay.clientSegmentId ||
      inferred.evidenceIds.every((id) => evidenceIds.has(id)));
  }).map((stay) => stay.clientSegmentId));
  const legs = deriveCommutes(stays, accepted, input.config, input.processingAt, {
    inferredBoundaryStayIds,
    arrivalWitnesses: arrivalAnalysis.witnesses,
    savedPlaces: input.savedPlaces,
    learnedPlaces: input.acceptedLearnedPlaces
  });
  const commutes = assembleTripsThroughStops(legs, stays, accepted, input.config, input.processingAt, {
    inferredBoundaryStayIds,
    arrivalWitnesses: arrivalAnalysis.witnesses,
    savedPlaces: input.savedPlaces,
    learnedPlaces: input.acceptedLearnedPlaces
  });
  const segments = [...stays, ...commutes].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.kind.localeCompare(b.kind));
  const finalisedSegments = segments.filter((segment) => segment.status === "finalised");
  const processedEvidenceIds = [...new Set([
    ...input.priorState.processedEvidenceIds,
    ...accepted.map(({ evidence }) => evidence.clientEvidenceId),
    ...rejectedEvidence.map((evidence) => evidence.clientEvidenceId)
  ])].sort();
  const activeStay = stays.find((stay) => stay.status === "open") ?? null;
  const hasUncertainGap = stays.some((stay) => stay.continuityStatus === "uncertain_gap");

  return { unusedCompanionIds, output: {
    nextState: {
      algorithmVersion: input.config.algorithmVersion,
      mode: activeStay
        ? "staying"
        : active
          ? "candidate_stay"
          : hasUncertainGap
            ? "uncertain_gap"
            : commutes.at(-1)?.status === "closed"
              ? "moving"
              : "idle",
      activeSegmentId: activeStay?.clientSegmentId ?? null,
      processedEvidenceIds,
      lastProcessedAt: accepted.at(-1)?.evidence.occurredAt ?? input.priorState.lastProcessedAt
    },
    acceptedEvidence: accepted,
    rejectedEvidence,
    segmentUpserts: segments,
    finalisedSegments,
    diagnostics: {
      inputCount: input.evidence.length,
      acceptedCount: accepted.length,
      rejectedCount: rejectedEvidence.length,
      duplicateCount: rejectedEvidence.filter((item) => item.reason === "duplicate").length,
      stayCount: stays.length,
      commuteCount: commutes.length,
      ambiguousMatchCount: accepted.filter((item) => item.match?.kind === "ambiguous").length,
      warningCodes: stays.some((stay) => stay.continuityStatus === "uncertain_gap") ? ["evidence_gap"] : []
    }
  } };
}
