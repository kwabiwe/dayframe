import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const runtimeSource = source("./runtime.ts");
const storeSource = source("./store.ts");
const dashboardSource = source("../../components/DayframeDashboard.tsx");
const recoveryOwnerSource = source("../../components/ConnectivityRecoveryOwner.tsx");
const geofenceSource = source("../geofence.ts");

describe("location finalisation replay contracts", () => {
  it("refreshes the local journal replay when due and forces one server replay on foreground", () => {
    expect(runtimeSource).toContain("syncLocationIntelligenceOnForeground");
    // 13 Oct (investigation 2026-10-12): the local replay is a diagnostic projection over the whole
    // seven-day journal, so it is throttled and never runs after each stored sample.
    expect(runtimeSource).toContain("await refreshLocalJournalReplayIfDue()");
    expect(runtimeSource).not.toContain("await processPendingLocationEvidence()");
    const persistPath = storeSource.slice(storeSource.indexOf("async function persistLocationEvidenceUnsafe"), storeSource.indexOf("export const LOCAL_JOURNAL_REPLAY_MIN_INTERVAL_MS"));
    expect(persistPath).not.toContain("processPendingLocationEvidenceUnsafe()");
    expect(runtimeSource).toMatch(/syncLocationEvidence\(\{ forceReplay: true,\s*\.\.\.options \}\)/);
    expect(recoveryOwnerSource).toContain("await syncLocationIntelligenceOnForeground({forceReplay:!context?.dueOnly})");
    expect(dashboardSource).not.toContain("syncLocationIntelligenceOnForeground");
  });

  it("bounds native drain and upload work", () => {
    expect(runtimeSource).toContain("MAX_LOCATION_NATIVE_DRAIN_PASSES");
    expect(runtimeSource).toContain("drainNativeLocationSignalsUnsafe(100, captured)");
    expect(storeSource).toContain("MAX_LOCATION_UPLOAD_BATCHES_PER_SYNC");
    expect(storeSource).toContain("fetchLocationSync");
    expect(storeSource).toContain("/api/location/replay");
  });

  it("does not hold geofence refresh behind remote reconciliation", () => {
    expect(runtimeSource).toContain("void syncLocationEvidence().catch(recordLocationStoreError)");
    expect(dashboardSource).toContain("await configureLocationIntelligence(bootstrap)");
    expect(dashboardSource).toContain("await refreshGeofencesForPlaces(bootstrap.places, { userId: bootstrap.user.id, workspaceId: bootstrap.workspace.id })");
  });

  it("keeps shared capture active while allowing legacy semantics only in explicit v1 mode", () => {
    expect(geofenceSource.match(/if \(persisted\.rolloutMode !== "v1"\) return;/g)).toHaveLength(2);
    expect(geofenceSource).toContain("await persistV2GeofenceEvidence");
    expect(geofenceSource).toContain("await persistV2LocationBatch");
  });

  it("keeps replay diagnostics coordinate-free", () => {
    const replayRequestSource = storeSource.slice(
      storeSource.indexOf("async function requestServerLocationReplay"),
      storeSource.indexOf("export async function applyLocationRetention")
    );
    expect(storeSource).toContain("last_server_replay_finalised_count");
    expect(storeSource).toContain("last_server_replay_semantic_count");
    expect(replayRequestSource).not.toContain("latitude");
    expect(replayRequestSource).not.toContain("longitude");
  });
});
