import { NativeModules, Platform } from "react-native";
import { paletteColorFor } from "@dayframe/shared";
import type { MobileBootstrap } from "./api";
import { registerLiveActivity } from "./api";

type LiveActivityEntry = Pick<
  NonNullable<MobileBootstrap["activeEntry"]>,
  "categoryColor" | "categoryName" | "description" | "id" | "startedAt"
>;

type DayframeLiveActivityModule = {
  start(
    title: string,
    categoryName?: string | null,
    categoryColor?: string | null,
    startedAt?: string | null
  ): Promise<boolean | { started: boolean; activityId?: string | null }>;
  pushToken?(activityId: string): Promise<{
    token?: string | null;
    environment: "development" | "production";
  }>;
  stop(): Promise<boolean>;
};

const nativeLiveActivity = NativeModules.DayframeLiveActivityModule as DayframeLiveActivityModule | undefined;

let lastSyncedLiveActivityKey: string | null = null;
let requestedEntry: LiveActivityEntry | null = null;
let reconciliation: Promise<void> | null = null;

export async function syncLiveActivityForEntry(entry: LiveActivityEntry | null | undefined) {
  if (Platform.OS !== "ios" || !nativeLiveActivity) return;

  requestedEntry = entry ?? null;
  if (!reconciliation) {
    reconciliation = reconcileLatestEntry().finally(() => {
      reconciliation = null;
    });
  }
  await reconciliation;
}

async function reconcileLatestEntry() {
  while (true) {
    const entry = requestedEntry;
    const requestedKey = liveActivityKey(entry);
    if (lastSyncedLiveActivityKey === requestedKey) return;

    if (!entry) {
      const didStop = await nativeLiveActivity!.stop().catch(() => false);
      if (requestedEntry !== entry) continue;
      if (didStop) lastSyncedLiveActivityKey = requestedKey;
      return;
    }

    const title = displayLiveActivityTitle(entry);
    const categoryColor = entry.categoryName
      ? paletteColorFor(entry.categoryColor ?? entry.categoryName, entry.categoryName, "dark")
      : null;
    const result = await nativeLiveActivity!.start(
      title,
      entry.categoryName,
      categoryColor,
      entry.startedAt
    ).catch(() => false);
    if (requestedEntry !== entry) continue;
    const didStart = typeof result === "boolean" ? result : result.started;
    if (didStart) {
      lastSyncedLiveActivityKey = requestedKey;
      if (
        typeof result === "object" &&
        result.activityId &&
        nativeLiveActivity?.pushToken &&
        isUuid(entry.id)
      ) {
        void registerRemoteUpdates(result.activityId, entry.id);
      }
    }
    return;
  }
}

function liveActivityKey(entry: LiveActivityEntry | null) {
  if (!entry) return "idle";
  const title = displayLiveActivityTitle(entry);
  const categoryColor = entry.categoryName
    ? paletteColorFor(entry.categoryColor ?? entry.categoryName, entry.categoryName, "dark")
    : null;
  return [entry.id, entry.startedAt, title, entry.categoryName ?? "", categoryColor ?? ""].join("|");
}

function displayLiveActivityTitle(entry: LiveActivityEntry) {
  const description = entry.description?.trim();
  if (description) return description;
  const categoryName = entry.categoryName?.trim();
  if (categoryName) return categoryName;
  return "Uncategorized";
}

async function registerRemoteUpdates(activityId: string, activeEntryId: string) {
  const registration = await nativeLiveActivity?.pushToken?.(activityId).catch(() => null);
  if (!registration?.token) return;
  await registerLiveActivity({
    token: registration.token,
    activityId,
    activeEntryId,
    environment: registration.environment
  }).catch(() => undefined);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
