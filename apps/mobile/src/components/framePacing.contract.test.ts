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

// Investigation 2026-10-07 (dropped frames): JS-thread animations and per-second rebuilds starve frames.
describe("mobile frame pacing", () => {
  it("never drives an RN Animated value on the JS thread", () => {
    const files = ["app", "src", "modules"].flatMap((folder) => sources(join(mobileRoot, folder)));
    const offenders = files.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      // Every timing/spring/decay call must opt into the native driver explicitly; RN falls back to
      // the JS driver when the flag is missing or false.
      return [...source.matchAll(/Animated\.(timing|spring|decay)\(/g)]
        .map((match) => source.slice(match.index, source.indexOf("})", match.index) + 2))
        .filter((call) => !/useNativeDriver: true/.test(call))
        .map((call) => `${path}: ${call.slice(0, 60)}`);
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
