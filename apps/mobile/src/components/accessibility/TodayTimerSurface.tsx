import { useEffect, useMemo, useRef, type ComponentProps } from "react";
import { Animated, StyleSheet, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { recordMobileLayout, type MobileAccessibilityDiagnostic } from "./diagnostics";
import type { MobileTheme } from "../../lib/mobileTheme";
import type { LandingRequest } from "../../lib/blocksMotion";
import { localLayoutTransition, localPresenceEntering, localPresenceExiting } from "../../lib/motion";
import type { QuickStartColumn } from "../../lib/quickStartMosaic";
import { QuickStartMosaic } from "../today/QuickStartMosaic";
import { TodayIdleCard } from "../today/TodayIdleCard";
import { TodayLiveBlock, type TodayLiveBlockPresentation } from "../today/TodayLiveBlock";

export type TodayActiveTimerPresentation = TodayLiveBlockPresentation;

/**
 * Today's Blocks timer area: the live block (or the idle card) and the quick-start mosaic below it.
 * Reanimated is the only animation owner here (LayoutAnimation does nothing in this app; see
 * .codex/reference/motion.md): the card slot and the mosaic animate their own layout changes, and
 * idle and live cards crossfade at the same geometry. With Reduce Motion the cards swap in place and
 * the live block's content fade is the single opacity change.
 */
export function TodayTimerSurface({
  active,
  activeTimerActionsStyle,
  activeTimerDetailsStyle,
  diagnostic,
  liveHidden = false,
  liveLanding,
  onAddTime,
  onOpenActiveTimer,
  onStartActivity,
  onStartBlank,
  onStop,
  onSwitch,
  quickStartColumns,
  reduceMotion,
  runningActivityId,
  theme,
}: {
  active: TodayActiveTimerPresentation | null;
  activeTimerActionsStyle?: ComponentProps<typeof Animated.View>["style"];
  activeTimerDetailsStyle?: ComponentProps<typeof Animated.View>["style"];
  diagnostic?: MobileAccessibilityDiagnostic;
  /** The Stop flight's ghost has taken the live block's place: it is hidden at once, not faded. */
  liveHidden?: boolean;
  liveLanding: LandingRequest | null;
  onAddTime: () => void;
  onOpenActiveTimer: () => void;
  onStartActivity: (activityId: string) => void;
  onStartBlank: () => void;
  onStop: () => void;
  onSwitch: () => void;
  quickStartColumns: QuickStartColumn[];
  reduceMotion: boolean;
  runningActivityId: string | null;
  theme: MobileTheme;
}) {
  // No card entrance on first paint, hydration or a cached launch.
  const painted = useRef(false);
  useEffect(() => {
    painted.current = true;
  }, []);
  // Builders are memoised so the 1 s timer tick does not re-register layout configs.
  const layout = useMemo(() => localLayoutTransition(reduceMotion), [reduceMotion]);
  const cardEntering = useMemo(() => localPresenceEntering(false), []);
  const cardExiting = useMemo(() => (reduceMotion ? undefined : localPresenceExiting(false)), [reduceMotion]);

  return (
    <View style={styles.stack}>
      <Reanimated.View
        layout={layout}
        onLayout={(event) => recordMobileLayout(diagnostic, active ? "today.timer.running" : "today.timer.idle", event)}
        testID="today-timer-slot"
      >
        <Reanimated.View
          entering={painted.current && !reduceMotion ? cardEntering : undefined}
          exiting={cardExiting}
          key={active ? "live" : "idle"}
          testID={active ? "today-live-slot" : "today-idle-slot"}
        >
          {active ? (
            <View style={liveHidden ? styles.hidden : null} testID="today-live-visibility">
            <TodayLiveBlock
              active={active}
              actionsStyle={activeTimerActionsStyle}
              detailsStyle={activeTimerDetailsStyle}
              diagnostic={diagnostic}
              landing={liveLanding}
              onAddTime={onAddTime}
              onOpen={onOpenActiveTimer}
              onStop={onStop}
              onSwitch={onSwitch}
              reduceMotion={reduceMotion}
              theme={theme}
            />
            </View>
          ) : (
            <TodayIdleCard diagnostic={diagnostic} onAddTime={onAddTime} onStartBlank={onStartBlank} theme={theme} />
          )}
        </Reanimated.View>
      </Reanimated.View>
      <Reanimated.View layout={layout} testID="today-quick-start-slot">
        <QuickStartMosaic
          columns={quickStartColumns}
          onOpenRunning={onOpenActiveTimer}
          onStartActivity={onStartActivity}
          reduceMotion={reduceMotion}
          runningActivityId={active?.hasLiveActiveTimer ? runningActivityId : null}
          theme={theme}
          timerRunning={Boolean(active?.hasLiveActiveTimer)}
        />
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 22 },
  hidden: { opacity: 0 },
});
