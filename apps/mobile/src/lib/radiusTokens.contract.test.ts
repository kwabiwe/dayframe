import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// UIA-103: iPhone cards, sheets and 44-point round buttons read the Blocks radius scale
// (DAYFRAME_BLOCKS.radius: phoneCard 22, sheet 28, pill), not hand-typed numbers.
const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("Blocks radius tokens on iPhone (UIA-103)", () => {
  it("no card, sheet or round button types its radius by hand", () => {
    const offenders = ["app", "src"]
      .flatMap((root) => files(join(mobileRoot, root)))
      .flatMap((path) => readFileSync(path, "utf8").split("\n").map((line, index) => ({ line, at: `${relative(mobileRoot, path)}:${index + 1}` })))
      .filter(({ line }) => /border(?:Top(?:Left|Right))?Radius: (?:22|24)\b/.test(line))
      .map(({ at }) => at);
    expect(offenders).toEqual([]);
  });
});
