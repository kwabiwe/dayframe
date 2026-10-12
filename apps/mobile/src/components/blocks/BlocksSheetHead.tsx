import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";

export type BlocksSheetHeadAction = {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  busy?: boolean;
  disabled?: boolean;
  /** "neutral" (Done), "primary" (the sheet's single coral commit) or "danger" (Clear). */
  tone?: "neutral" | "primary" | "danger";
  testID?: string;
};

/**
 * The one Blocks sheet head (design/blocks/ios.html .sheet-head, UIA-006): a left eyebrow over a
 * 17-point title, and one right pill. Sheets dismiss with the grabber, a swipe, the backdrop or
 * the VoiceOver escape gesture (each keeps that sheet's discard prompt), so there is no Cancel.
 * Presentation only: the owner keeps the draft, the save and the dismissal.
 */
export function BlocksSheetHead({
  action,
  eyebrow,
  eyebrowTestID,
  leading,
  testID,
  textTestID,
  theme,
  title
}: {
  action?: BlocksSheetHeadAction | null;
  eyebrow: string;
  eyebrowTestID?: string;
  /** Only for a pushed route with no sheet to swipe: a circular back control before the text. */
  leading?: ReactNode;
  testID?: string;
  textTestID?: string;
  theme: MobileTheme;
  title: string;
}) {
  const tone = action?.tone ?? "neutral";
  const inactive = Boolean(action?.disabled || action?.busy);
  const fill = tone === "primary" ? theme.accent : theme.surfaceMuted;
  const ink = tone === "primary" ? theme.onAccent : tone === "danger" ? theme.dangerText : theme.textPrimary;
  return (
    <View style={styles.head} testID={testID}>
      {leading}
      <View style={styles.text} testID={textTestID}>
        <Text {...mobileTextProps("counter")} numberOfLines={1} style={[styles.eyebrow, { color: theme.textMuted }]} testID={eyebrowTestID}>
          {eyebrow}
        </Text>
        <Text {...mobileTextProps("sectionHeading")} accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: theme.textPrimary }]}>
          {title}
        </Text>
      </View>
      {action ? (
        <Pressable
          accessibilityHint={action.accessibilityHint}
          accessibilityLabel={action.accessibilityLabel ?? action.label}
          accessibilityRole="button"
          accessibilityState={{ busy: Boolean(action.busy), disabled: inactive }}
          disabled={inactive}
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: fill },
            pressed && !inactive ? styles.pressed : null,
            action.disabled && !action.busy ? styles.disabled : null
          ]}
          testID={action.testID}
        >
          <Text {...mobileTextProps("control")} numberOfLines={1} style={[styles.pillText, { color: ink }]}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const blocksSheetHeadStyles = StyleSheet.create({
  head: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between", minHeight: 52, paddingTop: 4 },
  text: { flex: 1, gap: 2, minWidth: 0 },
  eyebrow: { fontSize: 11, fontWeight: "600", letterSpacing: 0.9 },
  title: { fontSize: 17, fontWeight: "700" },
  pill: { alignItems: "center", borderRadius: 999, justifyContent: "center", minHeight: 44, minWidth: 64, paddingHorizontal: 16 },
  pillText: { fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 }
});
const styles = blocksSheetHeadStyles;
