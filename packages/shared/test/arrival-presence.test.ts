import { describe, expect, it } from "vitest";
import { runLocationEngine } from "../src/location/segmenter";
import { SCHOOL_RUN_HOME_ID, schoolRunArrivalFixture, schoolRunAt as at } from "../src/location/schoolRunArrivalFixture";
import { PHYSICAL_STOP_LATITUDE, PHYSICAL_STOP_PICKUP, physicalStopFixture } from "../src/location/physicalStopFixture";
import type { CommuteSegment, LocationEngineInput, LocationEvidence, StaySegment } from "../src/location/types";

function run(input: LocationEngineInput) {
  const output = runLocationEngine(input);
  return {
    output,
    stays: output.segmentUpserts.filter((s): s is StaySegment => s.kind === "stay"),
    trips: output.segmentUpserts.filter((s): s is CommuteSegment => s.kind === "commute")
  };
}
const homeStays = (stays: StaySegment[]) => stays.filter((stay) => stay.placeId === SCHOOL_RUN_HOME_ID);
function extra(input: LocationEngineInput, item: Partial<LocationEvidence> & { clientEvidenceId: string; occurredAt: string }) {
  const template = input.evidence[0];
  input.evidence.push({ ...template, kind: "standard_location", endedAt: null, savedPlaceId: null, metadata: {},
    sourceTimestamp: item.occurredAt, receivedAt: item.occurredAt, ...item });
}

describe("corroborated arrival presence at saved places", () => {
  it("ends the school-run trip at the Home arrival, not at the next reading 36 minutes later", () => {
    const { stays, trips } = run(schoolRunArrivalFixture("09:30:00"));
    // Before this change: return journey 07:41:57–08:22:56 and Home from 08:22:56.
    expect(trips.some((trip) => trip.stoppedAt === at("08:22:56"))).toBe(false);
    const home = homeStays(stays).find((stay) => stay.startedAt === at("07:43:15"));
    expect(home).toMatchObject({ stoppedAt: null, status: "open" });
    expect(home!.evidenceIds).toEqual(expect.arrayContaining(["arrive-3", "home-later-0", "home-later-4"]));
    // Owner option A: the unsaved school stop sits inside one Home trip.
    expect(trips.filter((trip) => trip.startedAt >= at("07:26:00"))).toEqual([expect.objectContaining({
      startedAt: at("07:26:56"), stoppedAt: at("07:43:15"), qualificationReason: "same_place_meaningful_round_trip",
      stops: [expect.objectContaining({ startedAt: at("07:27:57"), stoppedAt: at("07:41:57") })]
    })]);
  });

  it("recognises the arrival from the Visit and geofence entry before buffered fixes reach the server", () => {
    // At 07:53:30 the server holds the drained Visits and the geofence entry, not the buffered fixes.
    const { stays } = run(schoolRunArrivalFixture("07:53:30"));
    expect(homeStays(stays).find((stay) => stay.startedAt === at("07:43:15"))).toMatchObject({ status: "open", stoppedAt: null });
  });

  it("keeps the old behaviour when the arrival-only Visit is not corroborated", () => {
    const input = schoolRunArrivalFixture("09:30:00", { exclude: ["home-enter", "arrive-0", "arrive-1", "arrive-2", "arrive-3"] });
    const { stays } = run(input);
    expect(homeStays(stays).some((stay) => stay.startedAt === at("07:43:15"))).toBe(false);
  });

  it("does not bridge silence across a Home geofence exit", () => {
    const input = schoolRunArrivalFixture("09:30:00");
    extra(input, { clientEvidenceId: "exit-in-silence", kind: "geofence_exit", occurredAt: at("08:00:00"),
      savedPlaceId: SCHOOL_RUN_HOME_ID, latitude: null, longitude: null, horizontalAccuracyMeters: null });
    const first = homeStays(run(input).stays).find((stay) => stay.startedAt === at("07:43:15"));
    expect(first?.stoppedAt == null || first.stoppedAt <= at("08:00:00")).toBe(true);
    expect(first?.stoppedAt).not.toBeNull();
  });

  it("does not bridge silence across an accurate reading away from Home", () => {
    const input = schoolRunArrivalFixture("09:30:00");
    extra(input, { clientEvidenceId: "away-in-silence", occurredAt: at("08:05:00"), latitude: 900 / 111_195, longitude: 0,
      horizontalAccuracyMeters: 5, speedMetersPerSecond: 12 });
    extra(input, { clientEvidenceId: "away-in-silence-2", occurredAt: at("08:06:00"), latitude: 1_200 / 111_195, longitude: 0,
      horizontalAccuracyMeters: 5, speedMetersPerSecond: 12 });
    const spanning = homeStays(run(input).stays).filter((stay) =>
      stay.startedAt < at("08:05:00") && (stay.stoppedAt == null || stay.stoppedAt > at("08:05:00")));
    expect(spanning).toEqual([]);
  });

  it("lets a completed Visit's reported departure end presence", () => {
    const input = schoolRunArrivalFixture("09:30:00");
    const open = input.evidence.find((item) => item.clientEvidenceId === "home-visit-open")!;
    extra(input, { ...open, clientEvidenceId: "home-visit-done", endedAt: at("07:58:00"), metadata: {} });
    const first = homeStays(run(input).stays).find((stay) => stay.startedAt === at("07:43:15"));
    expect(first?.stoppedAt).toBe(at("07:58:00"));
  });

  it("does not bridge beyond the presence cap", () => {
    const input = schoolRunArrivalFixture("09:30:00", { exclude: ["home-later-0", "home-later-1", "home-later-2", "home-later-3", "home-later-4"] });
    const later = new Date(Date.parse(at("07:46:51")) + input.config.savedPlaceOpenVisitPresenceMaximumMs + 60_000).toISOString();
    extra(input, { clientEvidenceId: "much-later", occurredAt: later, latitude: 0, longitude: 0, horizontalAccuracyMeters: 5 });
    extra(input, { clientEvidenceId: "much-later-2", occurredAt: new Date(Date.parse(later) + 600_000).toISOString(),
      latitude: 0, longitude: 0, horizontalAccuracyMeters: 5 });
    input.processingAt = new Date(Date.parse(later) + 3_600_000).toISOString();
    expect(homeStays(run(input).stays).some((stay) => stay.startedAt === at("07:43:15"))).toBe(false);
  });

  it("does not split a journey at a brief kerbside stop at a saved place", () => {
    // ~1 minute at a saved stop: arrival-only Visit and geofence entry, then driving on.
    const input = physicalStopFixture({ ...PHYSICAL_STOP_PICKUP, visit: null, slowAt: [700_000], departAt: 760_000, returnAt: 844_000 });
    const stopId = "10000000-0000-4000-8000-000000000032";
    input.savedPlaces.push({ id: stopId, name: "Station", latitude: PHYSICAL_STOP_LATITUDE, longitude: 0, radiusMeters: 80 });
    const template = input.evidence.find((item) => item.clientEvidenceId === "slow-0")!;
    input.evidence.push(
      { ...template, clientEvidenceId: "station-visit-open", kind: "visit", occurredAt: template.occurredAt.replace("00:11:40", "00:11:16"),
        speedMetersPerSecond: null, horizontalAccuracyMeters: 20, metadata: { visitDepartureOpen: true } },
      { ...template, clientEvidenceId: "station-enter", kind: "geofence_enter", savedPlaceId: stopId,
        latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null }
    );
    const { stays, trips } = run(input);
    expect(stays.some((stay) => stay.placeId === stopId)).toBe(false);
    expect(trips).toHaveLength(1);
    expect(trips[0].stops).toBeUndefined();
  });
});
