import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readAnswerKey } from "../src/answerKey";
import { assertOutsideRepository, readPrivateJson, REPOSITORY_ROOT } from "../src/cli";
import { fixed } from "../src/report";
import { scoreRun } from "../src/score";
import { sanitizeQualitySegments } from "../src/segments";
import { exampletonAnswerKey, exampletonSegments } from "./exampleton";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "location-quality-"));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

describe("privacy guard", () => {
  it("refuses private paths inside the repository, by path component", () => {
    expect(() => assertOutsideRepository(path.join(REPOSITORY_ROOT, "Timeline.json"))).toThrow(/outside the repository/);
    expect(() => assertOutsideRepository(REPOSITORY_ROOT)).toThrow();
    // "..private" is a folder inside the repository, not its parent.
    expect(() => assertOutsideRepository(path.join(REPOSITORY_ROOT, "..private", "Timeline.json"))).toThrow(/outside the repository/);
    expect(assertOutsideRepository(path.join(path.dirname(REPOSITORY_ROOT), "private", "Timeline.json"))).toContain("private");
  });

  it("follows symlinks, for inputs and for outputs not written yet", () => {
    const link = path.join(scratch, "into-repo");
    fs.symlinkSync(REPOSITORY_ROOT, link);
    expect(() => assertOutsideRepository(path.join(link, "packages", "Timeline.json"))).toThrow(/outside the repository/);
    expect(() => assertOutsideRepository(path.join(link, "new-folder", "summary.json"))).toThrow(/outside the repository/);
    expect(assertOutsideRepository(path.join(scratch, "summary.json"))).toBe(path.join(scratch, "summary.json"));
    // A dangling link outside the repository pointing at a file not yet written inside it.
    const dangling = path.join(scratch, "run.json");
    fs.symlinkSync(path.join(REPOSITORY_ROOT, "not-yet-written-private.json"), dangling);
    expect(() => assertOutsideRepository(dangling)).toThrow(/outside the repository/);
  });
});

describe("saved runs", () => {
  it("are rebuilt from an allowlist, so nothing else a file carries is scored or saved again", () => {
    const tampered = exampletonSegments.map((segment) => ({ ...segment, latitude: 1.5, longitude: 2.5, name: "Somewhere" }));
    const clean = sanitizeQualitySegments(JSON.parse(JSON.stringify(tampered)));
    expect(clean).toEqual(exampletonSegments);
    expect(JSON.stringify(clean)).not.toMatch(/latitude|longitude|Somewhere/);
  });

  it("refuse names in place labels, free text in codes and malformed segments, without quoting them", () => {
    const named = [{ ...exampletonSegments[0], place: "Somewhere Street" }];
    expect(() => sanitizeQualitySegments(named)).toThrow("Saved run segment 0 has an invalid place.");
    expect(() => sanitizeQualitySegments([{ ...exampletonSegments[0], reason: "Somewhere Street" }])).toThrow(/invalid reason/);
    expect(() => sanitizeQualitySegments([{ ...exampletonSegments[0], stops: -1 }])).toThrow(/invalid stops/);
    expect(() => sanitizeQualitySegments({})).toThrow(/JSON array/);
  });

  it("report a file that is not JSON, or a bad timestamp, without quoting it", () => {
    const file = path.join(scratch, "broken.json");
    fs.writeFileSync(file, '[{"kind": "stay", "near": "Somewhere Street 12", 51.12345');
    expect(() => readPrivateJson(file, "the saved run")).toThrow(/^Could not read the saved run: it is not valid JSON\.$/);
    const stamped = [{ ...exampletonSegments[0], startedAt: "Mon, 02 Mar 2026 06:00:00 GMT (Somewhere Street)" }];
    expect(() => sanitizeQualitySegments(stamped)).toThrow(/^Saved run segment 0 has an invalid startedAt\.$/);
    expect(() => readAnswerKey([{ startTime: "Somewhere Street 12", endTime: "2026-03-02T07:00:00Z" }], 0, Infinity))
      .toThrow(/^Invalid timestamp in the answer key\.$/);
  });
});

describe("long windows and rounding", () => {
  it("scores a 100-day window without overflowing the stack", () => {
    const from = Date.parse("2026-01-01T00:00:00Z") / 1000;
    const to = from + 100 * 86_400;
    const key = readAnswerKey(exampletonAnswerKey, from, to);
    const report = scoreRun(key, exampletonSegments, { from, to, homePlace: "P4", timeZone: "Europe/London" });
    // UTC midnights are 23:00 or 00:00 in London, so the window touches 101 local days.
    expect(report.days).toHaveLength(101);
  }, 60_000);

  it("rounds like Python: ties on the exact binary value to even, never a product's rounding", () => {
    // 129 s is 2.15 min, stored just under 2.15: Python prints 2.1.
    expect(fixed(129 / 60, 1)).toBe("2.1");
    expect(fixed(0.375, 2)).toBe("0.38");
    expect(fixed(72.5, 0)).toBe("72");
    expect(fixed(73.5, 0)).toBe("74");
    expect(fixed(0.05, 1)).toBe("0.1");
  });
});
