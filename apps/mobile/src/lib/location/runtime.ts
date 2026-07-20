import * as SecureStore from "expo-secure-store";
import {
  LOCATION_ENGINE_V2_CONFIG,
  LocationEvidenceSchema,
  type LocationEvidence,
  type LocationEvidenceMetadata
} from "@dayframe/shared";
import type { MobileBootstrap } from "../api";
import {
  activeLocationCaptureContext,
  configureLocationAccount,
  getLocationRolloutMode,
  persistLocationEvidence,
  syncLocationEvidence
} from "./store";

const DEVICE_ID_KEY = "dayframe.location.deviceId.v2";
const LAST_ACCOUNT_KEY = "dayframe.location.lastAccount.v2";

async function locationDeviceId() {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const generated = `ios-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, generated);
  return generated;
}

export async function configureLocationIntelligence(bootstrap: MobileBootstrap) {
  const deviceId = await locationDeviceId();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";
  const nextAccountKey = `${bootstrap.workspace.id}:${bootstrap.user.id}`;
  const previousAccountKey = await SecureStore.getItemAsync(LAST_ACCOUNT_KEY);
  if (previousAccountKey && previousAccountKey !== nextAccountKey) {
    // Fail closed: never bind a prior account's native journal to a new owner.
    await clearNativeLocationSignals();
  }
  const rolloutMode = bootstrap.locationRolloutMode ?? "v2_shadow";
  await configureLocationAccount({
    userId: bootstrap.user.id,
    workspaceId: bootstrap.workspace.id,
    deviceId,
    timeZone,
    savedPlaces: bootstrap.places.flatMap((place) =>
      place.latitude == null || place.longitude == null
        ? []
        : [{
            id: place.id,
            name: place.name,
            latitude: place.latitude,
            longitude: place.longitude,
            radiusMeters: place.radiusMeters,
            priority: place.priority,
            loggingEnabled: place.loggingEnabled
          }]
    ),
    acceptedLearnedPlaces: (bootstrap.learnedPlaces ?? []).flatMap((place) =>
      place.status !== "accepted"
        ? []
        : [{
            id: place.id,
            name: place.name,
            latitude: place.latitude,
            longitude: place.longitude,
            radiusMeters: place.radiusMeters,
            priority: 0,
            accepted: true as const
          }]
    )
  }, rolloutMode);
  await SecureStore.setItemAsync(LAST_ACCOUNT_KEY, nextAccountKey);
  if (rolloutMode === "v1") {
    await stopNativeLocationIntelligence().catch(() => undefined);
    await clearNativeLocationSignals().catch(() => undefined);
    return;
  }
  await drainNativeLocationSignals();
  void syncLocationEvidence();
}

export async function startNativeLocationIntelligence() {
  if (await getLocationRolloutMode() === "v1") return null;
  const native = await import("../../../modules/dayframe-location-visits");
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

export async function drainNativeLocationSignals() {
  const context = await activeLocationCaptureContext();
  if (!context.deviceId || !context.timeZone) return { transferredCount: 0, pendingAccount: true };
  const deviceId = context.deviceId;
  const timeZone = context.timeZone;
  const native = await import("../../../modules/dayframe-location-visits");
  const signals = await native.drainSignals(100);
  if (signals.length === 0) return { transferredCount: 0, pendingAccount: false };
  const receivedAt = new Date().toISOString();
  const evidence = signals.map((signal) => {
    const metadata: LocationEvidenceMetadata = {
      ...(signal.metadata.visitDepartureOpen === "true" ? { visitDepartureOpen: true } : {}),
      ...(signal.metadata.authorizationStatus
        ? { authorizationStatus: signal.metadata.authorizationStatus as LocationEvidenceMetadata["authorizationStatus"] }
        : {}),
      ...(signal.metadata.accuracyAuthorization
        ? { accuracyAuthorization: signal.metadata.accuracyAuthorization as LocationEvidenceMetadata["accuracyAuthorization"] }
        : {}),
      ...(signal.metadata.errorCode ? { errorCode: signal.metadata.errorCode } : {})
    };
    return LocationEvidenceSchema.parse({
      clientEvidenceId: signal.id,
      deviceId,
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      kind: signal.kind,
      occurredAt: signal.occurredAt,
      endedAt: signal.endedAt ?? null,
      latitude: signal.latitude ?? null,
      longitude: signal.longitude ?? null,
      horizontalAccuracyMeters: signal.horizontalAccuracyMeters ?? null,
      receivedAt,
      timeZone,
      metadata
    } satisfies LocationEvidence);
  });
  await persistLocationEvidence(evidence);
  await native.clearSignals(signals.map((signal) => signal.id));
  return { transferredCount: evidence.length, pendingAccount: false };
}
