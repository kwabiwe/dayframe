import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { mapHealthKitSleepStage, type SleepStage } from "@dayframe/shared";
import { enqueueEvent } from "./api";

const HEALTHKIT_SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis";
const HEALTHKIT_WORKOUT_TYPE = "HKWorkoutTypeIdentifier";
const HEALTHKIT_ANCHOR_KEY = "dayframe.healthkit.sleepAnchor.v1";
const HEALTHKIT_SEEN_KEY = "dayframe.healthkit.sleepSeen.v1";
const HEALTHKIT_WORKOUT_ANCHOR_KEY = "dayframe.healthkit.workoutAnchor.v1";
const HEALTHKIT_WORKOUT_SEEN_KEY = "dayframe.healthkit.workoutSeen.v1";

export type HealthImportStatus = {
  provider: "healthkit";
  kind?: "availability" | "sleep" | "workout";
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
  workoutType: string;
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
        notes: "Apple Health is available from a native iOS build on iPhone."
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
          ? "Apple Health access can be requested from this native build."
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

export async function requestHealthKitSleepPermission() {
  ensureIos();
  const healthkit = await loadHealthKit();
  const available = await Promise.resolve(healthkit.isHealthDataAvailable());
  if (!available) {
    return {
      provider: "healthkit" as const,
      kind: "sleep" as const,
      status: "unavailable" as const,
      notes: "Health data is not available on this device."
    };
  }

  const granted = await healthkit.requestAuthorization({ toRead: [HEALTHKIT_SLEEP_TYPE] });
  return {
    provider: "healthkit" as const,
    kind: "sleep" as const,
    status: granted ? ("available" as const) : ("needs_permission" as const),
    notes: granted
      ? "Apple Health sleep access was requested."
      : "Apple Health sleep access was not granted."
  };
}

export async function requestHealthKitPermission() {
  ensureIos();
  const healthkit = await loadHealthKit();
  const available = await Promise.resolve(healthkit.isHealthDataAvailable());
  if (!available) {
    return {
      provider: "healthkit" as const,
      kind: "availability" as const,
      status: "unavailable" as const,
      notes: "Health data is not available on this device."
    };
  }

  const granted = await healthkit.requestAuthorization({
    toRead: [HEALTHKIT_SLEEP_TYPE, HEALTHKIT_WORKOUT_TYPE]
  });
  return {
    provider: "healthkit" as const,
    kind: "availability" as const,
    status: granted ? ("available" as const) : ("needs_permission" as const),
    notes: granted
      ? "Apple Health access was requested for sleep and workouts."
      : "Apple Health access was not granted."
  };
}

export async function requestHealthKitWorkoutPermission() {
  ensureIos();
  const healthkit = await loadHealthKit();
  const available = await Promise.resolve(healthkit.isHealthDataAvailable());
  if (!available) {
    return {
      provider: "healthkit" as const,
      kind: "workout" as const,
      status: "unavailable" as const,
      notes: "Health data is not available on this device."
    };
  }

  const granted = await healthkit.requestAuthorization({ toRead: [HEALTHKIT_WORKOUT_TYPE] });
  return {
    provider: "healthkit" as const,
    kind: "workout" as const,
    status: granted ? ("available" as const) : ("needs_permission" as const),
    notes: granted
      ? "Apple Health workout access was requested."
      : "Apple Health workout access was not granted."
  };
}

export async function importHealthKitSleep() {
  ensureIos();
  const healthkit = await loadHealthKit();
  const anchor = await AsyncStorage.getItem(HEALTHKIT_ANCHOR_KEY);
  const seen = new Set(await readSeenSampleIds());
  const result = await healthkit.queryCategorySamplesWithAnchor(HEALTHKIT_SLEEP_TYPE, {
    anchor: anchor ?? undefined,
    limit: 0
  });

  const imported: DayframeSleepSample[] = [];
  for (const sample of result.samples as readonly HealthKitSleepSample[]) {
    const mapped = mapHealthKitSleepSample(sample);
    if (seen.has(mapped.externalSampleId)) continue;
    seen.add(mapped.externalSampleId);
    imported.push(mapped);
    await enqueueEvent({
      source: "health_sleep",
      type: "health_sleep_import",
      occurredAt: new Date(mapped.startedAt),
      description: `Sleep ${mapped.stage.replaceAll("_", " ")}`,
      rawPayload: {
        provider: "healthkit",
        externalSampleId: mapped.externalSampleId,
        sleepStage: mapped.stage,
        startedAt: mapped.startedAt,
        stoppedAt: mapped.stoppedAt,
        sourceName: mapped.sourceName,
        sample: mapped.rawPayload
      }
    });
  }

  await AsyncStorage.setItem(HEALTHKIT_ANCHOR_KEY, result.newAnchor);
  await AsyncStorage.setItem(HEALTHKIT_SEEN_KEY, JSON.stringify([...seen].slice(-1000)));

  return {
    provider: "healthkit" as const,
    kind: "sleep" as const,
    status: "synced" as const,
    notes: imported.length
      ? `Queued ${imported.length} sleep samples as activity events.`
      : "No new sleep samples found.",
    importedCount: imported.length,
    lastSync: new Date().toISOString()
  };
}

export async function importHealthKitWorkouts() {
  ensureIos();
  const healthkit = await loadHealthKit();
  const anchor = await AsyncStorage.getItem(HEALTHKIT_WORKOUT_ANCHOR_KEY);
  const seen = new Set(await readSeenSampleIds(HEALTHKIT_WORKOUT_SEEN_KEY));
  const result = await healthkit.queryWorkoutSamplesWithAnchor({
    anchor: anchor ?? undefined,
    limit: 0
  });

  const imported: DayframeWorkoutSample[] = [];
  for (const sample of result.workouts as readonly HealthKitWorkoutSample[]) {
    const mapped = mapHealthKitWorkoutSample(sample.toJSON?.() ?? sample);
    if (seen.has(mapped.externalSampleId)) continue;
    seen.add(mapped.externalSampleId);
    imported.push(mapped);
    await enqueueEvent(healthKitWorkoutEvent(mapped));
  }

  await AsyncStorage.setItem(HEALTHKIT_WORKOUT_ANCHOR_KEY, result.newAnchor);
  await AsyncStorage.setItem(HEALTHKIT_WORKOUT_SEEN_KEY, JSON.stringify([...seen].slice(-1000)));

  return {
    provider: "healthkit" as const,
    kind: "workout" as const,
    status: "synced" as const,
    notes: imported.length
      ? `Queued ${imported.length} workouts as activity events.`
      : "No new workouts found.",
    importedCount: imported.length,
    lastSync: new Date().toISOString()
  };
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
  const workoutType = mapHealthKitWorkoutType(sample.workoutActivityType);
  const durationSeconds =
    quantityValue(sample.duration) ??
    Math.max(0, Math.round((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1000));
  const externalSampleId = sample.uuid ?? `${startedAt}:${stoppedAt}:${workoutType}`;

  return {
    externalSampleId,
    workoutType,
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
    source: "health_workout" as const,
    type: "health_workout_import" as const,
    occurredAt: new Date(sample.startedAt),
    description: `Workout ${sample.workoutType.replaceAll("_", " ")}`,
    rawPayload: {
      provider: "healthkit",
      externalSampleId: sample.externalSampleId,
      workoutType: sample.workoutType,
      startedAt: sample.startedAt,
      stoppedAt: sample.stoppedAt,
      durationSeconds: sample.durationSeconds,
      distanceMeters: sample.distanceMeters,
      energyKcal: sample.energyKcal,
      sourceName: sample.sourceName,
      sample: sample.rawPayload
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
    return "Apple Health access is not ready yet. Connect Apple Health, confirm the iOS prompt, then sync again.";
  }

  if (lower.includes("not available") || lower.includes("native ios build")) {
    return "Apple Health needs a native iOS build on iPhone.";
  }

  if (lower.includes("denied") || lower.includes("not granted")) {
    return "Apple Health access was not granted. Open iOS Settings and allow Dayframe to read sleep and workouts.";
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

function mapHealthKitWorkoutType(value: unknown) {
  if (typeof value === "string" && value.trim()) return camelToSnake(value);
  if (typeof value === "number") {
    return (
      {
        13: "cycling",
        24: "hiking",
        37: "running",
        46: "swimming",
        52: "walking",
        57: "yoga",
        63: "high_intensity_interval_training",
        3000: "other"
      }[value] ?? `workout_${value}`
    );
  }
  return "other";
}

function camelToSnake(value: string) {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function quantityValue(value: HealthKitWorkoutSample["duration"] | HealthKitWorkoutSample["totalDistance"]) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && typeof value.quantity === "number" && Number.isFinite(value.quantity)) {
    return value.quantity;
  }
  return null;
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
