import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { mapHealthKitSleepStage, type SleepStage } from "@dayframe/shared";
import { enqueueEvent } from "./api";

const HEALTHKIT_SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis";
const HEALTHKIT_ANCHOR_KEY = "dayframe.healthkit.sleepAnchor.v1";
const HEALTHKIT_SEEN_KEY = "dayframe.healthkit.sleepSeen.v1";

export type HealthImportStatus = {
  provider: "healthkit" | "health_connect";
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

export async function getHealthImportStatus(): Promise<HealthImportStatus[]> {
  if (Platform.OS !== "ios") {
    return [
      {
        provider: "healthkit",
        status: "unavailable",
        notes: "HealthKit is only available on iOS native builds."
      },
      healthConnectPlannedStatus()
    ];
  }

  try {
    const healthkit = await loadHealthKit();
    const available = await Promise.resolve(healthkit.isHealthDataAvailable());
    return [
      {
        provider: "healthkit",
        status: available ? "available" : "unavailable",
        notes: available
          ? "HealthKit sleep permission can be requested from this native build."
          : "Health data is not available on this device."
      },
      healthConnectPlannedStatus()
    ];
  } catch (error) {
    return [
      {
        provider: "healthkit",
        status: "error",
        notes: error instanceof Error ? error.message : "Unable to load HealthKit."
      },
      healthConnectPlannedStatus()
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
      status: "unavailable" as const,
      notes: "Health data is not available on this device."
    };
  }

  const granted = await healthkit.requestAuthorization({ toRead: [HEALTHKIT_SLEEP_TYPE] });
  return {
    provider: "healthkit" as const,
    status: granted ? ("available" as const) : ("needs_permission" as const),
    notes: granted
      ? "HealthKit sleep read permission was requested."
      : "HealthKit sleep permission was not granted."
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
    status: "synced" as const,
    notes: imported.length
      ? `Queued ${imported.length} HealthKit sleep samples as activity events.`
      : "No new HealthKit sleep samples found.",
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

async function loadHealthKit(): Promise<HealthKitModule> {
  return import("@kingstinct/react-native-healthkit");
}

function ensureIos() {
  if (Platform.OS !== "ios") {
    throw new Error("HealthKit sleep import requires a native iOS build.");
  }
}

async function readSeenSampleIds(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(HEALTHKIT_SEEN_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function healthConnectPlannedStatus(): HealthImportStatus {
  return {
    provider: "health_connect",
    status: "planned",
    notes: "Android Health Connect will use the same event-first import contract."
  };
}
