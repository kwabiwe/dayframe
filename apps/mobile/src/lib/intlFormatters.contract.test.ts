import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Hermes builds a new Intl formatter on every toLocale*String call and every `new Intl.*`
// (about a millisecond each on an iPhone 11), and screens that re-render every second or format
// every visible day made that the largest idle cost (investigation 2026-10-12, Instruments run 2).
// Performance budget (.codex/reference/performance.md): format through `formatLocaleDate` /
// `localeDateFormatter`, which cache one formatter per option set and time zone, or a module-level
// constant.
const mobileRoot = new URL("../../", import.meta.url).pathname;
const CACHE = "src/lib/localeDateFormat.ts";
const PER_CALL = /\.toLocale(Date|Time)?String\(\s*(undefined|["'`])|\.toLocale(Date|Time)String\(/;
const NEW_INTL = /new Intl\.[A-Za-z]+\(/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|contract)\./.test(name) ? [path] : [];
  });
}

describe("Intl formatters on hot paths", () => {
  it("never formats dates per call outside the cache, and builds formatters only at module level", () => {
    const offences: string[] = [];
    for (const path of [...sources(join(mobileRoot, "src")), ...sources(join(mobileRoot, "app"))]) {
      const file = relative(mobileRoot, path);
      if (file === CACHE) continue;
      readFileSync(path, "utf8").split("\n").forEach((line, index) => {
        const code = line.replace(/\/\/.*$/, "");
        if (PER_CALL.test(code)) offences.push(`${file}:${index + 1} per-call toLocale*String`);
        if (NEW_INTL.test(code) && !/^(export )?const [A-Z0-9_]+ = new Intl\./.test(code)) {
          offences.push(`${file}:${index + 1} new Intl.* outside a module-level constant`);
        }
      });
    }
    expect(offences).toEqual([]);
  });

  it("the cache returns one formatter per option set and zone", async () => {
    const { localeDateFormatter } = await import("./localeDateFormat");
    const options = { day: "numeric", month: "short" } as const;
    expect(localeDateFormatter(options)).toBe(localeDateFormatter({ ...options }));
  });
});
