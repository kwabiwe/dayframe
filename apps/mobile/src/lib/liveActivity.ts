import { NativeModules, Platform } from "react-native";
import { paletteColorFor } from "@dayframe/shared";
import type { MobileBootstrap } from "./api";
import { registerLiveActivity } from "./api";
import { DAYFRAME_API_BASE } from "./config";

type LiveActivityEntry = Pick<
  NonNullable<MobileBootstrap["activeEntry"]>,
  "categoryColor" | "categoryName" | "description" | "id" | "startedAt"
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
    startedAt?: string | null
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

    if (!entry) {
      const convergence = await convergeNativeActivities(null, generation, null);
      if (generation !== requestedGeneration) continue;
      if (convergence.converged) lastSyncedLiveActivityKey = requestedKey;
      else lastSyncedLiveActivityKey = null;
      return;
    }

    if (!isUuid(entry.id)) {
      if (lastSyncedLiveActivityKey === requestedKey) return;
      const result = await startNativeActivity(entry).catch(() => false);
      if (generation !== requestedGeneration) continue;
      if (nativeStartSucceeded(result)) lastSyncedLiveActivityKey = requestedKey;
      return;
    }

    const shouldStart = lastSyncedLiveActivityKey !== requestedKey;
    let preferredActivityId: string | null = null;
    if (shouldStart) {
      const result = await startNativeActivity(entry).catch(() => false);
      if (generation !== requestedGeneration) continue;
      if (!nativeStartSucceeded(result)) return;
      preferredActivityId = typeof result === "object" ? result.activityId ?? null : null;
    }

    const convergence = await convergeNativeActivities(
      entry,
      generation,
      preferredActivityId
    );
    if (generation !== requestedGeneration) continue;
    if (!convergence.snapshotAvailable) {
      lastSyncedLiveActivityKey = null;
      return;
    }
    if (!convergence.converged || !convergence.survivorActivityId) {
      lastSyncedLiveActivityKey = null;
      // A same-key foreground pass can discover that ActivityKit ended the
      // cached activity outside this JS process. Retry once through start;
      // a failed/newly delayed start remains retryable on the next lifecycle.
      if (!shouldStart) continue;
      return;
    }

    lastSyncedLiveActivityKey = requestedKey;
    if (nativeLiveActivity?.pushToken) {
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

  const matching = active.filter((activity) =>
    activity.isRunning && activity.entryId === entry.id
  );
  const survivor = matching.find((activity) => activity.activityId === preferredActivityId) ?? matching[0] ?? null;
  const staleActivityIds = active
    .filter((activity) => activity.activityId !== survivor?.activityId)
    .map((activity) => activity.activityId);
  return {
    converged: Boolean(survivor) && active.length === 1 && staleActivityIds.length === 0,
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

function startNativeActivity(entry: LiveActivityEntry) {
  const categoryColor = entry.categoryName
    ? paletteColorFor(entry.categoryColor ?? entry.categoryName, entry.categoryName, "dark")
    : null;
  return nativeLiveActivity!.start(
    displayLiveActivityTitle(entry),
    isUuid(entry.id) ? entry.id : null,
    DAYFRAME_API_BASE,
    entry.categoryName,
    categoryColor,
    entry.startedAt
  );
}

function nativeStartSucceeded(
  result: boolean | { started: boolean; activityId?: string | null }
) {
  return typeof result === "boolean" ? result : result.started;
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
