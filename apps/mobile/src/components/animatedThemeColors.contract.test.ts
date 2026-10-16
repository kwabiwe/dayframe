import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Production TF121 (16 Oct 2026): Today's blocks kept their light surface under dark text after
// the system appearance changed while the app was open, until it restarted. The surface came from
// a Reanimated style worklet. Theme colours belong in plain styles, which every render repaints;
// a UI-thread style may animate opacity, transforms or sizes, never a theme colour.
const root = fileURLToPath(new URL("../..", import.meta.url));

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Each useAnimatedStyle worklet body, up to its closing parenthesis. */
function animatedStyleBodies(source: string) {
  const bodies: string[] = [];
  let index = source.indexOf("useAnimatedStyle(");
  while (index !== -1) {
    let depth = 0;
    let end = index + "useAnimatedStyle".length;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.push(source.slice(index, end + 1));
    index = source.indexOf("useAnimatedStyle(", end);
  }
  return bodies;
}

describe("animated styles never carry theme colours", () => {
  it("keeps theme colours out of every useAnimatedStyle in the app", () => {
    const offenders = [...sources(join(root, "src")), ...sources(join(root, "app"))].flatMap((path) =>
      animatedStyleBodies(readFileSync(path, "utf8"))
        .filter((body) => /\btheme\.[a-zA-Z]+/.test(body) || body.includes("interpolateColor"))
        .map(() => relative(root, path)));
    expect(offenders).toEqual([]);
  });
});
