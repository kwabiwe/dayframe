import { describe, expect, it, vi } from "vitest";
import { replayLocationEvidence } from "./location-replay-service";

describe("Location replay timing observation", () => {
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
