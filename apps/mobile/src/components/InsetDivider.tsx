import { View, type StyleProp, type ViewStyle } from "react-native";
import { insetDividerStyle, type InsetDividerGeometry } from "../lib/insetDivider";

export { DIVIDER_INSET, DIVIDER_INSET_PAST_BLOCK, DIVIDER_INSET_PAST_TILE } from "../lib/insetDivider";

/** A row divider inset on both sides (owner rule, 28 Oct 2026); see `src/lib/insetDivider.ts`. */
export function InsetDivider({ style, testID, ...geometry }: InsetDividerGeometry & {
  /** Vertical spacing only (margins above or below a flow line). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[insetDividerStyle(geometry), style]}
      testID={testID}
    />
  );
}
