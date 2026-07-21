import { z } from "zod";

export {
  TAG_DISPLAY_NAME_MAX_LENGTH,
  TAG_TOKEN_PATTERN,
  TagMutationSchema,
  TagNameSchema,
  TagRecordSchema,
  TimeEntryTagsPatchSchema,
  consumeActiveHashtag,
  findActiveHashtag,
  insertHashtagStarter,
  isValidHashtagBoundary,
  normalizeTagName,
  parseHashtagTokens,
  replaceActiveHashtag,
  tagNamesFromDescription,
  type ActiveHashtagQuery,
  type NormalizedTagName,
  type ParsedHashtagToken
} from "./tags";

export {
  DAYFRAME_PALETTE,
  DEFAULT_PALETTE_KEY,
  deterministicPaletteIndex,
  isPaletteKey,
  normalizePaletteKey,
  paletteColorFor,
  paletteCssColorFor,
  paletteKeyFor,
  type DayframePaletteKey
} from "./palette";
export {
  DAYFRAME_THEME,
  type DayframeTheme,
  type DayframeThemeMode
} from "./theme";

export * from "./location";

export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_WORKSPACE_ID = "00000000-0000-4000-8000-000000000010";
export const DEFAULT_UNKNOWN_STAY_THRESHOLD_MINUTES = 20;

export const LOCATION_LEARNING_THRESHOLDS = {
  sampleIntervalMs: 15 * 60_000,
  distanceIntervalMeters: 250,
  clusterRadiusMeters: 160,
  visitGapMs: 3 * 60 * 60_000,
  maxSampleAccuracyMeters: 200,
  maxAverageAccuracyMeters: 100,
  maxClusterSpreadMeters: 140,
  placeCandidate: {
    minVisitCount: 2,
    minDistinctDays: 2,
    minSampleCount: 6,
    minTotalDwellMs: 40 * 60_000,
    minLongestDwellMs: 20 * 60_000
  },
  oneOffActivity: {
    minSampleCount: 4,
    minDwellMs: 60 * 60_000
  },
  learnedPlaceQueueCooldownMs: 24 * 60 * 60_000,
  oneOffQueueCooldownMs: 24 * 60 * 60_000,
  commuteDwellMs: 15 * 60_000,
  commuteQueueCooldownMs: 6 * 60 * 60_000
} as const;

export type LocationLearningEvidence = {
  visitCount: number;
  distinctDays: number;
  sampleCount: number;
  totalDwellMs: number;
  longestDwellMs: number;
  currentDwellMs: number;
  currentVisitSampleCount: number;
  averageAccuracyMeters: number | null;
  maxClusterSpreadMeters: number | null;
  radiusMeters: number;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
};

export type LocationLearningClassificationKind = "place_candidate" | "one_off_activity" | "noise";

export type LocationLearningClassification = {
  kind: LocationLearningClassificationKind;
  confidence: "medium" | "low" | "hint";
  score: number;
  reason: string;
};

export function classifyLocationLearningEvidence(
  evidenceInput: Partial<LocationLearningEvidence>
): LocationLearningClassification {
  const evidence = normalizeLocationLearningEvidence(evidenceInput);
  const thresholds = LOCATION_LEARNING_THRESHOLDS;
  const accurate =
    evidence.averageAccuracyMeters === null ||
    evidence.averageAccuracyMeters <= thresholds.maxAverageAccuracyMeters;
  const stable =
    evidence.maxClusterSpreadMeters === null ||
    evidence.maxClusterSpreadMeters <= thresholds.maxClusterSpreadMeters;
  const hasPlaceEvidence =
    evidence.visitCount >= thresholds.placeCandidate.minVisitCount &&
    evidence.distinctDays >= thresholds.placeCandidate.minDistinctDays &&
    evidence.sampleCount >= thresholds.placeCandidate.minSampleCount &&
    evidence.totalDwellMs >= thresholds.placeCandidate.minTotalDwellMs &&
    evidence.longestDwellMs >= thresholds.placeCandidate.minLongestDwellMs &&
    accurate &&
    stable;
  const hasOneOffEvidence =
    evidence.visitCount === 1 &&
    evidence.distinctDays === 1 &&
    evidence.sampleCount >= thresholds.oneOffActivity.minSampleCount &&
    evidence.currentVisitSampleCount >= thresholds.oneOffActivity.minSampleCount &&
    evidence.longestDwellMs >= thresholds.oneOffActivity.minDwellMs &&
    accurate &&
    stable;
  const score = locationLearningEvidenceScore(evidence, { accurate, stable });

  if (hasPlaceEvidence) {
    return {
      kind: "place_candidate",
      confidence: "medium",
      score,
      reason: "Repeated visits on different days, meaningful dwell, sample quality and cluster stability support a place suggestion."
    };
  }

  if (hasOneOffEvidence) {
    return {
      kind: "one_off_activity",
      confidence: "low",
      score,
      reason: "This is one significant stay, but there is not enough recurrence to suggest saving a place."
    };
  }

  return {
    kind: "noise",
    confidence: "hint",
    score,
    reason: !accurate
      ? "Location accuracy is too broad for a reliable suggestion."
      : !stable
        ? "Samples are too dispersed to represent a stable place."
        : "The cluster does not yet have enough repeat visits or meaningful one-off dwell to surface."
  };
}

export function locationLearningEvidenceFromPayload(payload: Record<string, unknown>) {
  const currentDwellMs = dwellMsFromPayload(payload);
  const visitCount = positiveWholeNumber(payload.visitCount, 1);
  const distinctDays = positiveWholeNumber(
    payload.distinctDayCount ?? payload.distinctDays,
    distinctDayCountFromPayload(payload)
  );
  const explicitTotalDwellMs = nonNegativeFiniteNumber(payload.totalDwellMs)
    ?? secondsToMs(payload.totalDwellSeconds);
  const totalDwellMs = explicitTotalDwellMs
    ?? (visitCount > 1 ? currentDwellMs * visitCount : currentDwellMs);

  return normalizeLocationLearningEvidence({
    visitCount,
    distinctDays,
    sampleCount: positiveWholeNumber(payload.sampleCount, 1),
    totalDwellMs,
    longestDwellMs:
      nonNegativeFiniteNumber(payload.longestDwellMs)
      ?? secondsToMs(payload.longestDwellSeconds)
      ?? currentDwellMs,
    currentDwellMs,
    currentVisitSampleCount: positiveWholeNumber(
      payload.currentVisitSampleCount,
      positiveWholeNumber(payload.sampleCount, 1)
    ),
    averageAccuracyMeters:
      nonNegativeFiniteNumber(payload.averageAccuracyMeters)
      ?? nonNegativeFiniteNumber(payload.accuracy),
    maxClusterSpreadMeters: nonNegativeFiniteNumber(payload.maxClusterSpreadMeters),
    radiusMeters: positiveWholeNumber(payload.radiusMeters, LOCATION_LEARNING_THRESHOLDS.clusterRadiusMeters),
    firstSeenAt: cleanLocationText(payload.clusterFirstSeenAt ?? payload.startedAt),
    lastSeenAt: cleanLocationText(payload.stoppedAt ?? payload.lastSeenAt)
  });
}

export type LocationDisplayAddress = {
  name?: unknown;
  street?: unknown;
  streetNumber?: unknown;
  district?: unknown;
  city?: unknown;
  subregion?: unknown;
  region?: unknown;
  postalCode?: unknown;
  formattedAddress?: unknown;
};

export function formatLocationCoordinates(
  latitude: unknown,
  longitude: unknown,
  precision = 3
) {
  const lat = finiteCoordinate(latitude);
  const lng = finiteCoordinate(longitude);
  if (lat === null || lng === null) return null;
  return `${lat.toFixed(precision)}, ${lng.toFixed(precision)}`;
}

export function locationAddressSummary(address: unknown) {
  const record = isObjectRecord(address) ? address : {};
  const formattedAddress = cleanLocationText(record.formattedAddress);
  if (formattedAddress) return formattedAddress;

  const streetParts = [
    cleanLocationText(record.streetNumber),
    cleanLocationText(record.street)
  ].filter(Boolean);
  const locality = firstCleanLocationText(record.district, record.city, record.subregion, record.region);
  const postalCode = cleanLocationText(record.postalCode);

  return [streetParts.join(" "), locality, postalCode].filter(Boolean).join(", ") || null;
}

export function readableLocationNameFromParts(input: {
  address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  fallbackName?: unknown;
}) {
  const address = isObjectRecord(input.address) ? input.address : {};
  const street = cleanLocationText(address.street);
  const streetNumber = cleanLocationText(address.streetNumber);
  const venueName = cleanLocationText(address.name);
  const locality = firstCleanLocationText(address.district, address.city, address.subregion, address.region);
  const postalCode = cleanLocationText(address.postalCode);
  const fallbackName = cleanLocationText(input.fallbackName);
  const coordinates = formatLocationCoordinates(input.latitude, input.longitude);

  if (
    venueName &&
    !looksLikeCoordinateText(venueName) &&
    !looksLikeStreetAddressName({ name: venueName, street, streetNumber })
  ) {
    return venueName;
  }

  if (street && !looksLikeCoordinateText(street)) {
    return nearLabel(street);
  }

  if (locality && !looksLikeCoordinateText(locality)) {
    return nearLabel(locality);
  }

  if (postalCode && !looksLikeCoordinateText(postalCode)) {
    return `${postalCode} area`;
  }

  if (fallbackName && !looksLikeCoordinateFallback(fallbackName)) {
    return fallbackName;
  }

  return coordinates ? `Unknown place near ${coordinates}` : "Unknown place";
}

export function isCoordinateBasedLocationName(value: unknown) {
  const name = cleanLocationText(value);
  return name ? looksLikeCoordinateFallback(name) : false;
}

export const EventSourceSchema = z.enum([
  "manual_app",
  "mobile_app",
  "nfc",
  "widget",
  "shortcut",
  "geofence_specific",
  "geofence_broad",
  "calendar",
  "health_sleep",
  "health_workout",
  "location_learning",
  "home_assistant",
  "ha_button",
  "ha_geofence"
]);

export const ConfidenceSchema = z.enum([
  "high",
  "medium_high",
  "medium",
  "low",
  "hint"
]);

export const ReviewStatusSchema = z.enum([
  "confirmed",
  "needs_review",
  "accepted",
  "ignored"
]);

export const SleepStageSchema = z.enum([
  "in_bed",
  "asleep_unspecified",
  "asleep_core",
  "asleep_deep",
  "asleep_rem",
  "awake"
]);

export const ActivityEventTypeSchema = z.enum([
  "timer_start",
  "timer_stop",
  "timer_switch",
  "quick_action",
  "geofence_enter",
  "geofence_exit",
  "unknown_stay",
  "commute_detected",
  "learned_place_visit",
  "nfc_action",
  "shortcut_action",
  "calendar_hint",
  "health_sleep_import",
  "health_workout_import",
  "location_evidence_batch"
]);

export const AutomationActionSchema = z.enum([
  "start_timer",
  "suggest_timer",
  "create_review_item",
  "stop_timer",
  "ignore_source"
]);

export const ActivityEventInputSchema = z.object({
  source: EventSourceSchema,
  type: ActivityEventTypeSchema,
  occurredAt: z.coerce.date(),
  workspaceId: z.string().uuid().default(DEMO_WORKSPACE_ID),
  userId: z.string().uuid().default(DEMO_USER_ID),
  deviceId: z.string().uuid().optional(),
  clientEventId: z.string().trim().min(1).max(160).optional(),
  projectId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  placeId: z.string().uuid().optional(),
  description: z.string().trim().optional(),
  rawPayload: z.record(z.string(), z.unknown()).default({})
});

export type EventSource = z.infer<typeof EventSourceSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;
export type SleepStage = z.infer<typeof SleepStageSchema>;
export type ActivityEventType = z.infer<typeof ActivityEventTypeSchema>;
export type AutomationAction = z.infer<typeof AutomationActionSchema>;
export type ActivityEventInput = z.input<typeof ActivityEventInputSchema>;
type ParsedActivityEvent = z.output<typeof ActivityEventInputSchema>;

const healthKitSleepStages: Record<number | string, SleepStage> = {
  0: "in_bed",
  1: "asleep_unspecified",
  2: "awake",
  3: "asleep_core",
  4: "asleep_deep",
  5: "asleep_rem",
  inBed: "in_bed",
  asleep: "asleep_unspecified",
  asleepUnspecified: "asleep_unspecified",
  awake: "awake",
  asleepCore: "asleep_core",
  asleepDeep: "asleep_deep",
  asleepREM: "asleep_rem",
  HKCategoryValueSleepAnalysisInBed: "in_bed",
  HKCategoryValueSleepAnalysisAsleep: "asleep_unspecified",
  HKCategoryValueSleepAnalysisAsleepUnspecified: "asleep_unspecified",
  HKCategoryValueSleepAnalysisAwake: "awake",
  HKCategoryValueSleepAnalysisAsleepCore: "asleep_core",
  HKCategoryValueSleepAnalysisAsleepDeep: "asleep_deep",
  HKCategoryValueSleepAnalysisAsleepREM: "asleep_rem"
};

export function mapHealthKitSleepStage(value: unknown): SleepStage {
  if (typeof value === "number" || typeof value === "string") {
    return healthKitSleepStages[value] ?? "asleep_unspecified";
  }

  return "asleep_unspecified";
}

export const HEALTH_WORKOUT_TYPE_OPTIONS = [
  { key: "walking", label: "Walking", activityLabel: "Walk", defaultEnabled: true },
  { key: "running", label: "Running", activityLabel: "Run", defaultEnabled: true },
  { key: "cycling", label: "Cycling", activityLabel: "Cycling", defaultEnabled: true },
  { key: "strength_training", label: "Strength training", activityLabel: "Strength training", defaultEnabled: false },
  { key: "swimming", label: "Swimming", activityLabel: "Swimming", defaultEnabled: false },
  { key: "other", label: "Other/unknown", activityLabel: "Workout", defaultEnabled: false }
] as const;

export type HealthWorkoutType = (typeof HEALTH_WORKOUT_TYPE_OPTIONS)[number]["key"];
export type HealthWorkoutImportPreferences = Record<HealthWorkoutType, boolean>;

export const DEFAULT_HEALTH_WORKOUT_IMPORT_PREFERENCES = Object.fromEntries(
  HEALTH_WORKOUT_TYPE_OPTIONS.map((option) => [option.key, option.defaultEnabled])
) as HealthWorkoutImportPreferences;

export const HEALTH_IMPORT_PREFERENCE_OPTIONS = [
  { key: "sleep", label: "Sleep", defaultEnabled: true },
  { key: "walking", label: "Walking", defaultEnabled: true },
  { key: "running", label: "Running", defaultEnabled: true },
  { key: "cycling", label: "Cycling", defaultEnabled: true },
  { key: "strength_training", label: "Strength training", defaultEnabled: false },
  { key: "swimming", label: "Swimming", defaultEnabled: false },
  { key: "other", label: "Other/unknown", defaultEnabled: false }
] as const;

export type HealthImportPreferenceKey = (typeof HEALTH_IMPORT_PREFERENCE_OPTIONS)[number]["key"];
export type HealthImportPreferences = Record<HealthImportPreferenceKey, boolean>;
export type HealthAutoLogMapping = {
  categoryId?: string | null;
  description?: string | null;
};
export type HealthAutoLogMappings = Partial<Record<HealthImportPreferenceKey, HealthAutoLogMapping>>;

export const DEFAULT_HEALTH_IMPORT_PREFERENCES = Object.fromEntries(
  HEALTH_IMPORT_PREFERENCE_OPTIONS.map((option) => [option.key, option.defaultEnabled])
) as HealthImportPreferences;

export function normalizeHealthAutoLogMappings(input: unknown): HealthAutoLogMappings {
  const values = isObjectRecord(input) ? input : {};
  const mappings: HealthAutoLogMappings = {};

  for (const option of HEALTH_IMPORT_PREFERENCE_OPTIONS) {
    const raw = values[option.key];
    if (!isObjectRecord(raw)) continue;

    const categoryId = normalizeMappingText(raw.categoryId);
    const description = normalizeMappingText(raw.description);
    if (!categoryId && !description) continue;

    mappings[option.key] = {
      categoryId,
      description
    };
  }

  return mappings;
}

export function healthAutoLogMappingFor(
  key: HealthImportPreferenceKey,
  mappings?: HealthAutoLogMappings | null
): HealthAutoLogMapping {
  return mappings?.[key] ?? {};
}

export function calendarBlockContinuationEdges(input: {
  startedAt: unknown;
  stoppedAt: unknown;
  dayStart: unknown;
  dayEnd: unknown;
}) {
  const startedAt = timestampMs(input.startedAt);
  const stoppedAt = timestampMs(input.stoppedAt);
  const dayStart = timestampMs(input.dayStart);
  const dayEnd = timestampMs(input.dayEnd);
  if (startedAt == null || stoppedAt == null || dayStart == null || dayEnd == null) {
    return {
      startsBeforeDay: false,
      continuesIntoNextDay: false
    };
  }
  return {
    startsBeforeDay: startedAt < dayStart,
    continuesIntoNextDay: stoppedAt > dayEnd
  };
}

const healthWorkoutTypeByNumber: Record<number, HealthWorkoutType> = {
  13: "cycling",
  20: "strength_training",
  37: "running",
  46: "swimming",
  50: "strength_training",
  52: "walking",
  3000: "other"
};

const healthWorkoutTypeAliases: Record<string, HealthWorkoutType> = {
  cycle: "cycling",
  cycling: "cycling",
  biking: "cycling",
  functional_strength_training: "strength_training",
  run: "running",
  running: "running",
  strength: "strength_training",
  strength_training: "strength_training",
  swim: "swimming",
  swimming: "swimming",
  traditional_strength_training: "strength_training",
  walk: "walking",
  walking: "walking",
  workout_13: "cycling",
  workout_20: "strength_training",
  workout_37: "running",
  workout_46: "swimming",
  workout_50: "strength_training",
  workout_52: "walking",
  workout_3000: "other"
};

export function normalizeHealthWorkoutType(value: unknown): HealthWorkoutType {
  if (typeof value === "number" && Number.isFinite(value)) {
    return healthWorkoutTypeByNumber[Math.trunc(value)] ?? "other";
  }

  if (typeof value === "string") {
    const normalized = healthWorkoutTypeString(value);
    return healthWorkoutTypeAliases[normalized] ?? "other";
  }

  return "other";
}

export function healthWorkoutLabel(value: unknown) {
  const type = normalizeHealthWorkoutType(value);
  return HEALTH_WORKOUT_TYPE_OPTIONS.find((option) => option.key === type)?.activityLabel ?? "Workout";
}

export function shouldAutoConfirmHealthWorkout(input: {
  durationSeconds?: number | null;
  workoutType: unknown;
}) {
  const type = normalizeHealthWorkoutType(input.workoutType);
  const durationSeconds = typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds)
    ? input.durationSeconds
    : 0;
  const minimumSeconds: Partial<Record<HealthWorkoutType, number>> = {
    cycling: 10 * 60,
    running: 10 * 60,
    strength_training: 20 * 60,
    swimming: 10 * 60,
    walking: 5 * 60
  };
  const minimum = minimumSeconds[type];
  return Boolean(minimum && durationSeconds >= minimum);
}

export function shouldAutoConfirmHealthSleep(input: {
  durationSeconds?: number | null;
  startedAt?: unknown;
  stoppedAt?: unknown;
}) {
  const durationSeconds =
    typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds)
      ? input.durationSeconds
      : durationSecondsBetween(input.startedAt, input.stoppedAt);
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds)) return false;
  return durationSeconds >= 3 * 60 * 60 && durationSeconds <= 14 * 60 * 60;
}

function healthWorkoutTypeString(value: string) {
  return value
    .trim()
    .replace(/^HKWorkoutActivityType/, "")
    .replace(/^WorkoutActivityType/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function durationSecondsBetween(startedAt: unknown, stoppedAt: unknown) {
  if (typeof startedAt !== "string" || typeof stoppedAt !== "string") return null;
  const started = new Date(startedAt).getTime();
  const stopped = new Date(stoppedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(stopped) || stopped <= started) return null;
  return Math.round((stopped - started) / 1000);
}

export type ProjectSummary = {
  id: string;
  name: string;
  clientId?: string | null;
  categoryId?: string | null;
};

export type CategorySummary = {
  id: string;
  name: string;
  color?: string | null;
  isPinned?: boolean;
};

export type RecentActivityEntry = {
  id?: string;
  categoryId?: string | null;
  categoryName?: string | null;
  categoryColor?: string | null;
  description?: string | null;
  eventType?: string | null;
  reviewStatus?: string | null;
  source?: string | null;
  startedAt: string;
  stoppedAt?: string | null;
  durationSeconds?: number | null;
  userConfirmed?: boolean;
  tagNames?: string[];
};

export type RecentActivitySuggestionSection = "recent" | "often_used" | "suggested_now";

export type RecentActivitySuggestion = {
  key: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  description: string;
  lastSeenAt: string;
  score: number;
  section: RecentActivitySuggestionSection;
  useCount: number;
  totalSeconds: number;
  tagNames: string[];
};

export type CategoryUsageRank = {
  categoryId: string;
  lastSeenAt: string;
  score: number;
  totalSeconds: number;
  useCount: number;
};

export function buildRecentActivitySuggestions(
  entries: RecentActivityEntry[],
  options: { contextDate?: Date | string; limit?: number; minDurationSeconds?: number } = {}
): RecentActivitySuggestion[] {
  const limit = options.limit ?? 6;
  const minDurationSeconds = options.minDurationSeconds ?? 60;
  const suggestions = new Map<string, ScoredRecentActivitySuggestion>();
  const contextDate = options.contextDate ? new Date(options.contextDate) : new Date();
  const contextMs = Number.isFinite(contextDate.getTime()) ? contextDate.getTime() : Date.now();
  const contextBucket = timeOfDayBucket(new Date(contextMs));
  const contextDay = new Date(contextMs).getDay();
  const contextDayKind = dayKind(new Date(contextMs));

  for (const entry of entries) {
    const description = normalizeRecentActivityDescription(entry.description);
    if (!description || !entry.stoppedAt) continue;
    if (!isManualLearningEntryEligible(entry)) continue;
    if ((entry.durationSeconds ?? 0) < minDurationSeconds) continue;

    const lastSeenMs = Date.parse(entry.stoppedAt);
    if (!Number.isFinite(lastSeenMs)) continue;
    const startedAt = new Date(entry.startedAt);
    const matchesTimeBucket = Number.isFinite(startedAt.getTime()) && timeOfDayBucket(startedAt) === contextBucket;
    const matchesDay = Number.isFinite(startedAt.getTime()) && startedAt.getDay() === contextDay;
    const matchesDayKind = Number.isFinite(startedAt.getTime()) && dayKind(startedAt) === contextDayKind;

    const categoryId = entry.categoryId ?? null;
    const tagNames = [...new Set((entry.tagNames ?? []).map((name) => name.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    const key = `${categoryId ?? "uncategorized"}:${description.toLocaleLowerCase()}:${tagNames.join("|").toLocaleLowerCase()}`;
    const current = suggestions.get(key);
    if (!current) {
      suggestions.set(key, {
        key,
        categoryId,
        categoryName: entry.categoryName ?? null,
        categoryColor: entry.categoryColor ?? null,
        description,
        lastSeenAt: entry.stoppedAt,
        score: 0,
        section: "recent",
        useCount: 1,
        totalSeconds: Math.max(0, entry.durationSeconds ?? 0),
        tagNames,
        recentWindowCount: contextMs - lastSeenMs <= 14 * 86_400_000 ? 1 : 0,
        timeBucketMatches: matchesTimeBucket ? 1 : 0,
        dayMatches: matchesDay ? 1 : 0,
        dayKindMatches: matchesDayKind ? 1 : 0
      });
      continue;
    }

    current.useCount += 1;
    current.totalSeconds += Math.max(0, entry.durationSeconds ?? 0);
    current.recentWindowCount += contextMs - lastSeenMs <= 14 * 86_400_000 ? 1 : 0;
    current.timeBucketMatches += matchesTimeBucket ? 1 : 0;
    current.dayMatches += matchesDay ? 1 : 0;
    current.dayKindMatches += matchesDayKind ? 1 : 0;
    if (lastSeenMs > Date.parse(current.lastSeenAt)) {
      current.lastSeenAt = entry.stoppedAt;
      current.description = description;
      current.categoryName = entry.categoryName ?? current.categoryName;
      current.categoryColor = entry.categoryColor ?? current.categoryColor;
    }
  }

  const scored = [...suggestions.values()]
    .map((suggestion) => scoreRecentActivitySuggestion(suggestion, contextMs));

  return compactRecentActivitySuggestionOrder(scored).slice(0, limit);
}

export function buildCategoryUsageRanks(
  entries: RecentActivityEntry[],
  options: { contextDate?: Date | string; limit?: number; minDurationSeconds?: number } = {}
): CategoryUsageRank[] {
  const limit = options.limit ?? 50;
  const minDurationSeconds = options.minDurationSeconds ?? 60;
  const contextDate = options.contextDate ? new Date(options.contextDate) : new Date();
  const contextMs = Number.isFinite(contextDate.getTime()) ? contextDate.getTime() : Date.now();
  const ranks = new Map<string, CategoryUsageRank & {
    dayKindMatches: number;
    dayMatches: number;
    timeBucketMatches: number;
  }>();
  const contextBucket = timeOfDayBucket(new Date(contextMs));
  const contextDay = new Date(contextMs).getDay();
  const contextDayKind = dayKind(new Date(contextMs));

  for (const entry of entries) {
    if (!entry.categoryId || !entry.stoppedAt) continue;
    if (!isManualLearningEntryEligible(entry)) continue;
    if ((entry.durationSeconds ?? 0) < minDurationSeconds) continue;

    const lastSeenMs = Date.parse(entry.stoppedAt);
    if (!Number.isFinite(lastSeenMs)) continue;
    const startedAt = new Date(entry.startedAt);
    const matchesTimeBucket = Number.isFinite(startedAt.getTime()) && timeOfDayBucket(startedAt) === contextBucket;
    const matchesDay = Number.isFinite(startedAt.getTime()) && startedAt.getDay() === contextDay;
    const matchesDayKind = Number.isFinite(startedAt.getTime()) && dayKind(startedAt) === contextDayKind;
    const current = ranks.get(entry.categoryId);

    if (!current) {
      ranks.set(entry.categoryId, {
        categoryId: entry.categoryId,
        dayKindMatches: matchesDayKind ? 1 : 0,
        dayMatches: matchesDay ? 1 : 0,
        lastSeenAt: entry.stoppedAt,
        score: 0,
        timeBucketMatches: matchesTimeBucket ? 1 : 0,
        totalSeconds: Math.max(0, entry.durationSeconds ?? 0),
        useCount: 1
      });
      continue;
    }

    current.dayKindMatches += matchesDayKind ? 1 : 0;
    current.dayMatches += matchesDay ? 1 : 0;
    current.timeBucketMatches += matchesTimeBucket ? 1 : 0;
    current.totalSeconds += Math.max(0, entry.durationSeconds ?? 0);
    current.useCount += 1;
    if (lastSeenMs > Date.parse(current.lastSeenAt)) current.lastSeenAt = entry.stoppedAt;
  }

  return [...ranks.values()]
    .map((rank) => {
      const lastSeenMs = Date.parse(rank.lastSeenAt);
      const daysAgo = Number.isFinite(lastSeenMs)
        ? Math.max(0, (contextMs - lastSeenMs) / 86_400_000)
        : 90;
      const frequencyScore = boundedLogScore(rank.useCount, 12);
      const recencyScore = Math.exp(-daysAgo / 21);
      const contextScore = rank.useCount >= 3
        ? Math.max(rank.timeBucketMatches / rank.useCount, rank.dayMatches / rank.useCount, rank.dayKindMatches / rank.useCount * 0.75)
        : 0;
      return {
        categoryId: rank.categoryId,
        lastSeenAt: rank.lastSeenAt,
        score: roundScore(100 * (0.55 * frequencyScore + 0.25 * recencyScore + 0.20 * contextScore)),
        totalSeconds: rank.totalSeconds,
        useCount: rank.useCount
      };
    })
    .sort((a, b) =>
      b.score - a.score ||
      b.useCount - a.useCount ||
      Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt) ||
      a.categoryId.localeCompare(b.categoryId)
    )
    .slice(0, limit);
}

const manualSuggestionSources = new Set(["manual_app", "mobile_app"]);
const excludedSuggestionEventTypes = new Set([
  "geofence_enter",
  "geofence_exit",
  "unknown_stay",
  "commute_detected",
  "learned_place_visit",
  "nfc_action",
  "shortcut_action",
  "calendar_hint",
  "health_sleep_import",
  "health_workout_import"
]);

function isManualLearningEntryEligible(entry: RecentActivityEntry) {
  if (entry.reviewStatus !== "confirmed") return false;
  if (entry.userConfirmed) return true;
  if (!entry.source || !manualSuggestionSources.has(entry.source)) return false;
  if (entry.eventType && excludedSuggestionEventTypes.has(entry.eventType)) return false;
  return true;
}

export function isRecentActivitySuggestionEligible(entry: RecentActivityEntry) {
  return isManualLearningEntryEligible(entry);
}

type ScoredRecentActivitySuggestion = RecentActivitySuggestion & {
  dayKindMatches: number;
  dayMatches: number;
  recentWindowCount: number;
  timeBucketMatches: number;
};

function scoreRecentActivitySuggestion(
  suggestion: ScoredRecentActivitySuggestion,
  contextMs: number
): RecentActivitySuggestion {
  const lastSeenMs = Date.parse(suggestion.lastSeenAt);
  const daysAgo = Number.isFinite(lastSeenMs)
    ? Math.max(0, (contextMs - lastSeenMs) / 86_400_000)
    : 90;
  const frequencyScore = boundedLogScore(suggestion.useCount, 10);
  const recencyScore = Math.exp(-daysAgo / 10);
  const timeAffinityScore = suggestion.useCount >= 3
    ? suggestion.timeBucketMatches / suggestion.useCount
    : 0;
  const dayAffinityScore = suggestion.useCount >= 3
    ? Math.max(suggestion.dayMatches / suggestion.useCount, suggestion.dayKindMatches / suggestion.useCount * 0.75)
    : 0;
  const recentRepetitionScore = Math.min(1, suggestion.recentWindowCount / 3);
  const categoryAffinityScore = suggestion.categoryId ? 0.65 : 0;
  const score = roundScore(100 * (
    0.34 * frequencyScore +
    0.12 * recencyScore +
    0.24 * timeAffinityScore +
    0.18 * dayAffinityScore +
    0.07 * recentRepetitionScore +
    0.05 * categoryAffinityScore
  ));
  const contextScore = suggestion.useCount >= 3
    ? timeAffinityScore + dayAffinityScore
    : 0;
  const section: RecentActivitySuggestionSection =
    suggestion.useCount >= 3 && contextScore >= 0.9
      ? "suggested_now"
      : suggestion.useCount >= 2
        ? "often_used"
        : "recent";

  return {
    categoryColor: suggestion.categoryColor,
    categoryId: suggestion.categoryId,
    categoryName: suggestion.categoryName,
    description: suggestion.description,
    key: suggestion.key,
    lastSeenAt: suggestion.lastSeenAt,
    score,
    section,
    totalSeconds: suggestion.totalSeconds,
    tagNames: suggestion.tagNames,
    useCount: suggestion.useCount
  };
}

function boundedLogScore(value: number, maxValue: number) {
  return Math.min(1, Math.log1p(Math.max(0, value)) / Math.log1p(maxValue));
}

function roundScore(value: number) {
  return Math.round(value * 100) / 100;
}

function compactRecentActivitySuggestionOrder(
  suggestions: RecentActivitySuggestion[]
): RecentActivitySuggestion[] {
  return [...suggestions].sort((a, b) =>
    b.score - a.score ||
    b.useCount - a.useCount ||
    b.totalSeconds - a.totalSeconds ||
    Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt) ||
    a.description.localeCompare(b.description)
  );
}

function timeOfDayBucket(date: Date) {
  return Math.floor(date.getHours() / 3);
}

function dayKind(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
}

function normalizeRecentActivityDescription(value: string | null | undefined) {
  const description = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!description || description === "Start activity") return null;
  return description;
}

export type PlaceSummary = {
  id: string;
  name: string;
  radiusMeters: number;
  priority: number;
  defaultProjectId?: string | null;
  defaultCategoryId?: string | null;
  defaultActivityDescription?: string | null;
  autoStart: boolean;
  loggingEnabled?: boolean;
};

export type AutomationRuleSummary = {
  id: string;
  name: string;
  triggerSource: EventSource;
  triggerType: ActivityEventType;
  placeId?: string | null;
  action: AutomationAction;
  projectId?: string | null;
  categoryId?: string | null;
  activityDescription?: string | null;
  enabled: boolean;
};

export type NormalizationContext = {
  projects: ProjectSummary[];
  categories: CategorySummary[];
  places: PlaceSummary[];
  automationRules: AutomationRuleSummary[];
  unknownStayThresholdMinutes?: number;
};

export type AutomationRuleDraftKind =
  | "round_trip_place_visit"
  | "place_visit_with_travel"
  | "place_visit_with_calendar_context"
  | "review_first_custom_rule";

export type AutomationRuleDraftOutcome = {
  categoryName?: string | null;
  description: string;
  mode: "auto_log_when_matched" | "review_first";
};

export type AutomationRuleDraft = {
  kind: AutomationRuleDraftKind;
  title: string;
  summary: string;
  placeName?: string | null;
  outcome: AutomationRuleDraftOutcome;
  conditions: string[];
  simulationChecks: string[];
  unsupported: string[];
};

export type AutomationRuleDraftSaveValues = {
  name: string;
  triggerSource: EventSource;
  triggerType: ActivityEventType;
  placeId: string;
  action: AutomationAction;
  projectId?: string | null;
  categoryId?: string | null;
  activityDescription?: string | null;
  confidenceThreshold: Confidence;
};

export type AutomationRuleDraftSavePlan = {
  values?: AutomationRuleDraftSaveValues;
  blockers: string[];
  notes: string[];
};

export function automationRuleInputFromDraft(input: {
  draft: AutomationRuleDraft;
  places?: Array<Pick<PlaceSummary, "id" | "name"> & Partial<Pick<PlaceSummary, "radiusMeters" | "defaultProjectId" | "defaultCategoryId" | "defaultActivityDescription">>>;
  categories?: Array<Pick<CategorySummary, "id" | "name">>;
}): AutomationRuleDraftSavePlan {
  const { draft } = input;
  const places = input.places ?? [];
  const categories = input.categories ?? [];
  const blockers: string[] = [];
  const notes: string[] = [];

  if (draft.title === "Empty rule draft" || !draft.outcome.description.trim()) {
    blockers.push("Enter a rule request before saving.");
  }

  const place = draft.placeName ? findNamedDraftItem(places, draft.placeName) : undefined;
  if (!draft.placeName) {
    blockers.push("Name a saved place in the rule request.");
  } else if (!place) {
    blockers.push(`Add "${draft.placeName}" as a saved place before saving this rule.`);
  }

  const category = draft.outcome.categoryName
    ? findNamedDraftItem(categories, draft.outcome.categoryName)
    : undefined;
  let categoryId: string | null = null;
  if (draft.outcome.categoryName && category) {
    categoryId = category.id;
  } else if (draft.outcome.categoryName && !category) {
    blockers.push(`Add "${draft.outcome.categoryName}" as a category before saving this rule.`);
  } else {
    categoryId = place?.defaultCategoryId ?? null;
  }
  if (!draft.outcome.categoryName && !categoryId) {
    blockers.push("Choose a category before saving this rule.");
  }

  if (draft.outcome.mode === "auto_log_when_matched") {
    notes.push("The first saved version stays review-first until simulation proves automatic writes are safe.");
  }

  if (draft.unsupported.length > 0) {
    notes.push("Advanced evidence checks stay in the preview until the sequence engine supports them.");
  }

  if (blockers.length > 0 || !place) {
    notes.unshift("Saved v1 rules match place exits and create review items only.");
    return { blockers, notes };
  }

  notes.unshift(
    `Saved v1 trigger: any exit from ${place.name}. It creates review items only; confirming the review creates the time entry.`
  );

  const activityDescription =
    normalizeMappingText(draft.outcome.description) ??
    normalizeMappingText(place.defaultActivityDescription) ??
    draft.title;
  const triggerSource = (place.radiusMeters ?? 0) > 250 ? "geofence_broad" : "geofence_specific";

  return {
    values: {
      name: draft.title.slice(0, 160),
      triggerSource,
      triggerType: "geofence_exit",
      placeId: place.id,
      action: "create_review_item",
      projectId: place.defaultProjectId ?? null,
      categoryId,
      activityDescription,
      confidenceThreshold: "medium_high"
    },
    blockers,
    notes
  };
}

export function draftAutomationRuleFromText(input: {
  text: string;
  places?: Array<Pick<PlaceSummary, "id" | "name">>;
  categories?: Array<Pick<CategorySummary, "id" | "name">>;
}): AutomationRuleDraft {
  const text = input.text.trim();
  const normalized = normalizeDraftText(text);
  const placeName = inferDraftPlaceName(normalized, input.places ?? []);
  const categoryName = inferDraftCategoryName(normalized, input.categories ?? []);

  if (isStationRoundTripDraft(normalized)) {
    const resolvedPlace = placeName ?? "Chelmsford Station";
    return {
      kind: "round_trip_place_visit",
      title: `${resolvedPlace} pickup/drop-off`,
      summary: "Create a family duty only when the location evidence shows a short home-to-station-to-home driving loop.",
      placeName: resolvedPlace,
      outcome: {
        categoryName: categoryName ?? "Family",
        description: "Train station pickup/drop-off",
        mode: "auto_log_when_matched"
      },
      conditions: [
        `Visited ${resolvedPlace}.`,
        "Trip starts at Home and returns to Home.",
        "Total home-to-home loop is 8-75 minutes.",
        "Station dwell is at most 30 minutes.",
        "No onward commute place appears before returning home.",
        "No existing completed entry already covers the inferred window."
      ],
      simulationChecks: [
        "Replay recent location transitions in time order.",
        "Group transit states between Home and the station visit.",
        "Reject loops that continue to Stratford, Liverpool Street, Canary Wharf, or a work place.",
        "Show the inferred start, stop, dwell, and rejection reason before enabling writes."
      ],
      unsupported: [
        "Dayframe does not yet execute multi-place sequence rules from automation_rules."
      ]
    };
  }

  if (normalized.includes("gym")) {
    return {
      kind: "place_visit_with_travel",
      title: "Gym visit with travel",
      summary: "Infer one gym activity from the home departure before Gym through the next named place or return home.",
      placeName: placeName ?? "Gym",
      outcome: {
        categoryName: categoryName ?? "Gym",
        description: "Gym",
        mode: "auto_log_when_matched"
      },
      conditions: [
        "A Gym visit is present in location history.",
        "The activity window includes travel to and from Gym.",
        "An existing Gym entry inside the inferred window is updated instead of duplicated.",
        "A later school pickup starts at school arrival and does not absorb the Gym block."
      ],
      simulationChecks: [
        "Find the home departure before the Gym visit.",
        "Find the next named place or Home after the Gym visit.",
        "Check for existing overlapping Gym entries.",
        "Show any non-Gym overlap before writing time."
      ],
      unsupported: [
        "Dayframe does not yet merge visit evidence and existing entries into sequence-based writes."
      ]
    };
  }

  if (normalized.includes("school")) {
    return {
      kind: "place_visit_with_calendar_context",
      title: "School logistics",
      summary: "Use a school visit plus calendar context as evidence for school-run activity, without treating the calendar alone as proof.",
      placeName: placeName ?? "School",
      outcome: {
        categoryName: categoryName ?? "Chores",
        description: "School run",
        mode: "review_first"
      },
      conditions: [
        "A school place visit is present in location history.",
        "Calendar context supports a drop-off, pickup, assembly, or similar school event.",
        "Child-attendance events support timing only; they do not mean the user attended the whole event.",
        "No existing completed entry already covers the inferred window."
      ],
      simulationChecks: [
        "Compare the school visit against the same-day calendar.",
        "Classify breakfast club and after-school club as child-attendance context.",
        "Show the inferred time window and category before confirmation."
      ],
      unsupported: [
        "Dayframe does not yet combine calendar evidence with place-visit rules in the automation UI."
      ]
    };
  }

  return {
    kind: "review_first_custom_rule",
    title: text ? "Custom rule draft" : "Empty rule draft",
    summary: text
      ? "Start as review-first until the required evidence checks are made explicit."
      : "Enter a rule request to draft evidence checks.",
    placeName,
    outcome: {
      categoryName,
      description: text || "Suggested activity",
      mode: "review_first"
    },
    conditions: [
      "Specify the source evidence.",
      "Specify the required time window.",
      "Specify overlap and duplicate handling.",
      "Keep the first version review-first."
    ],
    simulationChecks: [
      "Run the rule against recent events without writing time.",
      "Show matched entries and rejection reasons.",
      "Enable automatic writes only after the simulation matches expectations."
    ],
    unsupported: [
      "The request needs more detail before it can safely auto-log time."
    ]
  };
}

export type CandidateActivity = {
  action: AutomationAction | "create_time_entry" | "record_only";
  confidence: Confidence;
  reviewStatus: ReviewStatus;
  projectId?: string;
  categoryId?: string;
  placeId?: string;
  title: string;
  description?: string;
  reason: string;
  shouldClosePrevious: boolean;
};

function normalizeDraftText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function inferDraftPlaceName(normalizedText: string, places: Array<Pick<PlaceSummary, "name">>) {
  const exact = places
    .filter((place) => normalizedText.includes(place.name.toLowerCase()))
    .sort((left, right) => right.name.length - left.name.length)[0];
  if (exact) return exact.name;
  if (normalizedText.includes("chelmsford") && normalizedText.includes("station")) return "Chelmsford Station";
  if (normalizedText.includes("rail station") || normalizedText.includes("train station")) return "Train station";
  if (normalizedText.includes("gym")) return "Gym";
  if (normalizedText.includes("school")) return "School";
  return null;
}

function inferDraftCategoryName(normalizedText: string, categories: Array<Pick<CategorySummary, "name">>) {
  const categoryHints = [
    { keywords: ["family duty", "family duties", "wife", "pickup", "drop off", "drop-off"], category: "Family" },
    { keywords: ["school", "school run", "drop-off", "drop off"], category: "Chores" },
    { keywords: ["gym", "workout"], category: "Gym" },
    { keywords: ["errand", "town", "shop"], category: "Errands" },
    { keywords: ["travel", "commute"], category: "Travel" }
  ];
  for (const hint of categoryHints) {
    if (!hint.keywords.some((keyword) => normalizedText.includes(keyword))) continue;
    const category = categories.find((candidate) => candidate.name.toLowerCase() === hint.category.toLowerCase());
    return category?.name ?? hint.category;
  }
  return null;
}

function findNamedDraftItem<T extends { name: string }>(items: T[], name: string) {
  const normalizedName = name.trim().toLowerCase();
  return items.find((item) => item.name.trim().toLowerCase() === normalizedName);
}

function isStationRoundTripDraft(normalizedText: string) {
  const mentionsStation = normalizedText.includes("station") || normalizedText.includes("train");
  const mentionsPickup = ["pick", "pickup", "drop", "drop-off", "wife"].some((keyword) =>
    normalizedText.includes(keyword)
  );
  const mentionsReturnLoop = [
    "back home",
    "go back home",
    "return home",
    "there and back",
    "driving there and back",
    "shortly after"
  ].some((keyword) => normalizedText.includes(keyword));
  return mentionsStation && mentionsPickup && mentionsReturnLoop;
}

export type RunningEntry = {
  id: string;
  projectId?: string;
  categoryId?: string;
  placeId?: string;
  source: EventSource;
  confidence: Confidence;
  startedAt: Date;
  stoppedAt?: Date;
  description?: string;
};

export type ReviewCandidate = {
  id: string;
  eventType: ActivityEventType;
  title: string;
  confidence: Confidence;
  projectId?: string;
  categoryId?: string;
  placeId?: string;
  occurredAt: Date;
};

export type TimelineState = {
  activeEntry?: RunningEntry;
  completedEntries: RunningEntry[];
  reviewItems: ReviewCandidate[];
};

const explicitStartTypes = new Set<ActivityEventType>([
  "timer_start",
  "timer_switch",
  "quick_action",
  "nfc_action",
  "shortcut_action"
]);

export function confidenceForSource(source: EventSource): Confidence {
  switch (source) {
    case "manual_app":
    case "mobile_app":
    case "nfc":
    case "widget":
    case "shortcut":
    case "health_sleep":
    case "health_workout":
    case "ha_button":
      return "high";
    case "location_learning":
      return "medium";
    case "ha_geofence":
    case "geofence_specific":
      return "medium_high";
    case "home_assistant":
    case "geofence_broad":
      return "low";
    case "calendar":
      return "hint";
  }
}

export function normalizeActivityEvent(
  eventInput: ActivityEventInput,
  context: NormalizationContext
): CandidateActivity {
  const event = ActivityEventInputSchema.parse(eventInput);
  const sourceConfidence = confidenceForSource(event.source);
  const place = event.placeId
    ? context.places.find((candidate) => candidate.id === event.placeId)
    : findPlaceByName(context.places, event.rawPayload.placeName);
  const project = event.projectId
    ? context.projects.find((candidate) => candidate.id === event.projectId)
    : undefined;
  const matchingRule = findMatchingRule(event, place, context.automationRules);

  if (event.type === "timer_stop") {
    return {
      action: "stop_timer",
      confidence: sourceConfidence,
      reviewStatus: "confirmed",
      title: "Stop current timer",
      reason: "Explicit stop actions close the active primary timer.",
      shouldClosePrevious: false
    };
  }

  if (event.type === "location_evidence_batch") {
    return {
      action: "record_only",
      confidence: sourceConfidence,
      reviewStatus: "confirmed",
      title: "Location evidence batch",
      reason: "Raw location evidence is replayed into semantic stay and journey events before review.",
      shouldClosePrevious: false
    };
  }

  if (matchingRule?.enabled && matchingRule.action === "ignore_source") {
    return {
      action: "record_only",
      confidence: sourceConfidence,
      reviewStatus: "confirmed",
      title: event.description ?? "Ignored activity signal",
      reason: "An enabled ignore rule suppresses future review items for this source.",
      shouldClosePrevious: false
    };
  }

  if (explicitStartTypes.has(event.type)) {
    const categoryFromPayload = categoryFromEventPayload(event, context.categories);
    const projectId = event.projectId ?? matchingRule?.projectId ?? project?.id;
    return {
      action: "start_timer",
      confidence: sourceConfidence,
      reviewStatus: "confirmed",
      projectId,
      categoryId: event.categoryId ?? matchingRule?.categoryId ?? categoryFromPayload?.id ?? project?.categoryId ?? undefined,
      placeId: event.placeId ?? place?.id,
      title: event.description ?? project?.name ?? "Timer started",
      description: event.description,
      reason: "Manual, NFC, widget and shortcut signals are treated as high-confidence explicit starts.",
      shouldClosePrevious: true
    };
  }

  if (event.type === "geofence_enter") {
    const broadPlace = event.source === "geofence_broad" || Boolean(event.rawPayload.isBroad);
    const isHome = place?.name.toLowerCase() === "home";
    const projectId = matchingRule?.projectId ?? place?.defaultProjectId ?? undefined;
    const categoryId = matchingRule?.categoryId ?? place?.defaultCategoryId ?? undefined;

    if (matchingRule?.enabled && matchingRule.action === "suggest_timer") {
      return {
        action: "record_only",
        confidence: broadPlace ? "low" : "medium_high",
        reviewStatus: "confirmed",
        projectId,
        categoryId,
        placeId: place?.id,
        title: `Entered ${place?.name ?? "place"}`,
        reason: "Geofence arrivals are recorded as evidence only; completed visits are reviewed after a stay or exit is known.",
        shouldClosePrevious: false
      };
    }

    return {
      action: "record_only",
      confidence: broadPlace || isHome ? "low" : "medium_high",
      reviewStatus: "confirmed",
      projectId,
      categoryId,
      placeId: place?.id,
      title: `Entered ${place?.name ?? "unknown place"}`,
      reason: isHome
        ? "Home arrivals are intentionally ambiguous and remain raw evidence."
        : broadPlace
          ? "Broad geofence arrivals are raw evidence until a stay or exit is known."
          : "Specific geofence arrivals are raw evidence; Dayframe reviews completed visits after the fact.",
      shouldClosePrevious: false
    };
  }

  if (event.type === "geofence_exit") {
    const broadPlace = event.source === "geofence_broad" || event.source === "ha_geofence" || Boolean(event.rawPayload.isBroad);
    const isHome = place?.name.toLowerCase() === "home";
    const projectId = matchingRule?.projectId ?? place?.defaultProjectId ?? undefined;
    const categoryId = matchingRule?.categoryId ?? place?.defaultCategoryId ?? undefined;
    const title = visitActivityDescription(event, place, matchingRule);

    if (place?.loggingEnabled === false || event.rawPayload.loggingEnabled === false) {
      return {
        action: "record_only",
        confidence: broadPlace || isHome ? "low" : "medium_high",
        reviewStatus: "confirmed",
        projectId,
        categoryId,
        placeId: place?.id,
        title,
        reason: "Visit logging is turned off for this saved place, so the visit is kept as location evidence only.",
        shouldClosePrevious: false
      };
    }

    return {
      action: "create_review_item",
      confidence: broadPlace || isHome ? "low" : "medium_high",
      reviewStatus: "needs_review",
      projectId,
      categoryId,
      placeId: place?.id,
      title,
      reason: broadPlace
        ? "Broad geofence exits are reviewed before Dayframe closes or creates a stay."
        : isHome
          ? "Home exits are ambiguous and stay review-first by default."
          : matchingRule?.enabled && matchingRule.action === "stop_timer"
            ? "Location rules create after-the-fact review candidates instead of stopping live timers."
            : "Place visits are review-first by default, even for saved places. Confirm this completed visit before Dayframe turns it into tracked time.",
      shouldClosePrevious: false
    };
  }

  if (event.type === "unknown_stay") {
    const durationMinutes = Number(event.rawPayload.durationMinutes ?? 0);
    const threshold = context.unknownStayThresholdMinutes ?? DEFAULT_UNKNOWN_STAY_THRESHOLD_MINUTES;
    const isLearnedOneOff = event.rawPayload.evidenceKind === "one_off_activity";
    const locationName = readableLocationNameFromParts({
      address: event.rawPayload.address,
      latitude: event.rawPayload.latitude,
      longitude: event.rawPayload.longitude,
      fallbackName: event.description ?? stringFromPayload(event.rawPayload.candidateName)
    });
    return {
      action: durationMinutes >= threshold ? "create_review_item" : "record_only",
      confidence: "low",
      reviewStatus: durationMinutes >= threshold ? "needs_review" : "confirmed",
      title: durationMinutes >= threshold
        ? isLearnedOneOff ? locationName : "Review unknown stay"
        : "Record short unknown stay",
      reason:
        durationMinutes >= threshold
          ? isLearnedOneOff
            ? "Dayframe detected one significant stay here. It can be reviewed as time spent here, but it is not a saved-place suggestion."
            : "Unknown stays longer than the configured threshold need human review."
          : "Short unknown stays are retained as raw events only.",
      shouldClosePrevious: false
    };
  }

  if (event.type === "commute_detected") {
    const fromName = stringFromPayload(event.rawPayload.fromPlaceName) ?? "previous place";
    const toName = stringFromPayload(event.rawPayload.toPlaceName) ?? stringFromPayload(event.rawPayload.placeName) ?? "next place";
    const commuteCategory = findCategoryByName(context.categories, "Commute") ?? findCategoryByName(context.categories, "Travel");
    const fromPlaceId = stringFromPayload(event.rawPayload.fromPlaceId);
    const toPlaceId = stringFromPayload(event.rawPayload.toPlaceId);
    const fromSavedPlace = fromPlaceId ? context.places.find((candidate) => candidate.id === fromPlaceId) : undefined;
    const toSavedPlace = toPlaceId ? context.places.find((candidate) => candidate.id === toPlaceId) : undefined;
    const canAutoLog =
      event.rawPayload.reviewFirst === false &&
      Boolean(fromSavedPlace) &&
      Boolean(toSavedPlace) &&
      fromSavedPlace?.id !== toSavedPlace?.id;
    return {
      action: canAutoLog ? "create_time_entry" : "create_review_item",
      confidence: canAutoLog ? "medium_high" : "medium",
      reviewStatus: canAutoLog ? "confirmed" : "needs_review",
      categoryId: event.categoryId ?? commuteCategory?.id,
      placeId: event.placeId ?? place?.id,
      title: canAutoLog ? "Commute" : event.description ?? `Possible commute from ${fromName} to ${toName}`,
      reason: canAutoLog
        ? "A clean transition between two saved places can be logged automatically as category-only commute time."
        : "Commute learning found movement between places, but an uncertain endpoint keeps it review-first.",
      shouldClosePrevious: false
    };
  }

  if (event.type === "learned_place_visit") {
    const classification = classifyLocationLearningEvidence(
      locationLearningEvidenceFromPayload(event.rawPayload)
    );
    const candidateName = readableLocationNameFromParts({
      address: event.rawPayload.address,
      latitude: event.rawPayload.latitude,
      longitude: event.rawPayload.longitude,
      fallbackName:
        event.description ??
        stringFromPayload(event.rawPayload.placeName) ??
        stringFromPayload(event.rawPayload.candidateName)
    });
    if (classification.kind === "noise") {
      return {
        action: "record_only",
        confidence: "hint",
        reviewStatus: "confirmed",
        categoryId: event.categoryId,
        placeId: event.placeId ?? place?.id,
        title: candidateName,
        reason: classification.reason,
        shouldClosePrevious: false
      };
    }
    return {
      action: "create_review_item",
      confidence: classification.confidence,
      reviewStatus: "needs_review",
      categoryId: event.categoryId,
      placeId: event.placeId ?? place?.id,
      title: candidateName,
      reason:
        classification.kind === "one_off_activity"
          ? "Dayframe detected one significant stay here. It can be reviewed as time spent here, but it is not a saved-place suggestion."
          : "Repeated visits suggest this may be a place worth saving. The detected time still needs review before it is logged.",
      shouldClosePrevious: false
    };
  }

  if (event.type === "calendar_hint") {
    return {
      action: "create_review_item",
      confidence: "hint",
      reviewStatus: "needs_review",
      title: event.description ?? "Review calendar hint",
      reason: "Calendar entries are hints until a person confirms the mapping.",
      shouldClosePrevious: false
    };
  }

  if (event.type === "health_sleep_import") {
    const autoConfirm =
      event.rawPayload.autoConfirm === true &&
      shouldAutoConfirmHealthSleep({
        durationSeconds: typeof event.rawPayload.durationSeconds === "number"
          ? event.rawPayload.durationSeconds
          : undefined,
        startedAt: event.rawPayload.startedAt,
        stoppedAt: event.rawPayload.stoppedAt
      });

    return {
      action: autoConfirm ? "create_time_entry" : "create_review_item",
      confidence: "high",
      reviewStatus: autoConfirm ? "confirmed" : "needs_review",
      projectId: event.projectId,
      categoryId: event.categoryId ?? findCategoryByName(context.categories, "Sleep")?.id,
      title: event.description ?? "Sleep",
      reason: autoConfirm
        ? "High-confidence Health sleep can become completed time automatically."
        : "Sleep imports are reviewed when the duration or confidence is uncertain.",
      shouldClosePrevious: false
    };
  }

  if (event.type === "health_workout_import") {
    const workoutType = normalizeHealthWorkoutType(
      event.rawPayload.workoutType ?? event.rawPayload.workoutLabel ?? event.description
    );
    const durationSeconds = typeof event.rawPayload.durationSeconds === "number"
      ? event.rawPayload.durationSeconds
      : undefined;
    const autoConfirm =
      event.rawPayload.autoConfirm === true &&
      shouldAutoConfirmHealthWorkout({ workoutType, durationSeconds });

    return {
      action: autoConfirm ? "create_time_entry" : "create_review_item",
      confidence: "high",
      reviewStatus: autoConfirm ? "confirmed" : "needs_review",
      projectId: event.projectId,
      categoryId: event.categoryId ?? findCategoryByName(context.categories, "Health")?.id,
      title: event.description ?? healthWorkoutLabel(workoutType),
      reason: autoConfirm
        ? "High-confidence Health workouts can become completed time entries automatically."
        : "Health workouts are reviewed when the type, duration, or confidence is uncertain.",
      shouldClosePrevious: false
    };
  }

  return {
    action: "record_only",
    confidence: sourceConfidence,
    reviewStatus: "confirmed",
    title: event.description ?? "Recorded activity event",
    reason: "No conversion rule matched this event.",
    shouldClosePrevious: false
  };
}

export function applyActivityEvent(
  state: TimelineState,
  eventInput: ActivityEventInput,
  context: NormalizationContext
): TimelineState {
  const event = ActivityEventInputSchema.parse(eventInput);
  const candidate = normalizeActivityEvent(event, context);
  const next: TimelineState = {
    activeEntry: state.activeEntry ? { ...state.activeEntry } : undefined,
    completedEntries: [...state.completedEntries],
    reviewItems: [...state.reviewItems]
  };

  if (candidate.action === "stop_timer" && next.activeEntry) {
    next.completedEntries.push({ ...next.activeEntry, stoppedAt: event.occurredAt });
    next.activeEntry = undefined;
    return next;
  }

  if (candidate.action === "start_timer") {
    if (candidate.shouldClosePrevious && next.activeEntry) {
      next.completedEntries.push({ ...next.activeEntry, stoppedAt: event.occurredAt });
    }

    next.activeEntry = {
      id: `entry-${event.occurredAt.getTime()}`,
      projectId: candidate.projectId,
      categoryId: candidate.categoryId,
      placeId: candidate.placeId,
      source: event.source,
      confidence: candidate.confidence,
      startedAt: event.occurredAt,
      description: event.description ?? candidate.description
    };
    return next;
  }

  if (candidate.action === "create_time_entry") {
    next.completedEntries.push({
      id: `entry-${event.occurredAt.getTime()}`,
      projectId: candidate.projectId,
      categoryId: candidate.categoryId,
      placeId: candidate.placeId,
      source: event.source,
      confidence: candidate.confidence,
      startedAt: timestampFromPayload(event.rawPayload.startedAt) ?? event.occurredAt,
      stoppedAt: timestampFromPayload(event.rawPayload.stoppedAt),
      description: event.description ?? candidate.title
    });
    return next;
  }

  if (candidate.reviewStatus === "needs_review") {
    next.reviewItems.push(toReviewCandidate(event, candidate));
  }

  return next;
}

function timestampFromPayload(value: unknown) {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMappingText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 160) : null;
}

function timestampMs(value: unknown) {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : null;
  if (!date) return null;
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function findMatchingRule(
  event: ParsedActivityEvent,
  place: PlaceSummary | undefined,
  rules: AutomationRuleSummary[]
) {
  return rules.find((rule) => {
    if (!rule.enabled) return false;
    if (rule.triggerSource !== event.source) return false;
    if (rule.triggerType !== event.type) return false;
    if (rule.placeId && rule.placeId !== place?.id && rule.placeId !== event.placeId) return false;
    return true;
  });
}

function findPlaceByName(places: PlaceSummary[], value: unknown) {
  if (typeof value !== "string") return undefined;
  return places.find((place) => place.name.toLowerCase() === value.toLowerCase());
}

function findCategoryByName(categories: CategorySummary[], value: string) {
  return categories.find((category) => category.name.toLowerCase() === value.toLowerCase());
}

function categoryFromEventPayload(
  event: ParsedActivityEvent,
  categories: CategorySummary[]
) {
  const categoryName = stringFromPayload(event.rawPayload.categoryName) ?? stringFromPayload(event.rawPayload.category);
  if (!categoryName) return undefined;
  return findCategoryByName(categories, categoryName);
}

function stringFromPayload(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteCoordinate(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanLocationText(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 160) : null;
}

function firstCleanLocationText(...values: unknown[]) {
  for (const value of values) {
    const text = cleanLocationText(value);
    if (text) return text;
  }
  return null;
}

function nearLabel(value: string) {
  return value.toLowerCase().startsWith("near ") ? value : `Near ${value}`;
}

function looksLikeStreetAddressName(input: {
  name: string;
  street: string | null;
  streetNumber: string | null;
}) {
  const normalizedName = input.name.toLowerCase();
  if (input.streetNumber && normalizedName === input.streetNumber.toLowerCase()) return true;
  if (input.street && normalizedName === input.street.toLowerCase()) return true;
  if (/^\d+[a-z]?(\s|$)/i.test(input.name)) return true;
  if (!input.street || !input.streetNumber) return false;
  return (
    normalizedName.includes(input.street.toLowerCase()) &&
    normalizedName.includes(input.streetNumber.toLowerCase())
  );
}

function looksLikeCoordinateFallback(value: string) {
  const normalized = value.toLowerCase();
  return (
    looksLikeCoordinateText(value) ||
    /^(near|place near)\s+-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(normalized) ||
    /^regular place near\s+-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(normalized) ||
    /^unknown place near\s+-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(normalized)
  );
}

function looksLikeCoordinateText(value: string) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(value.trim());
}

function normalizeLocationLearningEvidence(
  evidence: Partial<LocationLearningEvidence>
): LocationLearningEvidence {
  return {
    visitCount: positiveWholeNumber(evidence.visitCount, 1),
    distinctDays: positiveWholeNumber(evidence.distinctDays, 1),
    sampleCount: positiveWholeNumber(evidence.sampleCount, 1),
    totalDwellMs: nonNegativeFiniteNumber(evidence.totalDwellMs) ?? 0,
    longestDwellMs: nonNegativeFiniteNumber(evidence.longestDwellMs) ?? 0,
    currentDwellMs: nonNegativeFiniteNumber(evidence.currentDwellMs) ?? 0,
    currentVisitSampleCount: positiveWholeNumber(evidence.currentVisitSampleCount, 1),
    averageAccuracyMeters: nonNegativeFiniteNumber(evidence.averageAccuracyMeters),
    maxClusterSpreadMeters: nonNegativeFiniteNumber(evidence.maxClusterSpreadMeters),
    radiusMeters: positiveWholeNumber(
      evidence.radiusMeters,
      LOCATION_LEARNING_THRESHOLDS.clusterRadiusMeters
    ),
    firstSeenAt: evidence.firstSeenAt ?? null,
    lastSeenAt: evidence.lastSeenAt ?? null
  };
}

function locationLearningEvidenceScore(
  evidence: LocationLearningEvidence,
  quality: { accurate: boolean; stable: boolean }
) {
  const thresholds = LOCATION_LEARNING_THRESHOLDS;
  const points =
    Math.min(25, Math.max(0, evidence.visitCount - 1) * 15) +
    Math.min(20, Math.max(0, evidence.distinctDays - 1) * 20) +
    Math.min(15, Math.round((evidence.sampleCount / thresholds.placeCandidate.minSampleCount) * 15)) +
    Math.min(20, Math.round((evidence.totalDwellMs / thresholds.placeCandidate.minTotalDwellMs) * 20)) +
    (quality.accurate ? 10 : 0) +
    (quality.stable ? 10 : 0);
  return Math.min(100, points);
}

function dwellMsFromPayload(payload: Record<string, unknown>) {
  const explicit = nonNegativeFiniteNumber(payload.currentDwellMs)
    ?? secondsToMs(payload.durationSeconds)
    ?? minutesToMs(payload.durationMinutes);
  if (explicit !== null) return explicit;
  const startedAt = timestampMs(payload.startedAt);
  const stoppedAt = timestampMs(payload.stoppedAt ?? payload.lastSeenAt);
  if (startedAt === null || stoppedAt === null) return 0;
  return Math.max(0, stoppedAt - startedAt);
}

function distinctDayCountFromPayload(payload: Record<string, unknown>) {
  const firstSeenAt = timestampMs(payload.clusterFirstSeenAt ?? payload.startedAt);
  const lastSeenAt = timestampMs(payload.stoppedAt ?? payload.lastSeenAt);
  if (firstSeenAt === null || lastSeenAt === null) return 1;
  return new Date(firstSeenAt).toISOString().slice(0, 10) === new Date(lastSeenAt).toISOString().slice(0, 10)
    ? 1
    : 2;
}

function positiveWholeNumber(value: unknown, fallback: number) {
  const parsed = nonNegativeFiniteNumber(value);
  return parsed !== null && parsed >= 1 ? Math.round(parsed) : fallback;
}

function nonNegativeFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function secondsToMs(value: unknown) {
  const seconds = nonNegativeFiniteNumber(value);
  return seconds === null ? null : seconds * 1000;
}

function minutesToMs(value: unknown) {
  const minutes = nonNegativeFiniteNumber(value);
  return minutes === null ? null : minutes * 60_000;
}

function visitActivityDescription(
  event: ParsedActivityEvent,
  place: PlaceSummary | undefined,
  rule?: AutomationRuleSummary
) {
  const eventDescription = event.description?.trim();
  if (eventDescription) return eventDescription;

  const ruleDescription = rule?.activityDescription?.trim();
  if (ruleDescription) return ruleDescription;

  const placeDefault = place?.defaultActivityDescription?.trim();
  if (placeDefault) return placeDefault;

  const payloadDefault =
    typeof event.rawPayload.defaultActivityDescription === "string"
      ? event.rawPayload.defaultActivityDescription.trim()
      : "";
  if (payloadDefault) return payloadDefault;

  const payloadPlaceName =
    typeof event.rawPayload.placeName === "string"
      ? event.rawPayload.placeName.trim()
      : "";

  return place?.name ?? (payloadPlaceName || "Place visit");
}

function toReviewCandidate(
  event: ParsedActivityEvent,
  candidate: CandidateActivity
): ReviewCandidate {
  return {
    id: `review-${event.occurredAt.getTime()}`,
    eventType: event.type,
    title: candidate.title,
    confidence: candidate.confidence,
    projectId: candidate.projectId,
    categoryId: candidate.categoryId,
    placeId: candidate.placeId,
    occurredAt: event.occurredAt
  };
}
