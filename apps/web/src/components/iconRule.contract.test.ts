import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import * as lucide from "lucide-react";
import { describe, expect, it } from "vitest";
import { DAYFRAME_GLYPHS } from "@dayframe/shared";

// UIA-212 (owner option c): anything that stands for a Dayframe thing or action draws its glyph
// from the shared registry (DayframeIcon); lucide stays for generic controls (close, chevrons,
// check, add, search, show/hide, theme). These lucide icons have registry glyphs and mean Dayframe
// things, so they must not come back from lucide-react.
// Every registry glyph names a Dayframe thing unless it is listed here as a generic control.
const GENERIC_CONTROLS = new Set(["X", "Check", "ChevronRight", "Search", "Plus", "Ellipsis"]);
const pascal = (kebab: string) => kebab.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("");
// Lucide icons with no registry glyph that still stand for Dayframe things.
const EXTRA_THINGS = ["Sparkles", "AlarmClock", "Stopwatch", "Map", "MapPinned", "Library", "ListChecks", "PinOff", "Tags"];
const THING_NAMES = [
  ...Object.keys(DAYFRAME_GLYPHS).map(pascal).filter((name) => !GENERIC_CONTROLS.has(name)),
  ...EXTRA_THINGS
];
// Lucide exports many names for one icon (Home and House, BarChart3 and ChartColumn, FooIcon,
// LucideFoo …): an import is a Dayframe thing when it is the same component as one of the above.
const lucideExports = lucide as unknown as Record<string, unknown>;
const THING_COMPONENTS = new Set(THING_NAMES.map((name) => lucideExports[name]).filter(Boolean));
const THEME_COMPONENTS = new Set(["Sun", "Moon"].map((name) => lucideExports[name]));
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
  const fromLucide = (node: ts.Expression | undefined) =>
    Boolean(node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === "lucide-react");
  const visit = (node: ts.Node) => {
    // Type-only imports draw nothing.
    if (ts.isImportDeclaration(node) && fromLucide(node.moduleSpecifier) && !node.importClause?.isTypeOnly) {
      const bindings = node.importClause?.namedBindings;
      if (node.importClause?.name) names.push("default import");
      if (bindings && ts.isNamespaceImport(bindings)) names.push("* (namespace import)");
      else if (bindings) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue;
          const imported = (element.propertyName ?? element.name).text;
          // The aggregate `icons` map reaches every icon, like a namespace import.
          names.push(imported === "icons" ? "icons (all icons)" : imported);
        }
      }
    } else if (ts.isExportDeclaration(node) && fromLucide(node.moduleSpecifier)) {
      if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) names.push("* (re-export)");
      else for (const element of node.exportClause.elements) names.push((element.propertyName ?? element.name).text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && fromLucide(node.arguments[0])) {
      names.push("dynamic import");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

function offendersIn(source: string, allowTheme: boolean) {
  return lucideImports(source).filter((name) => {
    if (/^\*|^icons|^default|^dynamic/.test(name)) return true;
    const component = lucideExports[name];
    if (allowTheme && THEME_COMPONENTS.has(component)) return false;
    return THING_COMPONENTS.has(component);
  });
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
    expect(offendersIn('import { PlayIcon, LucidePlay, MapPinIcon } from "lucide-react";', false)).toEqual(["PlayIcon", "LucidePlay", "MapPinIcon"]);
    expect(offendersIn('import { UserCircle2, Code2, User2, ForkKnife, Square as Stop } from "lucide-react";', false)).toEqual(["UserCircle2", "Code2", "User2", "ForkKnife", "Square"]);
    expect(offendersIn("const lucide = await import(`lucide-react`);", false)).toEqual(["dynamic import"]);
    expect(offendersIn('import type { Bike } from "lucide-react";', false)).toEqual([]);
    expect(offendersIn('import { type Bike, X } from "lucide-react";', false)).toEqual([]);
    expect(offendersIn('import { XIcon, LucideChevronDown } from "lucide-react";', false)).toEqual([]);
    expect(offendersIn('import { Bike, RotateCcw, Home, BarChart3 } from "lucide-react";', false)).toEqual(["Bike", "RotateCcw", "Home", "BarChart3"]);
    expect(offendersIn('import { icons as Icons } from "lucide-react";', false)).toEqual(["icons (all icons)"]);
    expect(offendersIn('export { Play as StartIcon } from "lucide-react";', false)).toEqual(["Play"]);
    expect(offendersIn('const lucide = await import("lucide-react");', false)).toEqual(["dynamic import"]);
  });
});
