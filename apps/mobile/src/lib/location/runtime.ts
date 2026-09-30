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
import { createSerialMutationQueue } from "./mutationQueue";
import { MAX_LOCATION_NATIVE_DRAIN_PASSES } from "./uploadPolicy";

const DEVICE_ID_KEY = "dayframe.location.deviceId.v2";
// All OS start/stop/clear operations (including drains) share this runtime lane.
// SQLite admission remains on the store's existing mutation queue.
export const withLocationCaptureLifecycle = createSerialMutationQueue();

async function locationDeviceId() {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const generated = `ios-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, generated);
  return generated;
}

function ownerIsCurrent(owner: MobileAccountOwner, revision: number) {
  return revision === locationCaptureRevision() && mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), owner);
}

async function stopCaptureUnsafe(binding: LocationCaptureBinding | null, reason: string) {
  const current = await readLocationCaptureBinding();
  if (current?.id !== binding?.id) return false;
  // End admission before any fallible OS cleanup; retain accepted rows except
  // for deliberate explicit logout. Each cleanup failure is coordinate-free.
  await endLocationOwnership(binding, reason === "logout");
  const geofence = await import("../geofence");
  let cleared = true;
  for (const operation of [geofence.stopLocationLearningIfStarted, geofence.stopGeofencesIfStarted,
    stopNativeLocationIntelligence, clearNativeLocationSignals, () => geofence.clearLocationCaptureCaches(binding?.accountKey)]) {
    try { await operation(); }
    catch { cleared = false; await recordLocationCaptureCleanupFailure(); }
  }
  return cleared;
}

async function bindOwnerUnsafe(owner: MobileAccountOwner, revision: number) {
  if (!ownerIsCurrent(owner, revision)) return false;
  const geofence = await import("../geofence");
  // Migration checks the old persisted binding BEFORE replacing it.
  await geofence.migrateLegacyLocationOptIn(owner);
  const previous = await readLocationCaptureBinding();
  const key = `${owner.workspaceId}:${owner.userId}`;
  if (previous?.accountKey === key) {
    const capture = await captureLocationOwnership();
    const enabled = await geofence.getLocationLearningEnabled();
    if (capture.context && previous.enabled !== enabled) {
      await configureLocationAccount(capture.context, await getLocationRolloutMode(), enabled, revision);
    }
    return ownerIsCurrent(owner, revision);
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
    "v2_shadow", enabled, revision));
}

export function bindLocationCaptureOwner(owner: MobileAccountOwner, revision = locationCaptureRevision()) {
  return withLocationCaptureLifecycle(() => bindOwnerUnsafe(owner, revision));
}

export function enableLocationCaptureOwnership(owner: MobileAccountOwner, revision: number) {
  return withLocationCaptureLifecycle(async () => {
    if (!ownerIsCurrent(owner, revision)) return false;
    const geofence = await import("../geofence");
    await geofence.writeLocationLearningPreference(owner, true);
    return bindOwnerUnsafe(owner, revision);
  });
}

export function stopUnownedLocationCapture(capture: LocationCaptureSnapshot) {
  return withLocationCaptureLifecycle(async () => {
    if (capture.revision !== locationCaptureRevision() || isLocationCaptureSnapshotCurrent(capture)) return;
    const current = await readLocationCaptureBinding();
    if (current?.id !== capture.binding?.id || capture.revision !== locationCaptureRevision()) return;
    invalidateLocationCaptureOwnership();
    await stopCaptureUnsafe(current, "no_owner");
  });
}

// Called synchronously by the existing account listener, including A -> B -> A.
export function locationCaptureAccountChanged(owner: MobileAccountOwner | null) {
  const revision = invalidateLocationCaptureOwnership();
  return withLocationCaptureLifecycle(async () => {
    const binding = await readLocationCaptureBinding();
    if (!await stopCaptureUnsafe(binding, "account_change")) return;
    if (owner && ownerIsCurrent(owner, revision)) await bindOwnerUnsafe(owner, revision);
  });
}

export function endLocationCaptureOwnership(reason: "logout" | "signed_out" | "opt_out" | "no_owner",
  owner?: MobileAccountOwner, isCurrent: () => boolean = () => true) {
  if (!isCurrent()) return Promise.resolve();
  if (owner && getActiveMobileAccountSnapshot() && !mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), owner)) {
    return Promise.resolve();
  }
  const previous = readLocationCaptureBinding();
  const revision = invalidateLocationCaptureOwnership();
  return withLocationCaptureLifecycle(async () => {
    const binding = await previous;
    if (!isCurrent()) return;
    if (owner && binding && binding.accountKey !== `${owner.workspaceId}:${owner.userId}`) return;
    // A queued no-owner self-heal must never stop a subsequently bound owner.
    if (!binding && revision !== locationCaptureRevision()) return;
    if (reason === "opt_out" && owner) {
      const geofence = await import("../geofence");
      await geofence.writeLocationLearningPreference(owner, false);
    }
    await stopCaptureUnsafe(binding, reason);
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
    }, rolloutMode, await geofence.getLocationLearningEnabled(), revision);
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
  if (!isLocationCaptureSnapshotCurrent(capture) || await getLocationRolloutMode() === "v1") return null;
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
      ...(signal.metadata.errorCode ? { errorCode: signal.metadata.errorCode } : {})
    };
    const parsed = LocationEvidenceSchema.safeParse({
      clientEvidenceId: signal.id, deviceId: context.deviceId,
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion, kind: signal.kind,
      occurredAt: signal.occurredAt, endedAt: signal.endedAt ?? null,
      latitude: signal.latitude ?? null, longitude: signal.longitude ?? null,
      horizontalAccuracyMeters: signal.horizontalAccuracyMeters ?? null,
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
  let transferredCount = 0;
  for (let pass = 0; pass < MAX_LOCATION_NATIVE_DRAIN_PASSES; pass += 1) {
    const result = await drainNativeLocationSignalsUnsafe(100, captured);
    transferredCount += result.transferredCount;
    if (result.pendingAccount || result.drainedCount < 100) return { transferredCount, pendingAccount: result.pendingAccount };
  }
  return { transferredCount, pendingAccount: false };
}
