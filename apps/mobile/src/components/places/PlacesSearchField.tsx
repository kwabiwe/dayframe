import { StyleSheet, TextInput, View } from "react-native";
import { DAYFRAME_APP_ICONS } from "@dayframe/shared";
import { DayframeIcon } from "@/components/icons/DayframeIcon";
import { mobileTextProps } from "@/lib/mobileTypography";
import type { MobileTheme } from "@/lib/mobileTheme";

/**
 * Settings › Saved places search (location v3 PR 16c): filters the list only, never edits a place.
 * Uncontrolled, so native typing owns the text and fast input never drops characters.
 */
export function PlacesSearchField({ onChange, theme }: { onChange: (value: string) => void; theme: MobileTheme }) {
  return (
    <View style={[styles.search, { backgroundColor: theme.surfaceInset }]}>
      <DayframeIcon color={theme.textMuted} glyph={DAYFRAME_APP_ICONS.search} size={18} />
      <TextInput
        {...mobileTextProps("input")}
        accessibilityLabel="Search places"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        onChangeText={onChange}
        placeholder="Search places"
        placeholderTextColor={theme.textMuted}
        returnKeyType="search"
        style={[styles.input, { color: theme.textPrimary }]}
        testID="places-search"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: { alignItems: "center", borderRadius: 14, flexDirection: "row", gap: 8, minHeight: 44, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: 16, minHeight: 44 }
});
