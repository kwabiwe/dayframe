import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { mobileTextProps } from "@/lib/mobileTypography";
import { pressable, useMobileTheme } from "@/lib/mobileTheme";

/**
 * The Blocks navigation bar for pushed pages (prototype; first shipped on the Review deck):
 * a coral text back button naming the previous screen ("‹ Settings"), a centred 16-pt title and
 * an optional trailing slot. The two side slots share the width equally, so the title stays
 * centred whatever the back label or trailing content is.
 */
export function BlocksNavHeader({
  backDisabled = false,
  backLabel,
  backTestID,
  onBack,
  title,
  trailing
}: {
  backDisabled?: boolean;
  /** The previous screen's name, shown after the chevron. */
  backLabel: string;
  backTestID?: string;
  onBack: () => void;
  title: string;
  trailing?: ReactNode;
}) {
  const { styles, theme } = useMobileTheme();
  return (
    <View style={styles.blocksNav}>
      <Pressable
        accessibilityLabel={`Back to ${backLabel}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: backDisabled }}
        disabled={backDisabled}
        hitSlop={{ bottom: 4, top: 4 }}
        onPress={onBack}
        style={pressable(styles.blocksNavBack, styles.buttonPressed)}
        testID={backTestID}
      >
        <Svg accessibilityElementsHidden height={22} viewBox="0 0 24 24" width={22}>
          <Path d="M15 5 8 12l7 7" fill="none" stroke={theme.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} />
        </Svg>
        <Text {...mobileTextProps("control")} numberOfLines={1} style={[styles.blocksNavBackText, { color: theme.accentText }]}>
          {backLabel}
        </Text>
      </Pressable>
      <Text {...mobileTextProps("control")} accessibilityRole="header" numberOfLines={1} style={styles.blocksNavTitle}>
        {title}
      </Text>
      <View style={styles.blocksNavTrailing}>{trailing}</View>
    </View>
  );
}
