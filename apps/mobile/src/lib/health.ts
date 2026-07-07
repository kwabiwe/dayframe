import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_HEALTH_IMPORT_PREFERENCES,
  DEFAULT_HEALTH_WORKOUT_IMPORT_PREFERENCES,
  HEALTH_IMPORT_PREFERENCE_OPTIONS as SHARED_HEALTH_IMPORT_PREFERENCE_OPTIONS,
  HEALTH_WORKOUT_TYPE_OPTIONS,
  healthWorkoutLabel,
  mapHealthKitSleepStage,
  normalizeHealthWorkoutType,
  shouldAutoConfirmHealthSleep,
  shouldAutoConfirmHealthWorkout,
  type HealthImportPreferenceKey,
  type HealthImportPreferences,
  type HealthWorkoutImportPreferences,
  type HealthWorkoutType,
  type SleepStage
} from "@dayframe/shared";
import { enqueueEvent } from "./api";

const HEALTHKIT_SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis";
const HEALTHKIT_WORKOUT_TYPE = "HKWorkoutTypeIdentifier";
const HEALTHKIT_READ_TYPES = [HEALTHKIT_SLEEP_TYPE, HEALTHKIT_WORKOUT_TYPE] as const;
const HEALTHKIT_ANCHOR_KEY = "dayframe.healthkit.sleepAnchor.v1";
const HEALTHKIT_SEEN_KEY = "dayframe.healthkit.sleepSeen.v1";
const HEALTHKIT_WORKOUT_ANCHOR_KEY = "dayframe.healthkit.workoutAnchor.v1";
const HEALTHKIT_WORKOUT_SEEN_KEY = "dayframe.healthkit.workoutSeen.v1";
const HEALTHKIT_IMPORT_PREFERENCES_KEY = "dayframe.healthkit.importPreferences.v1";
const HEALTHKIT_WORKOUT_PREFERENCES_KEY = "dayframe.healthkit.workoutPreferences.v1";
const SLEEP_SESSION_GAP_MS = 90 * 60 * 1000;

export const HEALTH_IMPORT_PREFERENCE_OPTIONS = SHARED_HEALTH_IMPORT_PREFERENCE_OPTIONS;
export const HEALTH_WORKOUT_PREFERENCE_OPTIONS = HEALTH_WORKOUT_TYPE_OPTIONS;

export type HealthImportStatus = {
  provider: "healthkit";
  kind?: "availability" | "permissions" | "sleep" | "workout";
  status: "available" | "unavailable" | "needs_permission" | "synced" | "error" | "planned";
  notes: string;
  importedCount?: number;
  lastSync?: string;
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

export async function getHealthImportStatus(): Promise<HealthImportStatus[]> {
  if (Platform.OS !== "ios") {
    return [
      {
        provider: "healthkit",
        kind: "availability",
        status: "unavailable",
        notes: "Apple Health is only available on native iOS builds."
      }
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
          : "Health data is not available on this device."
      },
    ];
  } catch (error) {
    return [
      {
        provider: "healthkit",
        kind: "availability",
        status: "error",
        notes: friendlyHealthKitError(error, "check Apple Health availability")
      }
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
      notes: "Health data is not available on this device."
    };
  }

  const granted = await healthkit.requestAuthorization({ toRead: HEALTHKIT_READ_TYPES });
  return {
    provider: "healthkit" as const,
    kind: "permissions" as const,
    status: granted ? ("available" as const) : ("needs_permission" as const),
    notes: granted
      ? "Apple Health read access was requested for sleep and workouts."
      : "Apple Health access was not granted."
  };
}

export async function importHealthKitSleep() {
  ensureIos();
  const healthkit = await loadHealthKit();
  const anchor = await AsyncStorage.getItem(HEALTHKIT_ANCHOR_KEY);
  const seen = new Set(await readSeenSampleIds());
  const preferences = await getHealthImportPreferences();
  const result = await healthkit.queryCategorySamplesWithAnchor(HEALTHKIT_SLEEP_TYPE, {
    anchor: anchor ?? undefined,
    limit: 0
  });

  const importedSamples: DayframeSleepSample[] = [];
  for (const sample of result.samples as readonly HealthKitSleepSample[]) {
    const mapped = mapHealthKitSleepSample(sample);
    if (seen.has(mapped.externalSampleId)) continue;
    seen.add(mapped.externalSampleId);
    importedSamples.push(mapped);
  }

  const sessions = groupSleepSamplesIntoSessions(importedSamples);
  let ignoredCount = 0;
  for (const session of sessions) {
    if (!preferences.sleep) {
      ignoredCount += 1;
      continue;
    }
    await enqueueEvent(healthKitSleepSessionEvent(session));
  }

  await AsyncStorage.setItem(HEALTHKIT_ANCHOR_KEY, result.newAnchor);
  await AsyncStorage.setItem(HEALTHKIT_SEEN_KEY, JSON.stringify([...seen].slice(-1000)));

  return {
    provider: "healthkit" as const,
    kind: "sleep" as const,
    status: "synced" as const,
    notes: sleepImportNotes(sessions.length - ignoredCount, ignoredCount),
    importedCount: sessions.length - ignoredCount,
    lastSync: new Date().toISOString()
  };
}

export async function importHealthKitWorkouts() {
  ensureIos();
  const healthkit = await loadHealthKit();
  const anchor = await AsyncStorage.getItem(HEALTHKIT_WORKOUT_ANCHOR_KEY);
  const seen = new Set(await readSeenSampleIds(HEALTHKIT_WORKOUT_SEEN_KEY));
  const preferences = await getHealthImportPreferences();
  const result = await healthkit.queryWorkoutSamplesWithAnchor({
    anchor: anchor ?? undefined,
    limit: 0
  });

  const imported: DayframeWorkoutSample[] = [];
  let ignoredCount = 0;
  for (const sample of result.workouts as readonly HealthKitWorkoutSample[]) {
    const mapped = mapHealthKitWorkoutSample(sample.toJSON?.() ?? sample);
    if (seen.has(mapped.externalSampleId)) continue;
    seen.add(mapped.externalSampleId);
    if (!preferences[mapped.workoutType]) {
      ignoredCount += 1;
      continue;
    }
    imported.push(mapped);
    await enqueueEvent(healthKitWorkoutEvent(mapped));
  }

  await AsyncStorage.setItem(HEALTHKIT_WORKOUT_ANCHOR_KEY, result.newAnchor);
  await AsyncStorage.setItem(HEALTHKIT_WORKOUT_SEEN_KEY, JSON.stringify([...seen].slice(-1000)));

  return {
    provider: "healthkit" as const,
    kind: "workout" as const,
    status: "synced" as const,
    notes: workoutImportNotes(imported.length, ignoredCount),
    importedCount: imported.length,
    lastSync: new Date().toISOString()
  };
}

export async function getHealthImportPreferences(): Promise<HealthImportPreferences> {
  const raw = await AsyncStorage.getItem(HEALTHKIT_IMPORT_PREFERENCES_KEY);
  if (raw) {
    try {
      return healthImportPreferencesFromPartial(JSON.parse(raw) as Partial<Record<HealthImportPreferenceKey, unknown>>);
    } catch {
      return { ...DEFAULT_HEALTH_IMPORT_PREFERENCES };
    }
  }

  const legacyWorkoutRaw = await AsyncStorage.getItem(HEALTHKIT_WORKOUT_PREFERENCES_KEY);
  if (!legacyWorkoutRaw) return { ...DEFAULT_HEALTH_IMPORT_PREFERENCES };
  try {
    const legacyWorkouts = JSON.parse(legacyWorkoutRaw) as Partial<Record<HealthWorkoutType, unknown>>;
    return healthImportPreferencesFromPartial(legacyWorkouts);
  } catch {
    return { ...DEFAULT_HEALTH_IMPORT_PREFERENCES };
  }
}

export async function setHealthImportPreference(type: HealthImportPreferenceKey, enabled: boolean) {
  const current = await getHealthImportPreferences();
  const next = { ...current, [type]: enabled };
  await AsyncStorage.setItem(HEALTHKIT_IMPORT_PREFERENCES_KEY, JSON.stringify(next));
  return next;
}

export async function getHealthWorkoutImportPreferences(): Promise<HealthWorkoutImportPreferences> {
  return healthWorkoutPreferencesFromPartial(await getHealthImportPreferences());
}

export async function setHealthWorkoutImportPreference(type: HealthWorkoutType, enabled: boolean) {
  await setHealthImportPreference(type, enabled);
  return getHealthWorkoutImportPreferences();
}

export function mapHealthKitSleepSample(sample: HealthKitSleepSample): DayframeSleepSample {
  const startedAt = new Date(sample.startDate).toISOString();
  const stoppedAt = new Date(sample.endDate).toISOString();
  const externalSampleId = sample.uuid ?? `${startedAt}:${stoppedAt}:${String(sample.value ?? "")}`;

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
      metadata: sample.metadata,
      sourceRevision: sample.sourceRevision
    }
  };
}

export function mapHealthKitWorkoutSample(sample: HealthKitWorkoutSample): DayframeWorkoutSample {
  const startedAt = new Date(sample.startDate).toISOString();
  const stoppedAt = new Date(sample.endDate).toISOString();
  const workoutType = normalizeHealthWorkoutType(sample.workoutActivityType);
  const durationSeconds = wholeSecondsOrNull(
    quantityValue(sample.duration) ??
      Math.max(0, Math.round((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1000))
  );
  const externalSampleId = sample.uuid ?? `${startedAt}:${stoppedAt}:${workoutType}`;

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
      sourceRevision: sample.sourceRevision
    }
  };
}

export function healthKitWorkoutEvent(sample: DayframeWorkoutSample) {
  return {
    localId: `healthkit-workout:${sample.externalSampleId}`,
    source: "health_workout" as const,
    type: "health_workout_import" as const,
    occurredAt: new Date(sample.startedAt),
    description: sample.workoutLabel,
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
        workoutType: sample.workoutType
      }),
      sourceName: sample.sourceName,
      sample: sample.rawPayload
    }
  };
}

export function groupSleepSamplesIntoSessions(samples: DayframeSleepSample[]): DayframeSleepSession[] {
  const asleepSamples = samples
    .filter((sample) => isAsleepStage(sample.stage))
    .filter((sample) => validDate(sample.startedAt) && validDate(sample.stoppedAt))
    .sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime());

  const sessions: DayframeSleepSample[][] = [];
  for (const sample of asleepSamples) {
    const current = sessions.at(-1);
    if (!current) {
      sessions.push([sample]);
      continue;
    }

    const currentStop = Math.max(...current.map((item) => new Date(item.stoppedAt).getTime()));
    const nextStart = new Date(sample.startedAt).getTime();
    if (nextStart - currentStop <= SLEEP_SESSION_GAP_MS) {
      current.push(sample);
    } else {
      sessions.push([sample]);
    }
  }

  return sessions.map((sessionSamples) => {
    const startedAt = new Date(Math.min(...sessionSamples.map((sample) => new Date(sample.startedAt).getTime()))).toISOString();
    const stoppedAt = new Date(Math.max(...sessionSamples.map((sample) => new Date(sample.stoppedAt).getTime()))).toISOString();
    const sourceName = sessionSamples.find((sample) => sample.sourceName)?.sourceName;
    const stableSource = sessionSamples.map((sample) => sample.externalSampleId).sort().join("|");
    return {
      externalSessionId: `sleep-session-${stableHash(`${startedAt}|${stoppedAt}|${stableSource}`)}`,
      startedAt,
      stoppedAt,
      sourceName,
      samples: sessionSamples
    };
  });
}

export function healthKitSleepSessionEvent(session: DayframeSleepSession) {
  const durationSeconds = sessionDurationSeconds(session);
  return {
    localId: `healthkit-sleep:${session.externalSessionId}`,
    source: "health_sleep" as const,
    type: "health_sleep_import" as const,
    occurredAt: new Date(session.startedAt),
    description: "Sleep",
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
        stoppedAt: session.stoppedAt
      }),
      sourceName: session.sourceName,
      samples: session.samples.map((sample) => ({
        externalSampleId: sample.externalSampleId,
        sleepStage: sample.stage,
        startedAt: sample.startedAt,
        stoppedAt: sample.stoppedAt,
        sourceName: sample.sourceName,
        sample: sample.rawPayload
      }))
    }
  };
}

async function loadHealthKit(): Promise<HealthKitModule> {
  return import("@kingstinct/react-native-healthkit");
}

function ensureIos() {
  if (Platform.OS !== "ios") {
    throw new Error("Apple Health requires a native iOS build.");
  }
}

export function friendlyHealthKitError(error: unknown, action = "use Apple Health") {
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

function quantityValue(value: HealthKitWorkoutSample["duration"] | HealthKitWorkoutSample["totalDistance"]) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && typeof value.quantity === "number" && Number.isFinite(value.quantity)) {
    return value.quantity;
  }
  return null;
}

function wholeSecondsOrNull(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function healthWorkoutPreferencesFromPartial(
  value: Partial<Record<HealthWorkoutType, unknown>>
): HealthWorkoutImportPreferences {
  return Object.fromEntries(
    HEALTH_WORKOUT_TYPE_OPTIONS.map((option) => [
      option.key,
      typeof value[option.key] === "boolean"
        ? Boolean(value[option.key])
        : DEFAULT_HEALTH_WORKOUT_IMPORT_PREFERENCES[option.key]
    ])
  ) as HealthWorkoutImportPreferences;
}

function healthImportPreferencesFromPartial(
  value: Partial<Record<HealthImportPreferenceKey, unknown>>
): HealthImportPreferences {
  return Object.fromEntries(
    HEALTH_IMPORT_PREFERENCE_OPTIONS.map((option) => [
      option.key,
      typeof value[option.key] === "boolean"
        ? Boolean(value[option.key])
        : DEFAULT_HEALTH_IMPORT_PREFERENCES[option.key]
    ])
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

function isAsleepStage(stage: SleepStage) {
  return stage === "asleep_unspecified" || stage === "asleep_core" || stage === "asleep_deep" || stage === "asleep_rem";
}

function validDate(value: string) {
  return !Number.isNaN(new Date(value).getTime());
}

function sessionDurationSeconds(session: Pick<DayframeSleepSession, "startedAt" | "stoppedAt">) {
  const started = new Date(session.startedAt).getTime();
  const stopped = new Date(session.stoppedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(stopped) || stopped <= started) return null;
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
    })
  );
}
