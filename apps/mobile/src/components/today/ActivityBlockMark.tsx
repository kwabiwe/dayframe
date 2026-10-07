import { useMemo } from "react";
import { StyleSheet } from "react-native";
import Reanimated from "react-native-reanimated";
import { blockColorsFor, DAYFRAME_BLOCKS } from "@dayframe/shared";
import { ActivityIcon } from "../icons/DayframeIcon";
import type { MobileTheme } from "../../lib/mobileTheme";
import { useBlockLanding, useBlockPop, type LandingRequest } from "../../lib/blocksMotion";
import { flightNodeRef } from "../../lib/stopFlight";

export const ACTIVITY_BLOCK_MARK_SIZE = 30;
const ROW_LANDING_DISTANCE = -10;
/** The row block lands just after the live block lets go, so the Stop haptic's soft impact meets it. */
export const ROW_LANDING_DELAY_MS = 60;

/** A Today row's activity as a small solid block with its icon; hidden from VoiceOver (the row says it). */
export function ActivityBlockMark({
  categoryColor,
  categoryIcon,
  categoryName,
  entryId,
  flightNode,
  height = ACTIVITY_BLOCK_MARK_SIZE,
  landing,
  pop = null,
  reduceMotion,
  theme,
  width = ACTIVITY_BLOCK_MARK_SIZE,
}: {
  categoryColor: string | null;
  categoryIcon: string | null;
  categoryName: string | null;
  entryId: string;
  /** Today's rows register their block so the Stop flight can land on it. */
  flightNode?: string;
  /** Today's blocks size the block by duration; history rows keep the square mark. */
  height?: number;
  landing: LandingRequest | null;
  /** The Stop flight's arrival: the block pops once. */
  pop?: LandingRequest | null;
  reduceMotion: boolean;
  theme: MobileTheme;
  width?: number;
}) {
  const colors = useMemo(() => {
    if (!categoryName) return { fill: theme.surfaceMuted, text: theme.textSecondary };
    return blockColorsFor(categoryColor ?? categoryName, theme.mode, categoryName);
  }, [categoryColor, categoryName, theme.mode, theme.surfaceMuted, theme.textSecondary]);
  const landingStyle = useBlockLanding({
    delayMs: ROW_LANDING_DELAY_MS,
    distance: ROW_LANDING_DISTANCE,
    entryId,
    reduceMotion,
    request: landing,
  });
  const popStyle = useBlockPop({ entryId, request: pop });
  const register = useMemo(() => flightNodeRef(flightNode), [flightNode]);
  // The pop scales the resting frame (which the flight measures); the landing moves the block inside it.
  return (
    <Reanimated.View
      accessibilityElementsHidden
      collapsable={false}
      importantForAccessibility="no-hide-descendants"
      ref={register}
      style={[{ height, width }, popStyle]}
    >
      <Reanimated.View
        style={[styles.mark, { backgroundColor: colors.fill, height, width }, landingStyle]}
        testID={`activity-block-${entryId}`}
      >
        <ActivityIcon color={colors.text} icon={categoryIcon} name={categoryName} size={16} />
      </Reanimated.View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  mark: {
    alignItems: "center",
    borderRadius: DAYFRAME_BLOCKS.radius.chip,
    height: ACTIVITY_BLOCK_MARK_SIZE,
    justifyContent: "center",
    width: ACTIVITY_BLOCK_MARK_SIZE,
  },
});
