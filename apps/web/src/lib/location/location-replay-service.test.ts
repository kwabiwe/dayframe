import { describe, expect, it, vi } from "vitest";
import { replayLocationEvidence } from "./location-replay-service";
import { LOCATION_REPLAY_SCALABILITY_PROFILE } from "./location-replay-batching";
import { journeyIdentityFixture, PHYSICAL_STOP_PICKUP, physicalStopFixture, runLocationEngine } from "@dayframe/shared";

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
