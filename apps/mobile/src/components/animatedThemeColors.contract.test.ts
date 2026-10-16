import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Production TF121 (16 Oct 2026): Today's blocks kept their light surface under dark text after
// the system appearance changed, until the app restarted. The rows' surface was the one theme
// colour drawn by a Reanimated style worklet. Theme colours belong in plain styles, which every
// render repaints; a UI-thread style may animate opacity, transforms or sizes, never a theme colour.
// The guard reads the TypeScript syntax tree: inside the worklet passed to `useAnimatedStyle` or
// `useAnimatedProps` (not its dependency list, not comments) it rejects any reference to `theme`
// and any `interpolateColor` call.
const root = fileURLToPath(new URL("../..", import.meta.url));
const ANIMATED_HOOKS = new Set(["useAnimatedStyle", "useAnimatedProps"]);

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

/** A `theme` identifier used as a value (not a property name such as `x.theme` or `{ theme: … }`). */
function isThemeReference(node: ts.Identifier) {
  if (node.text !== "theme") return false;
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return false;
  return true;
}

/** Each problem inside an animated-style worklet in one source file. */
export function animatedThemeColourOffences(source: string, fileName = "source.tsx"): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offences: string[] = [];
  function inspectWorklet(node: ts.Node) {
    if (ts.isIdentifier(node) && isThemeReference(node)) {
      offences.push(`theme at ${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    if (ts.isCallExpression(node) && calleeName(node.expression) === "interpolateColor") {
      offences.push(`interpolateColor at ${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    ts.forEachChild(node, inspectWorklet);
  }
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ANIMATED_HOOKS.has(calleeName(node.expression) ?? "") && node.arguments[0]) {
      inspectWorklet(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return offences;
}

describe("animated styles never carry theme colours", () => {
  it("finds theme colours however the worklet is written", () => {
    expect(animatedThemeColourOffences("useAnimatedStyle(() => ({ backgroundColor: theme.surface }));")).toHaveLength(1);
    expect(animatedThemeColourOffences("useAnimatedStyle (() => ({ backgroundColor: theme['surface'] }));")).toHaveLength(1);
    expect(animatedThemeColourOffences("useAnimatedStyle<ViewStyle>(() => { const { surface } = theme; return { backgroundColor: surface }; });")).toHaveLength(1);
    expect(animatedThemeColourOffences("Reanimated.useAnimatedStyle(() => ({ color: \")\" + theme.text }));")).toHaveLength(1);
    expect(animatedThemeColourOffences("useAnimatedProps(() => ({ fill: interpolateColor(p.value, [0, 1], [a, b]) }));")).toHaveLength(1);
  });

  it("allows opacity and transforms, comments and dependency lists", () => {
    expect(animatedThemeColourOffences([
      "// theme.surface stays in the plain style",
      "const style = useAnimatedStyle(() => ({ opacity: highlight.value, transform: [{ translateX: x.value }] }), [theme.surface]);",
      "const plain = { backgroundColor: theme.surface };",
      "const other = useAnimatedStyle(() => ({ width: props.theme ? 1 : 0, height: { theme: 1 }.theme }));"
    ].join("\n"))).toEqual([]);
  });

  it("keeps theme colours out of every animated style in the app", () => {
    const offenders = [...sources(join(root, "src")), ...sources(join(root, "app"))].flatMap((path) =>
      animatedThemeColourOffences(readFileSync(path, "utf8"), path).map((offence) => `${relative(root, path)}: ${offence}`));
    expect(offenders).toEqual([]);
  });
});
