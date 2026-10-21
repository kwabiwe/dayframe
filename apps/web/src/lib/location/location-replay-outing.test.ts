import { describe, expect, it, vi } from "vitest";

// The outing check is pinned here, so the test shows what replay does with its answer when a stay
// elsewhere in the outing (not the leg's own ends) has decided boundaries; the engine runs for real.
const outing = vi.hoisted(() => ({ qualifies: true, calls: [] as string[][] }));
vi.mock("@dayframe/shared", async (original) => {
  const shared = await original<typeof import("@dayframe/shared")>();
  return {
    ...shared,
    outingQualifies: (chain: Array<{ clientSegmentId: string }>) => {
      outing.calls.push(chain.map((stay) => stay.clientSegmentId));
      return outing.qualifies;
    }
  };
});
const { PHYSICAL_STOP_PICKUP, physicalStopFixture, runLocationEngine } = await import("@dayframe/shared");
const { replayLocationEvidence } = await import("./location-replay-service");

// The sparse 12-minute outing: two fast fixes on each leg, too few for either leg alone.
function sparseOuting() {
  const fixture = physicalStopFixture({ ...PHYSICAL_STOP_PICKUP,
    visit: [670_000, 1_390_000], slowAt: [860_000, 1_000_000, 1_200_000], departAt: 1_394_000, returnAt: 1_478_000 });
  fixture.evidence = fixture.evidence.filter((item) => item.clientEvidenceId !== "out-2" && item.clientEvidenceId !== "back-2");
  return fixture;
}

async function replayWithDecidedOrigin(qualifies: boolean) {
  outing.qualifies = qualifies;
  outing.calls = [];
  const fixture = sparseOuting();
  const local = runLocationEngine(fixture);
  const legs = local.segmentUpserts.filter((segment) => segment.kind === "commute");
  const outbound = legs.find((leg) => leg.kind === "commute" && leg.outingStayIds?.[0] !== leg.fromStaySegmentId);
  if (outbound?.kind !== "commute" || !outbound.outingStayIds) throw new Error("fixture must produce the visit's outbound outing leg");
  // The outing's first anchor (the origin stay), not the outbound leg's own ends, has a decided end bound.
  const originId = outbound.outingStayIds[0];
  const origin = local.segmentUpserts.find((segment) => segment.kind === "stay" && segment.clientSegmentId === originId);
  if (origin?.kind !== "stay") throw new Error("fixture must produce the origin stay");
  const canonical = { clientSegmentId: originId, startedAt: origin.startedAt, stoppedAt: origin.stoppedAt,
    startLowerBoundAt: origin.startLowerBoundAt, startUpperBoundAt: origin.startUpperBoundAt,
    stopLowerBoundAt: new Date(Date.parse(origin.stopLowerBoundAt!) - 5_000).toISOString(), stopUpperBoundAt: origin.stopUpperBoundAt };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("decided stay bounds")) return { rows: [canonical] };
    if (sql.includes("from location_evidence\n")) return { rows: fixture.evidence.map((item, index) => ({
      id: `row-${index}`, clientEvidenceId: item.clientEvidenceId, deviceId: item.deviceId, evidenceType: item.kind,
      occurredAt: item.occurredAt, endedAt: item.endedAt ?? null, latitude: item.latitude ?? null, longitude: item.longitude ?? null,
      horizontalAccuracyMeters: item.horizontalAccuracyMeters ?? null, altitudeMeters: item.altitudeMeters ?? null,
      speedMetersPerSecond: item.speedMetersPerSecond ?? null, courseDegrees: item.courseDegrees ?? null,
      savedPlaceId: item.savedPlaceId ?? null, geofenceIdentifier: item.geofenceIdentifier ?? null,
      algorithmVersion: item.algorithmVersion, timeZone: item.timeZone, isSimulated: item.isSimulated ?? null,
      metadata: item.metadata ?? {}, receivedAt: item.receivedAt })) };
    if (sql.includes("from places\n")) return { rows: fixture.savedPlaces };
    if (sql.includes("from learned_places lp\n")) return { rows: fixture.acceptedLearnedPlaces };
    if (sql.includes("insert into stay_segments")) return { rows: local.segmentUpserts.filter((segment) => segment.kind === "stay")
      .map((segment) => ({ id: `db-${segment.clientSegmentId}`, clientSegmentId: segment.clientSegmentId })) };
    if (sql.includes("from stay_segments") && sql.includes("for update")) return { rows: [{
      id: "decided-origin-row", clientSegmentId: originId, continuityStatus: "supported_by_visit", preservesManualCorrection: true }] };
    return { rows: [] };
  });
  const server = await replayLocationEvidence({ query } as never, {
    workspaceId: "workspace-private", userId: "user-private", authMode: "provider", scopes: []
  }, { deviceId: fixture.evidence[0].deviceId, algorithmVersion: fixture.config.algorithmVersion, processingAt: fixture.processingAt });
  return { outbound, ids: server.segments.filter((segment) => segment.kind === "commute").map((segment) => segment.clientSegmentId) };
}

describe("Location replay outing support (PRD D19, Codex r3 on #461)", () => {
  it("re-checks an outing leg when a decided stay elsewhere in its outing moved, and drops it when the outing no longer qualifies", async () => {
    const { outbound, ids } = await replayWithDecidedOrigin(false);
    expect(outing.calls).toContainEqual(outbound.outingStayIds);
    expect(ids).not.toContain(outbound.clientSegmentId);
  });

  it("keeps it while the outing, with the decided boundary, still qualifies", async () => {
    const { outbound, ids } = await replayWithDecidedOrigin(true);
    expect(outing.calls).toContainEqual(outbound.outingStayIds);
    expect(ids).toContain(outbound.clientSegmentId);
  });
});
