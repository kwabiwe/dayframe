import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Calendar on phones (owner-approved 17 Oct 2026, moved from the Blocks chat): a narrow gutter, a
// grid that takes the width, a near-full-screen card in a page that scrolls, floating zoom, and Day
// on a phone's first visit. Short blocks stay data marks; List is the phone path (WUI-045).
const root = join(process.cwd(), "src");
const styles = readFileSync(join(root, "app/globals.css"), "utf8");
const views = readFileSync(join(root, "components/TimeReviewViews.tsx"), "utf8");
const page = readFileSync(join(root, "app/timeline/page.tsx"), "utf8");

describe("Calendar phone layout", () => {
  it("sizes the gutter and day columns from CSS, narrower on phones", () => {
    expect(views).toContain("gridTemplateColumns: `var(--calendar-axis-width) repeat(${visibleDays.length}, minmax(var(--calendar-day-min-width), 1fr))`");
    expect(styles).toMatch(/\.timeline-calendar-workspace \{\s*--calendar-axis-width: 104px;\s*--calendar-day-min-width: 130px;/);
    const phone = styles.slice(styles.lastIndexOf("/* Calendar phone layout"));
    expect(phone).toMatch(/@media \(max-width: 560px\)/);
    expect(phone).toMatch(/--calendar-axis-width: 60px;/);
  });

  it("lets the page scroll and gives the card nearly a screen, last in the cascade", () => {
    const phone = styles.slice(styles.lastIndexOf("/* Calendar phone layout"));
    // After the phone shell's fixed-height frame, so it wins over it.
    expect(styles.lastIndexOf("/* Calendar phone layout")).toBeGreaterThan(styles.lastIndexOf("  .swiss-app-shell.is-timeline {\n    display: flex;"));
    expect(phone).toMatch(/\.swiss-app-shell\.is-timeline \{\s*height: auto;\s*min-height: 100dvh;\s*overflow: visible;/);
    expect(phone).toMatch(/\.timeline-calendar-workspace,\s*\.swiss-main-frame\.is-timeline \.timeline-list-workspace \{[^}]*height: calc\(100dvh - var\(--df-tabbar-space\) - 24px\);[^}]*min-height: 420px;/);
    // Its row parent stretches it; a fixed flex basis would shrink it to its content.
    expect(phone).not.toMatch(/timeline-calendar-workspace[^{]*\{[^}]*flex: 0 0 auto/);
    expect(phone).toMatch(/\.calendar-grid-scroller,\s*\.timeline-list-scroll \{\s*overscroll-behavior: auto;/);
  });

  it("floats zoom over the grid on phones instead of the corner, with 44 px buttons", () => {
    expect(views).toContain('className="calendar-phone-zoom" role="group" aria-label="Calendar zoom"');
    expect(styles).toMatch(/\.calendar-phone-zoom \{\s*display: none;/);
    const phone = styles.slice(styles.lastIndexOf("/* Calendar phone layout"));
    expect(phone).toMatch(/\.calendar-grid-corner \.calendar-corner-zoom \{\s*display: none;/);
    expect(phone).toMatch(/\.calendar-phone-zoom button \{[^}]*width: 44px;[^}]*height: 44px;/);
    expect(phone).toMatch(/\.calendar-now-pill \{[^}]*white-space: nowrap;/);
  });

  it("opens Day on a phone's first visit, from the server", () => {
    expect(page).toContain('preference ?? firstVisitTimelinePreference((await headers()).get("user-agent"))');
  });
});
