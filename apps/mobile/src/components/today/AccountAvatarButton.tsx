import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { accountInitials } from "../../lib/accountInitials";
import { syncAttentionPresentation } from "../../lib/connectivityPresentation";

/**
 * The account avatar (Blocks prototype): opens Settings, where account and logout live. While a
 * rejected change needs the user it carries a badge and opens Settings › Sync help instead
 * (the connectivity redesign moved that attention state here from the header).
 */
export function AccountAvatarButton({
  attentionCount = 0,
  email,
  name,
  onPress,
  theme,
}: {
  attentionCount?: number;
  email: string | null | undefined;
  name: string | null | undefined;
  onPress: (target: "settings" | "sync") => void;
  theme: MobileTheme;
}) {
  const attention = syncAttentionPresentation(attentionCount);
  return (
    <Pressable
      accessibilityHint={attention?.accessibilityHint}
      accessibilityLabel={attention?.accessibilityLabel ?? "Account and settings"}
      accessibilityRole="button"
      hitSlop={2}
      onPress={() => onPress(attention ? "sync" : "settings")}
      style={({ pressed }) => [styles.avatar, { backgroundColor: theme.surfaceMuted }, pressed ? styles.pressed : null]}
      testID="account-avatar"
    >
      <Text {...mobileTextProps("control")} numberOfLines={1} style={[styles.initials, { color: theme.textPrimary }]}>
        {accountInitials(name, email)}
      </Text>
      {attention ? (
        <View
          pointerEvents="none"
          style={[styles.badge, { backgroundColor: theme.danger, borderColor: theme.background }]}
          testID="account-avatar-attention"
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: "center", borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  badge: { borderRadius: 7, borderWidth: 2, height: 14, position: "absolute", right: 0, top: 0, width: 14 },
  initials: { fontSize: 13, fontWeight: "800" },
  pressed: { opacity: 0.82 },
});
