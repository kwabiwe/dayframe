import { useEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { DAYFRAME_APP_ICONS, DAYFRAME_BLOCKS } from "@dayframe/shared";
import { DayframeIcon } from "../icons/DayframeIcon";
import type { MobileTheme } from "../../lib/mobileTheme";
import { localPresenceEntering, localPresenceExiting } from "../../lib/motion";
import { mobileTextProps } from "../../lib/mobileTypography";

/**
 * Today's "N to check today" (location v4 step 14, mock-up #ios-today): the Review card becomes one quiet
 * chip that opens Calendar › List at the first "?". It fades within a reserved tap area so the
 * first or last check does not move the blocks below.
 */
export function TodayChecksChip({ count, onOpen, reduceMotion, theme }: {
  count: number;
  onOpen: () => void;
  reduceMotion: boolean;
  theme: MobileTheme;
}) {
  const painted = useRef(false);
  useEffect(() => {
    painted.current = true;
  }, []);
  const entering = useMemo(() => (reduceMotion ? undefined : localPresenceEntering(false)), [reduceMotion]);
  const exiting = useMemo(() => (reduceMotion ? undefined : localPresenceExiting(false)), [reduceMotion]);
  const label = `${count} to check today`;
  return (
    <View style={styles.slot} testID="today-checks-slot">
      {count > 0 ? (
        <Reanimated.View entering={painted.current ? entering : undefined} exiting={exiting} style={styles.row}>
          <Pressable accessibilityHint="Opens Calendar's list at the first one" accessibilityLabel={label} accessibilityRole="button"
            onPress={onOpen} style={({ pressed }) => [styles.chip, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.8 : 1 }]}
            testID="today-checks-chip">
            <DayframeIcon color={theme.warningText} glyph={DAYFRAME_APP_ICONS.placeUnknown} size={16} />
            <Text {...mobileTextProps("control")} numberOfLines={1} style={[styles.text, { color: theme.warningText }]}>{label}</Text>
            <DayframeIcon color={theme.warningText} glyph={DAYFRAME_APP_ICONS.next} size={14} />
          </Pressable>
        </Reanimated.View>
      ) : null}
    </View>
  );
}

const CHECKS_HEIGHT = 44;

const styles = StyleSheet.create({
  slot: { height: CHECKS_HEIGHT },
  row: { flexDirection: "row" },
  chip: { flexDirection: "row", alignItems: "center", gap: 8, height: CHECKS_HEIGHT, maxWidth: "100%", borderRadius: DAYFRAME_BLOCKS.radius.pill, paddingHorizontal: 16 },
  text: { flexShrink: 1, fontSize: 14, fontWeight: "700" }
});
