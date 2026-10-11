import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
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

/**
 * Names imported from lucide-react, read from the syntax tree (comments and quotes don't matter),
 * normalised to lucide's base name ("PlayIcon" and "LucidePlay" are Play). A namespace import is an
 * offender itself, since it can reach any icon.
 */
export function lucideImports(source: string) {
  const file = ts.createSourceFile("file.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names: string[] = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== "lucide-react") continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      names.push("* (namespace import)");
      continue;
    }
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      names.push(imported.replace(/^Lucide(?=[A-Z])/, "").replace(/Icon$/, "") || imported);
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
    expect(offendersIn('import { /* recording */ Play } from "lucide-react";', false)).toEqual(["Play"]);
    expect(offendersIn('import /* icons */ * as Icons from "lucide-react";', false)).toEqual(["* (namespace import)"]);
    expect(offendersIn('import { PlayIcon, LucidePlay, MapPinIcon } from "lucide-react";', false)).toEqual(["Play", "Play", "MapPin"]);
    expect(offendersIn('import { XIcon, LucideChevronDown } from "lucide-react";', false)).toEqual([]);
  });
});
