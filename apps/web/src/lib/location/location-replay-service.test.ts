import { describe, expect, it, vi } from "vitest";
import { replayLocationEvidence } from "./location-replay-service";
import { LOCATION_REPLAY_SCALABILITY_PROFILE } from "./location-replay-batching";

describe("Location replay timing observation", () => {
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
