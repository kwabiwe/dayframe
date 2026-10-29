import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { DAYFRAME_APP_ICONS, activityMarkerRadius, blockColorsFor } from "@dayframe/shared";
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
/** The compact chip: 32 points tall plus 6 above and below, as the compact pill (rows sit 12 apart). */
const COMPACT_CHIP_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 };

/**
 * One activity chip: the activity's icon and name on a tint of its colour, solid in the activity
 * colour with measured on-block text when chosen. Tapping the chosen chip again clears it.
 *
 * `compact` (the place sheet's "Logs as", owner feedback 29 Oct 2026): the web's chip face on the
 * compact pill — a neutral 32-point pill led by the activity's 20-point colour tile with its glyph
 * (the activity picker's lead, X3 radius), the name, and for the chosen one a 2-point ring in the
 * primary text colour and a check, so the colour stays on the tile. `role="radio"` for a one-of choice.
 */
export function ActivityChip({
  activity,
  compact = false,
  onPress,
  role = "button",
  selected,
  testID,
  theme
}: {
  activity: ChipActivity;
  compact?: boolean;
  onPress: () => void;
  role?: "button" | "radio";
  selected: boolean;
  testID?: string;
  theme: MobileTheme;
}) {
  const colors = blockColorsFor(activity.color ?? activity.id, theme.mode, activity.name);
  const textColor = selected ? colors.text : theme.textPrimary;
  if (compact) {
    return (
      <Pressable
        accessibilityHint={selected ? "Double tap to clear the activity" : undefined}
        accessibilityLabel={role === "radio" ? activity.name : `Set activity to ${activity.name}`}
        accessibilityRole={role}
        accessibilityState={role === "radio" ? { checked: selected } : { selected }}
        hitSlop={COMPACT_CHIP_HIT_SLOP}
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [
          activityChipStyles.compact,
          { backgroundColor: theme.surfaceMuted, borderColor: selected ? theme.textPrimary : "transparent" },
          pressed ? { opacity: 0.72 } : null
        ]}
      >
        <View style={[activityChipStyles.tile, { backgroundColor: colors.fill }]}>
          <ActivityIcon color={colors.text} icon={activity.icon ?? null} name={activity.name} size={12} />
        </View>
        <Text {...mobileTextProps("control")} numberOfLines={1} style={[activityChipStyles.compactText, { color: theme.textPrimary }]}>
          {activity.name}
        </Text>
        {selected ? <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.done} size={14} /> : null}
      </Pressable>
    );
  }

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
export function ActivityChipRow({
  children,
  onLayout,
  testID
}: {
  children: ReactNode;
  /** The row's width, for fitting the chips into their rows. */
  onLayout?: (event: LayoutChangeEvent) => void;
  testID?: string;
}) {
  return (
    <View accessibilityLabel="Activity" onLayout={onLayout} style={activityChipStyles.wrap} testID={testID}>
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
  compact: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 2,
    flexDirection: "row",
    gap: 6,
    maxWidth: "100%",
    minHeight: 32,
    paddingLeft: 4,
    paddingRight: 12
  },
  tile: { alignItems: "center", borderRadius: activityMarkerRadius(20), height: 20, justifyContent: "center", width: 20 },
  compactText: { flexShrink: 1, fontSize: 13.5, fontWeight: "600" },
  /** Compact chips wrap 12 apart, so their 44-point targets never overlap. */
  compactWrap: { flexDirection: "row", flexWrap: "wrap", columnGap: 8, rowGap: 12 },
  chipText: { flexShrink: 1, fontSize: 13.5, fontWeight: "600" },
  chipCount: { fontSize: 12, fontWeight: "600" },
  /** Measures candidate chips off screen, so the visible row can be fitted. */
  measure: { flexDirection: "row", left: 0, opacity: 0, position: "absolute", top: 0 }
});
