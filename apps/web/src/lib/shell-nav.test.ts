import { describe, expect, it } from "vitest";
import { springLinearEasing } from "./blocks-motion";
import { SHELL_SECTIONS, activeLibraryTab, activeShellSection, shellSectionForKey } from "./shell-nav";

const bare = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

describe("Blocks shell sections", () => {
  it("lists Today, Calendar, Review, Reports and Library on keys 1–5", () => {
    expect(SHELL_SECTIONS.map((section) => `${section.key} ${section.label}`)).toEqual([
      "1 Today",
      "2 Calendar",
      "3 Review",
      "4 Reports",
      "5 Library"
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

  it("only treats bare digits as section keys", () => {
    expect(shellSectionForKey({ ...bare, key: "4" })?.id).toBe("reports");
    expect(shellSectionForKey({ ...bare, key: "6" })).toBeNull();
    expect(shellSectionForKey({ ...bare, key: "1", metaKey: true })).toBeNull();
    expect(shellSectionForKey({ ...bare, key: "1", ctrlKey: true })).toBeNull();
    expect(shellSectionForKey({ ...bare, key: "1", altKey: true })).toBeNull();
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
