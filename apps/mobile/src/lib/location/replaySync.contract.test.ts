import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const runtimeSource = source("./runtime.ts");
const storeSource = source("./store.ts");
const dashboardSource = source("../../components/DayframeDashboard.tsx");

describe("location finalisation replay contracts", () => {
  it("reprocesses local evidence and forces one replay on foreground", () => {
    expect(runtimeSource).toContain("syncLocationIntelligenceOnForeground");
    expect(runtimeSource).toContain("await processPendingLocationEvidence()");
    expect(runtimeSource).toContain("syncLocationEvidence({ forceReplay: true })");
    expect(dashboardSource).toContain("syncLocationIntelligenceOnForeground().catch(recordLocationStoreError)");
  });

  it("bounds native drain and upload work", () => {
    expect(runtimeSource).toContain("MAX_LOCATION_NATIVE_DRAIN_PASSES");
    expect(runtimeSource).toContain("drainNativeLocationSignals(100)");
    expect(storeSource).toContain("MAX_LOCATION_UPLOAD_BATCHES_PER_SYNC");
    expect(storeSource).toContain("/api/location/replay");
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
