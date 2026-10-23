import { describe, expect, it } from "vitest";
import { distanceMeters } from "@dayframe/shared";
import { parseEvidenceRows, parsePlaceRows, placeIdFromLabel, placeLabelFromId, projectionAround } from "../src/evidenceRows";
import { replay, sharedEngine } from "../src/replay";
import { exampletonPlaces } from "./exampleton";

const projection = projectionAround(45);

const COLUMNS = ["n", "kind", "occurredAt", "endedAt", "receivedAt", "x", "y", "accuracy", "speed", "course", "place", "simulated",
  "activity", "confidence", "continuation", "open", "callbackAt", "authorization", "accuracyAuthorization", "accepted", "timeZone",
  "geofence", "altitude"] as const;

/** One evidence row in the private export's column order; unnamed columns are empty. */
function evidenceRow(fields: Partial<Record<(typeof COLUMNS)[number], string | number>>): string {
  const row = { kind: "standard_location", accepted: "true", timeZone: "Europe/London", simulated: "false", ...fields };
  row.receivedAt ??= row.occurredAt;
  return COLUMNS.map((column) => String(row[column] ?? "")).join("|");
}

/** Synthetic evidence: a fix a minute at Home, a 7 km drive east, then a fix a minute at the Works. */
function exampletonRows(): string {
  const rows: string[] = [];
  const fix = (seconds: number, x: number, speed: number) => evidenceRow({
    n: rows.length + 1,
    occurredAt: new Date(Date.parse("2026-03-02T06:00:00Z") + seconds * 1000).toISOString(),
    x, y: 0, accuracy: 10, speed, course: speed > 0 ? 90 : ""
  });
  for (let t = 0; t <= 120 * 60; t += 60) rows.push(fix(t, 0, 0));
  for (let t = 30; t < 20 * 60; t += 30) rows.push(fix(120 * 60 + t, (7000 * t) / (20 * 60), 7000 / (20 * 60)));
  for (let t = 0; t <= 60 * 60; t += 60) rows.push(fix(140 * 60 + t, 7000, 0));
  return rows.join("\n");
}

describe("evidence rows", () => {
  it("projects relative metres so distances survive the origin", () => {
    const [home, works] = parsePlaceRows(exampletonPlaces, projection);
    expect(home.role).toBe("home");
    expect(works.role).toBeNull();
    expect(distanceMeters(home, works)).toBeGreaterThan(6990);
    expect(distanceMeters(home, works)).toBeLessThan(7010);
  });

  it("round-trips place labels through synthetic ids", () => {
    expect(placeLabelFromId(placeIdFromLabel("P12"))).toBe("P12");
    expect(placeLabelFromId(null)).toBe("-");
  });

  it("keeps only accepted rows and can drop motion or late rows", () => {
    const text = [
      evidenceRow({ n: 1, occurredAt: "2026-03-02T06:00:00Z", x: 0, y: 0, accuracy: 10, speed: 0, place: "P4" }),
      evidenceRow({ n: 2, kind: "motion_activity", occurredAt: "2026-03-02T06:01:00Z", activity: "automotive", confidence: "high", continuation: "true" }),
      evidenceRow({ n: 3, occurredAt: "2026-03-02T06:02:00Z", receivedAt: "2026-03-02T07:00:00Z", x: 0, y: 0, accuracy: 10 }),
      evidenceRow({ n: 4, occurredAt: "2026-03-02T06:03:00Z", x: 0, y: 0, accuracy: 10, accepted: "false" })
    ].join("\n");
    const all = parseEvidenceRows(text, projection, { algorithmVersion: "v" });
    expect(all.map((e) => e.clientEvidenceId)).toEqual(["e00001", "e00002", "e00003"]);
    expect(all[0].savedPlaceId).toBe(placeIdFromLabel("P4"));
    expect(all[1].metadata).toEqual({ motionActivity: "automotive", motionConfidence: "high", motionContinuation: true });
    expect(all[1].latitude).toBeNull();
    expect(() => parseEvidenceRows(evidenceRow({ n: 9, occurredAt: "Mon, 02 Mar 2026 06:00:00 GMT (Somewhere Street)" }), projection, { algorithmVersion: "v" }))
      .toThrow(/^Evidence line 1 has an invalid timestamp\.$/);
    expect(() => parseEvidenceRows(evidenceRow({ n: "Somewhere Street 12", occurredAt: "2026-03-02T06:00:00Z" }), projection, { algorithmVersion: "v" }))
      .toThrow(/^Evidence line 1 has an invalid row number\.$/);
    const trimmed = parseEvidenceRows(text, projection, { algorithmVersion: "v", dropMotion: true, receivedUntil: Date.parse("2026-03-02T06:30:00Z") });
    expect(trimmed.map((e) => e.clientEvidenceId)).toEqual(["e00001"]);
  });
});

describe("replay", () => {
  it("runs the shared engine and returns labelled segments without coordinates", () => {
    const places = parsePlaceRows(exampletonPlaces, projection);
    const evidence = parseEvidenceRows(exampletonRows(), projection, { algorithmVersion: sharedEngine.config.algorithmVersion });
    const segments = replay(sharedEngine, evidence, places, "2026-03-02T09:05:00Z");
    const stays = segments.filter((s) => s.kind === "stay");
    const moves = segments.filter((s) => s.kind === "commute");
    expect(stays.map((s) => s.place)).toEqual(["P4", "P1"]);
    expect(moves).toHaveLength(1);
    expect([moves[0].from, moves[0].to]).toEqual(["P4", "P1"]);
    expect(JSON.stringify(segments)).not.toMatch(/latitude|longitude/);
  });
});
