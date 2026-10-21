import type { ReactNode } from "react";
import { Text } from "react-native";
import Reanimated from "react-native-reanimated";
import { settingsBlockGroupStyles } from "@/components/settings/SettingsBlocks";
import { localLayoutTransition } from "@/lib/motion";
import { mobileTextProps } from "@/lib/mobileTypography";
import type { MobileTheme } from "@/lib/mobileTheme";

/**
 * `SettingsBlockGroup` drawn with one layout owner (Codex r1 on #508): the group, its rounded list
 * and its footnote each take the shared `localLayoutTransition`, so when rows fade in or out (Saved
 * places, Archived, Suggested places) the list closes up and the footnote and the groups below
 * glide instead of jumping. Reduce Motion keeps the transition's no-movement path. Same look,
 * eyebrow and footnote as the Settings groups.
 */
export function ReflowBlockGroup({
  children,
  foot,
  reduceMotion,
  testID,
  theme,
  title
}: {
  children: ReactNode;
  foot?: string;
  reduceMotion: boolean;
  testID?: string;
  theme: MobileTheme;
  title: string;
}) {
  const groupStyles = settingsBlockGroupStyles();
  const layout = localLayoutTransition(reduceMotion);
  return (
    <Reanimated.View layout={layout} style={groupStyles.group} testID={testID}>
      <Text {...mobileTextProps("counter")} accessibilityRole="header" style={[groupStyles.eyebrow, { color: theme.textSecondary }]}>
        {title.toUpperCase()}
      </Text>
      <Reanimated.View layout={layout} style={[groupStyles.list, { backgroundColor: theme.surface }]}>{children}</Reanimated.View>
      {foot ? (
        <Reanimated.Text {...mobileTextProps("metadata")} layout={layout} style={[groupStyles.foot, { color: theme.textMuted }]}>
          {foot}
        </Reanimated.Text>
      ) : null}
    </Reanimated.View>
  );
}
