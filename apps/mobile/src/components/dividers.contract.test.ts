import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// Owner rules, 28 Oct 2026 (the web half is apps/web/src/app/dividers.contract.test.ts, #614):
// (1) a divider line never touches its container's edges; it is inset on both sides, app-wide on the
// iPhone (Calendar List, sheets, Settings, menus, Library lists, Today). (2) The Calendar row's compact
// "Yes" pill is the size for question and sheet answer pills, each with a 44-point target.
//
// Every hairline in the app is drawn with the shared mechanism (`<InsetDivider>` or
// `insetDividerStyle`, src/lib/insetDivider.ts) or listed below with the reason it may span its box.

vi.mock("react-native", () => ({ StyleSheet: { create: <T,>(value: T) => value, hairlineWidth: 0.5 } }));

const mobile = fileURLToPath(new URL("../..", import.meta.url));
const read = (path: string) => readFileSync(join(mobile, path), "utf8");

function sourceFiles(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".build") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path, pattern);
    return pattern.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const appSources = [...sourceFiles(join(mobile, "src"), /\.tsx?$/), ...sourceFiles(join(mobile, "app"), /\.tsx?$/)]
  .map((path) => ({ path: relative(mobile, path), text: readFileSync(path, "utf8") }));

/** The mechanism itself. */
const MECHANISM = "src/lib/insetDivider.ts";

/** Full-width lines that are frames or structure rather than row dividers, with the reason. */
const EXEMPT: Record<string, string> = {
  "src/components/reports/ReportActivityChart.tsx": "the activity chart's tick lines are chart grid structure, not row dividers",
  "src/components/review/ReviewDeckSegments.tsx": "the labelled “Older than 7 days” split flexes beside its label inside the deck's padding",
  "src/components/DayframeDashboard.tsx": "the history list's ItemSeparatorComponent is a 14-point gap with no line"
};

/** Lines that draw a hairline: a top or bottom border, a separator component, or a 1-point line View. */
function hairlines(text: string) {
  const lines = text.split("\n");
  return lines.flatMap((line, index) => {
    if (/\bborder(?:Top|Bottom|Block(?:Start|End)?)Width\b/.test(line)) return [line.trim()];
    if (/\b(?:ItemSeparatorComponent|SectionSeparatorComponent|<Divider\b)/.test(line)) return [line.trim()];
    if (/\bheight:\s*(?:StyleSheet\.hairlineWidth|0\.5|1)\b(?!\.)/.test(line)) {
      // A 1-point View is a line when its own style fills it with a line colour.
      const near = lines.slice(Math.max(0, index - 4), index + 5).join("\n");
      if (/\bborder(?:Strong)?\b|hairlineWidth/.test(near) && !/fontSize/.test(near)) return [line.trim()];
    }
    return [];
  });
}

describe("iPhone row dividers are inset on both sides", () => {
  it("draws every hairline with the shared inset mechanism, unless the file is a listed frame", () => {
    const offenders = appSources
      .filter(({ path }) => path !== MECHANISM && !(path in EXEMPT))
      .flatMap(({ path, text }) => hairlines(text).map((line) => `${path}: ${line}`));
    expect(offenders).toEqual([]);
  });

  it("keeps the exemption list honest: each listed file still draws its line", () => {
    for (const path of Object.keys(EXEMPT)) {
      const text = appSources.find((source) => source.path === path)?.text ?? "";
      expect(hairlines(text).length, path).toBeGreaterThan(0);
    }
  });

  it("never sets an inset to zero unless the line names the container padding that insets it", () => {
    for (const { path, text } of appSources) {
      for (const match of text.matchAll(/<InsetDivider\b[^>]*\/>/g)) {
        const tag = match[0];
        expect(tag, path).toMatch(/color=\{theme\.border\}/);
        if (/\b(?:start|end)=\{0\}/.test(tag)) expect(tag, path).toMatch(/paddedBy="[^"]{8,}"/);
        expect(tag, path).not.toMatch(/paddedBy=""/);
      }
      for (const match of text.matchAll(/insetDividerStyle\(\{[^)]*\}\)/g)) {
        expect(match[0], path).not.toMatch(/\b(?:start|end):\s*0\b/);
      }
    }
  });

  it("insets on both sides by default, logically (start / end), so a right-to-left layout keeps its gaps", async () => {
    const { DIVIDER_INSET, insetDividerStyle } = await import("../lib/insetDivider");
    expect(DIVIDER_INSET).toBe(16);
    expect(insetDividerStyle({ color: "line" })).toEqual({ backgroundColor: "line", height: 0.5, marginEnd: 16, marginStart: 16 });
    expect(insetDividerStyle({ color: "line", edge: "top", end: 14, start: 60 }))
      .toEqual({ backgroundColor: "line", end: 14, height: 0.5, position: "absolute", start: 60, top: 0 });
    expect(insetDividerStyle({ color: "line", edge: "bottom" })).toMatchObject({ bottom: 0, end: 16, start: 16 });
    // Only a named container padding lets the line reach the content edge.
    expect(insetDividerStyle({ color: "line", paddedBy: "the card's padding" })).toMatchObject({ marginEnd: 0, marginStart: 0 });
    expect(read(MECHANISM)).not.toMatch(/\b(?:left|right|marginLeft|marginRight|marginHorizontal):/);
  });

  it("insets Today's and Calendar › List rows past the block (60 points), as the web's rows", () => {
    const calendar = read("src/components/calendar/CalendarListView.tsx");
    expect(calendar).toMatch(/<InsetDivider color=\{theme\.border\} edge="top" end=\{14\} start=\{DIVIDER_INSET_PAST_BLOCK\} \/>/);
    expect(read("src/components/today/TodayBlockRows.tsx")).toMatch(/<InsetDivider color=\{theme\.border\} edge="top" start=\{DIVIDER_INSET_PAST_BLOCK\} \/>/);
    expect(read("src/components/today/TodaySwitchSheet.tsx")).toMatch(/start=\{DIVIDER_INSET_PAST_BLOCK\}/);
    expect(read(MECHANISM)).toMatch(/export const DIVIDER_INSET_PAST_BLOCK = 60;/);
  });

  it("covers the sheets, Settings, menus and Library lists", () => {
    for (const path of [
      "src/components/calendar/LocationCorrectionSheet.tsx",
      "src/components/calendar/SheetNearbySearch.tsx",
      "src/components/location/LocationReviewCorrectionEditor.tsx",
      "src/components/settings/SettingsBlocks.tsx",
      "src/components/places/PlaceRoleSheet.tsx",
      "app/places.tsx",
      "app/settings.tsx",
      "app/place-editor.tsx"
    ]) expect(read(path), path).toMatch(/<InsetDivider\b/);
    const theme = read("src/lib/mobileTheme.ts");
    expect(theme).toMatch(/overflowMenuDivider: insetDividerStyle\(\{ color: theme\.border, end: 18, start: 18 \}\)/);
    expect(theme).toMatch(/tagSuggestionDivider: insetDividerStyle\(/);
    expect(theme).toMatch(/taskSuggestionRowDivider: insetDividerStyle\(/);
  });

  it("keeps the native Calendar's only hairline as its hour grid line, with no list separators", () => {
    const swift = sourceFiles(join(mobile, "modules"), /\.swift$/)
      .filter((path) => !/\/Tests?\//.test(path))
      .map((path) => readFileSync(path, "utf8")).join("\n");
    expect(swift).not.toMatch(/\bDivider\(\)|listRowSeparator|separatorStyle|separatorInset/);
    const hairline = [...swift.matchAll(/\.frame\(height: max\(1 \/ displayScale, 0\.5\)\)\n\s*\.padding\(\.leading, hourLabelWidth\)/g)];
    expect(hairline).toHaveLength(1);
  });
});

describe("compact answer pills", () => {
  it("sizes question and sheet answers as the Calendar row's Yes pill, each with a 44-point target", () => {
    const pill = read("src/components/compactPill.ts");
    expect(pill).toMatch(/export const COMPACT_PILL_HEIGHT = 32;/);
    const slop = pill.match(/COMPACT_PILL_HIT_SLOP = \{ top: (\d+), bottom: (\d+), left: (\d+), right: (\d+) \}/)!;
    const [top, bottom, left, right] = slop.slice(1).map(Number);
    expect(32 + top + bottom).toBeGreaterThanOrEqual(44);
    expect(pill).toMatch(/pill: \{[^}]*minHeight: COMPACT_PILL_HEIGHT[^}]*paddingHorizontal: 16[^}]*radius\.pill/);
    expect(pill).toMatch(/text: \{ fontSize: 14, fontWeight: "700" \}/);
    // Wrapped rows sit far enough apart that neighbouring 44-point targets never overlap.
    const gaps = pill.match(/answers: \{[^}]*columnGap: (\d+), rowGap: (\d+)/)!;
    expect(Number(gaps[2])).toBeGreaterThanOrEqual(top + bottom);
    expect(Number(gaps[1])).toBeGreaterThanOrEqual(left + right);
  });

  it("uses the shared pill and its hit slop for every inline and sheet answer", () => {
    for (const path of ["src/components/calendar/CalendarListView.tsx", "src/components/calendar/LocationCorrectionSheet.tsx"]) {
      const text = read(path);
      expect(text, path).toMatch(/from "\.\.\/compactPill"/);
      expect(text, path).not.toMatch(/const COMPACT_PILL_HIT_SLOP/);
      const pills = text.match(/\[compactPillStyles\.pill\b/g)?.length ?? 0;
      expect(pills, path).toBeGreaterThan(0);
      expect(text.match(/hitSlop=\{COMPACT_PILL_HIT_SLOP\}/g)?.length, path).toBe(pills);
    }
    // The sheet's "?" answers wrap with the shared row gap, not the 44-point pills' 8.
    expect(read("src/components/calendar/LocationCorrectionSheet.tsx")).toMatch(/<View style=\{compactPillStyles\.answers\}>/);
  });
});
