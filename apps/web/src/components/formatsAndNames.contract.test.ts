import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { formatClockDuration, formatDuration } from "@/lib/format";
import { formatDuration as sharedFormatDuration } from "@dayframe/shared";

// Web UI audit P7 (WUI-032, 033, 034, 035, 044; owner 17 Oct 2026).
const root = join(process.cwd(), "src");
const source = (path: string) => readFileSync(join(root, path), "utf8");
const styles = source("app/globals.css");

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("formats (WUI-032, WUI-033)", () => {
  it("reads a running clock as H:MM:SS at every length", () => {
    expect(formatClockDuration(0)).toBe("0:00:00");
    expect(formatClockDuration(485)).toBe("0:08:05");
    expect(formatClockDuration(3_785)).toBe("1:03:05");
    expect(formatClockDuration(36 * 3600 + 1)).toBe("36:00:01");
  });

  it("has one duration formatter, the shared one, with no web wrappers", () => {
    expect(formatDuration).toBe(sharedFormatDuration);
    const offenders = files(root).filter((path) => {
      const text = readFileSync(path, "utf8");
      // Only the clock (H:MM:SS) and the CSV export have formats of their own.
      const wrappers = [...text.matchAll(/function (format\w*Duration|compactDuration|formatGoalHours)\b/g)]
        .map((match) => match[1])
        .filter((name) => name !== "formatClockDuration" && name !== "formatExportDuration");
      return wrappers.length > 0
        || /const formatDuration\s*=/.test(text);
    }).map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });
});

describe("accessible names (WUI-034, WUI-044)", () => {
  it("starts each name with what is shown", () => {
    expect(source("components/InlineTagInput.tsx")).toContain("aria-label={`#${tagName}, remove tag`}");
    expect(source("components/today/TodayView.tsx")).toContain("aria-label={`${title}, ${activity}${tags ? ` · ${tags}` : \"\"}, ${start} to");
    const shell = source("components/AppShell.tsx");
    expect(shell).toContain("`${shellIdentity.userName}, ${shellIdentity.workspaceName}: profile and settings`");
    expect(shell.match(/aria-label=\{profileLabel\}/g)).toHaveLength(2);
    expect(source("components/SettingsForms.tsx")).toContain('aria-label="Workspace"');
  });
});

describe("touch targets (WUI-035)", () => {
  it("makes Today's This week rows 44 px on touch and up to 860 px, and the range controls up to 860 px", () => {
    const coarse = styles.slice(styles.lastIndexOf("/* Touch screens: every segment"));
    expect(coarse).toMatch(/\.df-flist-search input,\s*\.df-mw-row \{\s*min-height: 44px;/);
    expect(styles).toMatch(/@media \(max-width: 860px\) \{\s*\.df-mw-row,\s*\.df-range-nav,\s*\.df-range-trigger \{\s*min-height: 44px;/);
    // Today's "N to check today" chip (location v4 step 14) is a 44 px target everywhere.
    expect(styles).toMatch(/\.timeline-checks-chip \{[^}]*min-height: 44px;/);
    // Size guards use any-pointer (a touch screen with a mouse too); hover-only controls and
    // wording stay on the primary pointer.
    expect(styles).toMatch(/@media \(max-width: 560px\), \(any-pointer: coarse\) \{\s*\.df-flist \{/);
    expect(styles).toMatch(/@media \(pointer: coarse\) \{\s*\.calendar-start-again \{\s*display: none;/);
  });
});
