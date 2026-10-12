import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A4: Settings paints last-known values stored on the device, but they are display only. Actions
// read the live permission and state; only the `shown…` display values read `lastKnown`.
const mobileRoot = resolve(__dirname, "../../..");
const settings = readFileSync(join(mobileRoot, "app/settings.tsx"), "utf8");
const layout = readFileSync(join(mobileRoot, "app/_layout.tsx"), "utf8");

function functionBody(signature: string) {
  const start = settings.indexOf(signature);
  expect(start, signature).toBeGreaterThan(-1);
  return settings.slice(start, settings.indexOf("\n  }\n", start));
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (name === "node_modules" || name === "ios") return [];
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("Settings' last-known values are display only (A4)", () => {
  it("never lets an action read a last-known or shown value", () => {
    for (const signature of [
      "async function enableLocation()",
      "async function toggleLocationLearning(enabled: boolean)",
      "async function handleMotionFitnessAction()",
      "async function toggleReviewNudge(enabled: boolean)",
      "async function changeReviewNudge(",
      "async function connectAppleHealth()",
      "async function updateHealthImportPreference(",
      "async function setSleepImport(enabled: boolean)"
    ]) {
      const body = functionBody(signature);
      expect(body, signature).not.toMatch(/lastKnown|\bshown[A-Z]/);
    }
    // Motion & Fitness: the pill's press re-reads the live status before acting.
    expect(functionBody("async function handleMotionFitnessAction()")).toContain("const status = await readMotionFitnessStatus();");
    // Controls whose action needs this visit's live read do nothing until it lands.
    expect(settings.match(/onValueChange=\{\(enabled\) => \{ if \(locationDiagnostics\) void toggleLocationLearning\(enabled\); \}\}/g)).toHaveLength(2);
    expect(settings).toContain("onDecrease={() => { if (reviewNudge) void changeReviewNudge(");
    expect(settings).toContain("onIncrease={() => { if (reviewNudge) void changeReviewNudge(");
    // The Needs attention rows (with Retry/Discard) come from the live lists only.
    expect(settings).toContain("{liveSyncStatus.issueCount > 0 ? (");
  });

  it("reads last-known values only in Settings' display layer", () => {
    const readers = sourceFiles(join(mobileRoot, "app"))
      .concat(sourceFiles(join(mobileRoot, "src")))
      .filter((path) => /useSettingsLastKnown|readSettingsLastKnown/.test(readFileSync(path, "utf8")))
      .map((path) => relative(mobileRoot, path))
      .sort();
    expect(readers).toEqual(["app/settings.tsx", "src/lib/settingsLastKnown.ts"]);
    expect(settings.match(/useSettingsLastKnown\(\)/g)).toHaveLength(1);
    // The sync status line falls back per count; the rows below it never do.
    expect(settings).toContain("const syncStatus = syncHelpStatus(shownSyncHelpCounts({");
  });

  it("is primed at app start, before Settings opens", () => {
    expect(layout).toContain("void primeSettingsLastKnown();");
  });
});
