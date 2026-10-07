import { Pressable, StyleSheet, Text, View } from "react-native";
import { DAYFRAME_APP_ICONS } from "@dayframe/shared";
import { PrimaryTimerGlyph } from "../PrimaryTimerAction";
import { DayframeIcon } from "../icons/DayframeIcon";
import { recordMobileLayout, type MobileAccessibilityDiagnostic } from "../accessibility/diagnostics";
import type { MobileTheme } from "../../lib/mobileTheme";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "../../lib/mobileTypography";
import { TODAY_CARD } from "./todayBlocksLayout";

/**
 * Nothing recording (Blocks prototype): the eyebrow, "What are you working on?" and the coral
 * "Start a block" pill, the screen's single primary action. Add past time stays here as a quiet
 * pill until the Play orb and the entry sheet take it over.
 */
export function TodayIdleCard({
  diagnostic,
  onAddTime,
  onStartBlank,
  theme,
}: {
  diagnostic?: MobileAccessibilityDiagnostic;
  onAddTime: () => void;
  onStartBlank: () => void;
  theme: MobileTheme;
}) {
  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]} testID="today-idle-card">
      <Text {...mobileTextProps("counter")} style={[styles.eyebrow, { color: theme.textMuted }]}>
        NOTHING RECORDING
      </Text>
      <Text
        {...mobileTextProps("itemTitle")}
        accessibilityRole="header"
        onLayout={(event) => recordMobileLayout(diagnostic, "today.timer.composer.frame", event)}
        style={[styles.prompt, { color: theme.textPrimary }]}
      >
        What are you working on?
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityHint="Starts a timer and opens it so you can add details"
          accessibilityLabel="Start a block"
          accessibilityRole="button"
          onPress={onStartBlank}
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: pressed ? theme.accentPressed : theme.accent },
            pressed ? styles.pillPressed : null,
          ]}
          testID="today-idle-start"
        >
          <PrimaryTimerGlyph color={theme.onAccent} mode="play" />
          <Text {...mobileTextProps("control")} style={[styles.pillText, { color: theme.onAccent }]}>
            Start a block
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Add past time"
          accessibilityRole="button"
          onPress={onAddTime}
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: theme.surfaceMuted },
            pressed ? styles.pillPressed : null,
          ]}
          testID="today-idle-add-past-time"
        >
          <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.add} size={18} />
          <Text {...mobileTextProps("control")} style={[styles.pillText, { color: theme.textPrimary }]}>
            Add past time
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: TODAY_CARD.radius, gap: 14, padding: TODAY_CARD.idlePadding },
  eyebrow: { fontSize: 11, fontWeight: "600", letterSpacing: 0.9 },
  prompt: {
    fontFamily: MOBILE_DISPLAY_FONT.bold,
    fontSize: 28,
    letterSpacing: -0.7,
    lineHeight: 30,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    alignItems: "center",
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 44,
    paddingLeft: 14,
    paddingRight: 18,
  },
  pillPressed: { transform: [{ scale: 0.96 }] },
  pillText: { fontSize: 14, fontWeight: "600" },
});
