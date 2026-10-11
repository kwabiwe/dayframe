import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { DAYFRAME_GLYPHS } from "@dayframe/shared";

// UIA-212 (owner option c): anything that stands for a Dayframe thing or action draws its glyph
// from the shared registry (DayframeIcon); lucide stays for generic controls (close, chevrons,
// check, add, search, show/hide, theme). These lucide icons have registry glyphs and mean Dayframe
// things, so they must not come back from lucide-react.
// Every registry glyph names a Dayframe thing unless it is listed here as a generic control.
const GENERIC_CONTROLS = new Set(["X", "Check", "ChevronRight", "Search", "Plus", "Ellipsis", "Square"]);
// Square is generic as a shape; Stop uses the registry's own square through the Play/Stop control.
const pascal = (kebab: string) => kebab.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("");
// Lucide names that draw the same icon as a registry glyph.
const LUCIDE_ALIASES = ["Home", "BarChart", "BarChart2", "BarChart3", "BarChart4", "ChartBar", "Edit", "Edit2", "Edit3", "Trash", "MapPinned", "Map", "Sparkles", "AlarmClock", "Stopwatch", "Tags", "PinOff", "Library", "ListChecks"];
const DAYFRAME_THINGS = [
  ...Object.keys(DAYFRAME_GLYPHS).map(pascal).filter((name) => !GENERIC_CONTROLS.has(name)),
  ...LUCIDE_ALIASES
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
  const base = (name: string) => name.replace(/^Lucide(?=[A-Z])/, "").replace(/Icon$/, "") || name;
  const fromLucide = (node: ts.Expression | undefined) => Boolean(node && ts.isStringLiteral(node) && node.text === "lucide-react");
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && fromLucide(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      if (node.importClause?.name) names.push("default import");
      if (bindings && ts.isNamespaceImport(bindings)) names.push("* (namespace import)");
      else if (bindings) {
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          // The aggregate `icons` map reaches every icon, like a namespace import.
          names.push(imported === "icons" ? "icons (all icons)" : base(imported));
        }
      }
    } else if (ts.isExportDeclaration(node) && fromLucide(node.moduleSpecifier)) {
      if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) names.push("* (re-export)");
      else for (const element of node.exportClause.elements) names.push(base((element.propertyName ?? element.name).text));
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && fromLucide(node.arguments[0])) {
      names.push("dynamic import");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

function offendersIn(source: string, allowTheme: boolean) {
  const things = allowTheme ? DAYFRAME_THINGS.filter((name) => name !== "Sun" && name !== "Moon") : DAYFRAME_THINGS;
  return lucideImports(source).filter((name) => /^\*|^icons|^default|^dynamic/.test(name) || things.includes(name));
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
    expect(offendersIn('import { Bike, RotateCcw, Home, BarChart3 } from "lucide-react";', false)).toEqual(["Bike", "RotateCcw", "Home", "BarChart3"]);
    expect(offendersIn('import { icons as Icons } from "lucide-react";', false)).toEqual(["icons (all icons)"]);
    expect(offendersIn('export { Play as StartIcon } from "lucide-react";', false)).toEqual(["Play"]);
    expect(offendersIn('const lucide = await import("lucide-react");', false)).toEqual(["dynamic import"]);
  });
});
