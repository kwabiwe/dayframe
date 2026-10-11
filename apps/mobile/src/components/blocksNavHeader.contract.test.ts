import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const header = read("./BlocksNavHeader.tsx");
const pushedPages = {
  places: read("../../app/places.tsx"),
  review: read("../../app/review.tsx"),
  evidence: read("../../app/review/[id].tsx"),
  settings: read("../../app/settings.tsx")
};

describe("Blocks navigation bar (UIA-001)", () => {
  it("is a text back naming the previous screen with a centred title", () => {
    expect(header).toContain("accessibilityLabel={`Back to ${backLabel}`}");
    expect(header).toContain('accessibilityRole="header"');
    expect(header).toContain("styles.blocksNavTrailing");
  });

  it("labels the back button from the screen below in the stack, on every pushed page", () => {
    expect(header).toContain("export function usePreviousScreenLabel()");
    for (const [name, source] of Object.entries(pushedPages)) {
      expect(source, name).toContain("usePreviousScreenLabel()");
    }
    expect(pushedPages.review).toMatch(/<ReviewDeckFinished\s+backLabel=\{backLabel\}/);
  });

  it("is the only back control on every pushed page", () => {
    for (const [name, source] of Object.entries(pushedPages)) {
      expect(source, name).toContain("<BlocksNavHeader");
      expect(source, name).not.toContain("MobileBackButton");
      expect(source, name).not.toContain("styles.settingsTitle");
      expect(source, name).not.toContain('accessibilityLabel="Back"');
    }
    expect(pushedPages.places).toContain('title="Saved places"');
  });

  it("tells Settings and Location evidence where they were opened from", () => {
    expect(pushedPages.review).toContain('params: { from: "review", section: "sync" }');
    const dashboard = read("./DayframeDashboard.tsx");
    // Each tab's avatar names its own tab (Today, Calendar, Reports), for Settings and Sync help.
    expect(dashboard).toContain('router.push({ pathname: "/settings", params: { from, section: "sync" } })');
    expect(dashboard).toContain('router.push({ pathname: "/settings", params: { from } })');
    for (const tab of ["Today", "Calendar", "Reports"]) {
      expect(dashboard).toContain(`onPress={openAccountFrom${tab}}`);
    }
    expect(dashboard).not.toContain("onPress={openAccount}");
    expect(read("../lib/todayReviewNavigation.ts")).toContain('params: { from: "today", id: activity.source.reviewItemId }');
  });
});
