import type { ComponentProps } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { recordMobileLayout, type MobileAccessibilityDiagnostic } from "./diagnostics";
import type { MobileTheme } from "../../lib/mobileTheme";
import type { LandingRequest } from "../../lib/blocksMotion";
import type { QuickStartColumn } from "../../lib/quickStartMosaic";
import { QuickStartMosaic } from "../today/QuickStartMosaic";
import { TodayIdleCard } from "../today/TodayIdleCard";
import { TodayLiveBlock, type TodayLiveBlockPresentation } from "../today/TodayLiveBlock";

export type TodayActiveTimerPresentation = TodayLiveBlockPresentation;

/** Today's Blocks timer area: the live block (or the idle card) and the quick-start mosaic below it. */
export function TodayTimerSurface({
  active,
  activeTimerActionsStyle,
  activeTimerDetailsStyle,
  diagnostic,
  liveLanding,
  onAddTime,
  onOpenActiveTimer,
  onStartActivity,
  onStartBlank,
  onStop,
  quickStartColumns,
  reduceMotion,
  runningActivityId,
  theme,
}: {
  active: TodayActiveTimerPresentation | null;
  activeTimerActionsStyle?: ComponentProps<typeof Animated.View>["style"];
  activeTimerDetailsStyle?: ComponentProps<typeof Animated.View>["style"];
  diagnostic?: MobileAccessibilityDiagnostic;
  liveLanding: LandingRequest | null;
  onAddTime: () => void;
  onOpenActiveTimer: () => void;
  onStartActivity: (activityId: string) => void;
  onStartBlank: () => void;
  onStop: () => void;
  quickStartColumns: QuickStartColumn[];
  reduceMotion: boolean;
  runningActivityId: string | null;
  theme: MobileTheme;
}) {
  return (
    <View style={styles.stack}>
      <View onLayout={(event) => recordMobileLayout(diagnostic, active ? "today.timer.running" : "today.timer.idle", event)}>
        {active ? (
          <TodayLiveBlock
            active={active}
            actionsStyle={activeTimerActionsStyle}
            detailsStyle={activeTimerDetailsStyle}
            landing={liveLanding}
            onAddTime={onAddTime}
            onOpen={onOpenActiveTimer}
            onStop={onStop}
            reduceMotion={reduceMotion}
            theme={theme}
          />
        ) : (
          <TodayIdleCard onAddTime={onAddTime} onStartBlank={onStartBlank} theme={theme} />
        )}
      </View>
      <QuickStartMosaic
        columns={quickStartColumns}
        onOpenRunning={onOpenActiveTimer}
        onStartActivity={onStartActivity}
        reduceMotion={reduceMotion}
        runningActivityId={active?.hasLiveActiveTimer ? runningActivityId : null}
        theme={theme}
        timerRunning={Boolean(active?.hasLiveActiveTimer)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 22 },
});
