import { describe, expect, it } from "vitest";
import { runLocationEngine } from "../src/location/segmenter";
import { SCHOOL_RUN_HOME_ID, schoolRunArrivalFixture, schoolRunAt as at } from "../src/location/schoolRunArrivalFixture";
import { PHYSICAL_STOP_LATITUDE, PHYSICAL_STOP_PICKUP, physicalStopFixture } from "../src/location/physicalStopFixture";
import { GYM_VISIT_PLACE_ID, gymVisitAt, gymVisitDepartureFixture } from "../src/location/gymVisitDepartureFixture";
import { input as qualityInput, place as qualityPlace, signal } from "../src/location/savedPlaceQualityFixture";
import { SCHOOL_VISIT_HOME_ID, SCHOOL_VISIT_SCHOOL_ID, schoolVisitAt, schoolVisitFixture } from "../src/location/schoolVisitFixture";
import { assessAutomaticLocation } from "../src/location/automaticPolicy";
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

  it("suspends clock-based presence while an outside reading is unresolved (review finding 1)", () => {
    const input = schoolRunArrivalFixture("09:30:00", { exclude: ["home-later-0", "home-later-1", "home-later-2", "home-later-3", "home-later-4"] });
    extra(input, { clientEvidenceId: "away-once", occurredAt: at("07:50:00"), latitude: 1_100 / 111_195, longitude: 0,
      horizontalAccuracyMeters: 5, speedMetersPerSecond: 15 });
    const { stays, trips } = run(input);
    expect(homeStays(stays).some((stay) => stay.startedAt === at("07:43:15"))).toBe(false);
    expect(trips.some((trip) => trip.stoppedAt === at("07:43:15"))).toBe(false);
  });

  it("keeps a recognised arrival through a quiet departure, ending at the exit (review finding 2)", () => {
    const input = schoolRunArrivalFixture("09:30:00", { exclude: ["home-later-0", "home-later-1", "home-later-2", "home-later-3", "home-later-4"] });
    extra(input, { clientEvidenceId: "home-exit-later", kind: "geofence_exit", occurredAt: at("08:10:00"),
      savedPlaceId: SCHOOL_RUN_HOME_ID, latitude: null, longitude: null, horizontalAccuracyMeters: null });
    extra(input, { clientEvidenceId: "leave-0", occurredAt: at("08:10:20"), latitude: 1_000 / 111_195, longitude: 0,
      horizontalAccuracyMeters: 5, speedMetersPerSecond: 12 });
    extra(input, { clientEvidenceId: "leave-1", occurredAt: at("08:10:40"), latitude: 1_500 / 111_195, longitude: 0,
      horizontalAccuracyMeters: 5, speedMetersPerSecond: 13 });
    const { stays, trips } = run(input);
    expect(homeStays(stays).find((stay) => stay.startedAt === at("07:43:15"))).toMatchObject({
      stoppedAt: at("08:10:00"), stopLowerBoundAt: at("07:46:51"), stopUpperBoundAt: at("08:10:00")
    });
    expect(trips.some((trip) => trip.startedAt === at("07:26:56") && trip.stoppedAt === at("07:43:15"))).toBe(true);
  });

  it("bounds presence at the earliest credible departure before judging dwell (re-review finding 1)", () => {
    const input = schoolRunArrivalFixture("09:30:00", { exclude: ["home-later-0", "home-later-1", "home-later-2", "home-later-3", "home-later-4"] });
    const workId = "10000000-0000-4000-8000-000000000033";
    input.savedPlaces.push({ id: workId, name: "Work", latitude: 2_000 / 111_195, longitude: 0, radiusMeters: 100 });
    extra(input, { clientEvidenceId: "away-moving", occurredAt: at("07:48:00"), latitude: 1_100 / 111_195, longitude: 0,
      horizontalAccuracyMeters: 5, speedMetersPerSecond: 15 });
    extra(input, { clientEvidenceId: "at-work", occurredAt: at("07:51:00"), latitude: 2_000 / 111_195, longitude: 0,
      horizontalAccuracyMeters: 5, speedMetersPerSecond: 0 });
    extra(input, { clientEvidenceId: "at-work-2", occurredAt: at("07:58:00"), latitude: 2_000 / 111_195, longitude: 0,
      horizontalAccuracyMeters: 5, speedMetersPerSecond: 0 });
    // Departure was evident at 07:48, so Home lasted under five minutes, as on main.
    expect(homeStays(run(input).stays).some((stay) => stay.startedAt === at("07:43:15"))).toBe(false);
  });

  it("does not corroborate an arrival with evidence from a separate earlier episode (re-review finding 2)", () => {
    const input = schoolRunArrivalFixture("09:30:00", { exclude: [] });
    const workId = "10000000-0000-4000-8000-000000000034";
    input.savedPlaces.push({ id: workId, name: "Work", latitude: 2_000 / 111_195, longitude: 0, radiusMeters: 100 });
    const template = input.evidence.find((item) => item.clientEvidenceId === "home-visit-open")!;
    const day = "2026-01-13";
    const point = (id: string, time: string, metres: number) => ({ ...template, clientEvidenceId: id, kind: "standard_location" as const,
      occurredAt: `${day}T${time}.000Z`, sourceTimestamp: `${day}T${time}.000Z`, receivedAt: `${day}T${time}.000Z`,
      latitude: metres / 111_195, horizontalAccuracyMeters: 5, speedMetersPerSecond: 0, metadata: {} });
    input.evidence = [
      point("home-early", "00:00:00", 5),
      point("work-1", "00:01:00", 2_000), point("work-2", "00:02:00", 2_000),
      { ...point("home-visit-bare", "00:04:00", 19), kind: "visit" as const, speedMetersPerSecond: null,
        horizontalAccuracyMeters: 15, metadata: { visitDepartureOpen: true } },
      point("work-3", "00:09:00", 2_000), point("work-4", "00:09:30", 2_000), point("work-5", "00:20:00", 2_000)
    ];
    input.processingAt = `${day}T01:00:00.000Z`;
    const stays = run(input).stays;
    expect(homeStays(stays).some((stay) => stay.startedAt === `${day}T00:04:00.000Z`)).toBe(false);
  });

  function crossEpisodeInput(intervening: "visit" | "none", freshHome: boolean) {
    const input = schoolRunArrivalFixture("09:30:00");
    const workId = "10000000-0000-4000-8000-000000000035";
    input.savedPlaces.push({ id: workId, name: "Work", latitude: 2_000 / 111_195, longitude: 0, radiusMeters: 100 });
    const template = input.evidence.find((item) => item.clientEvidenceId === "home-visit-open")!;
    const day = "2026-01-14";
    const time = (value: string) => `${day}T${value}.000Z`;
    const point = (id: string, value: string, metres: number) => ({ ...template, clientEvidenceId: id, kind: "standard_location" as const,
      occurredAt: time(value), sourceTimestamp: time(value), receivedAt: time(value), endedAt: null,
      latitude: metres / 111_195, horizontalAccuracyMeters: 5, speedMetersPerSecond: 0, metadata: {} });
    input.evidence = [
      point("home-a", "00:00:00", 5),
      ...(intervening === "visit" ? [{ ...point("work-visit", "00:01:00", 2_000), kind: "visit" as const,
        endedAt: time("00:03:00"), speedMetersPerSecond: null, horizontalAccuracyMeters: 20 }] : []),
      { ...point("home-visit-bare", "00:04:00", 19), kind: "visit" as const, speedMetersPerSecond: null,
        horizontalAccuracyMeters: 15, metadata: { visitDepartureOpen: true } },
      ...(freshHome ? [point("home-fresh", "00:04:30", 8)] : []),
      point("work-1", "00:09:00", 2_000), point("work-2", "00:09:30", 2_000), point("work-3", "00:20:00", 2_000)
    ];
    input.processingAt = time("01:00:00");
    return { input, homeVisitAt: time("00:04:00") };
  }

  it("treats an accurate Visit at another place as an episode boundary (re-review finding)", () => {
    const { input, homeVisitAt } = crossEpisodeInput("visit", false);
    expect(homeStays(run(input).stays).some((stay) => stay.startedAt === homeVisitAt)).toBe(false);
  });

  it("still recognises the arrival when fresh Home evidence corroborates it after the other-place Visit", () => {
    const { input, homeVisitAt } = crossEpisodeInput("visit", true);
    expect(homeStays(run(input).stays).find((stay) => stay.startedAt === homeVisitAt)).toMatchObject({
      stoppedAt: input.processingAt.replace("01:00:00", "00:09:00")
    });
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

describe("completed saved-place Visit ending after the departure evidence", () => {
  const gymStay = (input: LocationEngineInput) => run(input).stays.find((stay) => stay.placeId === GYM_VISIT_PLACE_ID);

  // Before this change the stay was correct until the completed Visit drained,
  // then fell back to the midpoint of the silent hour (06:43:14) and retired the Review.
  it.each(["07:20:00", "07:42:43", "07:43:44", "08:05:00", "09:00:00"])(
    "keeps the gym stay at the first departure evidence before and after the Visit drains (at %s)", (processingTime) => {
      expect(gymStay(gymVisitDepartureFixture(processingTime))).toMatchObject({
        startedAt: gymVisitAt("06:07:48"), stoppedAt: gymVisitAt("07:14:08.435"),
        stopLowerBoundAt: gymVisitAt("06:12:18"), stopUpperBoundAt: gymVisitAt("07:14:08.435")
      });
    });

  // Without its arrival callback the completed Visit is the only support, so an
  // end far past the departure evidence is contradicted and keeps the midpoint.
  it.each([[300_000, true], [300_001, false]])("bounds how late a completion-only Visit end may run (%i ms)", (lagMs, keepsPresence) => {
    const visitEndedAt = new Date(Date.parse(gymVisitAt("07:14:08.435")) + lagMs).toISOString().slice(11, 23);
    const stay = gymStay(gymVisitDepartureFixture("08:05:00", { visitEndedAt, exclude: ["gym-visit-open"] }));
    expect(stay?.stopUpperBoundAt).toBe(keepsPresence ? gymVisitAt("07:14:08.435") : gymVisitAt("07:14:10.031"));
    expect(stay?.stoppedAt === gymVisitAt("07:14:08.435")).toBe(keepsPresence);
    if (!keepsPresence) expect(stay!.stoppedAt! < gymVisitAt("07:14:08")).toBe(true);
  });

  // A corroborated arrival already established presence to the departure
  // evidence; its own completion may bound that, never shrink it.
  it.each([300_001, 1_200_000])("never lets a corroborated arrival's late completion shrink the stay (%i ms)", (lagMs) => {
    const visitEndedAt = new Date(Date.parse(gymVisitAt("07:14:08.435")) + lagMs).toISOString().slice(11, 23);
    expect(gymStay(gymVisitDepartureFixture("08:05:00", { visitEndedAt }))).toMatchObject({
      stoppedAt: gymVisitAt("07:14:08.435"), stopUpperBoundAt: gymVisitAt("07:14:08.435") });
  });

  // An accurate completion keeps the position it always had (here it sorts
  // first), so identities of existing stays do not change (re-review finding).
  it("keeps an accurate completion where earlier engines placed it", () => {
    expect(gymStay(gymVisitDepartureFixture("07:43:44"))!.evidenceIds.slice(0, 2)).toEqual(["gym-visit", "gym-visit-open"]);
  });

  // Re-review of c18ad1c: a Home Visit spanning accurate Work fixes was reused by a
  // later single Home fix, so the late departure created a five-minute Home stay.
  function returnEpisode(variant: "reused" | "fresh-visit" | "observed-dwell" | "fresh-after-fix", freshEndedAt = "11:27:00.000") {
    const work = { ...qualityPlace, id: "10000000-0000-4000-8000-000000000092", name: "Work", latitude: 51.518 };
    const value = qualityInput([
      signal("home-visit", "11:00:00", { kind: "visit", endedAt: "2026-09-15T11:27:00.000Z" }),
      signal("work-1", "11:05:00", { latitude: work.latitude }), signal("work-2", "11:10:00", { latitude: work.latitude }),
      ...(variant === "fresh-visit" ? [signal("home-visit-2", "11:20:30", { kind: "visit", endedAt: "2026-09-15T11:27:00.000Z" })] : []),
      ...(variant === "observed-dwell" ? [signal("home-0", "11:19:00")] : []),
      signal("home-1", "11:21:00"),
      ...(variant === "fresh-after-fix" ? [signal("home-visit-2", "11:21:05", { kind: "visit", endedAt: `2026-09-15T${freshEndedAt}Z` })] : []),
      ...(variant === "observed-dwell" ? [signal("home-2", "11:24:00")] : []),
      signal("home-exit", "11:26:00", { kind: "geofence_exit", savedPlaceId: qualityPlace.id, latitude: null, longitude: null, horizontalAccuracyMeters: null }),
      signal("work-3", "11:26:06", { latitude: work.latitude })
    ]);
    value.savedPlaces.push(work);
    return run(value).stays.filter((stay) => stay.placeId === qualityPlace.id && stay.startedAt >= "2026-09-15T11:15:00.000Z");
  }

  it("does not let a Visit reused from an earlier, contradicted episode extend a later stay (re-review finding)", () => {
    expect(returnEpisode("reused")).toEqual([]);
  });

  it("still uses a fresh Visit in the return episode, and observed dwell keeps the ordinary estimate", () => {
    expect(returnEpisode("fresh-visit")).toEqual([expect.objectContaining({
      startedAt: "2026-09-15T11:20:30.000Z", stoppedAt: "2026-09-15T11:26:00.000Z" })]);
    expect(returnEpisode("observed-dwell")).toEqual([expect.objectContaining({
      startedAt: "2026-09-15T11:19:00.000Z", stoppedAt: "2026-09-15T11:25:00.000Z", stopUpperBoundAt: "2026-09-15T11:26:00.000Z" })]);
  });

  // Re-review of 70a0e67: a fresh Visit replaced inherited support only when it ended later.
  it.each(["11:27:00.000", "11:26:30.000", "11:27:00.001"])(
    "lets a fresh Visit after the return fix replace inherited support (fresh end %s)", (freshEndedAt) => {
      expect(returnEpisode("fresh-after-fix", freshEndedAt)).toEqual([expect.objectContaining({
        startedAt: "2026-09-15T11:21:00.000Z", stoppedAt: "2026-09-15T11:26:00.000Z",
        stopLowerBoundAt: "2026-09-15T11:21:05.000Z", stopUpperBoundAt: "2026-09-15T11:26:00.000Z" })]);
    });
});

describe("broad completed Visit after a corroborated arrival (4 Oct school drop-off and stop)", () => {
  const schoolStays = (input: LocationEngineInput) => run(input).stays.filter((stay) => stay.placeId === SCHOOL_VISIT_SCHOOL_ID);
  const day = (input: LocationEngineInput) => run(input).output.segmentUpserts
    .filter((segment) => segment.startedAt >= schoolVisitAt("06:40:00"))
    .map((segment) => [segment.kind, segment.kind === "stay" ? segment.placeId : null, segment.startedAt, segment.stoppedAt]);

  // Before this change the 94 m completion cancelled the arrival's presence and
  // was itself too broad to use, so the 24-minute stop and both journeys vanished.
  it.each(["07:48:30", "08:30:00"])("records the drive, the stop and the drive home once the Visits drain (at %s)", (processingTime) => {
    expect(day(schoolVisitFixture(processingTime))).toEqual([
      ["commute", null, schoolVisitAt("06:49:32.461"), schoolVisitAt("06:53:00")],
      ["stay", SCHOOL_VISIT_SCHOOL_ID, schoolVisitAt("06:53:00"), schoolVisitAt("07:17:43")],
      ["commute", null, schoolVisitAt("07:17:48.218"), schoolVisitAt("07:21:35")],
      ["stay", SCHOOL_VISIT_HOME_ID, schoolVisitAt("07:21:35"), null]
    ]);
    // The one-minute drop-off at the School stays inside the outbound drive.
    expect(schoolStays(schoolVisitFixture(processingTime))).toHaveLength(1);
  });

  it("keeps broad support inferred: medium confidence, never logged automatically", () => {
    const [stay] = schoolStays(schoolVisitFixture());
    expect(stay.confidence).toBe("medium");
    expect(assessAutomaticLocation("v2_enabled", stay)).toMatchObject({ action: "review", reason: "insufficient_confidence" });
  });

  it("gives the same stay whichever callback is delivered first", () => {
    const reordered = schoolVisitFixture();
    // The field IDs sort the completion first; this one sorts it after the arrival.
    reordered.evidence = reordered.evidence.map((item) =>
      item.clientEvidenceId === "visit-0653-done" ? { ...item, clientEvidenceId: "visit-0653-zdone" } : item);
    const [original] = schoolStays(schoolVisitFixture());
    const [other] = schoolStays(reordered);
    expect({ ...other, evidenceIds: [] }).toEqual({ ...original, evidenceIds: [] });
    expect(other.evidenceIds[0]).toBe("visit-0653-open");
  });

  // Re-review of 565f620: moving an accurate completion behind its arrival changed
  // existing stay IDs once and orphaned decided stays' neighbouring journeys.
  it("keeps an accurate completion's earlier position, so existing identities do not change", () => {
    const input = schoolVisitFixture();
    input.evidence = input.evidence.map((item) =>
      item.clientEvidenceId === "visit-0653-done" ? { ...item, horizontalAccuracyMeters: 20 } : item);
    expect(schoolStays(input)[0].evidenceIds.slice(0, 2)).toEqual(["visit-0653-done", "visit-0653-open"]);
    // A broad completion was never used before, so it follows the arrival.
    expect(schoolStays(schoolVisitFixture())[0].evidenceIds.slice(0, 2)).toEqual(["visit-0653-open", "visit-0653-done"]);
  });

  it("ends presence at the reported departure when the phone stays silent after leaving", () => {
    const input = schoolVisitFixture("12:00:00", { exclude: ["back-0", "back-1", "back-2-slc", "back-3", "back-4", "back-5", "back-6",
      "school-exit-0717", "gym-exit-0717", "home-exit-0717", "visit-0721-open", "arrive-0", "home-enter-0721", "arrive-1",
      "arrive-2", "arrive-3-slc", "arrive-4"] });
    extra(input, { clientEvidenceId: "home-much-later", occurredAt: schoolVisitAt("10:30:00"), latitude: 0, longitude: 0,
      horizontalAccuracyMeters: 5, speedMetersPerSecond: 0 });
    expect(schoolStays(input)).toEqual([expect.objectContaining({ startedAt: schoolVisitAt("06:53:00"), stoppedAt: schoolVisitAt("07:17:43") })]);
  });

  it("does not use a broad completion without a corroborated arrival", () => {
    expect(schoolStays(schoolVisitFixture("08:30:00", { exclude: ["visit-0653-open"] }))).toEqual([]);
    expect(schoolStays(schoolVisitFixture("08:30:00", { exclude: ["school-enter-0653", "stop-0", "stop-1-slc", "stop-2"] }))).toEqual([]);
  });

  it("ignores a completion that is not spatially compatible with the place, keeping arrival presence", () => {
    const input = schoolVisitFixture();
    input.evidence = input.evidence.map((item) =>
      item.clientEvidenceId === "visit-0653-done" ? { ...item, latitude: 1_500 / 111_195 } : item);
    // Presence continues to the departure evidence, exactly as before the completion was delivered.
    expect(schoolStays(input)).toEqual([expect.objectContaining({ startedAt: schoolVisitAt("06:53:00"), stoppedAt: schoolVisitAt("07:17:47.589") })]);
  });

  const companion = (input: LocationEngineInput, id: string, patch: Partial<LocationEvidence>) => {
    const arrival = input.evidence.find((item) => item.clientEvidenceId === "visit-0653-open")!;
    input.evidence.push({ ...arrival, clientEvidenceId: id, metadata: {}, ...patch });
  };

  // Re-review of 565f620: an ignored companion still contradicted its own
  // arrival's corroboration (or became an outside reading) when it sorted after it.
  it.each(["visit-0653-a", "visit-0653-z"])("never lets an incompatible companion remove presence (id %s)", (id) => {
    const input = schoolVisitFixture("08:30:00", { exclude: ["visit-0653-done"] });
    companion(input, id, { latitude: 1_500 / 111_195, horizontalAccuracyMeters: 20, endedAt: schoolVisitAt("07:18:00") });
    expect(schoolStays(input)).toEqual([expect.objectContaining({ startedAt: schoolVisitAt("06:53:00"), stoppedAt: schoolVisitAt("07:17:47.589") })]);
    expect(schoolStays(input)[0].evidenceIds).not.toContain(id);
  });

  // Re-review of 565f620: an unselected companion still joined and moved the departure.
  it.each([["visit-0653-a", "visit-0653-z"], ["visit-0653-z", "visit-0653-a"]])(
    "bounds presence at the earliest companion whatever their order (%s ends first)", (earlyId, lateId) => {
      const input = schoolVisitFixture("08:30:00", { exclude: ["visit-0653-done"] });
      companion(input, earlyId, { horizontalAccuracyMeters: 20, endedAt: schoolVisitAt("07:10:00") });
      companion(input, lateId, { horizontalAccuracyMeters: 20, endedAt: schoolVisitAt("07:30:00") });
      const [stay] = schoolStays(input);
      expect(stay).toMatchObject({ startedAt: schoolVisitAt("06:53:00"), stoppedAt: schoolVisitAt("07:10:00") });
      expect(stay.evidenceIds).toContain(earlyId);
      expect(stay.evidenceIds).not.toContain(lateId);
    });
});
