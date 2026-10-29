import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const header = read("./BlocksNavHeader.tsx");
const pushedPages = {
  places: read("../../app/places.tsx"),
  settings: read("../../app/settings.tsx")
};

describe("Blocks navigation bar (UIA-001)", () => {
  it("is a text back naming the previous screen with a centred title", () => {
    expect(header).toContain("accessibilityLabel={backActionLabel(backLabel)}");
    expect(header).toContain('accessibilityRole="header"');
    expect(header).toContain("styles.blocksNavTrailing");
  });

  it("labels the back button from the screen below in the stack, on every pushed page", () => {
    expect(header).toContain("export function usePreviousScreenLabel()");
    for (const [name, source] of Object.entries(pushedPages)) {
      expect(source, name).toContain("usePreviousScreenLabel()");
    }
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

  it("tells Settings where it was opened from", () => {
    const dashboard = read("./DayframeDashboard.tsx");
    // Each tab's avatar names its own tab (Today, Calendar, Reports), for Settings and Sync help.
    expect(dashboard).toContain('router.push({ pathname: "/settings", params: { from, section: "sync" } })');
    expect(dashboard).toContain('router.push({ pathname: "/settings", params: { from } })');
    for (const tab of ["Today", "Calendar", "Reports"]) {
      expect(dashboard).toContain(`onPress={openAccountFrom${tab}}`);
    }
    expect(dashboard).not.toContain("onPress={openAccount}");
    // Today's hatched blocks open their "?" in Calendar › List (step 15), never a pushed Review page.
    expect(read("../lib/todayReviewNavigation.ts")).not.toContain('"/review');
  });
});
