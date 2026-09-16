import { describe, expect, it } from "vitest";
import { runLocationEngine, type LocationEngineInput } from "../src/location";

import { place, signal, input, incident } from "../src/location/savedPlaceQualityFixture";

function stays(value: LocationEngineInput) { return runLocationEngine(value).segmentUpserts.filter(s => s.kind === "stay"); }

describe("saved-place quality synthetic incident", () => {
  it("does not admit the short completed-Visit-backed fragment", () => {
    const result = stays(incident());
    expect(result.filter(s => s.stoppedAt && Date.parse(s.stoppedAt) - Date.parse(s.startedAt) < 300_000)).toEqual([]);
  });
  it("retains compatible Visit continuity after an uncorroborated exit", () => {
    expect(stays(incident())).toHaveLength(1);
  });
  it("bridges the supplied 26m38s gap with strong synthetic endpoints", () => {
    const value = incident(false);
    value.evidence = value.evidence.filter(e => e.clientEvidenceId !== "exit");
    expect(stays(value)).toHaveLength(1);
  });
});

describe("saved-place quality boundaries", () => {
  it.each([0, 40_000, 299_999, 300_000, 600_000])("applies the exact %i ms completed-Visit floor to saved and learned", (duration) => {
    for (const learned of [false, true]) {
      const first = signal("visit", "11:00:00", { kind: "visit", endedAt: new Date(Date.parse("2026-09-15T11:00:00.000Z") + duration).toISOString() });
      const value = input([first]);
      if (learned) { value.savedPlaces = []; value.acceptedLearnedPlaces = [{ ...place, accepted: true }]; }
      expect(stays(value)).toHaveLength(duration >= 300_000 ? 1 : 0);
    }
  });
  it("uses a new supported re-entry after synthetic corroborated parking departure", () => {
    const value = incident();
    value.evidence.push(signal("outside-1", "11:57:10", { latitude: 51.503, speedMetersPerSecond: 4 }), signal("outside-2", "11:57:40", { latitude: 51.504, speedMetersPerSecond: 4 }));
    expect(stays(value)).toMatchObject([{ startedAt: "2026-09-15T11:58:52.000Z", stoppedAt: "2026-09-15T12:46:44.000Z" }]);
  });
  it("uses valid Visit departure, but never extends through earlier synthetic movement", () => {
    const value = incident();
    expect(stays(value)[0]).toMatchObject({ stoppedAt: "2026-09-15T12:46:44.000Z", stopLowerBoundAt: "2026-09-15T12:46:44.000Z", stopUpperBoundAt: "2026-09-15T12:46:44.000Z" });
    value.evidence.push(signal("depart-1", "12:42:00", { latitude: 51.503, speedMetersPerSecond: 4 }), signal("depart-2", "12:43:00", { latitude: 51.504, speedMetersPerSecond: 4 }));
    const stay = stays(value)[0];
    expect(Date.parse(stay.stoppedAt!)).toBeLessThanOrEqual(Date.parse("2026-09-15T12:42:00.000Z"));
    expect(stay.stopLowerBoundAt).not.toBe(stay.stopUpperBoundAt);
  });
  it("does not manufacture attendance from clock time, a distant point or repeated exits", () => {
    for (const extra of [[], [signal("distant", "11:10:00", { latitude: 51.51 })], [signal("exit-1", "11:10:00", { kind: "geofence_exit", savedPlaceId: place.id, latitude: null, longitude: null }),signal("exit-2", "11:12:00", { kind: "geofence_exit", savedPlaceId: place.id, latitude: null, longitude: null })]]) {
      expect(stays(input([signal("passing", "11:00:00"), ...extra]))).toEqual([]);
    }
  });
  it("waits for grace then emits a stable bounded medium fallback without new evidence", () => {
    const value = input([signal("first", "11:00:00"),signal("inside", "11:05:00"),signal("exit", "11:06:00", { kind: "geofence_exit", savedPlaceId: place.id, latitude: null, longitude: null })]);
    value.processingAt = "2026-09-15T11:09:00.000Z";
    expect(stays(value)[0]).toMatchObject({ status: "open", stoppedAt: null });
    value.processingAt = "2026-09-15T11:11:00.000Z";
    expect(stays(value)[0]).toMatchObject({ status: "closed", stoppedAt: "2026-09-15T11:05:30.000Z", confidence: "medium", continuityStatus: "uncertain_gap" });
    value.processingAt = "2026-09-15T11:30:00.000Z";
    const final = stays(value);
    expect(final[0].status).toBe("finalised");
    value.processingAt = "2026-09-15T13:30:00.000Z";
    expect(stays(value)).toEqual(final);
  });
  it("allows callback re-entry only with compatible finite Visit support", () => {
    const value = incident();
    value.evidence = value.evidence.map(e => e.clientEvidenceId === "inside-2" ? { ...e, kind: "geofence_enter" as const, savedPlaceId: place.id, latitude: null, longitude: null } : e);
    expect(stays(value)).toHaveLength(1);
  });
  it.each(["invalid", null, "2026-09-16T12:00:00.000Z"])("does not treat %s Visit departure as unbounded interval support", endedAt => {
    const value = incident(); value.evidence[0] = { ...value.evidence[0], endedAt };
    const result = stays(value);
    expect(result.every(s => s.stoppedAt == null || Date.parse(s.stoppedAt) <= Date.parse(value.processingAt))).toBe(true);
  });
  it("keeps point-only quiet continuity uncertain/medium and splits beyond thirty minutes", () => {
    const value = incident(false); value.evidence = value.evidence.filter(e => e.kind !== "geofence_exit");
    expect(stays(value)[0]).toMatchObject({ confidence: "medium", continuityStatus: "uncertain_gap" });
    value.evidence = [signal("one", "11:00:00"),signal("two", "11:05:00"),signal("three", "11:35:01"),signal("four", "11:40:01")];
    expect(stays(value)).toHaveLength(2);
  });
  it("does not bridge on broad endpoints or through credible outside/different-place evidence", () => {
    const value = input([signal("one", "11:00:00"),signal("two", "11:05:00"),signal("three", "11:31:38"),signal("four", "11:36:38")]);
    for (const middle of [signal("outside", "11:15:00", { latitude: 51.503, speedMetersPerSecond: 4 }), signal("other", "11:15:00", { latitude: 51.503 })]) {
      const separated = { ...value, evidence: [...value.evidence, middle], savedPlaces: [...value.savedPlaces, { ...place, id: "other", latitude: 51.503 }] };
      expect(stays(separated).filter(s => s.placeId === place.id)).toHaveLength(2);
    }
    value.evidence[2] = { ...value.evidence[2], horizontalAccuracyMeters: 150 };
    expect(stays(value).some(s => s.continuityStatus === "uncertain_gap" && s.startedAt === "2026-09-15T11:00:00.000Z" && !s.stoppedAt)).toBe(false);
  });
  it("keeps deterministic occurrence ordering across duplicates and delayed Visit delivery", () => {
    const value = incident(); const before = JSON.stringify(value);
    const expected = runLocationEngine(value).segmentUpserts;
    expect(JSON.stringify(value)).toBe(before);
    value.evidence = [...value.evidence].reverse().map(e => ({ ...e, receivedAt: "2026-09-15T15:00:00.000Z" }));
    value.evidence.push({ ...value.evidence[0] });
    expect(runLocationEngine(value).segmentUpserts).toEqual(expected);
  });
});

describe("saved-place continuity isolation", () => {
  it("fails closed if a caller mixes device journals", () => {
    const value = incident(); value.evidence[1] = { ...value.evidence[1], deviceId: "another-device" };
    expect(() => runLocationEngine(value)).toThrow("one device");
  });
  it("keeps accepted learned-place gaps on the ordinary twelve-minute rule", () => {
    const value = incident(false); value.evidence = value.evidence.filter(e => e.kind !== "geofence_exit");
    value.savedPlaces = []; value.acceptedLearnedPlaces = [{ ...place, accepted: true }];
    expect(stays(value)).toHaveLength(2);
  });
  it("does not join same-name places or real A to B to A inside a long Visit", () => {
    const value = input([signal("visit", "11:00:00", { kind: "visit", endedAt: "2026-09-15T12:00:00.000Z" }),
      signal("a-support", "11:06:00"),signal("b", "11:08:00", { latitude: 51.503 }),signal("b-support", "11:14:00", { latitude: 51.503 }),signal("return", "11:15:00"),signal("return-support", "11:21:00")]);
    value.savedPlaces.push({ ...place, id: "distinct-place", latitude: 51.503 });
    const result = stays(value);
    expect(result.map(s => s.placeId)).toEqual([place.id,"distinct-place",place.id]);
    expect(result[2].startedAt).toBe("2026-09-15T11:15:00.000Z");
    expect(result[0].stoppedAt! < result[1].startedAt).toBe(true);
  });
  it("does not turn registration callbacks into continuing attendance", () => {
    const value = input([signal("one", "11:00:00"), ...[5,10,15,20].map(minute=>signal(`state-${minute}`,`11:${minute.toString().padStart(2,"0")}:00`, { kind: "geofence_state", savedPlaceId: place.id, latitude: null, longitude: null }))]);
    expect(stays(value)).toHaveLength(0);
  });
  it("preserves a valid long gap beyond thirty minutes only with finite interval support", () => {
    const value = input([signal("visit", "11:00:00", { kind: "visit", endedAt: "2026-09-15T12:10:00.000Z" }),signal("one", "11:05:00"),signal("two", "11:55:00")]);
    expect(stays(value)).toHaveLength(1);
    expect(stays(value)[0]).toMatchObject({ stoppedAt: "2026-09-15T12:10:00.000Z", continuityStatus: "supported_by_visit" });
  });
});


describe("clipped interval support", () => {
  it("does not let an earlier short Visit waive later inferred dwell", () => {
    const value = input([signal("short-visit", "11:00:00", { kind: "visit", endedAt: "2026-09-15T11:00:10.000Z" }),
      signal("last-inside", "11:00:20"),signal("outside-one", "11:10:00", { latitude: 51.51, speedMetersPerSecond: 4 }),
      signal("outside-two", "11:11:00", { latitude: 51.511, speedMetersPerSecond: 4 })]);
    expect(stays(value)).toHaveLength(0);
  });
});


describe("context during saved-place silence", () => {
  it("does not split strong quiet-gap endpoints on registration or another region's callback", () => {
    for (const callback of [signal("state", "11:20:00", { kind: "geofence_state", savedPlaceId: place.id, latitude: null, longitude: null }),
      signal("other-region", "11:20:00", { kind: "geofence_enter", savedPlaceId: "another-region", latitude: null, longitude: null })]) {
      const value = input([signal("first", "11:00:00"),signal("inside", "11:06:00"),callback,signal("return", "11:30:00"),signal("later", "11:36:00")]);
      expect(stays(value)).toHaveLength(1);
      expect(stays(value)[0].confidence).toBe("medium");
    }
  });
});
