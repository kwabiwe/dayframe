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
  "Timer", "Inbox"
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

describe("icon rule (UIA-212)", () => {
  it("draws Dayframe things from the registry, not lucide-react", () => {
    const root = process.cwd();
    const offenders = ["src/components", "src/app"].flatMap((dir) => files(join(root, dir))).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const imported = [...source.matchAll(/import \{([^}]*)\} from "lucide-react"/g)]
        .flatMap((match) => match[1].split(",").map((name) => name.trim().split(/\s+as\s+/)[0]))
        .filter(Boolean);
      const things = THEME_FILES.has(relative(root, path)) ? DAYFRAME_THINGS : [...DAYFRAME_THINGS, "Moon", "Sun"];
      return imported.filter((name) => things.includes(name)).map((name) => `${relative(root, path)}: ${name}`);
    });
    expect(offenders).toEqual([]);
  });
});
