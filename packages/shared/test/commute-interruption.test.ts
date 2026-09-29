import { describe, expect, it } from "vitest";
import {
  qualifyConfirmedCommuteInterruption,
  type RetainedCommuteRoutePoint
} from "../src/location/commuteInterruption";

// Relative coordinates and IDs are synthetic. The 39m52s Home loop and
// two-sided interruption reflect the reported 25 September B case; no owner
// location export is embedded in this fixture.
const base = {
  startedAt: "2026-09-25T07:00:00.000Z",
  stoppedAt: "2026-09-25T07:39:52.000Z",
  stopStartedAt: "2026-09-25T07:13:00.000Z",
  stopEndedAt: "2026-09-25T07:26:00.000Z",
  fromStayPoint: { latitude: 0, longitude: 0 },
  toStayPoint: { latitude: 0, longitude: 0 }
};

function route(id: string, minute: number, longitude: number, overrides: Partial<RetainedCommuteRoutePoint> = {}): RetainedCommuteRoutePoint {
  return {
    evidenceId: id,
    occurredAt: new Date(Date.parse(base.startedAt) + minute * 60_000).toISOString(),
    latitude: 0,
    longitude,
    accuracyMeters: 12,
    kind: "standard_location",
    role: "route",
    isSimulated: false,
    ...overrides
  };
}

const positive = [
  route("in-1", 3, 0.004), route("in-2", 6, 0.010), route("in-3", 10, 0.018),
  route("out-1", 28, 0.018), route("out-2", 32, 0.010), route("out-3", 36, 0.004)
];

const qualify = (routePoints: RetainedCommuteRoutePoint[], change: Partial<Omit<typeof base, "fromStayPoint" | "toStayPoint">> & {
  fromStayPoint?: typeof base.fromStayPoint | null;
  toStayPoint?: typeof base.toStayPoint | null;
} = {}) =>
  qualifyConfirmedCommuteInterruption({ ...base, ...change, routePoints });

describe("user-confirmed commute interruption", () => {
  it("keeps two independently proven legs around a user-supplied interruption", () => {
    const result = qualify(positive);
    expect(result.qualifies).toBe(true);
    if (!result.qualifies) return;
    expect(result.inbound.evidenceIds).toEqual(["in-1", "in-2", "in-3"]);
    expect(result.outbound.evidenceIds).toEqual(["out-1", "out-2", "out-3"]);
    expect(result.inbound.stoppedAt).toBe(base.stopStartedAt);
    expect(result.outbound.startedAt).toBe(base.stopEndedAt);
  });

  it.each([
    ["one inbound point", [positive[0], ...positive.slice(3)]],
    ["one outbound point", [...positive.slice(0, 3), positive[3]]],
    ["only two inbound points", [positive[0], positive[2], ...positive.slice(3)]],
    ["mirrored inbound observations", [positive[0], route("mirror", 6, 0.004), ...positive.slice(3)]],
    ["same-time callback", [positive[0], route("same-time", 3, 0.010), positive[2], ...positive.slice(3)]],
    ["implausible GPS jump", [positive[0], route("jump", 3 + 1 / 60, 0.017), positive[2], ...positive.slice(3)]],
    ["slow traffic or road queue without inbound displacement", [
      route("queue-1", 3, 0.001), route("queue-2", 7, 0.0015), route("queue-3", 10, 0.002), ...positive.slice(3)
    ]],
    ["GPS drift without observed movement", [
      route("drift-1", 3, 0.018), route("drift-2", 6, 0.0181), route("drift-3", 10, 0.0182), ...positive.slice(3)
    ]],
    ["broad Visit only", [positive[0], positive[1], route("visit", 10, 0.018, { kind: "visit" }), ...positive.slice(3)]],
    ["geofence restoration", [positive[0], positive[1], route("geofence", 10, 0.018, { kind: "geofence_state" }), ...positive.slice(3)]],
    ["poor accuracy", [route("poor-1", 3, 0.004, { accuracyMeters: 180 }), route("poor-2", 6, 0.018, { accuracyMeters: 180 }), ...positive.slice(3)]],
    ["simulated route", [route("sim-1", 3, 0.004, { isSimulated: true }), route("sim-2", 6, 0.018, { isSimulated: true }), ...positive.slice(3)]],
    ["unknown simulation flag", [positive[0], route("unknown", 6, 0.010, { isSimulated: null }), positive[2], ...positive.slice(3)]]
  ])("rejects %s when a leg lacks retained route proof", (_name, points) => {
    expect(qualify(points).qualifies).toBe(false);
  });

  it("keeps both valid legs while excluding an unlinked middle observation", () => {
    const result = qualify([...positive.slice(0, 3), route("middle", 20, 0.02), ...positive.slice(3)]);
    expect(result.qualifies).toBe(true);
    if (!result.qualifies) return;
    expect(result.inbound.evidenceIds).toEqual(["in-1", "in-2", "in-3"]);
    expect(result.outbound.evidenceIds).toEqual(["out-1", "out-2", "out-3"]);
    expect([...result.inbound.evidenceIds, ...result.outbound.evidenceIds]).not.toContain("middle");
  });

  it("rejects a long quiet gap inside either proposed leg", () => {
    expect(qualify(positive, { stopStartedAt: "2026-09-25T07:24:00.000Z" }).qualifies).toBe(false);
  });

  it("rejects overlapping or out-of-parent stop times", () => {
    expect(qualify(positive, { stopStartedAt: base.stopEndedAt }).qualifies).toBe(false);
    expect(qualify(positive, { stopEndedAt: base.stoppedAt }).qualifies).toBe(false);
  });

  it("requires real stay endpoints without creating a hidden stay", () => {
    expect(qualify(positive, { fromStayPoint: null }).qualifies).toBe(false);
  });
});
