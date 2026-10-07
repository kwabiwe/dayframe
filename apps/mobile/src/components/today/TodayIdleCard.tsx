import { Pressable, StyleSheet, Text, View } from "react-native";
import { DAYFRAME_APP_ICONS } from "@dayframe/shared";
import { PrimaryTimerGlyph } from "../PrimaryTimerAction";
import { DayframeIcon } from "../icons/DayframeIcon";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { TODAY_CARD, TODAY_CARD_ACTIONS_WIDTH } from "./todayBlocksLayout";

/** Nothing recording: one prompt, coral Play (the screen's single primary action) and Add past time. */
export function TodayIdleCard({
  onAddTime,
  onStartBlank,
  theme,
}: {
  onAddTime: () => void;
  onStartBlank: () => void;
  theme: MobileTheme;
}) {
  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]} testID="today-idle-card">
      <Pressable
        accessibilityLabel="Start timer and add details"
        accessibilityRole="button"
        onPress={onStartBlank}
        style={({ pressed }) => [styles.main, pressed ? styles.pressed : null]}
      >
        <Text {...mobileTextProps("counter")} style={[styles.eyebrow, { color: theme.textSecondary }]}>
          Nothing recording
        </Text>
        <Text {...mobileTextProps("itemTitle")} style={[styles.prompt, { color: theme.textPrimary }]}>
          What are you working on?
        </Text>
      </Pressable>
      <View pointerEvents="box-none" style={styles.actions}>
        <Pressable
          accessibilityLabel="Add past time"
          accessibilityRole="button"
          onPress={onAddTime}
          style={({ pressed }) => [styles.secondaryAction, { backgroundColor: theme.surfaceMuted }, pressed ? styles.pressed : null]}
        >
          <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.add} size={20} />
        </Pressable>
        <Pressable
          accessibilityLabel="Start task"
          accessibilityRole="button"
          onPress={onStartBlank}
          style={({ pressed }) => [styles.primaryAction, { backgroundColor: pressed ? theme.accentPressed : theme.accent }]}
          testID="today-idle-start"
        >
          <PrimaryTimerGlyph color={theme.onAccent} mode="play" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: TODAY_CARD.radius, minHeight: TODAY_CARD.minHeight },
  main: { flexGrow: 1, minHeight: TODAY_CARD.minHeight, padding: TODAY_CARD.padding, paddingRight: TODAY_CARD.padding },
  pressed: { opacity: 0.82 },
  eyebrow: { fontSize: 12, fontWeight: "700", letterSpacing: 0.2 },
  prompt: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.2,
    lineHeight: 26,
    marginTop: 8,
    paddingBottom: TODAY_CARD.primaryActionSize + 8,
    paddingRight: TODAY_CARD_ACTIONS_WIDTH / 2,
  },
  actions: {
    alignItems: "center",
    bottom: TODAY_CARD.padding,
    flexDirection: "row",
    gap: TODAY_CARD.actionGap,
    position: "absolute",
    right: TODAY_CARD.padding,
  },
  secondaryAction: {
    alignItems: "center",
    borderRadius: TODAY_CARD.secondaryActionSize / 2,
    height: TODAY_CARD.secondaryActionSize,
    justifyContent: "center",
    width: TODAY_CARD.secondaryActionSize,
  },
  primaryAction: {
    alignItems: "center",
    borderRadius: TODAY_CARD.primaryActionSize / 2,
    height: TODAY_CARD.primaryActionSize,
    justifyContent: "center",
    width: TODAY_CARD.primaryActionSize,
  },
});
