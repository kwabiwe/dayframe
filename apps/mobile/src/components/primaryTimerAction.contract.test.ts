import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const componentRoot = fileURLToPath(new URL("./", import.meta.url));
const primaryAction = readFileSync(`${componentRoot}PrimaryTimerAction.tsx`, "utf8");
const dashboard = readFileSync(`${componentRoot}DayframeDashboard.tsx`, "utf8");
const timerSurface = readFileSync(`${componentRoot}accessibility/TodayTimerSurface.tsx`, "utf8");
const idleCard = readFileSync(`${componentRoot}today/TodayIdleCard.tsx`, "utf8");
const liveBlock = readFileSync(`${componentRoot}today/TodayLiveBlock.tsx`, "utf8");
const todayLayout = readFileSync(`${componentRoot}today/todayBlocksLayout.ts`, "utf8");
const editSheet = readFileSync(`${componentRoot}ActiveTimerEditSheet.tsx`, "utf8");
const theme = readFileSync(fileURLToPath(new URL("../lib/mobileTheme.ts", import.meta.url)), "utf8");
const layout = readFileSync(fileURLToPath(new URL("../lib/timerCardLayout.ts", import.meta.url)), "utf8");

describe("primary mobile timer action geometry", () => {
  it("matches the canonical web glyph proportions inside the existing 44-point control", () => {
    expect(primaryAction).toContain("PRIMARY_TIMER_ACTION_SIZE = TIMER_CARD_ACTION_SIZE");
    expect(layout).toContain("TIMER_CARD_ACTION_SIZE = 44");
    expect(primaryAction).toContain("PRIMARY_TIMER_PLAY_GLYPH_SIZE = 22");
    expect(primaryAction).toContain("PRIMARY_TIMER_STOP_GLYPH_SIZE = 17");
    expect(primaryAction).toContain("PRIMARY_TIMER_PLAY_OFFSET_X = 1");
    expect(primaryAction).toContain('PRIMARY_TIMER_ICON_VIEWBOX = "0 0 24 24"');
    expect(primaryAction).toContain(
      "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"
    );
    expect(primaryAction).toMatch(/<Rect[\s\S]*height=\{18\}[\s\S]*rx=\{2\}[\s\S]*width=\{18\}[\s\S]*x=\{3\}[\s\S]*y=\{3\}/);
    expect(primaryAction).not.toMatch(/shadow|elevation/i);
  });

  it("uses the shared primary glyph for idle, running and running-edit controls", () => {
    expect(idleCard).toContain('<PrimaryTimerGlyph color={theme.onAccent} mode="play" />');
    expect(liveBlock).toContain('<PrimaryTimerGlyph color={colors.fill} mode="stop" />');
    expect(primaryAction).toContain("<PrimaryTimerGlyph color={glyphColor} mode={mode} />");
    expect(editSheet).toContain('<PrimaryTimerGlyph color={theme.onAccent} mode="stop" />');
    expect(editSheet).not.toContain("function StopGlyph");
    expect(theme).not.toMatch(/\bplayButton:|\bstopButton:/);
  });

  it("keeps Today replay compact while sharing the rounded Play silhouette", () => {
    expect(primaryAction).toContain("COMPACT_REPLAY_PLAY_GLYPH_SIZE = 14");
    expect(primaryAction).toContain("function CompactReplayPlayGlyph");
    expect(primaryAction.match(/d=\{PRIMARY_TIMER_PLAY_PATH\}/g)).toHaveLength(2);
    expect(dashboard).toContain("<CompactReplayPlayGlyph");
    expect(dashboard).not.toContain("M7 4v16l13-8L7 4Z");
  });

  it("keeps the primary controls and the working field on the 44-point track", () => {
    expect(primaryAction).toMatch(/height: PRIMARY_TIMER_ACTION_SIZE,[\s\S]*width: PRIMARY_TIMER_ACTION_SIZE/);
    expect(theme).toMatch(/startInput: \{[\s\S]*?minHeight: 44/);
    expect(theme).toMatch(/activeEditStopButton: \{[\s\S]*?width: 44,[\s\S]*?height: 44/);
  });

  it("keeps the idle timer hierarchy task-first without a reserved sync-copy row", () => {
    const eyebrowIndex = idleCard.indexOf("Nothing recording");
    const taskIndex = idleCard.indexOf("What are you working on?");

    expect(eyebrowIndex).toBeGreaterThan(-1);
    expect(taskIndex).toBeGreaterThan(eyebrowIndex);
    expect(timerSurface.indexOf("<QuickStartMosaic")).toBeGreaterThan(timerSurface.indexOf("<TodayIdleCard"));
    expect(timerSurface + idleCard).not.toContain("QUICK ACTIONS");
    expect(dashboard).not.toContain("Stop pending sync");
    expect(dashboard).not.toContain("Stop could not sync");
    expect(dashboard).not.toContain("timerSyncStatusSlot");
    expect(theme).not.toContain("timerSyncStatusSlot");
    expect(theme).not.toContain("timerSyncStatusText");
  });

  it("uses one Blocks card geometry and one bottom action track for idle and running", () => {
    for (const card of [idleCard, liveBlock]) {
      expect(card).toContain("minHeight: TODAY_CARD.minHeight");
      expect(card).toContain("borderRadius: TODAY_CARD.radius");
      expect(card).toMatch(/actions: \{[\s\S]*?bottom: TODAY_CARD.padding,[\s\S]*?position: "absolute",[\s\S]*?right: TODAY_CARD.padding/);
      expect(card).toMatch(/primaryAction: \{[\s\S]*?height: TODAY_CARD.primaryActionSize,[\s\S]*?width: TODAY_CARD.primaryActionSize/);
      expect(card).toMatch(/secondaryAction: \{[\s\S]*?height: TODAY_CARD.secondaryActionSize,[\s\S]*?width: TODAY_CARD.secondaryActionSize/);
    }
    expect(todayLayout).toContain("primaryActionSize: 56");
    expect(todayLayout).toContain("secondaryActionSize: 44");
    expect(dashboard).toContain("<TodayTimerSurface");
    expect(dashboard).toContain("onStop={stopFromToday}");
    expect(dashboard).toMatch(/function stopFromToday\(\) \{[\s\S]*?void stopActiveTimer\(\)/);
    expect(dashboard).toContain('onOpenActiveTimer={() => presentActiveEditor("existing_active_timer")}' );
  });
});
