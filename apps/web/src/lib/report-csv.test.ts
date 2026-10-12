import { describe, expect, it } from "vitest";
import { buildReportCsv, escapeCsvCell } from "./report-csv";

describe("report CSV", () => {
  it("escapes commas, quotes, newlines and preserves Unicode", () => {
    expect(escapeCsvCell("one,two")).toBe('"one,two"');
    expect(escapeCsvCell('say "hello"')).toBe('"say ""hello"""');
    expect(escapeCsvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(escapeCsvCell("Café 日本語")).toBe("Café 日本語");
  });

  it("exports only the documented columns with friendly source labels", () => {
    const csv = buildReportCsv([{
      startedAt: "2026-07-22T09:00:00.000Z",
      stoppedAt: "2026-07-22T10:00:00.000Z",
      durationSeconds: 3_600,
      description: 'School, notes "final"\nnext line',
      tagNames: ["Family", "Café 日本語"],
      categoryName: null,
      placeName: null,
      source: "manual_app"
    }]);

    expect(csv.split("\r\n")[0]).toBe("Date,Start,Finish,Duration,Description,Tags,Category,Place,Source");
    expect(csv).toContain('"School, notes ""final""\nnext line"');
    expect(csv).toContain('"Family, Café 日本語"');
    expect(csv).toContain("Uncategorized,No place,Web app");
    expect(csv).not.toMatch(/confidence|rawPayload|workspaceId|userId|reviewStatus/i);
    // The CSV keeps its own duration cells ("1h 00m"), whatever the interface shows.
    expect(csv).toContain(",1h 00m,");
  });

  it("writes dates and times in the viewer's zone when the export knows it", () => {
    const row = {
      startedAt: "2026-10-11T23:30:00.000Z",
      stoppedAt: "2026-10-12T00:15:00.000Z",
      durationSeconds: 2_700,
      description: "Late call",
      tagNames: [],
      categoryName: "Work",
      placeName: null,
      source: "manual_app"
    };
    expect(buildReportCsv([row], { timeZone: "Europe/London" }).split("\r\n")[1]).toMatch(/^12\/10\/2026,00:30,01:15,/);
    expect(buildReportCsv([row], { timeZone: "UTC" }).split("\r\n")[1]).toMatch(/^11\/10\/2026,23:30,00:15,/);
  });

  it("labels a running row without inventing a finish time", () => {
    const csv = buildReportCsv([{
      startedAt: "2026-07-22T09:00:00.000Z",
      stoppedAt: null,
      durationSeconds: 600,
      description: "Running task",
      tagNames: [],
      categoryName: "Work",
      placeName: "Office",
      source: "mobile_app"
    }]);
    expect(csv).toContain(",Running,10m,Running task,");
  });
});
