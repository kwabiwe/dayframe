import { describe, expect, it, vi } from "vitest";
import type { CommuteSegment, LocationSegment, StaySegment } from "@dayframe/shared";
import { chooseAutoLoggedMoves, logTripsAutomatically, moveEndsKnown, optedOutMoves } from "./location-auto-moves";

const session = { workspaceId: "00000000-0000-4000-8000-000000000010", userId: "00000000-0000-4000-8000-000000000001" } as never;
const instant = (minutes: number) => new Date(Date.parse("2026-10-14T07:00:00Z") + minutes * 60_000).toISOString();
const stay = (id: string, patch: Partial<StaySegment> = {}) => ({
  kind: "stay", clientSegmentId: id, placeMatchKind: "unknown", placeId: null, learnedPlaceId: null, ...patch
}) as unknown as StaySegment;
// A clear Move between two saved places: medium_high, a mode, route readings, tight bounds.
const move = (id: string, patch: Partial<CommuteSegment> = {}): CommuteSegment => ({
  kind: "commute", clientSegmentId: id, algorithmVersion: "location-v2.0", status: "finalised",
  startedAt: instant(0), stoppedAt: instant(20), startLowerBoundAt: instant(0), startUpperBoundAt: instant(0),
  stopLowerBoundAt: instant(20), stopUpperBoundAt: instant(20), fromStaySegmentId: "home", toStaySegmentId: "work",
  fromPlaceId: "place-home", toPlaceId: "place-work", routeSampleCount: 5, gapDurationSeconds: 1_200,
  maximumObservationGapSeconds: 120, continuityStatus: "continuous", confidence: "medium_high",
  qualificationReason: "significant_endpoint_displacement", travelMode: "automotive", evidenceIds: [], ...patch
});
const context = (patch: Partial<Parameters<typeof chooseAutoLoggedMoves>[3]> = {}) => ({
  stays: new Map<string, LocationSegment>(), prior: new Set<string>(), freshAgain: new Set<string>(), optedOut: new Set<string>(),
  orphanEntryIds: [] as string[], enabled: true, ...patch
});

describe("chooseAutoLoggedMoves (PRD D19, A3/A4)", () => {
  it("logs a clear Move and gives every other Move the reason its card shows", async () => {
    const reasons: Record<string, string> = { overlapping: "overlap", "logged-elsewhere": "logged", "offered-elsewhere": "offered" };
    const query = vi.fn(async (_sql: string, params: unknown[]) => ({
      rows: (JSON.parse(params[2] as string) as Array<{ key: string }>).map(({ key }) => ({ key, reason: reasons[key] ?? null }))
    }));
    const candidates = [
      ["clear", move("clear")], ["no-mode", move("no-mode", { travelMode: undefined })], ["unknown-end", move("unknown-end", { toPlaceId: null })],
      ["decided", move("decided")], ["returned", move("returned")], ["stopped", move("stopped")], ["overlapping", move("overlapping")],
      // Under another ID: a Move here already logged itself and is a decision, or a card was offered here (Codex r1 on #462).
      ["logged-elsewhere", move("logged-elsewhere")], ["offered-elsewhere", move("offered-elsewhere")]
    ].map(([clientEventId, segment]) => ({ clientEventId: clientEventId as string, segment: segment as LocationSegment }));
    const result = await chooseAutoLoggedMoves({ query } as never, session, candidates, context({
      prior: new Set(["decided", "returned"]), freshAgain: new Set(["returned"]), optedOut: new Set(["stopped"]), orphanEntryIds: ["orphan-entry"]
    }));
    expect([...result.logged].sort()).toEqual(["clear", "returned"]);
    expect(Object.fromEntries(result.fallback)).toEqual({
      "no-mode": "travel_mode_unknown", "unknown-end": "untrusted_commute_endpoints", decided: "auto_log_offered_before",
      stopped: "trip_logging_opted_out", overlapping: "auto_log_overlap",
      "logged-elsewhere": "trip_logged_before", "offered-elsewhere": "auto_log_offered_before"
    });
    // One bounded read for the eligible Moves; a retired Move's own block never counts as overlap.
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1][3]).toEqual(["orphan-entry"]);
    expect(query.mock.calls[0][1][4]).toBe(300);
    expect(query.mock.calls[0][0]).toContain("te.stopped_at is null");
    expect(query.mock.calls[0][1][5]).toBe(true);
  });

  it("keeps every clear Move in Review with the switch off, reading nothing", async () => {
    const query = vi.fn();
    const result = await chooseAutoLoggedMoves({ query } as never, session, [{ clientEventId: "clear", segment: move("clear") }], context({ enabled: false }));
    expect(result.logged.size).toBe(0);
    expect(result.fallback.get("clear")).toBe("log_trips_off");
    expect(query).not.toHaveBeenCalled();
  });

  it("knows an end by its saved place or the Stay's saved or accepted learned place", () => {
    const stays = new Map<string, LocationSegment>([
      ["learned", stay("learned", { placeMatchKind: "learned", learnedPlaceId: "learned-1" })],
      ["unknown", stay("unknown")]
    ]);
    expect(moveEndsKnown(move("a"), stays)).toBe(true);
    expect(moveEndsKnown(move("b", { fromPlaceId: null, fromStaySegmentId: "learned" }), stays)).toBe(true);
    expect(moveEndsKnown(move("c", { fromPlaceId: null, fromStaySegmentId: "unknown" }), stays)).toBe(false);
  });

  it("reads the switch as off where the column is not there yet", async () => {
    const query = vi.fn(async () => ({ rows: [{ value: null }] }));
    expect(await logTripsAutomatically({ query } as never, session)).toBe(false);
    expect((query.mock.calls[0] as unknown[])[0]).toContain("to_jsonb(u)");
  });

  it("finds the Moves whose pattern the person stopped logging", async () => {
    const query = vi.fn(async () => ({ rows: [{ key: "pattern-stopped" }] }));
    const patterns = new Map([["m1", { key: "pattern-stopped" }], ["m2", { key: "pattern-other" }], ["s1", { key: "pattern-stopped" }]]);
    const stopped = await optedOutMoves({ query } as never, session, patterns, new Set(["m1", "m2"]));
    expect([...stopped]).toEqual(["m1"]);
    expect((query.mock.calls[0] as unknown[])[1]).toEqual([expect.any(String), expect.any(String), ["pattern-other", "pattern-stopped"]]);
  });
});
