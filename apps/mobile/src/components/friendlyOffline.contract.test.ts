import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Staging feedback B1/B2: offline and failed reads on iPhone are drawn as Blocks states or plain
 * sentences, never as a raw native error ("fetch failed: UnexpectedException: … Promise.swift:56").
 */
const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(mobileRoot, path), "utf8");
const places = read("app/places.tsx");
const reports = read("src/components/reports/ReportsTab.tsx");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("friendly offline states (staging feedback B1, B2)", () => {
  it("draws Reports' unavailable range as the Blocks empty state with a Try again pill", () => {
    expect(reports).toContain("<BlocksEmptyState");
    expect(reports).toContain('actionLabel="Try again"');
    expect(reports).toContain('title={rangeFailure.offline ? "You\'re offline" : "Report didn\'t load"}');
    expect(reports).not.toContain('"Connect to load this report range"');
    expect(reports).not.toMatch(/>Retry</);
    // A cached report for the range is still shown first (the empty state is only for no report).
    expect(reports).toContain("{!report && rangeFailure ? (");
  });

  it("never alerts on a Saved places read; the list stays, or the Blocks state says why", () => {
    const load = places.slice(places.indexOf("const load = useCallback("), places.indexOf("useEffect(() => {\n    void load();"));
    expect(load).not.toContain("Alert.alert");
    expect(load).toContain('setLoadFailure({ offline: mobileFailureKind(error) === "offline" });');
    expect(load).toContain("} else if (options?.refresh) {");
    expect(places).toContain('testID="places-unavailable"');
  });

  it("draws Home/Work and the place groups only from a list that was read (Codex r1)", () => {
    expect(places).toContain("const pageState = placesPageState(Boolean(data), Boolean(loadFailure));");
    // Pending first, then failed; the groups are the last branch, reached only when ready.
    const branches = places.slice(places.indexOf('{pageState === "pending" ? ('), places.indexOf('<SettingsBlockGroup foot="Trips and time away'));
    expect(branches).toContain('testID="places-pending"');
    expect(branches).toContain("Loading your places…");
    expect(branches).toContain(') : pageState === "failed" && loadFailure ? (');
    expect(branches).not.toMatch(/ActivityIndicator|RefreshControl/);
    // Set never opens adding a place from an unknown list.
    expect(places).toContain("if (roleSaving.current || !dataRef.current) return;");
  });

  it("lets the empty state's explanation scale without a cap (body role) and keeps 44-point Try again", () => {
    const empty = read("src/components/blocks/BlocksEmptyState.tsx");
    expect(empty).toMatch(/mobileTextProps\("body"\)\} style=\{\[emptyStyles\.message/);
    expect(empty).toContain("minHeight: 44");
  });

  it("never passes error.message straight into an Alert on iPhone screens outside Settings", () => {
    for (const file of [...sourceFiles(join(mobileRoot, "app")), ...sourceFiles(join(mobileRoot, "src"))]) {
      const path = relative(mobileRoot, file);
      // Settings is owned by another change; its alerts are covered there.
      if (path === "app/settings.tsx") continue;
      const source = readFileSync(file, "utf8");
      for (const call of source.matchAll(/Alert\.alert\(([\s\S]*?)\);/g)) {
        expect(call[1], path).not.toMatch(/error(?:\s+instanceof\s+Error\s*\?\s*error)?\.message/);
      }
    }
  });
});
