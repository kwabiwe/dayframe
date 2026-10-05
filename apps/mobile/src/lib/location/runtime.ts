import * as SecureStore from "expo-secure-store";
import {
  LOCATION_ENGINE_V2_CONFIG,
  LocationEvidenceSchema,
  type LocationEvidenceMetadata
} from "@dayframe/shared";
import type { MobileBootstrap } from "../api";
import {
  deactivateMobileAccount,
  getActiveMobileAccountSnapshot,
  mobileAccountOwnersEqual,
  readActiveMobileAccount,
  type MobileAccountOwner
} from "../mobileAccount";
import {
  captureLocationOwnership,
  configureLocationAccount,
  endLocationOwnership,
  getLocationRolloutMode,
  invalidateLocationCaptureOwnership,
  isLocationCaptureSnapshotCurrent,
  isLocationCaptureAdmissionSuspended,
  locationCaptureRevision,
  persistLocationEvidence,
  processPendingLocationEvidence,
  readLocationCaptureBinding,
  readOwnedLocationAccountContext,
  recordLocationCaptureDiscard,
  recordLocationCaptureCleanupFailure,
  recordLocationStoreError,
  syncLocationEvidence,
  type LocationCaptureBinding,
  type LocationCaptureSnapshot,
  type LocationSyncOptions
} from "./store";
import { captureMotionActivitySafelyUnsafe } from "./motionActivity";
import { createSerialMutationQueue } from "./mutationQueue";
import { MAX_LOCATION_NATIVE_DRAIN_PASSES } from "./uploadPolicy";

const DEVICE_ID_KEY = "dayframe.location.deviceId.v2";
// All OS start/stop/clear operations (including drains) share this runtime lane.
// SQLite admission remains on the store's existing mutation queue.
export const withLocationCaptureLifecycle = createSerialMutationQueue();
// This fence consults the captured secure-session authority supplied by logout.
// It lasts through the whole API logout, including its network await. It is not
// an independent session owner; a newer session makes its predicate false.
let logoutFence: { owner: MobileAccountOwner | null; isCurrent: () => boolean } | null = null;
let accountPublicationSeen = false;
export function beginLocationLogout(owner: MobileAccountOwner | null, isCurrent: () => boolean) {
  const fence = { owner, isCurrent };
  logoutFence = fence;
  invalidateLocationCaptureOwnership();
  return () => { if (logoutFence === fence) logoutFence = null; };
}

export function isLocationLogoutCurrent(owner: MobileAccountOwner) {
  return Boolean(logoutFence && mobileAccountOwnersEqual(logoutFence.owner, owner) && logoutFence.isCurrent());
}

async function locationDeviceId() {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const generated = `ios-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, generated);
  return generated;
}

function ownerIsCurrent(owner: MobileAccountOwner, revision: number) {
  return revision === locationCaptureRevision() && mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), owner) &&
    !isLocationLogoutCurrent(owner);
}

async function stopCaptureUnsafe(binding: LocationCaptureBinding | null, reason: string,
  options: { owner?: MobileAccountOwner; isCurrent?: () => boolean; revision?: number } = {}) {
  const current = await readLocationCaptureBinding();
  if (current?.id !== binding?.id) return false;
  // End admission before any fallible OS cleanup; retain accepted rows except
  // for deliberate explicit logout. Each cleanup failure is coordinate-free.
  if (!await endLocationOwnership(binding, reason === "logout", options)) return false;
  return stopCaptureSourcesUnsafe(options.owner ? `${options.owner.workspaceId}:${options.owner.userId}` : binding?.accountKey);
}

async function stopCaptureSourcesUnsafe(ownerKey?: string) {
  const geofence = await import("../geofence");
  let cleared = true;
  for (const operation of [geofence.stopLocationLearningIfStarted, geofence.stopGeofencesIfStarted,
    stopNativeLocationIntelligence, clearNativeLocationSignals, () => geofence.clearLocationCaptureCaches(ownerKey)]) {
    try { await operation(); }
    catch { cleared = false; await recordLocationCaptureCleanupFailure(); }
  }
  return cleared;
}

async function bindOwnerUnsafe(owner: MobileAccountOwner, revision: number, explicitEnable = false) {
  if (!ownerIsCurrent(owner, revision)) return false;
  const geofence = await import("../geofence");
  // Migration checks the old persisted binding BEFORE replacing it.
  await geofence.migrateLegacyLocationOptIn(owner);
  const previous = await readLocationCaptureBinding();
  const key = `${owner.workspaceId}:${owner.userId}`;
  if (previous?.accountKey === key) {
    const capture = await captureLocationOwnership();
    // A disabled binding also keeps a failed consent write fail-closed. Only
    // a later authorised opt-in may enable it; bootstrap is not consent.
    const enabled = (previous.enabled || explicitEnable) && await geofence.getLocationLearningEnabled();
    if (!capture.context || !ownerIsCurrent(owner, revision)) return false;
    const configured = await configureLocationAccount(capture.context, undefined, enabled, revision, isLocationCaptureAdmissionSuspended());
    if (configured && !enabled && ownerIsCurrent(owner, revision)) await stopCaptureSourcesUnsafe(key);
    return Boolean(configured);
  }
  if (!await stopCaptureUnsafe(previous, "replacement")) return false;
  if (!ownerIsCurrent(owner, revision)) return false;
  const retained = await readOwnedLocationAccountContext(owner);
  const deviceId = retained?.deviceId ?? await locationDeviceId();
  const enabled = await geofence.getLocationLearningEnabled();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timeZone || !ownerIsCurrent(owner, revision)) return false;
  return Boolean(await configureLocationAccount({ ...owner, deviceId, timeZone,
    savedPlaces: retained?.savedPlaces ?? [], acceptedLearnedPlaces: retained?.acceptedLearnedPlaces ?? [] },
    undefined, enabled, revision));
}

export function bindLocationCaptureOwner(owner: MobileAccountOwner, revision = locationCaptureRevision()) {
  return withLocationCaptureLifecycle(() => bindOwnerUnsafe(owner, revision));
}

export function enableLocationCaptureOwnership(owner: MobileAccountOwner, revision: number) {
  return withLocationCaptureLifecycle(async () => {
    if (!ownerIsCurrent(owner, revision)) return false;
    const geofence = await import("../geofence");
    await geofence.writeLocationLearningPreference(owner, true);
    return bindOwnerUnsafe(owner, revision, true);
  });
}

export function stopUnownedLocationCapture(capture: LocationCaptureSnapshot) {
  return withLocationCaptureLifecycle(async () => {
    if (capture.revision !== locationCaptureRevision()) return;
    const current = await readLocationCaptureBinding();
    if (current?.id !== capture.binding?.id || capture.revision !== locationCaptureRevision()) return;
    // An opted-out owner retains its context and accepted work for sync.
    if (current && capture.context && mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), capture.context)) {
      const consent = await import("../geofence").then(g => g.getLocationLearningEnabled());
      if (capture.revision !== locationCaptureRevision() || !mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), capture.context)) return;
      if (!current.enabled || !consent) {
        await stopCaptureSourcesUnsafe(current.accountKey);
        return;
      }
    }
    if (isLocationCaptureSnapshotCurrent(capture)) return;
    invalidateLocationCaptureOwnership();
    await stopCaptureUnsafe(current, "no_owner");
  });
}

// Called synchronously by the existing account listener, including A -> B -> A.
export function locationCaptureAccountChanged(owner: MobileAccountOwner | null) {
  // A first cold activation may publish before mobileAccount hydrates its cache.
  // Preserve an already attributable same-owner binding in that case. Later
  // publications invalidate synchronously, including A -> B -> A.
  const coldActivation = !accountPublicationSeen && owner && locationCaptureRevision() === 0;
  accountPublicationSeen = true;
  const revision = coldActivation ? 0 : invalidateLocationCaptureOwnership();
  return withLocationCaptureLifecycle(async () => {
    if (revision !== locationCaptureRevision()) return;
    if (owner) { if (ownerIsCurrent(owner, revision)) await bindOwnerUnsafe(owner, revision); return; }
    const binding = await readLocationCaptureBinding();
    if (!await stopCaptureUnsafe(binding, "account_change")) return;
  });
}

export function endLocationCaptureOwnership(reason: "logout" | "signed_out" | "opt_out" | "no_owner",
  owner?: MobileAccountOwner, isCurrent: () => boolean = () => true) {
  if (!isCurrent()) return Promise.resolve();
  if (owner && getActiveMobileAccountSnapshot() && !mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), owner)) {
    return Promise.resolve();
  }
  if (reason === "opt_out" && owner) {
    if (!mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), owner)) return Promise.resolve();
    const duringLogout = isLocationLogoutCurrent(owner);
    const revision = duringLogout ? locationCaptureRevision() : invalidateLocationCaptureOwnership();
    // Acceptance above authorises this scoped decision. Keep it in intent order
    // on the existing lane, even if logout/401 cancels its capture work. A later
    // authorised opt-in writes after it, so old off work cannot overwrite on.
    return withLocationCaptureLifecycle(async () => {
      const geofence = await import("../geofence");
      let saved = false;
      try {
        await geofence.writeLocationLearningPreference(owner, false);
        saved = true;
      } finally {
        try {
          // Never recreate context behind explicit logout. Keep a disabled
          // binding even on write failure while this capture job still applies.
          if (!duringLogout && isCurrent() && ownerIsCurrent(owner, revision)) {
            const context = await readOwnedLocationAccountContext(owner);
            if (context && ownerIsCurrent(owner, revision)) await configureLocationAccount(context, undefined, false, revision);
          }
        } finally {
          // A local SQLite failure cannot skip OS teardown after durable off.
          // Starts/consent writes share this lane. Replacement B is excluded;
          // a newer A start can only run after this job has finished.
          if (mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), owner) &&
            (saved || revision === locationCaptureRevision())) {
            if (!await stopCaptureSourcesUnsafe(`${owner.workspaceId}:${owner.userId}`)) {
              throw new Error("Location is paused, but some local capture cleanup failed. Try again before signing out.");
            }
          }
        }
      }
    });
  }
  const previous = readLocationCaptureBinding();
  const revision = invalidateLocationCaptureOwnership();
  return withLocationCaptureLifecycle(async () => {
    const binding = await previous;
    if (!isCurrent()) return;
    if (revision !== locationCaptureRevision()) {
      if (reason === "logout") throw new Error("Location changed during local cleanup. Try signing out again.");
      return;
    }
    if (owner && binding && binding.accountKey !== `${owner.workspaceId}:${owner.userId}`) {
      if (reason === "logout") throw new Error("Local Location account changed. Try signing out again.");
      return;
    }
    const cleared = await stopCaptureUnsafe(binding, reason, { owner, isCurrent, revision });
    if (!cleared && reason === "logout" && isCurrent()) {
      throw new Error("Local Location cleanup failed. Try signing out again to remove this account's saved Location data.");
    }
  });
}

export function locationCaptureSessionSignedOut() {
  // Hydrate at publication, before a later account activation can be queued.
  const owner = readActiveMobileAccount();
  const end = endLocationCaptureOwnership("signed_out");
  const deactivate = owner.then(async (previousOwner) => {
    if (previousOwner) await deactivateMobileAccount(previousOwner);
  });
  return Promise.all([deactivate, end]).then(() => undefined);
}

export async function configureLocationIntelligence(bootstrap: MobileBootstrap) {
  const owner = { userId: bootstrap.user.id, workspaceId: bootstrap.workspace.id };
  const revision = locationCaptureRevision();
  await readActiveMobileAccount();
  await withLocationCaptureLifecycle(async () => {
    if (!await bindOwnerUnsafe(owner, revision)) return;
    const capture = await captureLocationOwnership();
    if (!capture.context || !ownerIsCurrent(owner, revision)) return;
    const geofence = await import("../geofence");
    const rolloutMode = bootstrap.locationRolloutMode ?? "v2_shadow";
    await configureLocationAccount({ ...capture.context,
      savedPlaces: bootstrap.places.flatMap(place => place.latitude == null || place.longitude == null ? [] : [{
        id: place.id, name: place.name, latitude: place.latitude, longitude: place.longitude,
        radiusMeters: place.radiusMeters, priority: place.priority, loggingEnabled: place.loggingEnabled
      }]),
      acceptedLearnedPlaces: (bootstrap.learnedPlaces ?? []).flatMap(place => place.status !== "accepted" ? [] : [{
        id: place.id, name: place.name, latitude: place.latitude, longitude: place.longitude,
        radiusMeters: place.radiusMeters, priority: 0, accepted: true as const
      }])
    }, rolloutMode, Boolean(capture.binding?.enabled && await geofence.getLocationLearningEnabled()), revision);
    if (!ownerIsCurrent(owner, revision)) return;
    if (rolloutMode === "v1") {
      await stopNativeLocationIntelligence();
      await clearNativeLocationSignals();
      return;
    }
    await drainNativeLocationSignalsInBatchesUnsafe();
    await processPendingLocationEvidence();
  });
  if (ownerIsCurrent(owner, revision)) void syncLocationEvidence().catch(recordLocationStoreError);
}

export async function syncLocationIntelligenceOnForeground(options: LocationSyncOptions = {}) {
  if (await getLocationRolloutMode() === "v1") return { synced: false, reason: "v1" as const };
  await drainNativeLocationSignalsInBatches();
  await processPendingLocationEvidence();
  return syncLocationEvidence({ forceReplay: true, ...options });
}

// Call only inside withLocationCaptureLifecycle; all callers are in geofence.ts.
export async function startNativeLocationIntelligence() {
  const capture = await captureLocationOwnership();
  if (!isLocationCaptureSnapshotCurrent(capture) || !await import("../geofence").then(g => g.getLocationLearningEnabled()) ||
    !isLocationCaptureSnapshotCurrent(capture) || await getLocationRolloutMode() === "v1") return null;
  const native = await import("../../../modules/dayframe-location-visits");
  if (!isLocationCaptureSnapshotCurrent(capture)) return null;
  return native.startMonitoring();
}

export async function stopNativeLocationIntelligence() {
  const native = await import("../../../modules/dayframe-location-visits");
  return native.stopMonitoring();
}
export async function clearNativeLocationSignals() {
  const native = await import("../../../modules/dayframe-location-visits");
  return native.clearAllSignals();
}
export async function getNativeLocationIntelligenceStatus() {
  const native = await import("../../../modules/dayframe-location-visits");
  return native.getStatus();
}

export function drainNativeLocationSignals(limit = 100) {
  // Snapshot before waiting for the lifecycle lane; queued work cannot adopt B.
  const capture = captureLocationOwnership();
  return withLocationCaptureLifecycle(() => drainNativeLocationSignalsUnsafe(limit, capture));
}

async function drainNativeLocationSignalsUnsafe(limit = 100,
  captured = captureLocationOwnership()) {
  const capture = await captured;
  const native = await import("../../../modules/dayframe-location-visits");
  if (!isLocationCaptureSnapshotCurrent(capture)) {
    // Clear only when no replacement binding exists. This lane prevents clears
    // already in flight from running after B's monitoring starts.
    const current = await readLocationCaptureBinding();
    if (!current || current.id === capture.binding?.id) await native.clearAllSignals();
    return { transferredCount: 0, drainedCount: 0, pendingAccount: true };
  }
  const context = capture.context!;
  const signals = await native.drainSignals(limit);
  const receivedAt = new Date().toISOString();
  const evidence = signals.flatMap(signal => {
    const metadata: LocationEvidenceMetadata = {
      ...(signal.metadata.visitDepartureOpen === "true" ? { visitDepartureOpen: true } : {}),
      ...(signal.metadata.authorizationStatus ? { authorizationStatus: signal.metadata.authorizationStatus as LocationEvidenceMetadata["authorizationStatus"] } : {}),
      ...(signal.metadata.accuracyAuthorization ? { accuracyAuthorization: signal.metadata.accuracyAuthorization as LocationEvidenceMetadata["accuracyAuthorization"] } : {}),
      ...(signal.metadata.errorCode ? { errorCode: signal.metadata.errorCode } : {}),
      // When the native callback ran; receivedAt stays the drain time.
      ...(signal.metadata.nativeCallbackAt && Number.isFinite(Date.parse(signal.metadata.nativeCallbackAt))
        ? { nativeCallbackAt: signal.metadata.nativeCallbackAt } : {})
    };
    const parsed = LocationEvidenceSchema.safeParse({
      clientEvidenceId: signal.id, deviceId: context.deviceId,
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion, kind: signal.kind,
      occurredAt: signal.occurredAt, endedAt: signal.endedAt ?? null,
      latitude: signal.latitude ?? null, longitude: signal.longitude ?? null,
      horizontalAccuracyMeters: signal.horizontalAccuracyMeters ?? null,
      speedMetersPerSecond: signal.speedMetersPerSecond != null && signal.speedMetersPerSecond >= 0 ? signal.speedMetersPerSecond : null,
      receivedAt, timeZone: context.timeZone, metadata
    });
    return parsed.success ? [parsed.data] : [];
  });
  if (evidence.length !== signals.length) await recordLocationCaptureDiscard("invalid_evidence", signals.length - evidence.length);
  const result = await persistLocationEvidence(evidence, capture);
  // Both acceptance and deliberate discard have committed before native clear.
  await native.clearSignals(signals.map(signal => signal.id));
  return { transferredCount: result.insertedCount, drainedCount: signals.length, pendingAccount: false };
}

export function drainNativeLocationSignalsInBatches() {
  const capture = captureLocationOwnership();
  return withLocationCaptureLifecycle(() => drainNativeLocationSignalsInBatchesUnsafe(capture));
}
async function drainNativeLocationSignalsInBatchesUnsafe(captured = captureLocationOwnership()) {
  const result = await drainNativeSignalPassesUnsafe(captured);
  // Motion & Fitness history joins the same wake, after native signals; a
  // failure there never fails the drain.
  if (!result.pendingAccount) await captureMotionActivitySafelyUnsafe(await captured);
  return result;
}
async function drainNativeSignalPassesUnsafe(captured: Promise<LocationCaptureSnapshot>) {
  let transferredCount = 0;
  for (let pass = 0; pass < MAX_LOCATION_NATIVE_DRAIN_PASSES; pass += 1) {
    const result = await drainNativeLocationSignalsUnsafe(100, captured);
    transferredCount += result.transferredCount;
    if (result.pendingAccount || result.drainedCount < 100) return { transferredCount, pendingAccount: result.pendingAccount };
  }
  return { transferredCount, pendingAccount: false };
}
