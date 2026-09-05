import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_HEALTH_IMPORT_PREFERENCES,
  DEFAULT_HEALTH_WORKOUT_IMPORT_PREFERENCES,
  HEALTH_SLEEP_SESSION_GAP_MS,
  HEALTH_IMPORT_PREFERENCE_OPTIONS as SHARED_HEALTH_IMPORT_PREFERENCE_OPTIONS,
  HEALTH_WORKOUT_TYPE_OPTIONS,
  healthAutoLogMappingFor,
  healthWorkoutLabel,
  mapHealthKitSleepStage,
  normalizeHealthAutoLogMappings,
  normalizeHealthWorkoutType,
  shouldAutoConfirmHealthSleep,
  shouldAutoConfirmHealthWorkout,
  type HealthAutoLogMapping,
  type HealthAutoLogMappings,
  type HealthImportPreferenceKey,
  type HealthImportPreferences,
  type HealthWorkoutImportPreferences,
  type HealthWorkoutType,
  type SleepStage,
} from "@dayframe/shared";
import {
  enqueueEvent,
  reprocessHealthReviewItems,
  type HealthReviewReprocessResult,
} from "./api";
import { DAYFRAME_API_BASE } from "./config";
import {
  readActiveMobileAccount,
  mobileAccountOwnersEqual,
} from "./mobileAccount";
import { StaleMobileSessionResponseError } from "./mobile-network";
import {
  boundedHealthQuery,
  createHealthCaptureCoalescer,
  HealthQueryDeadlineError,
} from "./healthCaptureLifecycle";
import { requireBackendIdentity } from "./backendIdentity";
import {
  readOwnedAuthenticatedSessionSnapshot,
  isAuthenticatedSessionSnapshotCurrent,
} from "./secure-session";
import {
  getHealthCheckpoint,
  beginOrResumeHealthRepair,
  completeSkippedHealthRepairKind,
  commitHealthCapturePage,
  handoffHealthEvents,
  pruneAcknowledgedHealthCapture,
  recordHealthQueryFailure,
  type HealthCaptureOwner,
  type HealthCaptureKind,
  type HealthJournalSample,
  type HealthEpisodeDraft,
} from "./healthSyncStore";

const HEALTHKIT_SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis";
const HEALTHKIT_WORKOUT_TYPE = "HKWorkoutTypeIdentifier";
const HEALTHKIT_READ_TYPES = [
  HEALTHKIT_SLEEP_TYPE,
  HEALTHKIT_WORKOUT_TYPE,
] as const;
const HEALTHKIT_ANCHOR_KEY = "dayframe.healthkit.sleepAnchor.v1";
const HEALTHKIT_SEEN_KEY = "dayframe.healthkit.sleepSeen.v1";
const HEALTHKIT_WORKOUT_ANCHOR_KEY = "dayframe.healthkit.workoutAnchor.v1";
const HEALTHKIT_WORKOUT_SEEN_KEY = "dayframe.healthkit.workoutSeen.v1";
const HEALTHKIT_IMPORT_PREFERENCES_KEY =
  "dayframe.healthkit.importPreferences.v1";
const HEALTHKIT_AUTO_LOG_MAPPINGS_KEY = "dayframe.healthkit.autoLogMappings.v1";
const HEALTHKIT_WORKOUT_PREFERENCES_KEY =
  "dayframe.healthkit.workoutPreferences.v1";
const HEALTHKIT_AUTOMATIC_SYNC_KEY = "dayframe.healthkit.automaticSync.v1";
const HEALTHKIT_BACKGROUND_DELIVERY_KEY =
  "dayframe.healthkit.backgroundDelivery.v2";
const HEALTHKIT_BACKGROUND_SYNC_TYPES = [
  HEALTHKIT_SLEEP_TYPE,
  HEALTHKIT_WORKOUT_TYPE,
] as const;
const HEALTHKIT_UPDATE_FREQUENCY_IMMEDIATE = 1;
const HEALTH_REPROCESS_THROTTLE_MS = 5 * 60 * 1000;
const HEALTH_REPROCESS_BACKOFF_MS = 10 * 60 * 1000;
const HEALTH_REPROCESS_BATCH_SIZE = 25;
const HEALTH_REPROCESS_MAX_BATCHES = 10;
const HEALTH_REPROCESS_MAX_DURATION_MS = 25_000;
const HEALTH_DEBUG_LOOKBACK_DAYS = 14;
const HEALTH_DEBUG_SAMPLE_LIMIT = 100;

let healthReprocessInFlight: Promise<HealthReviewReprocessResult> | null = null;
let lastHealthReprocessAt = 0;
let healthReprocessBackoffUntil = 0;

export const HEALTH_IMPORT_PREFERENCE_OPTIONS =
  SHARED_HEALTH_IMPORT_PREFERENCE_OPTIONS;
export const HEALTH_WORKOUT_PREFERENCE_OPTIONS = HEALTH_WORKOUT_TYPE_OPTIONS;

export type HealthImportStatus = {
  provider: "healthkit";
  kind?: "availability" | "permissions" | "sleep" | "workout";
  status:
    | "available"
    | "unavailable"
    | "needs_permission"
    | "synced"
    | "error"
    | "planned"
    | "query_completed"
    | "captured"
    | "queued"
    | "uploaded"
    | "processed"
    | "visible"
    | "disabled"
    | "query_failed"
    | "no_readable_samples";
  notes: string;
  importedCount?: number;
  lastSync?: string;
  deletionCount?: number;
  capturedCount?: number;
  partial?: boolean;
};

export type DayframeSleepSample = {
  externalSampleId: string;
  stage: SleepStage;
  startedAt: string;
  stoppedAt: string;
  sourceName?: string;
  rawPayload: Record<string, unknown>;
};

export type DayframeSleepSession = {
  externalSessionId: string;
  startedAt: string;
  stoppedAt: string;
  sourceName?: string;
  samples: DayframeSleepSample[];
};

type HealthKitModule = typeof import("@kingstinct/react-native-healthkit");

type HealthKitSleepSample = {
  uuid?: string;
  value?: number | string;
  startDate: Date | string;
  endDate: Date | string;
  sourceRevision?: { source?: { name?: string; bundleIdentifier?: string } };
  metadata?: Record<string, unknown>;
};

export type DayframeWorkoutSample = {
  externalSampleId: string;
  workoutType: HealthWorkoutType;
  workoutLabel: string;
  startedAt: string;
  stoppedAt: string;
  durationSeconds: number | null;
  distanceMeters: number | null;
  energyKcal: number | null;
  sourceName?: string;
  rawPayload: Record<string, unknown>;
};

type HealthKitWorkoutSample = {
  uuid?: string;
  workoutActivityType?: number | string;
  startDate: Date | string;
  endDate: Date | string;
  duration?: { quantity?: number; unit?: string } | number;
  totalDistance?: { quantity?: number; unit?: string };
  totalEnergyBurned?: { quantity?: number; unit?: string };
  sourceRevision?: { source?: { name?: string; bundleIdentifier?: string } };
  metadata?: Record<string, unknown>;
  toJSON?: () => HealthKitWorkoutSample;
};

export type HealthKitChangeType =
  (typeof HEALTHKIT_BACKGROUND_SYNC_TYPES)[number];

export type HealthKitChangeSubscription = {
  remove: () => void;
};

export type HealthDebugExportOptions = {
  lookbackDays?: number;
  limit?: number;
};

export type HealthDebugExport = {
  exportedAt: string;
  apiBase: string;
  lookback: {
    startedAt: string;
    stoppedAt: string;
    days: number;
    limit: number;
  };
  storedState: {
    sleepAnchorPresent: boolean;
    workoutAnchorPresent: boolean;
    sleepSeenCount: number;
    workoutSeenCount: number;
    preferences: HealthImportPreferences;
    mappings: HealthAutoLogMappings;
  };
  healthKit: {
    sleep: {
      sampleCount: number;
      deletedSampleCount: number;
      stageCounts: Record<string, number>;
      sessions: Array<{
        externalSessionId: string;
        startedAt: string;
        stoppedAt: string;
        durationSeconds: number | null;
        sampleCount: number;
        stages: string[];
        autoConfirm: boolean;
      }>;
      samples: DayframeSleepSample[];
    };
    workouts: {
      sampleCount: number;
      deletedSampleCount: number;
      typeCounts: Record<string, number>;
      samples: DayframeWorkoutSample[];
    };
  };
  generatedEvents: {
    sleep: Array<ReturnType<typeof healthKitSleepSessionEvent>>;
    workouts: Array<ReturnType<typeof healthKitWorkoutEvent>>;
  };
};

export async function getHealthImportStatus(): Promise<HealthImportStatus[]> {
  if (Platform.OS !== "ios") {
    return [
      {
        provider: "healthkit",
        kind: "availability",
        status: "unavailable",
        notes: "Apple Health is only available on native iOS builds.",
      },
    ];
  }

  try {
    const healthkit = await loadHealthKit();
    const available = await Promise.resolve(healthkit.isHealthDataAvailable());
    return [
      {
        provider: "healthkit",
        kind: "availability",
        status: available ? "available" : "unavailable",
        notes: available
          ? "Apple Health can be connected from this native build."
          : "Health data is not available on this device.",
      },
    ];
  } catch (error) {
    return [
      {
        provider: "healthkit",
        kind: "availability",
        status: "error",
        notes: friendlyHealthKitError(error, "check Apple Health availability"),
      },
    ];
  }
}

export async function requestHealthKitPermissions() {
  ensureIos();
  const healthkit = await loadHealthKit();
  const available = await Promise.resolve(healthkit.isHealthDataAvailable());
  if (!available) {
    return {
      provider: "healthkit" as const,
      kind: "permissions" as const,
      status: "unavailable" as const,
      notes: "Health data is not available on this device.",
    };
  }

  const granted = await healthkit.requestAuthorization({
    toRead: HEALTHKIT_READ_TYPES,
  });
  if (granted) {
    await AsyncStorage.setItem(HEALTHKIT_AUTOMATIC_SYNC_KEY, "true");
    await configureHealthKitAutomaticSync().catch(() => undefined);
  }
  return {
    provider: "healthkit" as const,
    kind: "permissions" as const,
    status: granted ? ("available" as const) : ("needs_permission" as const),
    notes: granted
      ? "Apple Health read access was requested for sleep and workouts."
      : "Apple Health access was not granted.",
  };
}

export async function isHealthKitAutomaticSyncEnabled() {
  return AsyncStorage.getItem(HEALTHKIT_AUTOMATIC_SYNC_KEY).then(
    (value) => value === "true",
  );
}

export async function configureHealthKitAutomaticSync() {
  ensureIos();
  const healthkit = await loadHealthKit();
  const available = await Promise.resolve(healthkit.isHealthDataAvailable());
  if (!available) return false;

  const configured = await healthkit
    .configureBackgroundTypes(
      [...HEALTHKIT_BACKGROUND_SYNC_TYPES],
      HEALTHKIT_UPDATE_FREQUENCY_IMMEDIATE,
    )
    .catch(() => false);
  const deliveryResults = await Promise.all(
    HEALTHKIT_BACKGROUND_SYNC_TYPES.map((type) =>
      healthkit
        .enableBackgroundDelivery(type, HEALTHKIT_UPDATE_FREQUENCY_IMMEDIATE)
        .catch(() => false),
    ),
  );
  const enabled = configured !== false && deliveryResults.some(Boolean);
  if (enabled) {
    await AsyncStorage.setItem(HEALTHKIT_BACKGROUND_DELIVERY_KEY, "true");
  } else {
    await AsyncStorage.setItem(HEALTHKIT_BACKGROUND_DELIVERY_KEY, "false");
  }
  return enabled;
}

export async function startHealthKitChangeObservers(
  onChange: (type: HealthKitChangeType, errorMessage?: string) => void,
): Promise<HealthKitChangeSubscription | null> {
  ensureIos();
  if (!(await isHealthKitAutomaticSyncEnabled())) return null;

  const healthkit = await loadHealthKit();
  const subscriptions = HEALTHKIT_BACKGROUND_SYNC_TYPES.map((type) =>
    healthkit.subscribeToChanges(type, ({ errorMessage }) => {
      onChange(type, errorMessage);
    }),
  );

  return {
    remove: () => {
      for (const subscription of subscriptions) subscription.remove();
    },
  };
}

export type HealthCaptureOptions = {
  signal?: AbortSignal;
  observerChange?: boolean;
  repairWindow?: { startedAt: string; stoppedAt: string };
};
const HEALTH_QUERY_PAGE_SIZE = 250;
const HEALTH_CAPTURE_PASS_MS = 15_000;
const activeHealthCaptures = createHealthCaptureCoalescer();

export async function currentHealthCaptureOwner(): Promise<HealthCaptureOwner | null> {
  const owner = await readActiveMobileAccount();
  if (!owner) return null;
  return { ...owner, backendId: requireBackendIdentity() };
}

export function importHealthKitSleep(options: HealthCaptureOptions = {}) {
  return captureHealthKind("sleep", options);
}
export function importHealthKitWorkouts(options: HealthCaptureOptions = {}) {
  return captureHealthKind("workout", options);
}

async function captureHealthKind(
  kind: HealthCaptureKind,
  options: HealthCaptureOptions,
): Promise<HealthImportStatus> {
  ensureIos();
  const owner = await currentHealthCaptureOwner();
  if (!owner) throw new Error("Sign in before capturing Apple Health data.");
  const key = JSON.stringify([owner, kind, options.repairWindow ?? "delta"]);
  return activeHealthCaptures.run(
    key,
    () => captureHealthKindUnsafe(owner, kind, options),
    options.observerChange,
  );
}

async function captureHealthKindUnsafe(
  owner: HealthCaptureOwner,
  kind: HealthCaptureKind,
  options: HealthCaptureOptions,
): Promise<HealthImportStatus> {
  const preferences = await getHealthImportPreferences();
  const enabled =
    kind === "sleep"
      ? preferences.sleep
      : Object.entries(preferences).some(
          ([type, value]) => type !== "sleep" && value,
        );
  const session = await readOwnedAuthenticatedSessionSnapshot(owner);
  if (session.status !== "authenticated")
    throw new StaleMobileSessionResponseError();
  const deadlineAt = Date.now() + HEALTH_CAPTURE_PASS_MS;
  const isCurrent = async () =>
    !options.signal?.aborted &&
    Date.now() < deadlineAt &&
    isAuthenticatedSessionSnapshotCurrent(session.snapshot) &&
    mobileAccountOwnersEqual(owner, await readActiveMobileAccount());
  if (!enabled) {
    if (options.repairWindow)
      await completeSkippedHealthRepairKind(
        owner,
        kind,
        options.repairWindow,
        isCurrent,
      );
    return {
      provider: "healthkit",
      kind,
      status: "disabled",
      notes: `${kind === "sleep" ? "Sleep" : "Workout"} import is off.`,
      importedCount: 0,
    };
  }
  const healthkit = await loadHealthKit();
  const mappings = await getHealthAutoLogMappings();
  await pruneAcknowledgedHealthCapture(owner);
  let importedCount = 0,
    capturedCount = 0,
    deletionCount = 0,
    partial = false,
    queried = false;
  // Recover a committed source page even when its former process died before enqueue.
  importedCount += (await handoffHealthEvents(owner, enqueueEvent, isCurrent))
    .queuedCount;
  for (let page = 0; page < 20; page++) {
    if (!(await isCurrent())) {
      partial = true;
      break;
    }
    const checkpoint = await getHealthCheckpoint(
      owner,
      kind,
      options.repairWindow,
    );
    const startedAt = new Date().toISOString();
    const runId = `${kind}:${startedAt}:${page}:${Math.random().toString(36).slice(2)}`;
    try {
      const query = {
        anchor: checkpoint.anchor ?? undefined,
        limit: HEALTH_QUERY_PAGE_SIZE,
        filter: {
          date: {
            startDate: new Date(checkpoint.contract.startedAt),
            ...(checkpoint.contract.stoppedAt
              ? { endDate: new Date(checkpoint.contract.stoppedAt) }
              : {}),
          },
        },
      };
      const result =
        kind === "sleep"
          ? await boundedHealthQuery(
              healthkit.queryCategorySamplesWithAnchor(
                HEALTHKIT_SLEEP_TYPE,
                query,
              ),
              deadlineAt,
              options.signal,
            )
          : await boundedHealthQuery(
              healthkit.queryWorkoutSamplesWithAnchor(query),
              deadlineAt,
              options.signal,
            );
      if (!(await isCurrent())) throw new StaleMobileSessionResponseError();
      queried = true;
      const rawSamples = "samples" in result ? result.samples : result.workouts;
      const additions: HealthJournalSample[] = [];
      let ignoredCount = 0;
      for (const raw of rawSamples) {
        const sample =
          "toJSON" in raw && typeof raw.toJSON === "function"
            ? raw.toJSON()
            : raw;
        if (
          !sample.uuid ||
          !validDate(String(sample.startDate)) ||
          !validDate(String(sample.endDate))
        ) {
          ignoredCount++;
          continue;
        }
        const mapped =
          kind === "sleep"
            ? mapHealthKitSleepSample(sample as HealthKitSleepSample)
            : mapHealthKitWorkoutSample(sample as HealthKitWorkoutSample);
        if (
          !validDate(mapped.startedAt) ||
          !validDate(mapped.stoppedAt) ||
          Date.parse(mapped.stoppedAt) <= Date.parse(mapped.startedAt) ||
          Date.parse(mapped.stoppedAt) < Date.now() - 14 * 86_400_000
        ) {
          ignoredCount++;
          continue;
        }
        // Native arbitrary metadata never enters the durable capture store.
        mapped.rawPayload = {
          uuid: sample.uuid,
          sourceRevision: {
            source: {
              name: sample.sourceRevision?.source?.name,
              bundleIdentifier: sample.sourceRevision?.source?.bundleIdentifier,
            },
          },
          ...(kind === "workout"
            ? {
                workoutActivityType: (sample as HealthKitWorkoutSample)
                  .workoutActivityType,
              }
            : {}),
        };
        additions.push({
          id: mapped.externalSampleId,
          sourceKey: sleepSampleSourceKey(mapped as DayframeSleepSample),
          startedAt: mapped.startedAt,
          stoppedAt: mapped.stoppedAt,
          value: mapped as unknown as Record<string, unknown>,
        });
      }
      const deletedIds = result.deletedSamples.map((sample) => sample.uuid);
      const complete =
        rawSamples.length + deletedIds.length < HEALTH_QUERY_PAGE_SIZE;
      const committed = await commitHealthCapturePage({
        owner,
        ...checkpoint,
        previousAnchor: checkpoint.anchor,
        newAnchor: result.newAnchor,
        runId,
        startedAt,
        additions,
        deletedIds,
        returnedCount: rawSamples.length,
        ignoredCount,
        complete,
        isCurrent,
        derive: (samples) => {
          if (kind === "sleep")
            return groupSleepSamplesIntoSessions(
              samples.map(
                (sample) => sample.value as unknown as DayframeSleepSample,
              ),
            ).map((group) => ({
              sourceKey: sleepSampleSourceKey(group.samples[0]),
              sampleIds: group.samples.map((sample) => sample.externalSampleId),
              startedAt: group.startedAt,
              stoppedAt: group.stoppedAt,
              event: {
                ...healthKitSleepSessionEvent(
                  group,
                  healthAutoLogMappingFor("sleep", mappings),
                ),
                rawPayload: {
                  ...healthKitSleepSessionEvent(
                    group,
                    healthAutoLogMappingFor("sleep", mappings),
                  ).rawPayload,
                  sourceSampleIds: group.samples.map(
                    (sample) => sample.externalSampleId,
                  ),
                },
              },
            }));
          return samples.flatMap((sample) => {
            const workout = sample.value as unknown as DayframeWorkoutSample;
            if (!preferences[workout.workoutType]) return [];
            const event = healthKitWorkoutEvent(
              workout,
              healthAutoLogMappingFor(workout.workoutType, mappings),
            );
            return [
              {
                sourceKey: sample.sourceKey,
                sampleIds: [sample.id],
                startedAt: sample.startedAt,
                stoppedAt: sample.stoppedAt,
                event: {
                  ...event,
                  rawPayload: {
                    ...event.rawPayload,
                    sourceSampleIds: [sample.id],
                  },
                },
              } satisfies HealthEpisodeDraft,
            ];
          });
        },
      });
      capturedCount += committed.usableSampleCount;
      deletionCount += committed.deletionCount;
      importedCount += (
        await handoffHealthEvents(owner, enqueueEvent, isCurrent)
      ).queuedCount;
      partial = !complete;
      if (complete) break;
      if (result.newAnchor === checkpoint.anchor) {
        partial = true;
        break;
      }
    } catch (error) {
      if (error instanceof HealthQueryDeadlineError) {
        await recordHealthQueryFailure({
          owner,
          contract: checkpoint.contract,
          runId,
          startedAt,
          reason: "query_failed",
        });
        throw error;
      }
      if (
        error instanceof StaleMobileSessionResponseError ||
        !(await isCurrent())
      )
        throw new StaleMobileSessionResponseError();
      const reason =
        error instanceof Error &&
        /invalid.*anchor|anchor.*invalid/i.test(error.message)
          ? "invalid_anchor"
          : error instanceof Error &&
              /capacity|storage is full/i.test(error.message)
            ? "storage_full"
            : "query_failed";
      await recordHealthQueryFailure({
        owner,
        contract: checkpoint.contract,
        runId,
        startedAt,
        reason,
      });
      throw error;
    }
  }
  return {
    provider: "healthkit",
    kind,
    status: importedCount
      ? "queued"
      : capturedCount
        ? "captured"
        : queried
          ? "query_completed"
          : "query_failed",
    notes: importedCount
      ? `${importedCount} Health ${importedCount === 1 ? "event is" : "events are"} saved for delivery.${partial ? " More source pages remain." : ""}`
      : capturedCount
        ? "Health samples were captured locally. Source corrections may still need review."
        : "The Health query completed without new usable samples. This does not establish read permission or server visibility.",
    importedCount,
    capturedCount,
    deletionCount,
    partial,
    lastSync: new Date().toISOString(),
  };
}

export async function repairRecentHealthCapture(
  options: { days?: 7 | 14; signal?: AbortSignal } = {},
) {
  const owner = await currentHealthCaptureOwner();
  if (!owner) throw new Error("Sign in before repairing Health capture.");
  const days = options.days ?? 7;
  const repairWindow = await beginOrResumeHealthRepair(owner, days);
  const results = await Promise.allSettled([
    importHealthKitSleep({ signal: options.signal, repairWindow }),
    importHealthKitWorkouts({ signal: options.signal, repairWindow }),
  ]);
  return { days, window: repairWindow, results };
}

export async function getHealthImportPreferences(): Promise<HealthImportPreferences> {
  const raw = await AsyncStorage.getItem(HEALTHKIT_IMPORT_PREFERENCES_KEY);
  if (raw) {
    try {
      return healthImportPreferencesFromPartial(
        JSON.parse(raw) as Partial<Record<HealthImportPreferenceKey, unknown>>,
      );
    } catch {
      return { ...DEFAULT_HEALTH_IMPORT_PREFERENCES };
    }
  }

  const legacyWorkoutRaw = await AsyncStorage.getItem(
    HEALTHKIT_WORKOUT_PREFERENCES_KEY,
  );
  if (!legacyWorkoutRaw) return { ...DEFAULT_HEALTH_IMPORT_PREFERENCES };
  try {
    const legacyWorkouts = JSON.parse(legacyWorkoutRaw) as Partial<
      Record<HealthWorkoutType, unknown>
    >;
    return healthImportPreferencesFromPartial(legacyWorkouts);
  } catch {
    return { ...DEFAULT_HEALTH_IMPORT_PREFERENCES };
  }
}

export async function setHealthImportPreference(
  type: HealthImportPreferenceKey,
  enabled: boolean,
) {
  const current = await getHealthImportPreferences();
  const next = { ...current, [type]: enabled };
  await AsyncStorage.setItem(
    HEALTHKIT_IMPORT_PREFERENCES_KEY,
    JSON.stringify(next),
  );
  return next;
}

export async function getHealthAutoLogMappings(): Promise<HealthAutoLogMappings> {
  const raw = await AsyncStorage.getItem(HEALTHKIT_AUTO_LOG_MAPPINGS_KEY);
  if (!raw) return {};
  try {
    return normalizeHealthAutoLogMappings(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function setHealthAutoLogMapping(
  type: HealthImportPreferenceKey,
  mapping: HealthAutoLogMapping,
) {
  const current = await getHealthAutoLogMappings();
  const normalized =
    normalizeHealthAutoLogMappings({ [type]: mapping })[type] ?? {};
  const next = { ...current };
  if (normalized.categoryId || normalized.description) {
    next[type] = normalized;
  } else {
    delete next[type];
  }
  await AsyncStorage.setItem(
    HEALTHKIT_AUTO_LOG_MAPPINGS_KEY,
    JSON.stringify(next),
  );
  return next;
}

export async function getHealthWorkoutImportPreferences(): Promise<HealthWorkoutImportPreferences> {
  return healthWorkoutPreferencesFromPartial(
    await getHealthImportPreferences(),
  );
}

export async function setHealthWorkoutImportPreference(
  type: HealthWorkoutType,
  enabled: boolean,
) {
  await setHealthImportPreference(type, enabled);
  return getHealthWorkoutImportPreferences();
}

export async function reprocessExistingHealthReviewItems(
  preferences?: HealthImportPreferences,
  options: {
    force?: boolean;
    mappings?: HealthAutoLogMappings;
    signal?: AbortSignal;
    deadlineAt?: number;
  } = {},
) {
  const now = Date.now();
  if (healthReprocessInFlight) return healthReprocessInFlight;
  if (!options.force && now < healthReprocessBackoffUntil)
    return skippedHealthReprocessResult("Backoff active.");
  if (
    !options.force &&
    now - lastHealthReprocessAt < HEALTH_REPROCESS_THROTTLE_MS
  ) {
    return skippedHealthReprocessResult("Recently checked.");
  }

  healthReprocessInFlight = (async () => {
    try {
      const result = await reprocessHealthReviewItemBatches(
        preferences ?? (await getHealthImportPreferences()),
        options.mappings ?? (await getHealthAutoLogMappings()),
        options.force === true,
        options,
      );
      lastHealthReprocessAt = result.hasMore ? 0 : Date.now();
      healthReprocessBackoffUntil = 0;
      return result;
    } catch (error) {
      lastHealthReprocessAt = Date.now();
      healthReprocessBackoffUntil = Date.now() + HEALTH_REPROCESS_BACKOFF_MS;
      return failedHealthReprocessResult(error);
    } finally {
      healthReprocessInFlight = null;
    }
  })();
  return healthReprocessInFlight;
}

async function reprocessHealthReviewItemBatches(
  preferences: HealthImportPreferences,
  mappings: HealthAutoLogMappings,
  force: boolean,
  options: { signal?: AbortSignal; deadlineAt?: number } = {},
) {
  const startedAt = Date.now();
  let combined: HealthReviewReprocessResult | null = null;
  let cursor: string | null = null;
  const deadlineAt = Math.min(
    options.deadlineAt ?? Infinity,
    startedAt + HEALTH_REPROCESS_MAX_DURATION_MS,
  );

  for (let batch = 0; batch < HEALTH_REPROCESS_MAX_BATCHES; batch += 1) {
    const result = await reprocessHealthReviewItems(preferences, {
      limit: HEALTH_REPROCESS_BATCH_SIZE,
      force,
      mappings,
      cursor,
      signal: options.signal,
      deadlineAt,
    });
    cursor = result.nextCursor ?? null;
    combined = mergeHealthReprocessResults(combined, result);
    if (!result.hasMore && !result.partial) break;
    if ("nextCursor" in result && !result.nextCursor) break;
    if (options.signal?.aborted || Date.now() >= deadlineAt) {
      combined.partial = true;
      combined.hasMore = true;
      break;
    }
    if (
      result.checkedCount === 0 &&
      result.confirmedCount === 0 &&
      result.ignoredCount === 0
    )
      break;
  }

  return (
    combined ?? skippedHealthReprocessResult("No Health review work returned.")
  );
}

export async function exportHealthDebugSnapshot(
  options: HealthDebugExportOptions = {},
): Promise<HealthDebugExport> {
  ensureIos();
  const healthkit = await loadHealthKit();
  const exportedAt = new Date();
  const days = sanitizeDebugLookbackDays(options.lookbackDays);
  const limit = sanitizeDebugLimit(options.limit);
  const startedAt = new Date(exportedAt.getTime() - days * 24 * 60 * 60 * 1000);

  const [
    preferences,
    mappings,
    sleepAnchor,
    workoutAnchor,
    sleepSeen,
    workoutSeen,
    sleepResult,
    workoutResult,
  ] = await Promise.all([
    getHealthImportPreferences(),
    getHealthAutoLogMappings(),
    AsyncStorage.getItem(HEALTHKIT_ANCHOR_KEY),
    AsyncStorage.getItem(HEALTHKIT_WORKOUT_ANCHOR_KEY),
    readSeenSampleIds(),
    readSeenSampleIds(HEALTHKIT_WORKOUT_SEEN_KEY),
    healthkit.queryCategorySamplesWithAnchor(HEALTHKIT_SLEEP_TYPE, {
      filter: { date: { startDate: startedAt, endDate: exportedAt } },
      limit,
    }),
    healthkit.queryWorkoutSamplesWithAnchor({
      filter: { date: { startDate: startedAt, endDate: exportedAt } },
      limit,
    }),
  ]);

  const sleepSamples = (sleepResult.samples as readonly HealthKitSleepSample[])
    .map(mapHealthKitSleepSample)
    .filter(
      (sample) => validDate(sample.startedAt) && validDate(sample.stoppedAt),
    );
  const sessions = groupSleepSamplesIntoSessions(sleepSamples);
  const workoutSamples = (
    workoutResult.workouts as readonly HealthKitWorkoutSample[]
  )
    .map((sample) => mapHealthKitWorkoutSample(sample.toJSON?.() ?? sample))
    .filter(
      (sample) => validDate(sample.startedAt) && validDate(sample.stoppedAt),
    );
  const sleepEvents = preferences.sleep
    ? sessions.map((session) =>
        healthKitSleepSessionEvent(
          session,
          healthAutoLogMappingFor("sleep", mappings),
        ),
      )
    : [];
  const workoutEvents = workoutSamples
    .filter((sample) => preferences[sample.workoutType])
    .map((sample) =>
      healthKitWorkoutEvent(
        sample,
        healthAutoLogMappingFor(sample.workoutType, mappings),
      ),
    );

  return {
    exportedAt: exportedAt.toISOString(),
    apiBase: DAYFRAME_API_BASE,
    lookback: {
      startedAt: startedAt.toISOString(),
      stoppedAt: exportedAt.toISOString(),
      days,
      limit,
    },
    storedState: {
      sleepAnchorPresent: Boolean(sleepAnchor),
      workoutAnchorPresent: Boolean(workoutAnchor),
      sleepSeenCount: sleepSeen.length,
      workoutSeenCount: workoutSeen.length,
      preferences,
      mappings,
    },
    healthKit: {
      sleep: {
        sampleCount: sleepSamples.length,
        deletedSampleCount: sleepResult.deletedSamples.length,
        stageCounts: countBy(sleepSamples, (sample) => sample.stage),
        sessions: sessions.map((session) => {
          const durationSeconds = sessionDurationSeconds(session);
          return {
            externalSessionId: session.externalSessionId,
            startedAt: session.startedAt,
            stoppedAt: session.stoppedAt,
            durationSeconds,
            sampleCount: session.samples.length,
            stages: [...new Set(session.samples.map((sample) => sample.stage))],
            autoConfirm:
              preferences.sleep &&
              shouldAutoConfirmHealthSleep({
                durationSeconds,
                startedAt: session.startedAt,
                stoppedAt: session.stoppedAt,
              }),
          };
        }),
        samples: sleepSamples,
      },
      workouts: {
        sampleCount: workoutSamples.length,
        deletedSampleCount: workoutResult.deletedSamples.length,
        typeCounts: countBy(workoutSamples, (sample) => sample.workoutType),
        samples: workoutSamples,
      },
    },
    generatedEvents: {
      sleep: sleepEvents,
      workouts: workoutEvents,
    },
  };
}

export function mapHealthKitSleepSample(
  sample: HealthKitSleepSample,
): DayframeSleepSample {
  const startedAt = new Date(sample.startDate).toISOString();
  const stoppedAt = new Date(sample.endDate).toISOString();
  const externalSampleId =
    sample.uuid ?? `${startedAt}:${stoppedAt}:${String(sample.value ?? "")}`;

  return {
    externalSampleId,
    stage: mapHealthKitSleepStage(sample.value),
    startedAt,
    stoppedAt,
    sourceName:
      sample.sourceRevision?.source?.name ??
      sample.sourceRevision?.source?.bundleIdentifier ??
      undefined,
    rawPayload: {
      uuid: sample.uuid,
      value: sample.value,
      metadata: safeHealthMetadata(sample.metadata),
      sourceRevision: sample.sourceRevision,
    },
  };
}

export function mapHealthKitWorkoutSample(
  sample: HealthKitWorkoutSample,
): DayframeWorkoutSample {
  const startedAt = new Date(sample.startDate).toISOString();
  const stoppedAt = new Date(sample.endDate).toISOString();
  const workoutType = normalizeHealthWorkoutType(sample.workoutActivityType);
  const durationSeconds = wholeSecondsOrNull(
    quantityValue(sample.duration) ??
      Math.max(
        0,
        Math.round(
          (new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) /
            1000,
        ),
      ),
  );
  const externalSampleId =
    sample.uuid ?? `${startedAt}:${stoppedAt}:${workoutType}`;

  return {
    externalSampleId,
    workoutType,
    workoutLabel: healthWorkoutLabel(workoutType),
    startedAt,
    stoppedAt,
    durationSeconds,
    distanceMeters: quantityValue(sample.totalDistance),
    energyKcal: quantityValue(sample.totalEnergyBurned),
    sourceName:
      sample.sourceRevision?.source?.name ??
      sample.sourceRevision?.source?.bundleIdentifier ??
      undefined,
    rawPayload: {
      uuid: sample.uuid,
      workoutActivityType: sample.workoutActivityType,
      metadata: safeHealthMetadata(sample.metadata),
      sourceRevision: sample.sourceRevision,
    },
  };
}

export function healthKitWorkoutEvent(
  sample: DayframeWorkoutSample,
  mapping: HealthAutoLogMapping = {},
) {
  return {
    localId: `healthkit-workout:${sample.externalSampleId}`,
    source: "health_workout" as const,
    type: "health_workout_import" as const,
    occurredAt: new Date(sample.startedAt),
    categoryId: mapping.categoryId ?? undefined,
    description: mapping.description ?? sample.workoutLabel,
    rawPayload: {
      provider: "healthkit",
      externalSampleId: sample.externalSampleId,
      workoutType: sample.workoutType,
      workoutLabel: sample.workoutLabel,
      startedAt: sample.startedAt,
      stoppedAt: sample.stoppedAt,
      durationSeconds: sample.durationSeconds,
      distanceMeters: sample.distanceMeters,
      energyKcal: sample.energyKcal,
      autoConfirm: shouldAutoConfirmHealthWorkout({
        durationSeconds: sample.durationSeconds,
        workoutType: sample.workoutType,
      }),
      sourceName: sample.sourceName,
      sample: sample.rawPayload,
    },
  };
}

export function groupSleepSamplesIntoSessions(
  samples: DayframeSleepSample[],
): DayframeSleepSession[] {
  const asleepSamples = samples
    .filter((sample) => isAsleepStage(sample.stage))
    .filter(
      (sample) => validDate(sample.startedAt) && validDate(sample.stoppedAt),
    );

  const sessions: DayframeSleepSample[][] = [];
  const samplesBySource = new Map<string, DayframeSleepSample[]>();
  for (const sample of asleepSamples) {
    const sourceKey = sleepSampleSourceKey(sample);
    const sourceSamples = samplesBySource.get(sourceKey) ?? [];
    sourceSamples.push(sample);
    samplesBySource.set(sourceKey, sourceSamples);
  }
  for (const sourceSamples of samplesBySource.values()) {
    sourceSamples.sort(
      (left, right) =>
        new Date(left.startedAt).getTime() -
        new Date(right.startedAt).getTime(),
    );
    const sourceSessions: DayframeSleepSample[][] = [];
    for (const sample of sourceSamples) {
      const current = sourceSessions.at(-1);
      if (!current) {
        sourceSessions.push([sample]);
        continue;
      }

      const currentStop = Math.max(
        ...current.map((item) => new Date(item.stoppedAt).getTime()),
      );
      const nextStart = new Date(sample.startedAt).getTime();
      if (nextStart - currentStop <= HEALTH_SLEEP_SESSION_GAP_MS) {
        current.push(sample);
      } else {
        sourceSessions.push([sample]);
      }
    }
    sessions.push(...sourceSessions);
  }

  return sessions
    .map((sessionSamples) => {
      const startedAt = new Date(
        Math.min(
          ...sessionSamples.map((sample) =>
            new Date(sample.startedAt).getTime(),
          ),
        ),
      ).toISOString();
      const stoppedAt = new Date(
        Math.max(
          ...sessionSamples.map((sample) =>
            new Date(sample.stoppedAt).getTime(),
          ),
        ),
      ).toISOString();
      const sourceName = sessionSamples.find(
        (sample) => sample.sourceName,
      )?.sourceName;
      const stableSource = sessionSamples
        .map((sample) => sample.externalSampleId)
        .sort()
        .join("|");
      return {
        externalSessionId: `sleep-session-${stableHash(`${startedAt}|${stoppedAt}|${stableSource}`)}`,
        startedAt,
        stoppedAt,
        sourceName,
        samples: sessionSamples,
      };
    })
    .sort(
      (left, right) =>
        new Date(left.startedAt).getTime() -
        new Date(right.startedAt).getTime(),
    );
}

export function healthKitSleepSessionEvent(
  session: DayframeSleepSession,
  mapping: HealthAutoLogMapping = {},
) {
  const durationSeconds = sessionDurationSeconds(session);
  return {
    localId: `healthkit-sleep:${session.externalSessionId}`,
    source: "health_sleep" as const,
    type: "health_sleep_import" as const,
    occurredAt: new Date(session.startedAt),
    categoryId: mapping.categoryId ?? undefined,
    description: mapping.description ?? "Sleep",
    rawPayload: {
      provider: "healthkit",
      externalSampleId: session.externalSessionId,
      sleepStage: "asleep_unspecified",
      startedAt: session.startedAt,
      stoppedAt: session.stoppedAt,
      durationSeconds,
      autoConfirm: shouldAutoConfirmHealthSleep({
        durationSeconds,
        startedAt: session.startedAt,
        stoppedAt: session.stoppedAt,
      }),
      sourceName: session.sourceName,
      samples: session.samples.map((sample) => ({
        externalSampleId: sample.externalSampleId,
        sleepStage: sample.stage,
        startedAt: sample.startedAt,
        stoppedAt: sample.stoppedAt,
        sourceName: sample.sourceName,
        sample: sample.rawPayload,
      })),
    },
  };
}

let healthKitModulePromise: Promise<HealthKitModule> | undefined;
function loadHealthKit(): Promise<HealthKitModule> {
  healthKitModulePromise ??= import("@kingstinct/react-native-healthkit").catch(
    (error) => {
      healthKitModulePromise = undefined;
      throw error;
    },
  );
  return healthKitModulePromise;
}

function ensureIos() {
  if (Platform.OS !== "ios") {
    throw new Error("Apple Health requires a native iOS build.");
  }
}

export function friendlyHealthKitError(
  error: unknown,
  action = "use Apple Health",
) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  if (
    lower.includes("authorization not determined") ||
    lower.includes("code=5") ||
    lower.includes("not determined")
  ) {
    return "Apple Health permission is not ready yet. Connect from Settings, confirm the iOS prompt, then sync again.";
  }

  if (lower.includes("not available") || lower.includes("native ios build")) {
    return "Apple Health needs a native iOS build on a real device.";
  }

  if (lower.includes("denied") || lower.includes("not granted")) {
    return "Apple Health access was not granted. Open iOS Settings and allow Dayframe to read the selected health data.";
  }

  return `Unable to ${action}.`;
}

async function readSeenSampleIds(key = HEALTHKIT_SEEN_KEY): Promise<string[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function quantityValue(
  value:
    | HealthKitWorkoutSample["duration"]
    | HealthKitWorkoutSample["totalDistance"],
) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    value &&
    typeof value === "object" &&
    typeof value.quantity === "number" &&
    Number.isFinite(value.quantity)
  ) {
    return value.quantity;
  }
  return null;
}

function wholeSecondsOrNull(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function healthWorkoutPreferencesFromPartial(
  value: Partial<Record<HealthWorkoutType, unknown>>,
): HealthWorkoutImportPreferences {
  return Object.fromEntries(
    HEALTH_WORKOUT_TYPE_OPTIONS.map((option) => [
      option.key,
      typeof value[option.key] === "boolean"
        ? Boolean(value[option.key])
        : DEFAULT_HEALTH_WORKOUT_IMPORT_PREFERENCES[option.key],
    ]),
  ) as HealthWorkoutImportPreferences;
}

function healthImportPreferencesFromPartial(
  value: Partial<Record<HealthImportPreferenceKey, unknown>>,
): HealthImportPreferences {
  return Object.fromEntries(
    HEALTH_IMPORT_PREFERENCE_OPTIONS.map((option) => [
      option.key,
      typeof value[option.key] === "boolean"
        ? Boolean(value[option.key])
        : DEFAULT_HEALTH_IMPORT_PREFERENCES[option.key],
    ]),
  ) as HealthImportPreferences;
}

function sleepImportNotes(importedCount: number, ignoredCount: number) {
  if (importedCount > 0 && ignoredCount > 0) {
    return `Queued ${importedCount} Apple Health sleep ${importedCount === 1 ? "session" : "sessions"} as activity events. Ignored ${ignoredCount} disabled sleep ${ignoredCount === 1 ? "session" : "sessions"}.`;
  }
  if (importedCount > 0) {
    return `Queued ${importedCount} Apple Health sleep ${importedCount === 1 ? "session" : "sessions"} as activity events.`;
  }
  if (ignoredCount > 0) {
    return `Ignored ${ignoredCount} disabled Apple Health sleep ${ignoredCount === 1 ? "session" : "sessions"}.`;
  }
  return "No new Apple Health sleep samples found.";
}

function workoutImportNotes(importedCount: number, ignoredCount: number) {
  if (importedCount > 0 && ignoredCount > 0) {
    return `Queued ${importedCount} Apple Health ${importedCount === 1 ? "workout" : "workouts"} as activity events. Ignored ${ignoredCount} disabled ${ignoredCount === 1 ? "workout" : "workouts"}.`;
  }
  if (importedCount > 0) {
    return `Queued ${importedCount} Apple Health ${importedCount === 1 ? "workout" : "workouts"} as activity events.`;
  }
  if (ignoredCount > 0) {
    return `Ignored ${ignoredCount} disabled Apple Health ${ignoredCount === 1 ? "workout" : "workouts"}.`;
  }
  return "No new Apple Health workouts found.";
}

function skippedHealthReprocessResult(
  reason: string,
): HealthReviewReprocessResult {
  return {
    ok: true,
    checkedCount: 0,
    confirmedCount: 0,
    ignoredCount: 0,
    leftInReviewCount: 0,
    skippedCount: 0,
    failedCount: 0,
    updatedCategoryCount: 0,
    repairedSleepEntryCount: 0,
    remainingReviewCount: 0,
    errorSummary: reason ? [reason] : [],
  };
}

function failedHealthReprocessResult(
  error: unknown,
): HealthReviewReprocessResult {
  const message =
    error instanceof Error
      ? error.message
      : "Unable to reprocess Health review items.";
  return {
    ok: false,
    checkedCount: 0,
    confirmedCount: 0,
    ignoredCount: 0,
    leftInReviewCount: 0,
    skippedCount: 0,
    failedCount: 1,
    updatedCategoryCount: 0,
    repairedSleepEntryCount: 0,
    remainingReviewCount: 0,
    errorSummary: [message],
  };
}

function mergeHealthReprocessResults(
  current: HealthReviewReprocessResult | null,
  next: HealthReviewReprocessResult,
): HealthReviewReprocessResult {
  if (!current) {
    return {
      ...next,
      errorSummary: [...next.errorSummary],
      reasons: next.reasons ? [...next.reasons] : undefined,
    };
  }

  return {
    ok: current.ok && next.ok,
    checkedCount: current.checkedCount + next.checkedCount,
    confirmedCount: current.confirmedCount + next.confirmedCount,
    ignoredCount: current.ignoredCount + next.ignoredCount,
    leftInReviewCount: next.leftInReviewCount,
    skippedCount: current.skippedCount + next.skippedCount,
    failedCount: current.failedCount + next.failedCount,
    updatedCategoryCount:
      current.updatedCategoryCount + next.updatedCategoryCount,
    repairedSleepEntryCount:
      current.repairedSleepEntryCount + next.repairedSleepEntryCount,
    remainingReviewCount: next.remainingReviewCount,
    batchSize: next.batchSize ?? current.batchSize,
    partial: Boolean(next.partial),
    hasMore: Boolean(next.hasMore),
    errorSummary: [...current.errorSummary, ...next.errorSummary],
    reasons: [...(current.reasons ?? []), ...(next.reasons ?? [])],
  };
}

function isAsleepStage(stage: SleepStage) {
  return (
    stage === "asleep_unspecified" ||
    stage === "asleep_core" ||
    stage === "asleep_deep" ||
    stage === "asleep_rem"
  );
}

function sleepSampleSourceKey(sample: DayframeSleepSample) {
  return sample.sourceName?.trim().toLocaleLowerCase() || "unknown";
}

function validDate(value: string) {
  return !Number.isNaN(new Date(value).getTime());
}

function sessionDurationSeconds(
  session: Pick<DayframeSleepSession, "startedAt" | "stoppedAt">,
) {
  const started = new Date(session.startedAt).getTime();
  const stopped = new Date(session.stoppedAt).getTime();
  if (
    !Number.isFinite(started) ||
    !Number.isFinite(stopped) ||
    stopped <= started
  )
    return null;
  return Math.round((stopped - started) / 1000);
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function safeHealthMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return undefined;
  return Object.fromEntries(
    Object.entries(metadata).filter(([key, value]) => {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.includes("route") ||
        normalizedKey.includes("location") ||
        normalizedKey.includes("latitude") ||
        normalizedKey.includes("longitude")
      ) {
        return false;
      }
      return ["boolean", "number", "string"].includes(typeof value);
    }),
  );
}

function sanitizeDebugLookbackDays(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return HEALTH_DEBUG_LOOKBACK_DAYS;
  return Math.min(60, Math.max(1, Math.round(value)));
}

function sanitizeDebugLimit(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return HEALTH_DEBUG_SAMPLE_LIMIT;
  return Math.min(500, Math.max(1, Math.round(value)));
}

function countBy<T>(items: readonly T[], keyForItem: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyForItem(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}
