import { Pressable, StyleSheet, Text } from "react-native";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { accountInitials } from "../../lib/accountInitials";

/** The account avatar (Blocks prototype): opens Settings, where account and logout live. */
export function AccountAvatarButton({
  email,
  name,
  onPress,
  theme,
}: {
  email: string | null | undefined;
  name: string | null | undefined;
  onPress: () => void;
  theme: MobileTheme;
}) {
  return (
    <Pressable
      accessibilityLabel="Account and settings"
      accessibilityRole="button"
      hitSlop={2}
      onPress={onPress}
      style={({ pressed }) => [styles.avatar, { backgroundColor: theme.surfaceMuted }, pressed ? styles.pressed : null]}
      testID="account-avatar"
    >
      <Text {...mobileTextProps("control")} numberOfLines={1} style={[styles.initials, { color: theme.textPrimary }]}>
        {accountInitials(name, email)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: "center", borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  initials: { fontSize: 13, fontWeight: "800" },
  pressed: { opacity: 0.82 },
});
