import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { DAYFRAME_APP_ICONS, blockColorsFor } from "@dayframe/shared";
import { ActivityIcon, DayframeIcon } from "./icons/DayframeIcon";
import { colorWithAlpha } from "./today/todayBlocksLayout";
import type { MobileTheme } from "../lib/mobileTheme";
import { mobileTextProps } from "../lib/mobileTypography";

// The Blocks activity chips (prototype .chip, parity step 4b): a short wrapped row of the chosen,
// pinned and recent activities, then "All activities N", which opens `ActivityPickerSheet`. The
// entry sheet and Location evidence draw the same chips from here; `activityChips` in
// `lib/activityChoice.ts` picks which ones.

type ChipActivity = {
  color?: string | null;
  icon?: string | null;
  id: string;
  name: string;
};

/** 38 points tall plus 6 of hit slop above and below: at least a 44-point target. */
const CHIP_HIT_SLOP = { top: 6, bottom: 6 };

/**
 * One activity chip: the activity's icon and name on a tint of its colour, solid in the activity
 * colour with measured on-block text when chosen. Tapping the chosen chip again clears it.
 */
export function ActivityChip({
  activity,
  onPress,
  selected,
  testID,
  theme
}: {
  activity: ChipActivity;
  onPress: () => void;
  selected: boolean;
  testID?: string;
  theme: MobileTheme;
}) {
  const colors = blockColorsFor(activity.color ?? activity.id, theme.mode, activity.name);
  const textColor = selected ? colors.text : theme.textPrimary;

  return (
    <Pressable
      accessibilityHint={selected ? "Double tap to clear the activity" : undefined}
      accessibilityLabel={`Set activity to ${activity.name}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={CHIP_HIT_SLOP}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        activityChipStyles.chip,
        { backgroundColor: selected ? colors.fill : colorWithAlpha(colors.fill, theme.mode === "dark" ? 0.24 : 0.18) },
        pressed ? { opacity: 0.82 } : null
      ]}
    >
      <ActivityIcon color={textColor} icon={activity.icon ?? null} name={activity.name} size={16} />
      <Text {...mobileTextProps("control")} numberOfLines={1} style={[activityChipStyles.chipText, { color: textColor }]}>
        {activity.name}
      </Text>
    </Pressable>
  );
}

/** "All activities N": a filled neutral pill with the search glyph that opens the picker. */
export function AllActivitiesChip({
  count,
  disabled = false,
  onLayout,
  onPress,
  pressedStyle,
  testID,
  theme
}: {
  count: number;
  disabled?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  onPress: () => void;
  pressedStyle?: object;
  testID?: string;
  theme: MobileTheme;
}) {
  return (
    <Pressable
      accessibilityHint="Search every activity, or create one"
      accessibilityLabel={`All activities, ${count}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={CHIP_HIT_SLOP}
      onLayout={onLayout}
      onPress={onPress}
      style={({ pressed }) => [
        activityChipStyles.chip,
        activityChipStyles.chipMore,
        { backgroundColor: theme.surfaceMuted },
        pressed ? pressedStyle ?? { opacity: 0.72 } : null
      ]}
      testID={testID}
    >
      <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.search} size={16} />
      <Text {...mobileTextProps("control")} style={[activityChipStyles.chipText, { color: theme.textPrimary }]}>All activities</Text>
      <Text {...mobileTextProps("counter")} style={[activityChipStyles.chipCount, { color: theme.textSecondary }]}>{count}</Text>
    </Pressable>
  );
}

/** The wrapped row the chips sit in (never a sideways scroller). */
export function ActivityChipRow({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View accessibilityLabel="Activity" style={activityChipStyles.wrap} testID={testID}>
      {children}
    </View>
  );
}

export const ACTIVITY_CHIP_GAP = 8;

export const activityChipStyles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: ACTIVITY_CHIP_GAP },
  chip: {
    alignItems: "center",
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    maxWidth: "100%",
    minHeight: 38,
    paddingLeft: 10,
    paddingRight: 14
  },
  chipMore: { paddingLeft: 11 },
  chipText: { flexShrink: 1, fontSize: 13.5, fontWeight: "600" },
  chipCount: { fontSize: 12, fontWeight: "600" }
});
