import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const componentRoot = fileURLToPath(new URL("./", import.meta.url));
const primaryAction = readFileSync(`${componentRoot}PrimaryTimerAction.tsx`, "utf8");
const dashboard = readFileSync(`${componentRoot}DayframeDashboard.tsx`, "utf8");
const theme = readFileSync(fileURLToPath(new URL("../lib/mobileTheme.ts", import.meta.url)), "utf8");

describe("primary mobile timer action geometry", () => {
  it("matches the canonical web glyph proportions inside the existing 44-point control", () => {
    expect(primaryAction).toContain("PRIMARY_TIMER_ACTION_SIZE = 44");
    expect(primaryAction).toContain("PRIMARY_TIMER_PLAY_GLYPH_SIZE = 18");
    expect(primaryAction).toContain("PRIMARY_TIMER_STOP_GLYPH_SIZE = 14");
    expect(primaryAction).toContain("PRIMARY_TIMER_PLAY_OFFSET_X = 1");
    expect(primaryAction).toContain('PRIMARY_TIMER_ICON_VIEWBOX = "0 0 24 24"');
    expect(primaryAction).toContain(
      "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"
    );
    expect(primaryAction).toMatch(/<Rect[\s\S]*height=\{18\}[\s\S]*rx=\{2\}[\s\S]*width=\{18\}[\s\S]*x=\{3\}[\s\S]*y=\{3\}/);
    expect(primaryAction).not.toMatch(/shadow|elevation/i);
  });

  it("uses the shared geometry only for primary Play and Stop controls", () => {
    expect(dashboard.match(/<PrimaryTimerAction/g)).toHaveLength(2);
    expect(dashboard).toContain('mode="play"');
    expect(dashboard).toContain('mode="stop"');
    expect(dashboard).toContain("<PlayGlyph color={canReplay ? theme.accentText : theme.textSecondary} size={14} />");
    expect(theme).not.toMatch(/\bplayButton:|\bstopButton:/);
  });
});
