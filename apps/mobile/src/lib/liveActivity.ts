import { NativeModules, Platform } from "react-native";
import { paletteColorFor } from "@dayframe/shared";
import type { MobileBootstrap } from "./api";
import { registerLiveActivity } from "./api";
import { DAYFRAME_API_BASE } from "./config";
import { OPTIMISTIC_RUNNING_SPLIT_ID_PREFIX } from "./runningSplitIdentity";

type LiveActivityEntry = Pick<
  NonNullable<MobileBootstrap["activeEntry"]>,
  "categoryColor" | "categoryName" | "description" | "id" | "startedAt" | "runningSplitSourceEntryId"
>;

type NativeActivitySnapshot = {
  activityId: string;
  entryId?: string | null;
  isActive: boolean;
  isRunning: boolean;
};

type NativeConvergence = {
  converged: boolean;
  snapshotAvailable: boolean;
  staleActivityIds: string[];
  survivorActivityId: string | null;
};

type DayframeLiveActivityModule = {
  start(
    title: string,
    entryId?: string | null,
    apiBase?: string | null,
    categoryName?: string | null,
    categoryColor?: string | null,
    startedAt?: string | null,
    categoryColorLight?: string | null
  ): Promise<boolean | { started: boolean; activityId?: string | null }>;
  pushToken?(activityId: string): Promise<{
    token?: string | null;
    environment?: "development" | "production" | null;
  }>;
  activitySnapshot?(): Promise<NativeActivitySnapshot[]>;
  cleanupActivities?(activityIds: string[]): Promise<boolean>;
  enableStop?(activityId: string, entryId: string): Promise<boolean>;
};

const nativeLiveActivity = NativeModules.DayframeLiveActivityModule as DayframeLiveActivityModule | undefined;

let lastSyncedLiveActivityKey: string | null = null;
let pendingSplitActivity: { key: string; activityId: string } | null = null;
const bridgeOptimisticActivityIds = new Set<string>();
const MAX_BRIDGE_OPTIMISTIC_ACTIVITY_IDS = 8;
let requestedEntry: LiveActivityEntry | null = null;
let requestedGeneration = 0;
let reconciliation: Promise<void> | null = null;
const remoteRegistrations = new Map<string, Promise<boolean>>();
const registeredRemoteTokens = new Map<string, string>();
const CLEANUP_RETRY_DELAYS_MS = [0, 250, 1_000] as const;
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
    const pendingSplit = entry?.id.startsWith(OPTIMISTIC_RUNNING_SPLIT_ID_PREFIX) ?? false;
    if (!pendingSplit) pendingSplitActivity = null;

    if (!entry) {
      const convergence = await convergeNativeActivities(null, generation, null);
      if (generation !== requestedGeneration) continue;
      if (convergence.converged) {
        lastSyncedLiveActivityKey = requestedKey;
        bridgeOptimisticActivityIds.clear();
      } else {
        lastSyncedLiveActivityKey = null;
      }
      return;
    }

    if (!pendingSplit && !isUuid(entry.id)) {
      if (lastSyncedLiveActivityKey === requestedKey) return;
      const result = await startNativeActivity(entry).catch(() => false);
      if (generation !== requestedGeneration) continue;
      if (nativeStartSucceeded(result)) lastSyncedLiveActivityKey = requestedKey;
      return;
    }

    let preferredActivityId = pendingSplit && pendingSplitActivity?.key === requestedKey
      ? pendingSplitActivity.activityId
      : null;
    const shouldStart = pendingSplit ? !preferredActivityId : lastSyncedLiveActivityKey !== requestedKey;
    if (shouldStart) {
      const result = await startNativeActivity(entry).catch(() => false);
      preferredActivityId = typeof result === "object" && result.started ? result.activityId ?? null : null;
      // A repeat of the same pending key may arrive while the native start is in flight.
      if (pendingSplit && preferredActivityId && liveActivityKey(requestedEntry) === requestedKey) {
        pendingSplitActivity = { key: requestedKey, activityId: preferredActivityId };
      }
      if (generation !== requestedGeneration) continue;
      if (!nativeStartSucceeded(result) || (pendingSplit && !preferredActivityId)) return;
    }

    const convergence = await convergeNativeActivities(
      entry,
      generation,
      preferredActivityId
    );
    if (generation !== requestedGeneration) continue;
    if (!convergence.snapshotAvailable) {
      if (!pendingSplit) lastSyncedLiveActivityKey = null;
      return;
    }
    if (!convergence.converged || !convergence.survivorActivityId) {
      if (pendingSplit) {
        // Keep the verified canonical key when a pending start cannot take over.
        // Undo can then keep the original Activity and its enabled Stop.
        if (!convergence.survivorActivityId) pendingSplitActivity = null;
        return;
      }
      lastSyncedLiveActivityKey = null;
      // A same-key foreground pass can discover that ActivityKit ended the
      // cached activity outside this JS process. Retry once through start.
      if (!shouldStart) continue;
      return;
    }

    lastSyncedLiveActivityKey = requestedKey;
    if (!pendingSplit) bridgeOptimisticActivityIds.clear();
    if (!pendingSplit && nativeLiveActivity?.pushToken) {
      queueRemoteRegistration(
        convergence.survivorActivityId,
        entry.id,
        generation
      );
    }
    return;
  }
}

async function convergeNativeActivities(
  entry: LiveActivityEntry | null,
  generation: number,
  preferredActivityId: string | null
): Promise<NativeConvergence> {
  let latest: NativeConvergence = unavailableNativeConvergence();

  for (const delay of CLEANUP_RETRY_DELAYS_MS) {
    if (delay) await wait(delay);
    if (generation !== requestedGeneration) return latest;

    const observed = await matchingNativeActivityState(entry, preferredActivityId);
    if (generation !== requestedGeneration) return observed;
    latest = observed;
    if (!observed.snapshotAvailable || observed.converged) return observed;

    const staleActivityIds = [...observed.staleActivityIds];
    if (staleActivityIds.length > 0) {
      const cleaned = await nativeLiveActivity?.cleanupActivities?.(staleActivityIds)
        .catch(() => false);
      if (generation !== requestedGeneration) return observed;
      if (cleaned === false) continue;
    }

    const verified = await matchingNativeActivityState(entry, preferredActivityId);
    if (generation !== requestedGeneration) return verified;
    latest = verified;
    if (verified.converged) return verified;
  }

  return latest;
}

async function matchingNativeActivityState(
  entry: LiveActivityEntry | null,
  preferredActivityId: string | null
): Promise<NativeConvergence> {
  const snapshot = await nativeLiveActivity?.activitySnapshot?.().catch(() => undefined);
  if (!Array.isArray(snapshot)) return unavailableNativeConvergence();

  const active = snapshot
    .filter((activity) => activity?.isActive && activity.activityId)
    .sort((left, right) => left.activityId.localeCompare(right.activityId));
  if (!entry) {
    return {
      converged: active.length === 0,
      snapshotAvailable: true,
      staleActivityIds: active.map((activity) => activity.activityId),
      survivorActivityId: null
    };
  }

  const canonical = isUuid(entry.id);
  const matching = active.filter((activity) =>
    activity.isRunning && (canonical
      ? activity.entryId === entry.id
      : activity.entryId == null && activity.activityId === preferredActivityId)
  );
  const survivor = matching.find((activity) => activity.activityId === preferredActivityId) ?? matching[0] ?? null;
  // A native Shortcut can create a newer canonical Activity before bootstrap catches up.
  const staleActivityIds = active.filter((activity) =>
    activity.activityId !== survivor?.activityId && (canonical || (survivor &&
      ((entry.runningSplitSourceEntryId != null && activity.entryId === entry.runningSplitSourceEntryId) ||
        (activity.entryId == null && bridgeOptimisticActivityIds.has(activity.activityId)))))
  ).map((activity) => activity.activityId);
  return {
    converged: Boolean(survivor) && staleActivityIds.length === 0,
    snapshotAvailable: true,
    staleActivityIds,
    survivorActivityId: survivor?.activityId ?? null
  };
}

function unavailableNativeConvergence(): NativeConvergence {
  return {
    converged: false,
    snapshotAvailable: false,
    staleActivityIds: [],
    survivorActivityId: null
  };
}

/** The activity's block fill in each palette; the Live Activity follows the phone's appearance. */
function liveActivityFills(entry: LiveActivityEntry) {
  if (!entry.categoryName) return { dark: null, light: null };
  const value = entry.categoryColor ?? entry.categoryName;
  return {
    dark: paletteColorFor(value, entry.categoryName, "dark"),
    light: paletteColorFor(value, entry.categoryName, "light")
  };
}

async function startNativeActivity(entry: LiveActivityEntry) {
  const fills = liveActivityFills(entry);
  const canonicalId = isUuid(entry.id) ? entry.id : null;
  const result = await nativeLiveActivity!.start(
    displayLiveActivityTitle(entry),
    canonicalId,
    DAYFRAME_API_BASE,
    entry.categoryName,
    fills.dark,
    entry.startedAt,
    fills.light
  );
  if (!canonicalId && typeof result === "object" && result.started && result.activityId) {
    bridgeOptimisticActivityIds.add(result.activityId);
    if (bridgeOptimisticActivityIds.size > MAX_BRIDGE_OPTIMISTIC_ACTIVITY_IDS) {
      const oldest = bridgeOptimisticActivityIds.values().next().value;
      if (oldest) bridgeOptimisticActivityIds.delete(oldest);
    }
  }
  return result;
}

function nativeStartSucceeded(
  result: boolean | { started: boolean; activityId?: string | null }
) {
  return typeof result === "boolean" ? result : result.started;
}

function liveActivityKey(entry: LiveActivityEntry | null) {
  if (!entry) return "idle";
  const title = displayLiveActivityTitle(entry);
  const fills = liveActivityFills(entry);
  return [entry.id, entry.startedAt, title, entry.categoryName ?? "", fills.dark ?? "", fills.light ?? ""].join("|");
}

function displayLiveActivityTitle(entry: LiveActivityEntry) {
  const description = entry.description?.trim();
  if (description) return description;
  const categoryName = entry.categoryName?.trim();
  if (categoryName) return categoryName;
  return "No activity";
}

function queueRemoteRegistration(
  activityId: string,
  activeEntryId: string,
  generation: number
) {
  const existing = remoteRegistrations.get(activityId);
  if (existing) {
    void existing.finally(() => {
      if (isCurrentCanonicalRequest(activeEntryId, generation)) {
        queueRemoteRegistration(activityId, activeEntryId, generation);
      }
    });
    return;
  }
  const registration = registerRemoteUpdates(activityId, activeEntryId, generation).finally(() => {
    remoteRegistrations.delete(activityId);
  });
  remoteRegistrations.set(activityId, registration);
  void registration;
}

async function registerRemoteUpdates(
  activityId: string,
  activeEntryId: string,
  generation: number
) {
  for (const delay of REMOTE_REGISTRATION_RETRY_DELAYS_MS) {
    if (delay) await wait(delay);
    if (!isCurrentCanonicalRequest(activeEntryId, generation)) return false;
    if (!(await isVerifiedSurvivor(activityId, activeEntryId))) return false;
    if (!isCurrentCanonicalRequest(activeEntryId, generation)) return false;

    const registration = await nativeLiveActivity?.pushToken?.(activityId).catch(() => null);
    if (!isCurrentCanonicalRequest(activeEntryId, generation)) return false;
    if (!registration?.token || !registration.environment) continue;
    if (!(await isVerifiedSurvivor(activityId, activeEntryId))) return false;
    if (!isCurrentCanonicalRequest(activeEntryId, generation)) return false;
    if (registeredRemoteTokens.get(activityId) === registration.token) return true;

    const didRegister = await registerLiveActivity({
      token: registration.token,
      activityId,
      activeEntryId,
      environment: registration.environment
    }).then(() => true).catch(() => false);
    if (!isCurrentCanonicalRequest(activeEntryId, generation)) return false;
    if (!didRegister) continue;
    if (!(await isVerifiedSurvivor(activityId, activeEntryId))) return false;
    if (!isCurrentCanonicalRequest(activeEntryId, generation)) return false;

    const didEnable = await nativeLiveActivity?.enableStop?.(
      activityId,
      activeEntryId
    ).catch(() => false);
    if (!isCurrentCanonicalRequest(activeEntryId, generation)) return false;
    if (didEnable === true && await isVerifiedSurvivor(activityId, activeEntryId)) {
      registeredRemoteTokens.set(activityId, registration.token);
      return true;
    }
  }
  return false;
}

async function isVerifiedSurvivor(activityId: string, activeEntryId: string) {
  const snapshot = await nativeLiveActivity?.activitySnapshot?.().catch(() => undefined);
  if (!Array.isArray(snapshot)) return false;
  const active = snapshot.filter((activity) => activity?.isActive);
  return active.length === 1 &&
    active[0]?.activityId === activityId &&
    active[0]?.entryId === activeEntryId &&
    active[0]?.isRunning === true;
}

function isCurrentCanonicalRequest(activeEntryId: string, generation: number) {
  return requestedGeneration === generation && requestedEntry?.id === activeEntryId;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
