import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(process.cwd(), "../..");
const sourceRoots = ["apps/web/src", "apps/mobile/src", "apps/mobile/app"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("activity colour display", () => {
  it("never paints the stored identity hex; surfaces use the per-theme display value", () => {
    const offenders = sourceRoots
      .flatMap((root) => sourceFiles(join(repoRoot, root)))
      .flatMap((path) => readFileSync(path, "utf8").split("\n").map((line, index) => ({ path, line, index })))
      .filter(({ line }) => /\.hex\b/.test(line))
      .map(({ path, line, index }) => `${relative(repoRoot, path)}:${index + 1} ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
