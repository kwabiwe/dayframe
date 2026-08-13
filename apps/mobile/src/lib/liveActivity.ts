import { NativeModules, Platform } from "react-native";
import { paletteColorFor } from "@dayframe/shared";
import type { MobileBootstrap } from "./api";
import { registerLiveActivity } from "./api";
import { DAYFRAME_API_BASE } from "./config";

type LiveActivityEntry = Pick<
  NonNullable<MobileBootstrap["activeEntry"]>,
  "categoryColor" | "categoryName" | "description" | "id" | "startedAt"
>;

type DayframeLiveActivityModule = {
  start(
    title: string,
    entryId?: string | null,
    apiBase?: string | null,
    categoryName?: string | null,
    categoryColor?: string | null,
    startedAt?: string | null
  ): Promise<boolean | { started: boolean; activityId?: string | null }>;
  pushToken?(activityId: string): Promise<{
    token?: string | null;
    environment?: "development" | "production" | null;
  }>;
  activitySnapshot?(): Promise<Array<{
    activityId: string;
    entryId?: string | null;
    isActive: boolean;
    isRunning: boolean;
  }>>;
  cleanupActivities?(activityIds: string[]): Promise<boolean>;
  enableStop?(activityId: string, entryId: string): Promise<boolean>;
};

const nativeLiveActivity = NativeModules.DayframeLiveActivityModule as DayframeLiveActivityModule | undefined;

let lastSyncedLiveActivityKey: string | null = null;
let requestedEntry: LiveActivityEntry | null = null;
let requestedGeneration = 0;
let reconciliation: Promise<void> | null = null;
const remoteRegistrations = new Map<string, Promise<boolean>>();
const registeredRemoteTokens = new Map<string, string>();
const REMOTE_REGISTRATION_RETRY_DELAYS_MS = [0, 1_500, 5_000] as const;

export async function syncLiveActivityForEntry(entry: LiveActivityEntry | null | undefined) {
  if (Platform.OS !== "ios" || !nativeLiveActivity) return;

  requestedEntry = entry ?? null;
  requestedGeneration += 1;
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
    const generation = requestedGeneration;
    const requestedKey = liveActivityKey(entry);
    if (lastSyncedLiveActivityKey === requestedKey) {
      // Optimistic/offline IDs intentionally create a non-interactive Activity
      // until the server assigns a canonical UUID. Its exact identity cannot
      // be reconciled yet, so the completed local presentation remains the
      // truth until the canonical entry replaces it.
      if (entry && !isUuid(entry.id)) return;
      const nativeState = await matchingNativeActivityState(entry);
      if (generation !== requestedGeneration) continue;
      if (
        !entry &&
        nativeState.snapshotAvailable &&
        nativeState.mismatchedActivityIds.length > 0
      ) {
        const didStop = await nativeLiveActivity!.cleanupActivities?.(
          nativeState.mismatchedActivityIds
        ).catch(() => false);
        if (generation !== requestedGeneration) continue;
        if (didStop !== false) lastSyncedLiveActivityKey = requestedKey;
        return;
      }
      if (nativeState.matches) {
        if (
          entry &&
          isUuid(entry.id) &&
          nativeState.matchingActivityId &&
          nativeLiveActivity!.pushToken
        ) {
          // A prior registration attempt may have exhausted its bounded
          // retries while offline. Every later same-entry reconciliation gets
          // another chance; Stop stays hidden until one succeeds.
          queueRemoteRegistration(nativeState.matchingActivityId, entry.id);
        }
        if (nativeState.mismatchedActivityIds.length > 0) {
          void nativeLiveActivity?.cleanupActivities?.(nativeState.mismatchedActivityIds)
            .catch(() => false);
        }
        return;
      }
      // The Live Activity can be stopped by an App Intent while this JS
      // process is suspended. Reconcile the native truth, not only our last
      // requested key, when the app is active again.
      lastSyncedLiveActivityKey = null;
      continue;
    }

    if (!entry) {
      const nativeState = await matchingNativeActivityState(null);
      if (generation !== requestedGeneration) continue;
      if (!nativeState.snapshotAvailable) return;
      const didStop = nativeState.mismatchedActivityIds.length === 0 ||
        await nativeLiveActivity!.cleanupActivities?.(nativeState.mismatchedActivityIds)
          .catch(() => false);
      if (generation !== requestedGeneration) continue;
      if (didStop !== false) lastSyncedLiveActivityKey = requestedKey;
      return;
    }

    const title = displayLiveActivityTitle(entry);
    const categoryColor = entry.categoryName
      ? paletteColorFor(entry.categoryColor ?? entry.categoryName, entry.categoryName, "dark")
      : null;
    const result = await nativeLiveActivity!.start(
      title,
      isUuid(entry.id) ? entry.id : null,
      DAYFRAME_API_BASE,
      entry.categoryName,
      categoryColor,
      entry.startedAt
    ).catch(() => false);
    if (generation !== requestedGeneration) continue;
    const didStart = typeof result === "boolean" ? result : result.started;
    if (didStart) {
      lastSyncedLiveActivityKey = requestedKey;
      if (isUuid(entry.id)) {
        const nativeState = await matchingNativeActivityState(entry);
        if (generation !== requestedGeneration) continue;
        if (nativeState.matches && nativeState.mismatchedActivityIds.length > 0) {
          void nativeLiveActivity?.cleanupActivities?.(nativeState.mismatchedActivityIds)
            .catch(() => false);
        }
      }
      if (
        typeof result === "object" &&
        result.activityId &&
        nativeLiveActivity?.pushToken &&
        isUuid(entry.id)
      ) {
        queueRemoteRegistration(result.activityId, entry.id);
      }
    }
    return;
  }
}

async function matchingNativeActivityState(entry: LiveActivityEntry | null) {
  const snapshot = await nativeLiveActivity?.activitySnapshot?.().catch(() => undefined);
  if (Array.isArray(snapshot)) {
    const active = snapshot.filter((activity) => activity?.isActive && activity?.isRunning);
    if (!entry) {
      return {
        matches: active.length === 0,
        matchingActivityId: null,
        mismatchedActivityIds: active.map((activity) => activity.activityId),
        snapshotAvailable: true
      };
    }
    return {
      matches: active.some((activity) => activity.entryId === entry.id),
      matchingActivityId: active.find((activity) => activity.entryId === entry.id)?.activityId ?? null,
      mismatchedActivityIds: active
        .filter((activity) => activity.entryId !== entry.id)
        .map((activity) => activity.activityId),
      snapshotAvailable: true
    };
  }

  // The JS bundle and native binary ship together. If an unexpected binary
  // cannot provide exact identities, fail closed instead of treating an
  // arbitrary Dayframe activity as the requested run.
  return {
    matches: false,
    matchingActivityId: null,
    mismatchedActivityIds: [] as string[],
    snapshotAvailable: false
  };
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

function queueRemoteRegistration(activityId: string, activeEntryId: string) {
  if (remoteRegistrations.has(activityId)) return;
  const registration = registerRemoteUpdates(activityId, activeEntryId).finally(() => {
    remoteRegistrations.delete(activityId);
  });
  remoteRegistrations.set(activityId, registration);
  void registration;
}

async function registerRemoteUpdates(activityId: string, activeEntryId: string) {
  for (const delay of REMOTE_REGISTRATION_RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (requestedEntry?.id !== activeEntryId) return false;

    const registration = await nativeLiveActivity?.pushToken?.(activityId).catch(() => null);
    if (!registration?.token || !registration.environment) continue;
    if (registeredRemoteTokens.get(activityId) === registration.token) return true;
    const didRegister = await registerLiveActivity({
      token: registration.token,
      activityId,
      activeEntryId,
      environment: registration.environment
    }).then(() => true).catch(() => false);
    if (!didRegister) continue;
    const didEnable = await nativeLiveActivity?.enableStop?.(
      activityId,
      activeEntryId
    ).catch(() => false);
    if (didEnable === true) {
      registeredRemoteTokens.set(activityId, registration.token);
      return true;
    }
  }
  return false;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
