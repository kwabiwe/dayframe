// Blocks parity step 6a-1: the Settings page's grouped lists (prototype ios.html openSettings).
// Presentational only: the Settings screen owns data, permissions and every action.
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { DAYFRAME_APP_ICONS, DAYFRAME_BLOCKS, blockColorsFor } from "@dayframe/shared";
import { ActivityIcon, DayframeIcon } from "../icons/DayframeIcon";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";

type Theme = MobileTheme;

/** Name, email and workspace at the top of Settings; opens the account page. */
export function SettingsAccountCard({
  email,
  name,
  onPress,
  theme,
  workspace
}: {
  email: string;
  name: string;
  onPress: () => void;
  theme: Theme;
  workspace: string;
}) {
  const initials = settingsInitials(name || email);
  return (
    <Pressable
      accessibilityHint="Opens your account"
      accessibilityLabel={`${name || email}, ${email}, ${workspace}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [blockStyles.account, { backgroundColor: theme.surface }, pressed ? { backgroundColor: theme.surfaceMuted } : null]}
      testID="settings-account-card"
    >
      <View style={[blockStyles.avatar, { backgroundColor: theme.surfaceMuted }]}>
        <Text {...mobileTextProps("control")} style={[blockStyles.avatarText, { color: theme.textPrimary }]}>{initials}</Text>
      </View>
      <View style={blockStyles.accountText}>
        <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[blockStyles.accountName, { color: theme.textPrimary }]}>
          {name || email}
        </Text>
        <Text {...mobileTextProps("metadata")} numberOfLines={1} style={{ color: theme.textSecondary }}>{email}</Text>
      </View>
      <DayframeIcon color={theme.textMuted} glyph={DAYFRAME_APP_ICONS.next} size={18} />
    </Pressable>
  );
}

/** One titled group: an eyebrow, a rounded list of rows and an optional footnote. */
export function SettingsBlockGroup({
  children,
  foot,
  theme,
  title
}: {
  children: ReactNode;
  foot?: string;
  theme: Theme;
  title: string;
}) {
  return (
    <View style={blockStyles.group}>
      <Text {...mobileTextProps("counter")} accessibilityRole="header" style={[blockStyles.eyebrow, { color: theme.textSecondary }]}>
        {title.toUpperCase()}
      </Text>
      <View style={[blockStyles.list, { backgroundColor: theme.surface }]}>{children}</View>
      {foot ? <Text {...mobileTextProps("metadata")} style={[blockStyles.foot, { color: theme.textMuted }]}>{foot}</Text> : null}
    </View>
  );
}

/**
 * A row: title, optional subtitle, and either a control (switch, stepper, segmented) or, when it
 * opens something, a value and a chevron. `divider` draws the hairline above every row but the first.
 */
export function SettingsBlockRow({
  accessibilityHint,
  control,
  danger = false,
  divider = true,
  onPress,
  subtitle,
  testID,
  theme,
  title,
  value
}: {
  accessibilityHint?: string;
  control?: ReactNode;
  danger?: boolean;
  divider?: boolean;
  onPress?: () => void;
  subtitle?: string | null;
  testID?: string;
  theme: Theme;
  title: string;
  value?: string | null;
}) {
  const text = (
    <View style={blockStyles.rowText}>
      <Text {...mobileTextProps("itemTitle")} style={[blockStyles.rowTitle, { color: danger ? theme.dangerText : theme.textPrimary }]}>
        {title}
      </Text>
      {subtitle ? <Text {...mobileTextProps("metadata")} style={{ color: theme.textMuted }}>{subtitle}</Text> : null}
    </View>
  );
  const dividerStyle = divider ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth } : null;
  if (onPress) {
    return (
      <Pressable
        accessibilityHint={accessibilityHint}
        accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
        accessibilityRole="button"
        accessibilityValue={value ? { text: value } : undefined}
        onPress={onPress}
        style={({ pressed }) => [blockStyles.row, dividerStyle, pressed ? { backgroundColor: theme.surfaceMuted } : null]}
        testID={testID}
      >
        {text}
        <View style={blockStyles.rowValue}>
          {value ? <Text {...mobileTextProps("metadata")} numberOfLines={1} style={{ color: theme.textMuted }}>{value}</Text> : null}
          {danger ? null : <DayframeIcon color={theme.textMuted} glyph={DAYFRAME_APP_ICONS.next} size={18} />}
        </View>
      </Pressable>
    );
  }
  return (
    <View style={[blockStyles.row, dividerStyle]} testID={testID}>
      {text}
      {control}
    </View>
  );
}

/** The prototype switch: green when on. */
export function SettingsSwitch({
  accessibilityHint,
  disabled = false,
  label,
  onValueChange,
  theme,
  value
}: {
  accessibilityHint?: string;
  disabled?: boolean;
  label: string;
  onValueChange: (value: boolean) => void;
  theme: Theme;
  value: boolean;
}) {
  return (
    <Switch
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      disabled={disabled}
      ios_backgroundColor={theme.surfaceMuted}
      onValueChange={onValueChange}
      style={{ flexShrink: 0 }}
      thumbColor="#FFFFFF"
      trackColor={{ false: theme.surfaceMuted, true: theme.success }}
      value={value}
    />
  );
}

/** − value + with 44-point targets (36-point circles plus slop). */
export function SettingsStepper({
  canDecrease,
  canIncrease,
  label,
  onDecrease,
  onIncrease,
  theme,
  value
}: {
  canDecrease: boolean;
  canIncrease: boolean;
  label: string;
  onDecrease: () => void;
  onIncrease: () => void;
  theme: Theme;
  value: string;
}) {
  const button = (kind: "−" | "+", enabled: boolean, onPress: () => void) => (
    <Pressable
      accessibilityLabel={`${kind === "−" ? "Decrease" : "Increase"} ${label}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        blockStyles.stepButton,
        { backgroundColor: theme.surfaceMuted, opacity: enabled ? 1 : 0.4 },
        pressed ? { backgroundColor: theme.border } : null
      ]}
    >
      {/* An icon, not text: it keeps its size inside the circle at every text size. */}
      <Text allowFontScaling={false} style={[blockStyles.stepGlyph, { color: theme.textPrimary }]}>{kind}</Text>
    </Pressable>
  );
  return (
    <View
      accessibilityLabel={label}
      accessibilityValue={{ text: value }}
      style={blockStyles.stepper}
    >
      {button("−", canDecrease, onDecrease)}
      <Text {...mobileTextProps("control")} style={[blockStyles.stepValue, { color: theme.textPrimary }]}>{value}</Text>
      {button("+", canIncrease, onIncrease)}
    </View>
  );
}

/** A small segmented control (Theme: Midnight · Daylight · System). */
export function SettingsSegmented<T extends string>({
  label,
  onChange,
  options,
  theme,
  value
}: {
  label: string;
  onChange: (value: T) => void;
  options: readonly { label: string; value: T }[];
  theme: Theme;
  value: T;
}) {
  return (
    <View accessibilityLabel={label} accessibilityRole="radiogroup" style={[blockStyles.segmented, { backgroundColor: theme.surfaceInset }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityLabel={`${option.label} ${label.toLowerCase()}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[blockStyles.segment, selected ? { backgroundColor: theme.textPrimary } : null]}
          >
            <Text {...mobileTextProps("metadata")} style={[blockStyles.segmentText, { color: selected ? theme.background : theme.textSecondary }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Up to nine activity blocks under the Activities row (decorative). */
export function SettingsActivityStrip({
  activities,
  theme
}: {
  activities: readonly { id: string; name: string; color?: string | null; icon?: string | null }[];
  theme: Theme;
}) {
  if (!activities.length) return null;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={blockStyles.strip}>
      {activities.slice(0, 9).map((activity) => {
        const colors = blockColorsFor(activity.color ?? activity.id, theme.mode, activity.name);
        return (
          <View key={activity.id} style={[blockStyles.stripBlock, { backgroundColor: colors.fill }]}>
            <ActivityIcon color={colors.text} icon={activity.icon} name={activity.name} size={15} />
          </View>
        );
      })}
    </View>
  );
}

/** A status dot for the Help line: green when nothing waits, amber when something does. */
export function SettingsStatusDot({ attention, theme }: { attention: boolean; theme: Theme }) {
  return <View style={[blockStyles.dot, { backgroundColor: attention ? theme.warning : theme.success }]} />;
}

export function settingsInitials(value: string) {
  const words = value.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = (words.length > 1 ? [words[0][0], words[words.length - 1][0]] : [words[0]?.[0] ?? "?"]).join("");
  return letters.toUpperCase();
}

const blockStyles = StyleSheet.create({
  account: {
    alignItems: "center",
    borderRadius: 22,
    flexDirection: "row",
    gap: 14,
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  accountName: { fontSize: 17, fontWeight: "700" },
  accountText: { flex: 1, minWidth: 0 },
  avatar: { alignItems: "center", borderRadius: 28, height: 56, justifyContent: "center", width: 56 },
  avatarText: { fontSize: 18, fontWeight: "800" },
  dot: { borderRadius: 5, flexShrink: 0, height: 10, width: 10 },
  eyebrow: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, marginLeft: 4 },
  foot: { marginHorizontal: 4 },
  group: { gap: 8 },
  list: { borderRadius: 18, overflow: "hidden" },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 8
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: "600" },
  rowValue: { alignItems: "center", flexDirection: "row", flexShrink: 1, gap: 2, maxWidth: "45%" },
  segment: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, justifyContent: "center", minHeight: 36, paddingHorizontal: 12 },
  segmented: { borderRadius: DAYFRAME_BLOCKS.radius.pill, flexDirection: "row", flexShrink: 0, padding: 3 },
  segmentText: { fontWeight: "700" },
  stepButton: { alignItems: "center", borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  stepGlyph: { fontSize: 20, fontWeight: "600", lineHeight: 22 },
  stepper: { alignItems: "center", flexDirection: "row", flexShrink: 0, gap: 6 },
  stepValue: { fontVariant: ["tabular-nums"], minWidth: 40, textAlign: "center" },
  strip: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingBottom: 14, paddingHorizontal: 16, paddingTop: 4 },
  stripBlock: { alignItems: "center", borderRadius: 9, height: 30, justifyContent: "center", width: 30 }
});
