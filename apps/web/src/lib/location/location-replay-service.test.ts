import { describe, expect, it, vi } from "vitest";
import { replayLocationEvidence } from "./location-replay-service";
import { LOCATION_REPLAY_SCALABILITY_PROFILE } from "./location-replay-batching";
import { journeyIdentityFixture, PHYSICAL_STOP_PICKUP, physicalStopAt, physicalStopFixture, runLocationEngine } from "@dayframe/shared";

function journeyReplayQuery(
  fixture: ReturnType<typeof journeyIdentityFixture>,
  protectedRows: Array<Record<string, unknown>> = [],
  existingRows: Array<Record<string, unknown>> = []
) {
  return vi.fn(async (...args: [sql: string, params?: unknown[]]) => {
    const [sql] = args;
    if (sql.includes("from location_evidence\n")) return { rows: fixture.evidence.map((item, index) => ({
      id: `row-${index}`,
      clientEvidenceId: item.clientEvidenceId,
      deviceId: item.deviceId,
      evidenceType: item.kind,
      occurredAt: item.occurredAt,
      endedAt: item.endedAt ?? null,
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      horizontalAccuracyMeters: item.horizontalAccuracyMeters ?? null,
      altitudeMeters: item.altitudeMeters ?? null,
      speedMetersPerSecond: item.speedMetersPerSecond ?? null,
      courseDegrees: item.courseDegrees ?? null,
      savedPlaceId: item.savedPlaceId ?? null,
      geofenceIdentifier: item.geofenceIdentifier ?? null,
      algorithmVersion: item.algorithmVersion,
      timeZone: item.timeZone,
      isSimulated: item.isSimulated ?? null,
      metadata: item.metadata ?? {},
      receivedAt: item.receivedAt
    })) };
    if (sql.includes("from places\n")) return { rows: fixture.savedPlaces };
    if (sql.includes("from learned_places\n")) return { rows: fixture.acceptedLearnedPlaces };
    if (sql.includes("for update of s")) return { rows: protectedRows };
    if (sql.includes("from stay_segments") && sql.includes("for update")) return { rows: existingRows };
    return { rows: [] };
  });
}

describe("Location replay timing observation", () => {
  it("uses the same sanitised Journey-1 output as the shared engine", async () => {
    const fixture = journeyIdentityFixture();
    const local = runLocationEngine(fixture);
    const query = journeyReplayQuery(fixture);
    const server = await replayLocationEvidence({ query } as never, {
      workspaceId: "workspace-private", userId: "user-private", authMode: "provider", scopes: []
    }, {
      deviceId: fixture.evidence[0].deviceId,
      algorithmVersion: fixture.config.algorithmVersion,
      processingAt: fixture.processingAt
    });
    expect(server.segments).toEqual(local.segmentUpserts);
    expect(server.diagnostics).toEqual(local.diagnostics);
  });

  it("holds a changed-ID replacement that overlaps protected accepted or ignored evidence", async () => {
    const fixture = journeyIdentityFixture();
    const local = runLocationEngine(fixture);
    const intermediate = local.segmentUpserts.find((segment) =>
      segment.kind === "stay" && segment.placeId === fixture.savedPlaces[1].id && segment.stoppedAt
    )!;
    const query = journeyReplayQuery(fixture, [{
      clientSegmentId: "previous-decided-home-segment",
      clientEvidenceId: "home-late-1",
      kind: "standard_location",
      occurredAt: "2026-09-23T17:11:00.000Z",
      startedAt: "2026-09-23T16:55:00.000Z",
      stoppedAt: "2026-09-23T17:14:00.000Z"
    }]);
    const server = await replayLocationEvidence({ query } as never, {
      workspaceId: "workspace-private", userId: "user-private", authMode: "provider", scopes: []
    }, {
      deviceId: fixture.evidence[0].deviceId,
      algorithmVersion: fixture.config.algorithmVersion,
      processingAt: fixture.processingAt
    });
    expect(server.segments.some((segment) => segment.clientSegmentId === intermediate.clientSegmentId)).toBe(false);
    expect(server.segments.some((segment) => segment.kind === "commute" &&
      (segment.fromStaySegmentId === intermediate.clientSegmentId || segment.toStaySegmentId === intermediate.clientSegmentId))).toBe(false);
    const protectedRead = query.mock.calls.find(([sql]) => sql.includes("for update of s"))![0];
    expect(protectedRead).toContain("s.created_from_event_id is not null");
    expect(protectedRead).toContain("s.continuity_status = 'manual'");
    expect(protectedRead).toContain("ri.status = 'open'");
  });

  it.each([
    ["manual", false],
    ["terminal accepted or ignored", true]
  ])("preserves an existing %s segment with the same ID", async (_label, preservesManualCorrection) => {
    const fixture = journeyIdentityFixture();
    const intermediate = runLocationEngine(fixture).segmentUpserts.find((segment) =>
      segment.kind === "stay" && segment.placeId === fixture.savedPlaces[1].id && segment.stoppedAt
    )!;
    const query = journeyReplayQuery(fixture, [], [{
      id: "existing-protected-row",
      clientSegmentId: intermediate.clientSegmentId,
      continuityStatus: preservesManualCorrection ? "continuous" : "manual",
      preservesManualCorrection
    }]);
    const server = await replayLocationEvidence({ query } as never, {
      workspaceId: "workspace-private", userId: "user-private", authMode: "provider", scopes: []
    }, {
      deviceId: fixture.evidence[0].deviceId,
      algorithmVersion: fixture.config.algorithmVersion,
      processingAt: fixture.processingAt
    });
    expect(server.stayIds.get(intermediate.clientSegmentId)).toBe("existing-protected-row");
    const writes = query.mock.calls.filter(([sql]) => sql.includes("insert into stay_segments"));
    expect(writes.every(([, params]) => !params?.includes(intermediate.clientSegmentId))).toBe(true);
    const lock = query.mock.calls.find(([sql]) => sql.includes("from stay_segments") && sql.includes("for update") &&
      !sql.includes("for update of s"))![0];
    expect(lock).toContain("created_from_event_id is not null");
    expect(lock).toContain("status = 'open'");
  });

  it("keeps both protected locking arms and owner predicates in one bounded profile request", async () => {
    const query = vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: never[] }>>(async () => ({ rows: [] }));
    await replayLocationEvidence({ query } as never, {
      workspaceId: "workspace-private", userId: "user-private", authMode: "provider", scopes: []
    }, {
      deviceId: "device-private", algorithmVersion: "location-v2.0",
      processingAt: "2026-09-17T10:00:00.000Z", persistenceProfile: LOCATION_REPLAY_SCALABILITY_PROFILE
    });
    const protectedReads = query.mock.calls.filter(([sql]) => sql.includes("for update of s"));
    expect(protectedReads).toHaveLength(1);
    const [sql, params] = protectedReads[0];
    expect(params).toEqual(["workspace-private", "user-private", "device-private", "location-v2.0", []]);
    expect(sql).toContain(" union all ");
    expect(sql.match(/from location_evidence where id = lse.evidence_id offset 0/g)).toHaveLength(2);
    for (const arm of sql.split(" union all ")) {
      expect(arm).toContain("s.workspace_id = $1 and s.user_id = $2 and s.device_id = $3 and s.algorithm_version = $4");
      expect(arm).toContain("le.client_evidence_id = any($5::text[])");
      expect(arm).toContain("s.continuity_status = 'manual' or (s.status <> 'superseded' and s.created_from_event_id is not null");
      expect(arm).toContain("ri.workspace_id = $1 and ri.user_id = $2");
      expect(arm).toContain("ri.location_segment_id = s.id and ri.status = 'open'");
      expect(arm).toContain("order by s.id, le.client_evidence_id for update of s");
    }
    const obsolete = query.mock.calls.find(([sql]) => sql.includes('ri.id as "reviewId"'))![0];
    expect(obsolete).toContain("with eligible_lineage as materialized");
    expect(obsolete).toContain("lse.stay_segment_id = st.id or lse.commute_segment_id = cs.id");
    expect(obsolete.match(/le.accepted = true/g)).toHaveLength(1);
    expect(obsolete.match(/le.expires_at > \$7::timestamptz/g)).toHaveLength(1);
    expect(obsolete).toContain("for update of ri");
  });

  it("reports safe aggregate counts and completed replay stages for an empty snapshot", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const events: string[] = [];
    const counts: Record<string, number> = {};
    await replayLocationEvidence({ query } as never, {
      workspaceId: "workspace-private",
      userId: "user-private",
      authMode: "provider",
      scopes: []
    }, {
      deviceId: "device-private",
      algorithmVersion: "location-v2.0",
      processingAt: "2026-09-17T10:00:00.000Z",
      remainingOperationMs: () => 6000,
      onLocationTiming: event => events.push(`${event.stage}:${event.state}`),
      onLocationCount: (name, value) => { counts[name] = value; }
    });
    expect(events).toEqual(expect.arrayContaining([
      "evidence_read:started", "evidence_read:completed",
      "catalogue_read:started", "catalogue_read:completed",
      "engine_computation:started", "engine_computation:completed",
      "protected_replacement_checks:started", "protected_replacement_checks:completed",
      "obsolete_segment_handling:started", "obsolete_segment_handling:completed",
      "stay_persistence:started", "stay_persistence:completed",
      "commute_persistence:started", "commute_persistence:completed",
      "lineage_deletion:started", "lineage_deletion:completed",
      "lineage_insertion:started", "lineage_insertion:completed"
    ]));
    expect(counts).toMatchObject({ evidenceRows: 0, staySegments: 0, commuteSegments: 0, protectedSegments: 0 });
    expect(JSON.stringify({events,counts})).not.toMatch(/workspace-private|user-private|device-private/);
  });
});

describe("Location replay physical stops", () => {
  it("persists trip stops and stop formation as coordinate-free metadata", async () => {
    const fixture = physicalStopFixture(PHYSICAL_STOP_PICKUP);
    const local = runLocationEngine(fixture);
    const base = journeyReplayQuery(fixture as unknown as ReturnType<typeof journeyIdentityFixture>);
    const stayRows = local.segmentUpserts.filter((segment) => segment.kind === "stay")
      .map((segment) => ({ id: `db-${segment.clientSegmentId}`, clientSegmentId: segment.clientSegmentId }));
    const query = vi.fn(async (sql: string, params?: unknown[]) =>
      sql.includes("insert into stay_segments") ? { rows: stayRows } : base(sql, params));
    const server = await replayLocationEvidence({ query } as never, {
      workspaceId: "workspace-private", userId: "user-private", authMode: "provider", scopes: []
    }, {
      deviceId: fixture.evidence[0].deviceId,
      algorithmVersion: fixture.config.algorithmVersion,
      processingAt: fixture.processingAt
    });
    expect(server.segments).toEqual(local.segmentUpserts);
    const metadataOf = (table: string) => query.mock.calls
      .filter(([sql]) => sql.includes(`insert into ${table}`))
      .flatMap(([, params]) => (params ?? []).filter((value): value is string =>
        typeof value === "string" && value.startsWith("{")).map((value) => JSON.parse(value)));
    const trip = metadataOf("commute_segments").find((metadata) => metadata.stops);
    expect(trip.stops).toHaveLength(1);
    expect(Object.keys(trip.stops[0]).sort()).toEqual([
      "candidatePlaceIds", "startLowerBoundAt", "startUpperBoundAt", "startedAt",
      "staySegmentId", "stopLowerBoundAt", "stopUpperBoundAt", "stoppedAt"
    ]);
    expect(JSON.stringify(trip)).not.toMatch(/latitude|longitude/i);
    expect(metadataOf("stay_segments").filter((metadata) => metadata.formation === "physical_stop")).toHaveLength(1);
  });
});

describe("Location replay protected trip legs", () => {
  it("keeps an unresolved leg when a decided leg blocks the merged trip (review finding 3)", async () => {
    const fixture = physicalStopFixture(PHYSICAL_STOP_PICKUP);
    const local = runLocationEngine(fixture);
    const trip = local.segmentUpserts.find((segment) => segment.kind === "commute" && segment.stops?.length);
    if (trip?.kind !== "commute" || trip.legs?.length !== 2) throw new Error("fixture must produce a trip with two legs");
    const [decided, open] = trip.legs;
    const protectedLink = {
      clientSegmentId: decided.clientSegmentId,
      clientEvidenceId: decided.evidenceIds[1],
      kind: "standard_location",
      occurredAt: fixture.evidence.find((item) => item.clientEvidenceId === decided.evidenceIds[1])!.occurredAt,
      startedAt: decided.startedAt,
      stoppedAt: decided.stoppedAt
    };
    const base = journeyReplayQuery(fixture as unknown as ReturnType<typeof journeyIdentityFixture>, [protectedLink]);
    const stayRows = local.segmentUpserts.filter((segment) => segment.kind === "stay")
      .map((segment) => ({ id: `db-${segment.clientSegmentId}`, clientSegmentId: segment.clientSegmentId }));
    const query = vi.fn(async (sql: string, params?: unknown[]) =>
      sql.includes("insert into stay_segments") ? { rows: stayRows } : base(sql, params));
    const server = await replayLocationEvidence({ query } as never, {
      workspaceId: "workspace-private", userId: "user-private", authMode: "provider", scopes: []
    }, {
      deviceId: fixture.evidence[0].deviceId,
      algorithmVersion: fixture.config.algorithmVersion,
      processingAt: fixture.processingAt
    });
    const commuteIds = server.segments.filter((segment) => segment.kind === "commute").map((segment) => segment.clientSegmentId);
    expect(commuteIds).not.toContain(trip.clientSegmentId);
    expect(commuteIds).toEqual(expect.arrayContaining([decided.clientSegmentId, open.clientSegmentId]));
    const retire = query.mock.calls.find(([sql]) => sql.includes("from review_items ri") && sql.includes("for update of ri"))!;
    expect(retire[1]).toEqual(expect.arrayContaining([expect.arrayContaining([open.clientSegmentId])]));
  });
});

describe("Location replay protected interior stops", () => {
  it.each([
    ["default", undefined],
    ["scalability", LOCATION_REPLAY_SCALABILITY_PROFILE]
  ] as const)("does not persist a trip across a protected interior stop (%s profile; re-review finding)", async (_label, persistenceProfile) => {
    const fixture = physicalStopFixture(PHYSICAL_STOP_PICKUP);
    const local = runLocationEngine(fixture);
    const trip = local.segmentUpserts.find((segment) => segment.kind === "commute" && segment.stops?.length);
    if (trip?.kind !== "commute") throw new Error("fixture must produce a trip with a stop");
    const stop = local.segmentUpserts.find((segment) => segment.clientSegmentId === trip.stops![0].staySegmentId)!;
    const evidenceId = stop.evidenceIds.find((id) => id.startsWith("slow-"))!;
    // An earlier, already-decided stay covering the same stationary time.
    const protectedLink = {
      clientSegmentId: "previously-confirmed-stay",
      clientEvidenceId: evidenceId,
      kind: "standard_location",
      occurredAt: fixture.evidence.find((item) => item.clientEvidenceId === evidenceId)!.occurredAt,
      startedAt: stop.startedAt,
      stoppedAt: stop.stoppedAt
    };
    const base = journeyReplayQuery(fixture as unknown as ReturnType<typeof journeyIdentityFixture>, [protectedLink]);
    const stayRows = local.segmentUpserts.filter((segment) => segment.kind === "stay")
      .map((segment) => ({ id: `db-${segment.clientSegmentId}`, clientSegmentId: segment.clientSegmentId }));
    const query = vi.fn(async (sql: string, params?: unknown[]) =>
      sql.includes("insert into stay_segments") ? { rows: stayRows } : base(sql, params));
    const server = await replayLocationEvidence({ query } as never, {
      workspaceId: "workspace-private", userId: "user-private", authMode: "provider", scopes: []
    }, {
      deviceId: fixture.evidence[0].deviceId,
      algorithmVersion: fixture.config.algorithmVersion,
      processingAt: fixture.processingAt,
      persistenceProfile
    });
    const ids = server.segments.map((segment) => segment.clientSegmentId);
    expect(ids).not.toContain(stop.clientSegmentId);
    expect(ids).not.toContain(trip.clientSegmentId);
    // Legs ending or starting at the protected stop are not replacements either.
    expect(server.segments.some((segment) => segment.kind === "commute" &&
      (segment.fromStaySegmentId === stop.clientSegmentId || segment.toStaySegmentId === stop.clientSegmentId))).toBe(false);
  });
});

describe("Location replay decided interior stops with unchanged IDs", () => {
  it.each([
    ["default", undefined],
    ["scalability", LOCATION_REPLAY_SCALABILITY_PROFILE]
  ] as const)("keeps the decided stop and reconciles fallback legs to its boundaries (%s profile; re-review finding 4)", async (_label, persistenceProfile) => {
    const fixture = physicalStopFixture(PHYSICAL_STOP_PICKUP);
    const local = runLocationEngine(fixture);
    const trip = local.segmentUpserts.find((segment) => segment.kind === "commute" && segment.stops?.length);
    if (trip?.kind !== "commute" || trip.legs?.length !== 2) throw new Error("fixture must produce a trip with two legs");
    const stopId = trip.stops![0].staySegmentId;
    // The decided row keeps its earlier, longer boundaries; late evidence shortened the engine's version.
    const canonical = {
      clientSegmentId: stopId,
      startedAt: physicalStopAt(670_000), stoppedAt: physicalStopAt(1_230_000),
      startLowerBoundAt: physicalStopAt(665_000), startUpperBoundAt: physicalStopAt(672_000),
      stopLowerBoundAt: physicalStopAt(1_225_000), stopUpperBoundAt: physicalStopAt(1_235_000)
    };
    const base = journeyReplayQuery(fixture as unknown as ReturnType<typeof journeyIdentityFixture>, [], [{
      id: "decided-stop-row", clientSegmentId: stopId, continuityStatus: "supported_by_visit", preservesManualCorrection: true
    }]);
    const stayRows = local.segmentUpserts.filter((segment) => segment.kind === "stay" && segment.clientSegmentId !== stopId)
      .map((segment) => ({ id: `db-${segment.clientSegmentId}`, clientSegmentId: segment.clientSegmentId }));
    const query = vi.fn(async (sql: string, params?: unknown[]) =>
      sql.includes("decided stay bounds") ? { rows: [canonical] }
        : sql.includes("insert into stay_segments") ? { rows: stayRows } : base(sql, params));
    const server = await replayLocationEvidence({ query } as never, {
      workspaceId: "workspace-private", userId: "user-private", authMode: "provider", scopes: []
    }, {
      deviceId: fixture.evidence[0].deviceId,
      algorithmVersion: fixture.config.algorithmVersion,
      processingAt: fixture.processingAt,
      persistenceProfile
    });
    const commutes = server.segments.filter((segment) => segment.kind === "commute");
    expect(commutes.map((segment) => segment.clientSegmentId)).not.toContain(trip.clientSegmentId);
    const [into, outOf] = trip.legs;
    // Rebuilt within the decided boundaries: only evidence inside them, re-qualified.
    expect(commutes.find((segment) => segment.clientSegmentId === into.clientSegmentId)).toMatchObject({
      startedAt: into.startedAt, stoppedAt: canonical.startedAt,
      stopLowerBoundAt: canonical.startLowerBoundAt, stopUpperBoundAt: canonical.startUpperBoundAt,
      evidenceIds: ["out-0", "out-1", "out-2"], routeSampleCount: 3
    });
    expect(commutes.find((segment) => segment.clientSegmentId === outOf.clientSegmentId)).toMatchObject({
      startedAt: canonical.stoppedAt, stoppedAt: outOf.stoppedAt,
      startLowerBoundAt: canonical.stopLowerBoundAt, startUpperBoundAt: canonical.stopUpperBoundAt,
      evidenceIds: ["back-0", "back-1", "back-2"], routeSampleCount: 3
    });
    expect(server.stayIds.get(stopId)).toBe("decided-stop-row");
  });

  it.each([
    ["default", undefined],
    ["scalability", LOCATION_REPLAY_SCALABILITY_PROFILE]
  ] as const)("omits a fallback leg that no longer qualifies inside the decided boundaries (%s profile; re-review finding 3)", async (_label, persistenceProfile) => {
    const fixture = physicalStopFixture(PHYSICAL_STOP_PICKUP);
    const local = runLocationEngine(fixture);
    const trip = local.segmentUpserts.find((segment) => segment.kind === "commute" && segment.stops?.length);
    if (trip?.kind !== "commute" || trip.legs?.length !== 2) throw new Error("fixture must produce a trip with two legs");
    const stopId = trip.stops![0].staySegmentId;
    // The decided arrival leaves a 30-second inbound leg with a single route fix.
    const canonical = {
      clientSegmentId: stopId, startedAt: physicalStopAt(630_000), stoppedAt: physicalStopAt(1_230_000),
      startLowerBoundAt: null, startUpperBoundAt: null, stopLowerBoundAt: null, stopUpperBoundAt: null
    };
    const base = journeyReplayQuery(fixture as unknown as ReturnType<typeof journeyIdentityFixture>, [], [{
      id: "decided-stop-row", clientSegmentId: stopId, continuityStatus: "supported_by_visit", preservesManualCorrection: true
    }]);
    const stayRows = local.segmentUpserts.filter((segment) => segment.kind === "stay" && segment.clientSegmentId !== stopId)
      .map((segment) => ({ id: `db-${segment.clientSegmentId}`, clientSegmentId: segment.clientSegmentId }));
    const query = vi.fn(async (sql: string, params?: unknown[]) =>
      sql.includes("decided stay bounds") ? { rows: [canonical] }
        : sql.includes("insert into stay_segments") ? { rows: stayRows } : base(sql, params));
    const server = await replayLocationEvidence({ query } as never, {
      workspaceId: "workspace-private", userId: "user-private", authMode: "provider", scopes: []
    }, {
      deviceId: fixture.evidence[0].deviceId,
      algorithmVersion: fixture.config.algorithmVersion,
      processingAt: fixture.processingAt,
      persistenceProfile
    });
    const ids = server.segments.filter((segment) => segment.kind === "commute").map((segment) => segment.clientSegmentId);
    expect(ids).not.toContain(trip.legs[0].clientSegmentId);
    expect(ids).not.toContain(trip.clientSegmentId);
    expect(ids).toContain(trip.legs[1].clientSegmentId);
  });
});

describe("Location replay decided commute endpoints", () => {
  // A visit-length stop is its own Review, so its journeys are standalone commutes.
  const LONG_STOP = { visit: [670_000, 2_200_000] as [number, number],
    slowAt: [700_000, 900_000, 1_300_000, 1_700_000, 2_100_000, 2_180_000], departAt: 2_200_000, returnAt: 2_288_000 };

  async function replayWithDecided(fixture: ReturnType<typeof physicalStopFixture>, decidedId: string,
    canonical: Record<string, string | null | undefined>, persistenceProfile?: typeof LOCATION_REPLAY_SCALABILITY_PROFILE) {
    const local = runLocationEngine(fixture);
    const base = journeyReplayQuery(fixture as unknown as ReturnType<typeof journeyIdentityFixture>, [], [{
      id: "decided-row", clientSegmentId: decidedId, continuityStatus: "supported_by_visit", preservesManualCorrection: true
    }]);
    const stayRows = local.segmentUpserts.filter((segment) => segment.kind === "stay" && segment.clientSegmentId !== decidedId)
      .map((segment) => ({ id: `db-${segment.clientSegmentId}`, clientSegmentId: segment.clientSegmentId }));
    const query = vi.fn(async (sql: string, params?: unknown[]) =>
      sql.includes("decided stay bounds") ? { rows: [{ clientSegmentId: decidedId, ...canonical }] }
        : sql.includes("insert into stay_segments") ? { rows: stayRows } : base(sql, params));
    const server = await replayLocationEvidence({ query } as never, {
      workspaceId: "workspace-private", userId: "user-private", authMode: "provider", scopes: []
    }, {
      deviceId: fixture.evidence[0].deviceId,
      algorithmVersion: fixture.config.algorithmVersion,
      processingAt: fixture.processingAt,
      persistenceProfile
    });
    return { local, server, commutes: server.segments.filter((segment) => segment.kind === "commute") };
  }

  it.each([
    ["default", undefined],
    ["scalability", LOCATION_REPLAY_SCALABILITY_PROFILE]
  ] as const)("re-derives standalone commutes to a decided stop's persisted boundaries (%s profile; re-review finding)", async (_label, persistenceProfile) => {
    const fixture = physicalStopFixture(LONG_STOP);
    const engine = runLocationEngine(fixture).segmentUpserts;
    const stop = engine.find((segment) => segment.kind === "stay" && segment.placeMatchKind === "unknown");
    const legs = engine.filter((segment) => segment.kind === "commute");
    if (!stop || legs.length !== 2 || legs.some((leg) => leg.kind === "commute" && leg.legs?.length)) {
      throw new Error("fixture must produce a standalone stop between two standalone commutes");
    }
    // The decided row keeps its earlier, longer boundaries; late evidence shortened the engine's version.
    const canonical = {
      startedAt: physicalStopAt(665_000), stoppedAt: physicalStopAt(2_205_000),
      startLowerBoundAt: physicalStopAt(660_000), startUpperBoundAt: physicalStopAt(668_000),
      stopLowerBoundAt: physicalStopAt(2_202_000), stopUpperBoundAt: physicalStopAt(2_208_000)
    };
    const { server, commutes } = await replayWithDecided(fixture, stop.clientSegmentId, canonical, persistenceProfile);
    const [into, onward] = legs;
    expect(commutes.find((segment) => segment.clientSegmentId === into.clientSegmentId)).toMatchObject({
      startedAt: into.startedAt, stoppedAt: canonical.startedAt,
      stopLowerBoundAt: canonical.startLowerBoundAt, stopUpperBoundAt: canonical.startUpperBoundAt,
      evidenceIds: ["out-0", "out-1", "out-2"]
    });
    expect(commutes.find((segment) => segment.clientSegmentId === onward.clientSegmentId)).toMatchObject({
      startedAt: canonical.stoppedAt, stoppedAt: onward.stoppedAt,
      startLowerBoundAt: canonical.stopLowerBoundAt, startUpperBoundAt: canonical.stopUpperBoundAt,
      evidenceIds: ["back-0", "back-1", "back-2"]
    });
    expect(server.stayIds.get(stop.clientSegmentId)).toBe("decided-row");
  });

  it("leaves a commute unchanged when the decided endpoint's boundaries have not moved", async () => {
    const fixture = physicalStopFixture(LONG_STOP);
    const engine = runLocationEngine(fixture).segmentUpserts;
    const stop = engine.find((segment) => segment.kind === "stay" && segment.placeMatchKind === "unknown")!;
    const { commutes } = await replayWithDecided(fixture, stop.clientSegmentId, {
      startedAt: stop.startedAt, stoppedAt: stop.stoppedAt,
      startLowerBoundAt: stop.startLowerBoundAt, startUpperBoundAt: stop.startUpperBoundAt,
      stopLowerBoundAt: stop.stopLowerBoundAt, stopUpperBoundAt: stop.stopUpperBoundAt
    });
    expect(commutes).toEqual(engine.filter((segment) => segment.kind === "commute"));
  });

  it.each([
    ["default", undefined],
    ["scalability", LOCATION_REPLAY_SCALABILITY_PROFILE]
  ] as const)("falls back to re-derived legs when a trip's decided outer endpoint has moved (%s profile)", async (_label, persistenceProfile) => {
    const fixture = physicalStopFixture(PHYSICAL_STOP_PICKUP);
    const trip = runLocationEngine(fixture).segmentUpserts.find((segment) => segment.kind === "commute" && segment.stops?.length);
    if (trip?.kind !== "commute" || trip.legs?.length !== 2) throw new Error("fixture must produce a trip with two legs");
    // The decided Home row starts 18 s before the engine's estimate.
    const canonical = {
      startedAt: physicalStopAt(1_290_000), stoppedAt: physicalStopAt(1_908_000),
      startLowerBoundAt: physicalStopAt(1_285_000), startUpperBoundAt: physicalStopAt(1_295_000),
      stopLowerBoundAt: null, stopUpperBoundAt: null
    };
    const { commutes } = await replayWithDecided(fixture, trip.toStaySegmentId, canonical, persistenceProfile);
    const ids = commutes.map((segment) => segment.clientSegmentId);
    expect(ids).not.toContain(trip.clientSegmentId);
    expect(commutes.find((segment) => segment.clientSegmentId === trip.legs![0].clientSegmentId)).toMatchObject({
      startedAt: trip.legs[0].startedAt, stoppedAt: trip.legs[0].stoppedAt });
    expect(commutes.find((segment) => segment.clientSegmentId === trip.legs![1].clientSegmentId)).toMatchObject({
      stoppedAt: canonical.startedAt, stopLowerBoundAt: canonical.startLowerBoundAt, stopUpperBoundAt: canonical.startUpperBoundAt });
  });

  it.each([
    ["default", undefined],
    ["scalability", LOCATION_REPLAY_SCALABILITY_PROFILE]
  ] as const)("never rewrites a stop-bearing trip without qualified legs as a stopless commute (%s profile; re-review finding)", async (_label, persistenceProfile) => {
    // Thinned routes: the whole trip qualifies, but neither leg qualifies alone.
    const fixture = physicalStopFixture(PHYSICAL_STOP_PICKUP);
    fixture.evidence = fixture.evidence.filter((item) => !["out-1", "back-1", "back-2"].includes(item.clientEvidenceId));
    const trip = runLocationEngine(fixture).segmentUpserts.find((segment) => segment.kind === "commute");
    if (trip?.kind !== "commute" || !trip.stops?.length || trip.legs?.length) throw new Error("fixture must produce a trip with a stop and no qualified legs");
    const home = runLocationEngine(fixture).segmentUpserts.find((segment) => segment.clientSegmentId === trip.fromStaySegmentId)!;
    // The decided Home row ends five seconds after the engine's estimate.
    const canonical = {
      startedAt: home.startedAt, stoppedAt: physicalStopAt(605_000),
      startLowerBoundAt: home.startLowerBoundAt, startUpperBoundAt: home.startUpperBoundAt,
      stopLowerBoundAt: physicalStopAt(602_000), stopUpperBoundAt: physicalStopAt(608_000)
    };
    const { commutes } = await replayWithDecided(fixture, trip.fromStaySegmentId, canonical, persistenceProfile);
    // Conservative: no trip across the moved endpoint, and never the aggregate without its stop.
    expect(commutes).toEqual([]);
  });
});
