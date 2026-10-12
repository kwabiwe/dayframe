import { Pressable, StyleSheet, Text, View } from "react-native";
import { DAYFRAME_BLOCKS, type DayframeGlyph } from "@dayframe/shared";
import { DayframeIcon } from "../icons/DayframeIcon";
import type { MobileTheme } from "../../lib/mobileTheme";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "../../lib/mobileTypography";

/**
 * The iPhone Blocks empty or unavailable state (staging feedback B1): a neutral glyph block, a
 * short Bricolage title, one plain line and, when there is something to do, one neutral 44-point
 * pill ("Try again"). Never coral: it is not the screen's primary action. It appears in place, with
 * no motion of its own, so whatever replaced it (a loading line, the report) swaps without movement.
 */
export function BlocksEmptyState({
  actionAccessibilityLabel,
  actionLabel,
  actionTestID,
  glyph,
  message,
  onAction,
  testID,
  theme,
  title
}: {
  actionAccessibilityLabel?: string;
  actionLabel?: string;
  actionTestID?: string;
  glyph: DayframeGlyph;
  message: string;
  onAction?: () => void;
  testID?: string;
  theme: MobileTheme;
  title: string;
}) {
  return (
    <View style={emptyStyles.root} testID={testID}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[emptyStyles.glyph, { backgroundColor: theme.surfaceInset }]}
      >
        <DayframeIcon color={theme.textSecondary} glyph={glyph} size={32} />
      </View>
      <View style={emptyStyles.copy}>
        <Text {...mobileTextProps("sectionHeading")} accessibilityRole="header" style={[emptyStyles.title, { color: theme.textPrimary }]}>
          {title}
        </Text>
        {/* Explanation copy scales without a cap (brand guide: body role). */}
        <Text {...mobileTextProps("body")} style={[emptyStyles.message, { color: theme.textSecondary }]}>
          {message}
        </Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [emptyStyles.action, { backgroundColor: pressed ? theme.border : theme.surfaceMuted }]}
          testID={actionTestID}
        >
          <Text {...mobileTextProps("control")} style={[emptyStyles.actionText, { color: theme.textPrimary }]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  root: {
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 32
  },
  glyph: {
    alignItems: "center",
    borderRadius: 16,
    height: 64,
    justifyContent: "center",
    width: 64
  },
  copy: {
    alignItems: "center",
    gap: 6,
    maxWidth: 300
  },
  title: {
    fontFamily: MOBILE_DISPLAY_FONT.bold,
    fontSize: 22,
    letterSpacing: -0.4,
    textAlign: "center"
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center"
  },
  action: {
    alignItems: "center",
    borderRadius: DAYFRAME_BLOCKS.radius.pill,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 20
  },
  actionText: {
    fontSize: 15,
    fontWeight: "700"
  }
});
