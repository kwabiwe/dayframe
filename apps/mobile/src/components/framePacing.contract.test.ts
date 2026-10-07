import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));
const dashboard = readFileSync(fileURLToPath(new URL("./DayframeDashboard.tsx", import.meta.url)), "utf8");

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** The text of the object literal starting at `open` (a "{"), matched by brace depth. */
function objectLiteral(source: string, open: number) {
  if (open < 0 || source[open] !== "{") return "";
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(open, index + 1);
  }
  return "";
}

// Investigation 2026-10-07 (dropped frames): JS-thread animations and per-second rebuilds starve frames.
describe("mobile frame pacing", () => {
  it("settles the screen entrance fade at 1 so a header mounted after it is never left invisible", () => {
    // Simulator 7 Oct 2026: the native-driver fade left the JS value at 0 and Today's later-mounted
    // header (avatar, goal frame, timer, mosaic, nudge) rendered fully transparent.
    expect(dashboard).toMatch(/Animated\.timing\(entrance, \{[\s\S]*?useNativeDriver: true\s*\}\)\.start\(\(\) => entrance\.setValue\(1\)\);/);
  });

  it("never drives an RN Animated value on the JS thread", () => {
    const files = ["app", "src", "modules"].flatMap((folder) => sources(join(mobileRoot, folder)));
    const offenders = files.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      // Every timing/spring/decay call must opt into the native driver explicitly; RN falls back to
      // the JS driver when the flag is missing or false.
      const explicitFalse = source.includes("useNativeDriver: false") ? [`${path}: useNativeDriver: false`] : [];
      // Options must be an inline object with the flag; a variable could hide `false`.
      const calls = [...source.matchAll(/Animated\.(timing|spring|decay)\(\s*[^,]+,\s*(\{)?/g)]
        .filter((match) => !match[2] || !/useNativeDriver: true/.test(objectLiteral(source, match.index + match[0].length - 1)))
        .map((match) => `${path}: ${match[0].slice(0, 60)}`);
      const events = [...source.matchAll(/Animated\.event\(/g)]
        .filter((match) => !/useNativeDriver: true/.test(objectLiteral(source, source.indexOf("{", source.indexOf("]", match.index)))))
        .map(() => `${path}: Animated.event without useNativeDriver: true`);
      return [...explicitFalse, ...calls, ...events];
    });
    expect(offenders).toEqual([]);
  });

  it("rebuilds Today's history and the native Calendar model once a minute, not every second", () => {
    expect(dashboard).toContain("const minuteNow = minuteClock(now, newestShownMs);");
    expect(dashboard).toMatch(/buildHistoryDaySections\(\{[\s\S]*?nowMs: minuteNow[\s\S]*?\}\),\s*\[historySourceEntries, minuteNow\]/);
    expect(dashboard).toMatch(/buildNativeCalendarBridgeState\(\{[\s\S]*?now: minuteNow,/);
    expect(dashboard).toMatch(/<HistoryDayCard[\s\S]*?now=\{minuteNow\}/);
    // The native Calendar receives a stable model object between real changes.
    expect(dashboard).toContain("model={isFocused && refreshing ? nativeCalendarModelRefreshing : nativeCalendarModel}");
  });
});
