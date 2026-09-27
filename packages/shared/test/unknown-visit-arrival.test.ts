import { describe, expect, it } from "vitest";
import { runLocationEngine } from "../src/location/segmenter";
import { localDateKey, stableLocationId } from "../src/location/geo";
import { assessAutomaticLocation } from "../src/location/automaticPolicy";
import type { LocationEngineInput, StaySegment } from "../src/location/types";
import { shortAt, shortJourneysFixture } from "./fixtures/shortJourneys";
import { unknownVisitArrivalFixture } from "./fixtures/unknownVisitArrival";

const arrival = "2026-09-27T10:28:03.000Z";
const departure = "2026-09-27T10:51:38.000Z";
const lastMovement = "2026-09-27T10:27:44.000Z";

function unknownStay(input: LocationEngineInput) {
  return runLocationEngine(input).segmentUpserts.find((segment): segment is StaySegment =>
    segment.kind === "stay" && segment.placeMatchKind === "unknown" &&
    segment.evidenceIds.includes("visit-completed")
  );
}

describe("unknown native Visit arrival uncertainty", () => {
  it("keeps the plausible Visit estimate without exact-looking arrival bounds", () => {
    const fixture = unknownVisitArrivalFixture();
    const result = runLocationEngine(fixture);
    const stay = unknownStay(fixture);
    expect(stay).toBeDefined();
    expect(stay).toMatchObject({
      startedAt: "2026-09-27T10:28:03.000Z",
      stoppedAt: "2026-09-27T10:51:38.000Z",
      startLowerBoundAt: "2026-09-27T10:27:44.000Z",
      startUpperBoundAt: "2026-09-27T10:51:38.000Z",
      stopLowerBoundAt: "2026-09-27T10:51:38.000Z",
      stopUpperBoundAt: "2026-09-27T10:51:38.000Z"
    });
    const inbound = result.segmentUpserts.find((segment) =>
      segment.kind === "commute" && segment.toStaySegmentId === stay?.clientSegmentId
    );
    expect(inbound).toMatchObject({
      stoppedAt: stay?.startedAt,
      stopLowerBoundAt: stay?.startLowerBoundAt,
      stopUpperBoundAt: stay?.startUpperBoundAt
    });
    expect(inbound?.evidenceIds).toEqual(["route-1", "route-2", "route-last-moving"]);
    expect(stay?.clientSegmentId).toBe(stableLocationId("stay", [
      fixture.config.algorithmVersion,
      fixture.evidence[0].deviceId,
      "visit-arrival",
      "later-slow",
      "unknown"
    ]));
  });

  it("uses the Visit departure as an upper constraint without later stationary support", () => {
    const input = unknownVisitArrivalFixture();
    input.evidence = input.evidence.filter((item) => item.clientEvidenceId !== "later-slow");
    expect(unknownStay(input)).toMatchObject({
      startedAt: arrival,
      stoppedAt: departure,
      startLowerBoundAt: lastMovement,
      startUpperBoundAt: departure,
      stopLowerBoundAt: departure,
      stopUpperBoundAt: departure
    });
  });

  it("does not infer a movement-backed lower bound after a long quiet period", () => {
    const input = unknownVisitArrivalFixture();
    input.evidence = input.evidence.filter((item) => item.clientEvidenceId !== "route-last-moving" &&
      item.clientEvidenceId !== "route-2" && item.clientEvidenceId !== "later-slow");
    const stay = unknownStay(input);
    expect(stay).toMatchObject({
      startedAt: arrival,
      startLowerBoundAt: arrival,
      startUpperBoundAt: arrival,
      stoppedAt: departure
    });
    // A broad coordinate is not by itself a clock-error measurement. With no
    // recent independent movement, the narrow risk flag has no lower witness.
  });

  it("keeps a high-quality 11m33 internal Visit exact and below the unchanged Review gate", () => {
    const input = unknownVisitArrivalFixture();
    input.evidence = input.evidence.map((item) => item.clientEvidenceId === "visit-completed"
      ? { ...item, horizontalAccuracyMeters: 54, endedAt: "2026-09-27T10:39:36.000Z" }
      : item);
    const stay = unknownStay(input);
    expect(stay).toMatchObject({
      startedAt: arrival,
      stoppedAt: "2026-09-27T10:39:36.000Z",
      startLowerBoundAt: arrival,
      startUpperBoundAt: arrival
    });
    expect(Date.parse(stay!.stoppedAt!) - Date.parse(stay!.startedAt)).toBe(693_000);
    expect(Date.parse(stay!.stoppedAt!) - Date.parse(stay!.startedAt)).toBeLessThan(input.config.unknownStayReviewDwellMs);
  });

  it("requires recent accurate non-simulated native movement, not slow traffic or spatial noise", () => {
    for (const patch of [
      { speedMetersPerSecond: 0.76 },
      { horizontalAccuracyMeters: 90 },
      { isSimulated: true },
      { latitude: 51.5099 }
    ]) {
      const input = unknownVisitArrivalFixture();
      input.evidence = input.evidence.map((item) => item.clientEvidenceId === "route-last-moving"
        ? { ...item, ...patch } : item);
      expect(unknownStay(input)?.startLowerBoundAt, JSON.stringify(patch)).toBe(arrival);
      expect(unknownStay(input)?.startUpperBoundAt, JSON.stringify(patch)).toBe(arrival);
    }
    const sparse = unknownVisitArrivalFixture();
    sparse.evidence = sparse.evidence.filter((item) => item.clientEvidenceId !== "route-last-moving");
    expect(unknownStay(sparse)?.startLowerBoundAt).toBe(arrival);
  });

  it("does not use later slow or walking samples as the arrival instant", () => {
    const input = unknownVisitArrivalFixture();
    input.evidence.push({
      ...input.evidence.find((item) => item.clientEvidenceId === "later-slow")!,
      clientEvidenceId: "walking-after-parking",
      occurredAt: "2026-09-27T10:36:00.000Z",
      sourceTimestamp: "2026-09-27T10:36:00.000Z",
      latitude: 51.5101,
      speedMetersPerSecond: 2.1
    });
    expect(unknownStay(input)).toMatchObject({
      startedAt: arrival,
      startLowerBoundAt: lastMovement,
      startUpperBoundAt: departure
    });
  });

  it("does not retain the early Visit stay when a later accurate route contradicts it", () => {
    const input = unknownVisitArrivalFixture();
    const routePoint = input.evidence.find((item) => item.clientEvidenceId === "route-last-moving")!;
    input.evidence.push({
      ...routePoint,
      clientEvidenceId: "continued-route-1",
      occurredAt: "2026-09-27T10:29:30.000Z",
      sourceTimestamp: "2026-09-27T10:29:30.000Z",
      latitude: 51.512,
      speedMetersPerSecond: 5.2
    }, {
      ...routePoint,
      clientEvidenceId: "continued-route-2",
      occurredAt: "2026-09-27T10:30:30.000Z",
      sourceTimestamp: "2026-09-27T10:30:30.000Z",
      latitude: 51.514,
      speedMetersPerSecond: 4.8
    });
    input.evidence = input.evidence.map((item) => item.clientEvidenceId === "later-slow"
      ? { ...item, latitude: 51.5141, longitude: -0.12 }
      : item);
    expect(unknownStay(input)).toBeUndefined();
  });

  it("leaves an arrival-only upper bound unavailable, then converges on full replay", () => {
    const input = unknownVisitArrivalFixture();
    const first = structuredClone(input);
    first.evidence = first.evidence.filter((item) => item.clientEvidenceId !== "visit-completed");
    for (const [index, time] of ["10:36:00.000", "10:40:00.000"].entries()) {
      first.evidence.push({
        ...first.evidence.find((item) => item.clientEvidenceId === "later-slow")!,
        clientEvidenceId: `extra-stationary-${index}`,
        occurredAt: `2026-09-27T${time}Z`,
        sourceTimestamp: `2026-09-27T${time}Z`
      });
    }
    const provisional = runLocationEngine(first).segmentUpserts.find((segment) =>
      segment.kind === "stay" && segment.evidenceIds.includes("visit-arrival")
    );
    expect(provisional).toMatchObject({
      startedAt: arrival,
      startLowerBoundAt: lastMovement,
      startUpperBoundAt: null
    });
    const full = { ...first, evidence: [...first.evidence, input.evidence.find((item) =>
      item.clientEvidenceId === "visit-completed")!] };
    const completed = unknownStay(full);
    expect(completed).toMatchObject({
      startedAt: arrival,
      startLowerBoundAt: lastMovement,
      startUpperBoundAt: departure
    });
    expect(runLocationEngine({ ...full, evidence: [...full.evidence].reverse() }).segmentUpserts)
      .toEqual(runLocationEngine(full).segmentUpserts);
    expect(runLocationEngine({ ...full, evidence: [...full.evidence, ...full.evidence] }).segmentUpserts)
      .toEqual(runLocationEngine(full).segmentUpserts);
  });

  it("handles a completed callback alone and does not pair competing or non-overlapping callbacks", () => {
    const completedOnly = unknownVisitArrivalFixture();
    completedOnly.evidence = completedOnly.evidence.filter((item) => item.clientEvidenceId !== "visit-arrival");
    expect(unknownStay(completedOnly)).toMatchObject({
      startedAt: arrival,
      startLowerBoundAt: lastMovement,
      startUpperBoundAt: departure
    });

    const colliding = unknownVisitArrivalFixture();
    colliding.evidence.push({
      ...colliding.evidence.find((item) => item.clientEvidenceId === "visit-arrival")!,
      clientEvidenceId: "visit-arrival-other"
    });
    expect(unknownStay(colliding)?.startUpperBoundAt).toBeNull();

    const separated = unknownVisitArrivalFixture();
    separated.evidence = separated.evidence.map((item) => item.clientEvidenceId === "visit-arrival"
      ? { ...item, latitude: 51.51095, horizontalAccuracyMeters: 5 }
      : item);
    expect(unknownStay(separated)?.startUpperBoundAt).toBeNull();
  });

  it("keeps the ten-minute candidate gate and Visit departure after a short stop", () => {
    const input = unknownVisitArrivalFixture();
    input.evidence = input.evidence.map((item) => item.clientEvidenceId === "visit-completed"
      ? { ...item, endedAt: "2026-09-27T10:37:00.000Z" } : item);
    expect(unknownStay(input)).toBeUndefined();
  });

  it("keeps identity when a same-source departure becomes a 17-minute candidate", () => {
    const full = unknownVisitArrivalFixture();
    const short = unknownVisitArrivalFixture();
    short.evidence = short.evidence.map((item) => item.clientEvidenceId === "visit-completed"
      ? { ...item, endedAt: "2026-09-27T10:45:00.000Z" } : item);
    const before = unknownStay(full)!;
    const after = unknownStay(short)!;
    expect(after.clientSegmentId).toBe(before.clientSegmentId);
    expect(after.stoppedAt).toBe("2026-09-27T10:45:00.000Z");
    expect(Date.parse(after.stoppedAt!) - Date.parse(after.startedAt)).toBeLessThan(short.config.unknownStayReviewDwellMs);
    expect(after.startUpperBoundAt).toBe(after.stoppedAt);
  });

  it("uses absolute instants consistently through the Europe/London fall-back", () => {
    const input = unknownVisitArrivalFixture();
    const shift = (iso: string) => new Date(Date.parse(iso) - Date.parse("2026-09-27T10:00:00.000Z") +
      Date.parse("2026-10-25T00:20:00.000Z")).toISOString();
    input.evidence = input.evidence.map((item) => ({
      ...item,
      occurredAt: shift(item.occurredAt),
      endedAt: item.endedAt ? shift(item.endedAt) : null,
      receivedAt: shift(item.receivedAt),
      sourceTimestamp: item.sourceTimestamp ? shift(item.sourceTimestamp) : null
    }));
    input.processingAt = shift(input.processingAt);
    expect(unknownStay(input)).toMatchObject({
      startedAt: shift(arrival),
      startLowerBoundAt: shift(lastMovement),
      startUpperBoundAt: shift(departure),
      stoppedAt: shift(departure)
    });
  });

  it("keeps source bounds ordered across a Europe/London local-day boundary", () => {
    const input = unknownVisitArrivalFixture();
    const shift = (iso: string) => new Date(Date.parse(iso) - Date.parse("2026-09-27T10:00:00.000Z") +
      Date.parse("2026-10-24T22:20:00.000Z")).toISOString();
    input.evidence = input.evidence.map((item) => ({
      ...item,
      occurredAt: shift(item.occurredAt),
      endedAt: item.endedAt ? shift(item.endedAt) : null,
      receivedAt: shift(item.receivedAt),
      sourceTimestamp: item.sourceTimestamp ? shift(item.sourceTimestamp) : null
    }));
    input.processingAt = shift(input.processingAt);
    const stay = unknownStay(input)!;
    expect(stay.startLowerBoundAt).toBe(shift(lastMovement));
    expect(stay.startedAt).toBe(shift(arrival));
    expect(stay.startUpperBoundAt).toBe(shift(departure));
    expect(localDateKey(stay.startedAt, "Europe/London")).not.toBe(
      localDateKey(stay.stoppedAt!, "Europe/London"));
  });

  it("keeps a 76.140-second #209-style short journey Review-only", () => {
    const input = shortJourneysFixture();
    const oldArrival = Date.parse(shortAt(684_496));
    const offset = 8_356;
    input.evidence = input.evidence.map((item) => {
      const shift = (value: string) => Date.parse(value) >= oldArrival
        ? new Date(Date.parse(value) - offset).toISOString() : value;
      return {
        ...item,
        occurredAt: shift(item.occurredAt),
        endedAt: item.endedAt ? shift(item.endedAt) : null,
        sourceTimestamp: item.sourceTimestamp ? shift(item.sourceTimestamp) : null
      };
    });
    const commutes = runLocationEngine(input).segmentUpserts.filter((segment) => segment.kind === "commute");
    expect(commutes).toHaveLength(2);
    expect(Date.parse(commutes[0].stoppedAt) - Date.parse(commutes[0].startedAt)).toBe(76_140);
    expect(assessAutomaticLocation("v2_enabled", commutes[0])).toMatchObject({
      action: "review", reason: "short_journey_review_only"
    });
  });
});
