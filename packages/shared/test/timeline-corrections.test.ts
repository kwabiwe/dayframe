import { describe, expect, it } from "vitest";
import {
  applyTimelineCorrections, applyTimelineCorrectionsWithJoins, TimelineCorrectionRequestSchema, type TimelineCorrection
} from "../src/location/corrections";
import type { CommuteSegment, LocationSegment, StaySegment } from "../src/location/types";

// Location v4 step 11: synthetic times and identities only.
const at = (minutes: number) => new Date(Date.UTC(2026, 1, 16, 8) + minutes * 60_000).toISOString();
const SAVED = "00000000-0000-4000-8000-000000000001";
const LEARNED = "00000000-0000-4000-8000-000000000002";

function stay(id: string, from: number, to: number | null): StaySegment {
  return {
    kind: "stay", clientSegmentId: id, algorithmVersion: "test", status: "closed", startedAt: at(from), stoppedAt: to == null ? null : at(to),
    placeId: null, learnedPlaceId: null, placeMatchKind: "unknown", candidatePlaceIds: [], sampleCount: 3, continuityStatus: "continuous",
    confidence: "high", evidenceIds: []
  } as StaySegment;
}

function trip(id: string, from: number, to: number, legs?: CommuteSegment["tripLegs"]): CommuteSegment {
  return {
    kind: "commute", clientSegmentId: id, algorithmVersion: "test", status: "closed", startedAt: at(from), stoppedAt: at(to),
    fromStaySegmentId: "a", toStaySegmentId: "b", routeSampleCount: 4, gapDurationSeconds: 0, maximumObservationGapSeconds: 60,
    continuityStatus: "continuous", confidence: "high", evidenceIds: [], ...(legs ? { tripLegs: legs } : {})
  } as CommuteSegment;
}

function correction(partial: Partial<TimelineCorrection> & Pick<TimelineCorrection, "subject" | "kind">, from: number, to: number, created = 0): TimelineCorrection {
  return { id: `c-${created}-${partial.kind}`, target: {}, spanStartedAt: at(from), spanStoppedAt: at(to), createdAt: at(1_000 + created), ...partial };
}

const NOW = Date.parse(at(600));
const segments: LocationSegment[] = [
  stay("a", 0, 60),
  trip("t", 60, 90, [
    { startedAt: at(60), stoppedAt: at(70), mode: "walking", confidence: "sure", distanceMeters: 700 },
    { startedAt: at(70), stoppedAt: at(90), mode: "automotive", confidence: "unsure", runnerUp: "bus", distanceMeters: 9_000 }
  ]),
  stay("b", 90, null)
];

describe("timeline corrections (location v4 step 11)", () => {
  it("sets a place's place, marked as set by you", () => {
    const [first] = applyTimelineCorrections(segments, [correction({ subject: "place", kind: "place", target: { placeId: SAVED, learnedPlaceId: null } }, 0, 60)], NOW);
    expect(first).toMatchObject({ clientSegmentId: "a", placeId: SAVED, learnedPlaceId: null, placeMatchKind: "saved", setByYou: true });
  });

  it("finds the engine's item by the corrected span, so a correction still applies after replay moves its ends a little", () => {
    const moved = [stay("a2", 0, 62), ...segments.slice(1)];
    const [first] = applyTimelineCorrections(moved, [correction({ subject: "place", kind: "place", target: { placeId: null, learnedPlaceId: LEARNED } }, 0, 60)], NOW);
    expect(first).toMatchObject({ clientSegmentId: "a2", learnedPlaceId: LEARNED, placeMatchKind: "learned", setByYou: true });
  });

  it("leaves everything alone when no item covers at least half the span", () => {
    expect(applyTimelineCorrections(segments, [correction({ subject: "place", kind: "place", target: { placeId: SAVED } }, 700, 800)], NOW))
      .toEqual([...segments].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)));
  });

  it("sets a place's and a trip's times, and the newest correction of an item wins", () => {
    const result = applyTimelineCorrections(segments, [
      correction({ subject: "place", kind: "times", target: { startedAt: at(5), stoppedAt: at(55) } }, 0, 60, 1),
      correction({ subject: "place", kind: "times", target: { startedAt: at(10), stoppedAt: at(58) } }, 0, 60, 2),
      correction({ subject: "trip", kind: "times", target: { startedAt: at(58), stoppedAt: at(92) } }, 60, 90, 3)
    ], NOW);
    expect(result.find((segment) => segment.clientSegmentId === "a")).toMatchObject({ startedAt: at(10), stoppedAt: at(58), setByYou: true });
    expect(result.find((segment) => segment.clientSegmentId === "t")).toMatchObject({ startedAt: at(58), stoppedAt: at(92), setByYou: true });
  });

  it("leaves out a trip that wasn't one", () => {
    const result = applyTimelineCorrections(segments, [correction({ subject: "trip", kind: "delete" }, 60, 90)], NOW);
    expect(result.map((segment) => segment.clientSegmentId)).toEqual(["a", "b"]);
  });

  it("sets one leg's mode, sure and set by you, and keeps the others", () => {
    const result = applyTimelineCorrections(segments, [correction({ subject: "leg", kind: "leg_mode", target: { mode: "bus" } }, 70, 90)], NOW);
    const legs = (result.find((segment) => segment.clientSegmentId === "t") as CommuteSegment).tripLegs!;
    expect(legs[0]).toEqual(segments[1].kind === "commute" ? segments[1].tripLegs![0] : null);
    expect(legs[1]).toEqual({ startedAt: at(70), stoppedAt: at(90), mode: "bus", confidence: "sure", distanceMeters: 9_000, setByYou: true });
  });

  it("keeps a leg's other details when its mode is set (Codex r1 on #566)", () => {
    const unseen = [trip("u", 60, 90, [{ startedAt: at(60), stoppedAt: at(90), mode: "underground", confidence: "unsure", runnerUp: "train",
      unobserved: true, distanceMeters: 9_000 }])];
    const [corrected] = applyTimelineCorrections(unseen, [correction({ subject: "leg", kind: "leg_mode", target: { mode: "train" } }, 60, 90)], NOW);
    expect((corrected as CommuteSegment).tripLegs).toEqual([{ startedAt: at(60), stoppedAt: at(90), mode: "train", confidence: "sure",
      unobserved: true, distanceMeters: 9_000, setByYou: true }]);
  });

  it("sets the mode only over its own span when consecutive legs of one mode are one leg (card A; Codex r1 on #590)", () => {
    // A correction saved on the first of two Underground legs, 60–70, after the engine merged them into 60–90.
    const merged = [trip("m", 60, 90, [{ startedAt: at(60), stoppedAt: at(90), mode: "underground", confidence: "sure", unobserved: true, distanceMeters: 9_000 }])];
    const [corrected] = applyTimelineCorrections(merged, [correction({ subject: "leg", kind: "leg_mode", target: { mode: "bus" } }, 60, 70)], NOW);
    expect((corrected as CommuteSegment).tripLegs).toEqual([
      { startedAt: at(60), stoppedAt: at(70), mode: "bus", confidence: "sure", unobserved: true, distanceMeters: 3_000, setByYou: true },
      { startedAt: at(70), stoppedAt: at(90), mode: "underground", confidence: "sure", unobserved: true, distanceMeters: 6_000 }
    ]);
    // Two corrections on its two parts both hold.
    const [both] = applyTimelineCorrections(merged, [correction({ subject: "leg", kind: "leg_mode", target: { mode: "bus" } }, 60, 70, 1),
      correction({ subject: "leg", kind: "leg_mode", target: { mode: "train" } }, 70, 90, 2)], NOW);
    expect((both as CommuteSegment).tripLegs!.map(({ mode, startedAt, stoppedAt }) => [mode, startedAt, stoppedAt]))
      .toEqual([["bus", at(60), at(70)], ["train", at(70), at(90)]]);
  });

  it("applies a later correction over its whole span, across the parts an earlier one joined (Codex r2 on #590)", () => {
    // Walk 60–70 + Drive 70–90; the walk set to Drive makes one Drive 60–90; that leg then set to Bus.
    const result = applyTimelineCorrections(segments, [
      correction({ subject: "leg", kind: "leg_mode", target: { mode: "automotive" } }, 60, 70, 1),
      correction({ subject: "leg", kind: "leg_mode", target: { mode: "bus" } }, 60, 90, 2)
    ], NOW);
    expect((result.find((segment) => segment.clientSegmentId === "t") as CommuteSegment).tripLegs!.map(({ mode, startedAt, stoppedAt, setByYou }) =>
      [mode, startedAt, stoppedAt, setByYou])).toEqual([["bus", at(60), at(90), true]]);
  });

  it("applies a correction over three joined parts, none covering half of it alone (Codex r3 on #590)", () => {
    const three = [trip("w", 0, 30, [
      { startedAt: at(0), stoppedAt: at(10), mode: "walking", confidence: "sure", distanceMeters: 700 },
      { startedAt: at(10), stoppedAt: at(20), mode: "automotive", confidence: "sure", distanceMeters: 5_000 },
      { startedAt: at(20), stoppedAt: at(30), mode: "walking", confidence: "sure", distanceMeters: 700 }
    ])];
    const [result] = applyTimelineCorrections(three, [
      correction({ subject: "leg", kind: "leg_mode", target: { mode: "automotive" } }, 0, 10, 1),
      correction({ subject: "leg", kind: "leg_mode", target: { mode: "automotive" } }, 20, 30, 2),
      correction({ subject: "leg", kind: "leg_mode", target: { mode: "bus" } }, 0, 30, 3)
    ], NOW);
    expect((result as CommuteSegment).tripLegs!.map(({ mode, startedAt, stoppedAt }) => [mode, startedAt, stoppedAt]))
      .toEqual([["bus", at(0), at(30)]]);
  });

  it("makes a corrected leg one leg with a neighbour of the same mode, set by you", () => {
    const result = applyTimelineCorrections(segments, [correction({ subject: "leg", kind: "leg_mode", target: { mode: "automotive" } }, 60, 70)], NOW);
    expect((result.find((segment) => segment.clientSegmentId === "t") as CommuteSegment).tripLegs)
      .toEqual([{ startedAt: at(60), stoppedAt: at(90), mode: "automotive", confidence: "sure", distanceMeters: 9_700, setByYou: true }]);
  });

  it("finds each correction's item among the engine's own spans, so a shortened item is still found (Codex r1 on #566)", () => {
    const result = applyTimelineCorrections(segments, [
      correction({ subject: "place", kind: "times", target: { startedAt: at(0), stoppedAt: at(10) } }, 0, 60, 1),
      correction({ subject: "place", kind: "place", target: { placeId: SAVED, learnedPlaceId: null } }, 0, 60, 2),
      correction({ subject: "trip", kind: "times", target: { startedAt: at(85), stoppedAt: at(88) } }, 60, 90, 3),
      correction({ subject: "trip", kind: "delete" }, 60, 90, 4)
    ], NOW);
    expect(result.find((segment) => segment.clientSegmentId === "a")).toMatchObject({ startedAt: at(0), stoppedAt: at(10), placeId: SAVED,
      setByYou: true, correctionSpan: { startedAt: at(0), stoppedAt: at(60) } });
    expect(result.map((segment) => segment.clientSegmentId)).toEqual(["a", "b"]);
  });

  it("matches an open place up to now", () => {
    const result = applyTimelineCorrections(segments, [correction({ subject: "place", kind: "place", target: { placeId: SAVED } }, 90, 600)], NOW);
    expect(result.find((segment) => segment.clientSegmentId === "b")).toMatchObject({ placeId: SAVED, setByYou: true });
  });

  it("accepts the kinds the app sends and refuses the rest", () => {
    const parse = (value: unknown) => TimelineCorrectionRequestSchema.safeParse(value).success;
    expect(parse({ kind: "place", subject: "place", itemId: "a", placeId: SAVED, learnedPlaceId: null })).toBe(true);
    expect(parse({ kind: "place", subject: "place", itemId: "a", placeId: SAVED, learnedPlaceId: LEARNED })).toBe(false);
    expect(parse({ kind: "times", subject: "trip", itemId: "t", startedAt: at(1), stoppedAt: at(2) })).toBe(true);
    expect(parse({ kind: "times", subject: "trip", itemId: "t", startedAt: at(2), stoppedAt: at(1) })).toBe(false);
    expect(parse({ kind: "delete", subject: "trip", itemId: "t" })).toBe(true);
    expect(parse({ kind: "delete", subject: "place", itemId: "a" })).toBe(true);
    expect(parse({ kind: "delete", subject: "leg", itemId: "t" })).toBe(false);
    expect(parse({ kind: "merge", subject: "trip", itemId: "t" })).toBe(true);
    expect(parse({ kind: "merge", subject: "place", itemId: "a" })).toBe(false);
    expect(parse({ kind: "leg_mode", subject: "leg", itemId: "t", legStartedAt: at(70), legStoppedAt: at(90), mode: "bus" })).toBe(true);
    expect(parse({ kind: "leg_mode", subject: "leg", itemId: "t", legStartedAt: at(70), legStoppedAt: at(90), mode: "boat" })).toBe(false);
    expect(parse({ kind: "split", subject: "place", itemId: "a" })).toBe(false);
  });

  it("carries the app's own id for a correction, a UUID, so a retry is safe (step 12)", () => {
    const parse = (value: unknown) => TimelineCorrectionRequestSchema.safeParse(value);
    const id = "8b0d8c8e-5d0f-4c5e-9f0e-3b1c2d3e4f50";
    expect(parse({ kind: "delete", subject: "trip", itemId: "t", clientCorrectionId: id }).data).toMatchObject({ clientCorrectionId: id });
    expect(parse({ kind: "place", subject: "place", itemId: "a", placeId: null, learnedPlaceId: null, clientCorrectionId: id }).success).toBe(true);
    expect(parse({ kind: "times", subject: "place", itemId: "a", startedAt: at(1), stoppedAt: at(2), clientCorrectionId: id }).success).toBe(true);
    expect(parse({ kind: "leg_mode", subject: "leg", itemId: "t", legStartedAt: at(70), legStoppedAt: at(90), mode: "bus", clientCorrectionId: id }).success).toBe(true);
    expect(parse({ kind: "delete", subject: "trip", itemId: "t", clientCorrectionId: "retry-1" }).success).toBe(false);
  });

  // Step 12 part 4: a drive out, a place the person wasn't at, a walk on; then two visits to one place.
  const linked = (id: string, from: number, to: number, fromStay: string, toStay: string, legs: CommuteSegment["tripLegs"]) =>
    ({ ...trip(id, from, to, legs), fromStaySegmentId: fromStay, toStaySegmentId: toStay, routeDistanceMeters: 1_000, evidenceIds: [id] });
  const day: LocationSegment[] = [
    stay("home", 0, 60),
    linked("t1", 60, 80, "home", "x", [{ startedAt: at(60), stoppedAt: at(80), mode: "automotive", confidence: "sure", distanceMeters: 5_000 }]),
    stay("x", 80, 95),
    linked("t2", 95, 120, "x", "shop", [{ startedAt: at(95), stoppedAt: at(120), mode: "walking", confidence: "likely", distanceMeters: 800 }]),
    { ...stay("shop", 120, 150), placeId: SAVED, placeMatchKind: "saved" },
    linked("t3", 150, 160, "shop", "shop2", []),
    { ...stay("shop2", 160, 200), placeId: SAVED, placeMatchKind: "saved" },
    linked("t4", 200, 230, "shop2", "home2", []),
    stay("home2", 230, null)
  ];

  it("joins the trips either side of a place you weren't at into one trip (I wasn't here)", () => {
    const result = applyTimelineCorrections(day, [correction({ subject: "place", kind: "delete" }, 80, 95)], NOW);
    expect(result.map((segment) => segment.clientSegmentId)).toEqual(["home", "t1", "shop", "t3", "shop2", "t4", "home2"]);
    const joined = result.find((segment) => segment.clientSegmentId === "t1") as CommuteSegment;
    expect(joined).toMatchObject({ startedAt: at(60), stoppedAt: at(120), fromStaySegmentId: "home", toStaySegmentId: "shop",
      routeDistanceMeters: 2_000, confidence: "low", setByYou: true, gapDurationSeconds: 3_600, evidenceIds: ["t1", "t2"] });
    expect(joined.tripLegs?.map((leg) => leg.mode)).toEqual(["automotive", "walking"]);
  });

  it("changes nothing for a place you weren't at without a trip on both sides", () => {
    const edge = day.slice(0, 3);
    expect(applyTimelineCorrections(edge, [correction({ subject: "place", kind: "delete" }, 80, 95)], NOW)).toEqual(edge);
  });

  it("makes two visits to one place one stay when you didn't leave, and the next trip leaves it", () => {
    const result = applyTimelineCorrections(day, [correction({ subject: "trip", kind: "merge" }, 150, 160)], NOW);
    expect(result.map((segment) => segment.clientSegmentId)).toEqual(["home", "t1", "x", "t2", "shop", "t4", "home2"]);
    expect(result.find((segment) => segment.clientSegmentId === "shop")).toMatchObject({ startedAt: at(120), stoppedAt: at(200), setByYou: true });
    expect(result.find((segment) => segment.clientSegmentId === "t4")).toMatchObject({ fromStaySegmentId: "shop" });
  });

  it("keeps a merge the server accepted even when a later correction changes one visit's place (Codex r1 on #603)", () => {
    const result = applyTimelineCorrections(day, [
      correction({ subject: "trip", kind: "merge" }, 150, 160, 1),
      correction({ subject: "place", kind: "place", target: { placeId: null, learnedPlaceId: LEARNED } }, 160, 200, 2)
    ], NOW);
    expect(result.map((segment) => segment.clientSegmentId)).toEqual(["home", "t1", "x", "t2", "shop", "t4", "home2"]);
  });

  it("applies later corrections to what an earlier one joined", () => {
    const result = applyTimelineCorrections(day, [
      correction({ subject: "trip", kind: "merge" }, 150, 160, 1),
      correction({ subject: "place", kind: "place", target: { placeId: null, learnedPlaceId: LEARNED } }, 120, 150, 2),
      correction({ subject: "trip", kind: "times", target: { startedAt: at(62), stoppedAt: at(80) } }, 95, 120, 3)
    ], NOW);
    expect(result.find((segment) => segment.clientSegmentId === "shop")).toMatchObject({ stoppedAt: at(200), learnedPlaceId: LEARNED });
    expect(result.find((segment) => segment.clientSegmentId === "t2")).toMatchObject({ startedAt: at(62) });
  });

  it("ties later corrections of a joined trip to the earlier trip's span, so replay finds them (Codex r1 on #603)", () => {
    const joined = applyTimelineCorrections(day, [correction({ subject: "place", kind: "delete" }, 80, 95, 1)], NOW);
    expect(joined.find((segment) => segment.clientSegmentId === "t1")).toMatchObject({ correctionSpan: { startedAt: at(60), stoppedAt: at(80) } });
    // The app sends the joined trip's own span; it finds the trip in, which stands for both.
    const removed = applyTimelineCorrections(day, [
      correction({ subject: "place", kind: "delete" }, 80, 95, 1),
      correction({ subject: "trip", kind: "delete" }, 60, 80, 2)
    ], NOW);
    expect(removed.some((segment) => segment.clientSegmentId === "t1" || segment.clientSegmentId === "t2")).toBe(false);
  });

  it("sets a leg's mode on the trip out after it was joined (Codex r1 on #603)", () => {
    const result = applyTimelineCorrections(day, [
      correction({ subject: "place", kind: "delete" }, 80, 95, 1),
      correction({ subject: "leg", kind: "leg_mode", target: { mode: "running" } }, 95, 120, 2)
    ], NOW);
    expect((result.find((segment) => segment.clientSegmentId === "t1") as CommuteSegment).tripLegs?.map((leg) => leg.mode))
      .toEqual(["automotive", "running"]);
  });

  it("gives the one stay its last visit's status, and names which stay it folded (Codex r1 on #603)", () => {
    const open = day.map((segment) => segment.clientSegmentId === "shop2" ? { ...segment, status: "open" as const } : segment);
    const { segments, joinedStayIds } = applyTimelineCorrectionsWithJoins(open, [correction({ subject: "trip", kind: "merge" }, 150, 160)], NOW);
    expect(segments.find((segment) => segment.clientSegmentId === "shop")).toMatchObject({ status: "open", correctionSpan: { startedAt: at(120), stoppedAt: at(150) } });
    expect([...joinedStayIds]).toEqual([["shop2", "shop"]]);
  });

  // Codex r2 on #603.
  it("still takes the place off the day once replay leaves its trips to the block they became", () => {
    const decided = day.filter((segment) => segment.clientSegmentId !== "t1" && segment.clientSegmentId !== "t2");
    const result = applyTimelineCorrections(decided, [correction({ subject: "place", kind: "delete" }, 80, 95)], NOW);
    expect(result.some((segment) => segment.clientSegmentId === "x")).toBe(false);
  });

  it("sets the mode of a leg that spans both joined trips", () => {
    const walks = day.map((segment) => segment.clientSegmentId === "t1"
      ? { ...segment, tripLegs: [{ startedAt: at(60), stoppedAt: at(80), mode: "walking" as const, confidence: "sure" as const, distanceMeters: 900 }] }
      : segment);
    const result = applyTimelineCorrections(walks, [
      correction({ subject: "place", kind: "delete" }, 80, 95, 1),
      correction({ subject: "leg", kind: "leg_mode", target: { mode: "bus" } }, 60, 120, 2)
    ], NOW);
    expect((result.find((segment) => segment.clientSegmentId === "t1") as CommuteSegment).tripLegs?.map((leg) => leg.mode)).toEqual(["bus"]);
  });

  it("drops the trip in's classification from the one trip", () => {
    const round = day.map((segment) => segment.clientSegmentId === "t1" ? { ...segment, qualificationReason: "same_place_meaningful_round_trip" as const } : segment);
    const joined = applyTimelineCorrections(round, [correction({ subject: "place", kind: "delete" }, 80, 95)], NOW)
      .find((segment) => segment.clientSegmentId === "t1") as CommuteSegment;
    expect(joined).not.toHaveProperty("qualificationReason");
  });

  // Codex r4 on #603: corrections keep the order they were made in.
  it("joins a trip whose end was edited, and merges a visit whose times were edited, to the joined ends", () => {
    const joined = applyTimelineCorrections(day, [
      correction({ subject: "trip", kind: "times", target: { startedAt: at(60), stoppedAt: at(78) } }, 60, 80, 1),
      correction({ subject: "place", kind: "delete" }, 80, 95, 2)
    ], NOW).find((segment) => segment.clientSegmentId === "t1");
    expect(joined).toMatchObject({ startedAt: at(60), stoppedAt: at(120), toStaySegmentId: "shop" });
    const merged = applyTimelineCorrections(day, [
      correction({ subject: "place", kind: "times", target: { startedAt: at(125), stoppedAt: at(148) } }, 120, 150, 1),
      correction({ subject: "trip", kind: "merge" }, 150, 160, 2)
    ], NOW).find((segment) => segment.clientSegmentId === "shop");
    expect(merged).toMatchObject({ startedAt: at(125), stoppedAt: at(200) });
  });

  it("makes Home, a place you weren't at, Home one Home stay when you then didn't leave", () => {
    const homeDay: LocationSegment[] = [
      { ...stay("h1", 0, 60), placeId: SAVED, placeMatchKind: "saved" },
      linked("ta", 60, 80, "h1", "x", []), stay("x", 80, 95), linked("tb", 95, 120, "x", "h2", []),
      { ...stay("h2", 120, 200), placeId: SAVED, placeMatchKind: "saved" }
    ];
    const result = applyTimelineCorrections(homeDay, [
      correction({ subject: "place", kind: "delete" }, 80, 95, 1),
      correction({ subject: "trip", kind: "merge" }, 60, 80, 2)
    ], NOW);
    expect(result.map((segment) => segment.clientSegmentId)).toEqual(["h1"]);
    expect(result[0]).toMatchObject({ startedAt: at(0), stoppedAt: at(200) });
  });
});

