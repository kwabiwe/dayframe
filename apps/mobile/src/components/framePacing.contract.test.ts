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
    const offenders = [...sources(join(mobileRoot, "app")), ...sources(join(mobileRoot, "src"))]
      .filter((path) => readFileSync(path, "utf8").includes("useNativeDriver: false"));
    expect(offenders).toEqual([]);
  });

  it("rebuilds Today's history and the native Calendar model once a minute, not every second", () => {
    expect(dashboard).toContain("const minuteNow = minuteClock(now, newestShownMs);");
    expect(dashboard).toMatch(/buildHistoryDaySections\(\{[\s\S]*?nowMs: minuteNow[\s\S]*?\}\),\s*\[historySourceEntries, minuteNow\]/);
    expect(dashboard).toMatch(/buildNativeCalendarBridgeState\(\{[\s\S]*?now: minuteNow,/);
    expect(dashboard).toMatch(/<HistoryDayCard[\s\S]*?now=\{minuteNow\}/);
  });
});
