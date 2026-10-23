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
const settingsSource = source("../../../app/settings.tsx");

describe("location finalisation replay contracts", () => {
  it("runs the local journal replay only for the diagnostics export and forces one server replay on foreground", () => {
    expect(runtimeSource).toContain("syncLocationIntelligenceOnForeground");
    // 13 Oct (investigation 2026-10-12): the local replay is a diagnostic projection over the whole
    // seven-day journal, so it is throttled and never runs after each stored sample. 22 Oct stability
    // audit (location-3/4): it ran the whole engine on the JS thread on every bootstrap publish and its
    // throw skipped upload and geofence refresh, so no bootstrap, configuration or foreground path runs it.
    const between = (from: string, to: string) => {
      const start = runtimeSource.indexOf(from), end = runtimeSource.indexOf(to);
      expect(start, from).toBeGreaterThanOrEqual(0);
      expect(end, to).toBeGreaterThan(start);
      return runtimeSource.slice(start, end);
    };
    const configure = between("export async function configureLocationIntelligence", "export function syncLocationIntelligenceOnForeground");
    const foreground = between("export function syncLocationIntelligenceOnForeground", "/**\n * Settings › Sync help › Share location details");
    for (const path of [configure, foreground]) {
      expect(path).toContain("drainNativeLocationSignals");
      expect(path).not.toMatch(/refreshLocalJournalReplay(IfDue|ForDiagnostics)|processPendingLocationEvidence/);
    }
    expect(runtimeSource.match(/refreshLocalJournalReplayIfDue\(/g)).toHaveLength(1);
    expect(runtimeSource).toContain('withJsTask("location-replay", () => refreshLocalJournalReplayIfDue())');
    expect(settingsSource).toContain("await refreshLocalJournalReplayForDiagnostics();");
    for (const caller of [dashboardSource, recoveryOwnerSource, geofenceSource, source("../manualSyncRuntime.ts")]) {
      expect(caller).not.toMatch(/refreshLocalJournalReplay|processPendingLocationEvidence/);
    }
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
  it("does not let a pass's own location evidence queue another pass (13 Oct, TestFlight 117)", () => {
    expect(recoveryOwnerSource).toContain("durableWorkArrived(");
    expect(recoveryOwnerSource).toContain("currentCoordinator.snapshot().inFlight");
    expect(recoveryOwnerSource).toContain("previousLocationCount.current = durableWork.locationCount");
    expect(recoveryOwnerSource).not.toContain("durableWork.pendingCount > previousPendingCount.current");
  });
});
