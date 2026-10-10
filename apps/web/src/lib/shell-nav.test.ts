import { describe, expect, it } from "vitest";
import { springLinearEasing } from "./blocks-motion";
import { SHELL_SECTIONS, activeLibraryTab, activeShellSection, goToTarget, startsGoToSequence } from "./shell-nav";

const bare = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

describe("Blocks shell sections", () => {
  it("lists Today, Calendar, Review, Reports and Library with their G letters", () => {
    expect(SHELL_SECTIONS.map((section) => `${section.letter} ${section.label}`)).toEqual([
      "t Today",
      "c Calendar",
      "r Review",
      "p Reports",
      "l Library"
    ]);
  });

  it("maps every existing page to its section, and Settings to none", () => {
    expect(activeShellSection("/")?.id).toBe("today");
    expect(activeShellSection("/timeline")?.id).toBe("calendar");
    expect(activeShellSection("/review")?.id).toBe("review");
    expect(activeShellSection("/reports")?.id).toBe("reports");
    for (const path of ["/categories", "/tags", "/places"]) expect(activeShellSection(path)?.id).toBe("library");
    expect(activeShellSection("/settings")).toBeNull();
    expect(activeShellSection("/timelineish")).toBeNull();
  });

  it("keeps Activities, Tags and Places reachable as Library tabs", () => {
    expect(activeLibraryTab("/tags")?.label).toBe("Tags");
    expect(activeLibraryTab("/places")?.label).toBe("Places");
    expect(activeLibraryTab("/categories")?.label).toBe("Activities");
    expect(activeLibraryTab("/reports")).toBeNull();
  });

  it("jumps with G then a letter, leaving digits for pinned activities", () => {
    expect(startsGoToSequence({ ...bare, key: "g" })).toBe(true);
    expect(startsGoToSequence({ ...bare, key: "G", shiftKey: true })).toBe(false);
    expect(startsGoToSequence({ ...bare, key: "g", metaKey: true })).toBe(false);
    expect(goToTarget({ ...bare, key: "p" })).toBe("/reports");
    expect(goToTarget({ ...bare, key: "l" })).toBe("/categories");
    expect(goToTarget({ ...bare, key: "s" })).toBe("/settings");
    expect(goToTarget({ ...bare, key: "1" })).toBeNull();
    expect(goToTarget({ ...bare, key: "x" })).toBeNull();
    expect(goToTarget({ ...bare, key: "t", ctrlKey: true })).toBeNull();
  });
});

describe("Blocks springs on web", () => {
  it("expresses snap as a settling linear() easing from 0 to 1", () => {
    const { easing, durationMs } = springLinearEasing("snap");
    const points = easing.slice("linear(".length, -1).split(", ").map(Number);
    expect(points[0]).toBe(0);
    expect(points.at(-1)).toBe(1);
    expect(durationMs).toBeGreaterThan(200);
    expect(durationMs).toBeLessThan(700);
    // snap is near-critically damped: it may graze past the target but never visibly bounces.
    expect(Math.max(...points)).toBeLessThan(1.02);
  });

  it("gives land its one small overshoot", () => {
    const points = springLinearEasing("land").easing.slice("linear(".length, -1).split(", ").map(Number);
    expect(Math.max(...points)).toBeGreaterThan(1.02);
  });
});
