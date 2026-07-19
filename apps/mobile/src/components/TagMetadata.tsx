import { Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { MobileStyles, MobileTheme } from "@/lib/mobileTheme";

export function TagMetadata({
  active = false,
  styles,
  tagNames,
  theme
}: {
  active?: boolean;
  styles: MobileStyles;
  tagNames: string[];
  theme: MobileTheme;
}) {
  if (tagNames.length === 0) return null;
  const label = tagNames.join(" · ");
  const color = active ? theme.accentText : theme.textSecondary;

  return (
    <View accessibilityLabel={`Tags: ${label}`} style={styles.tagMetadataRow}>
      <Svg accessibilityElementsHidden height={14} viewBox="0 0 24 24" width={14}>
        <Path
          d="M20.59 13.41 11 3.83V3H4v7h.83l9.58 9.59a2 2 0 0 0 2.83 0l3.35-3.35a2 2 0 0 0 0-2.83ZM7.5 8A1.5 1.5 0 1 1 7.5 5a1.5 1.5 0 0 1 0 3Z"
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.7}
        />
      </Svg>
      <Text numberOfLines={1} style={[styles.tagMetadataText, active ? { color: theme.accentText } : null]}>
        {label}
      </Text>
    </View>
  );
}
