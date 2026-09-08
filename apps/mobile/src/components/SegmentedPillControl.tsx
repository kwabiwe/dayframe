import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MobileTheme } from "@/lib/mobileTheme";

export function SegmentedPillControl<T extends string>({
  accessibilityLabel,
  disabled = false,
  onChange,
  options,
  theme,
  value
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  onChange: (value: T) => void;
  options: readonly { label: string; value: T; accessibilityLabel?: string }[];
  theme: MobileTheme;
  value: T;
}) {
  return (
    <View accessibilityLabel={accessibilityLabel} style={[styles.group, { backgroundColor: theme.surfaceMuted }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityRole="button"
            accessibilityState={{ disabled, selected }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.option,
              selected ? { backgroundColor: theme.accentSoft } : null,
              pressed ? styles.pressed : null
            ]}
          >
            <Text style={[styles.label, { color: selected ? theme.accentText : theme.textSecondary }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    alignSelf: "flex-start",
    borderRadius: 999,
    flexDirection: "row",
    padding: 4
  },
  option: {
    alignItems: "center",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 68,
    paddingHorizontal: 13
  },
  label: {
    fontFamily: "System",
    fontSize: 13,
    fontWeight: "600"
  },
  pressed: { opacity: 0.72 }
});
