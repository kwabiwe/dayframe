import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// UIA-212 (owner option c): anything that stands for a Dayframe thing or action draws its glyph
// from the shared registry (DayframeIcon); lucide stays for generic controls (close, chevrons,
// check, add, search, show/hide, theme). These lucide icons have registry glyphs and mean Dayframe
// things, so they must not come back from lucide-react.
const DAYFRAME_THINGS = [
  "Play", "Square", "Pencil", "Trash2", "MapPin", "MapPinned", "Tag", "Tags", "CalendarDays", "Route",
  "Footprints", "HeartPulse", "House", "Briefcase", "Settings", "LogOut", "Download", "Scissors", "GitMerge",
  "Timer", "Inbox", "Pin", "PinOff", "ChartColumn", "ChartBar", "Library", "ListChecks", "Sparkles", "Map",
  "Sun", "Moon", "Bell", "CircleDot"
];
// The theme switcher's sun/moon/monitor are generic controls.
const THEME_FILES = new Set(["src/components/ThemeSettings.tsx", "src/components/ThemeToggleButton.tsx"]);

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Names imported from lucide-react (any quotes, aliases kept by their lucide name); a namespace import is an offender itself. */
export function lucideImports(source: string) {
  const names: string[] = [];
  for (const match of source.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+["']lucide-react["']/g)) {
    const clause = match[2].trim();
    if (clause.startsWith("*")) {
      names.push("* (namespace import)");
      continue;
    }
    const braces = clause.match(/\{([^}]*)\}/);
    if (!braces) continue;
    for (const part of braces[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
      if (name) names.push(name);
    }
  }
  return names;
}

function offendersIn(source: string, allowTheme: boolean) {
  const things = allowTheme ? DAYFRAME_THINGS.filter((name) => name !== "Sun" && name !== "Moon") : DAYFRAME_THINGS;
  return lucideImports(source).filter((name) => name.startsWith("*") || things.includes(name));
}

describe("icon rule (UIA-212)", () => {
  it("draws Dayframe things from the registry, not lucide-react", () => {
    const root = process.cwd();
    const offenders = ["src/components", "src/app"].flatMap((dir) => files(join(root, dir))).flatMap((path) =>
      offendersIn(readFileSync(path, "utf8"), THEME_FILES.has(relative(root, path))).map((name) => `${relative(root, path)}: ${name}`)
    );
    expect(offenders).toEqual([]);
  });

  it("catches every import form", () => {
    expect(offendersIn('import { Pin, X } from "lucide-react";', false)).toEqual(["Pin"]);
    expect(offendersIn("import { ChartColumn as Chart } from 'lucide-react';", false)).toEqual(["ChartColumn"]);
    expect(offendersIn('import {\n  Library,\n  ListChecks\n} from "lucide-react";', false)).toEqual(["Library", "ListChecks"]);
    expect(offendersIn('import * as Icons from "lucide-react";', false)).toEqual(["* (namespace import)"]);
    expect(offendersIn('import { Moon, Sun, Monitor } from "lucide-react";', true)).toEqual([]);
    expect(offendersIn('import { X, ChevronDown, Search, Check, Plus } from "lucide-react";', false)).toEqual([]);
  });
});
