import { describe, expect, it } from "vitest";
import type { LocationTimeline } from "./timeline";
import { locationListRows } from "./timelineRows";

// Calendar › List location rows (owner, 28 Oct 2026). Synthetic ids, made-up names.
const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 27, hour, minute)).toISOString();
const office = { kind: "place" as const, id: "seg-office", status: "finalised" as const, startedAt: at(9), stoppedAt: at(10), placeId: "p-office",
  learnedPlaceId: null, name: "Office", role: null, matchKind: "saved" as const, confidence: "high" as const, blockIds: [] };
const timeline: LocationTimeline = { date: "2026-10-27", timeZone: "UTC", dayStart: at(0), dayEnd: at(24), gaps: [], openTrip: null, items: [office] };
const check = { id: "q-office", segmentId: "seg-office", startedAt: at(9), stoppedAt: at(10) };
const meeting = [{ startedAt: at(9), stoppedAt: at(10) }];

describe("locationListRows hideCovered (Codex r1 on #609)", () => {
  it("hides a place your blocks cover even when it asks, and asks its \"?\" on a row of its own, once", () => {
    for (const showAll of [false, true]) {
      const rows = locationListRows(timeline, meeting, { nowMs: Date.parse(at(12)), showAll, checks: [check], hideCovered: true });
      expect(rows.map((row) => row.kind === "check" ? `check:${row.checkId}` : row.kind)).toEqual(["check:q-office"]);
      // It keeps its place, so the row opens the place's dialog (Codex r2 on #609).
      expect(rows[0]).toMatchObject({ kind: "check", startedAt: at(9), stoppedAt: at(10), trip: null, place: office });
    }
  });

  it("keeps the \"?\" on the place's row while the place isn't covered", () => {
    const rows = locationListRows(timeline, [], { nowMs: Date.parse(at(12)), showAll: false, checks: [check], hideCovered: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "place", checkIds: ["q-office"] });
  });

  it("without hideCovered, a covered place that asks is still its row", () => {
    const rows = locationListRows(timeline, meeting, { nowMs: Date.parse(at(12)), showAll: false, checks: [check] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "place", checkIds: ["q-office"] });
  });
});
