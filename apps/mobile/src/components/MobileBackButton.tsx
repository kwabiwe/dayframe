import { Pressable } from "react-native";
import Svg, { Path } from "react-native-svg";
import { pressable, useMobileTheme } from "@/lib/mobileTheme";

export function MobileBackButton({
  accessibilityLabel,
  onPress
}: {
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { styles, theme } = useMobileTheme();

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={pressable(styles.iconButton, styles.buttonPressed)}
      onPress={onPress}
    >
      <Svg accessibilityElementsHidden width={20} height={20} viewBox="0 0 24 24">
        <Path
          d="M15 5 8 12l7 7"
          fill="none"
          stroke={theme.accent}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2.3}
        />
      </Svg>
    </Pressable>
  );
}
