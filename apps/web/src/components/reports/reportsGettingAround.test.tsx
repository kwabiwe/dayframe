import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportsGettingAround, ReportsNotLogged } from "./ReportsGettingAround";

// Location v4 step 18 (mock-up #web-reports): times only, never distances or places.
describe("Reports › Getting around and Not logged (location v4 step 18)", () => {
  it("shows the time by leg mode, most first, with stops and changes, each trip counted once", () => {
    const html = renderToStaticMarkup(<ReportsGettingAround summary={{
      tripCount: 3, totalSeconds: 5_400, stopsSeconds: 600,
      byMode: [{ mode: "train", seconds: 2_400 }, { mode: "walking", seconds: 1_800 }, { mode: "unknown", seconds: 600 }]
    }} />);
    expect(html).toContain("Getting around");
    expect(html).toContain("3 trips, each counted once");
    const labels = [...html.matchAll(/<b>([^<]+)<\/b>/g)].map((match) => match[1]);
    expect(labels).toEqual(["Train", "Walk", "Mode not known", "Stops and changes"]);
    expect(html).toContain('data-glyph="train-front"');
    expect(html).toContain("width:44.44");
    expect(html).not.toMatch(/\bkm\b|\bmi\b|miles|metres/);
  });

  it("is absent with no trips in the range", () => {
    expect(renderToStaticMarkup(<ReportsGettingAround summary={null} />)).toBe("");
    expect(renderToStaticMarkup(<ReportsGettingAround summary={{ tripCount: 1, totalSeconds: 0, stopsSeconds: 0, byMode: [] }} />)).toBe("");
  });

  it("says one trip in the singular", () => {
    const html = renderToStaticMarkup(<ReportsGettingAround summary={{ tripCount: 1, totalSeconds: 900, stopsSeconds: 0, byMode: [{ mode: "bus", seconds: 900 }] }} />);
    expect(html).toContain("1 trip, each counted once");
    expect(html).not.toContain("Stops and changes");
  });

  it("says Not logged under the total, outside activities and goals, with a way to check them", () => {
    const html = renderToStaticMarkup(<ReportsNotLogged day="2026-10-21" seconds={3_720} />);
    expect(html).toContain("Not logged:");
    expect(html).toContain("at places you haven&#x27;t named");
    // The day the List shows the place, not today (Codex r1 on #569).
    expect(html).toContain('href="/timeline?view=list&amp;scope=day&amp;date=2026-10-21"');
    expect(html).toContain('class="df-report-not-logged-check"');
    expect(html).toContain("Not counted above or in goals.");
    expect(renderToStaticMarkup(<ReportsNotLogged day={null} seconds={30} />)).toBe("");
  });

});
