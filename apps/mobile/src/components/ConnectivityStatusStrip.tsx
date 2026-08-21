import { type StyleProp, StyleSheet, Text, type ViewStyle } from "react-native";
import Reanimated from "react-native-reanimated";
import { useConnectivity } from "@/lib/connectivity";
import { getConnectivitySnapshot } from "@/lib/connectivityMonitor";
import { connectivityStatusViewModel } from "@/lib/connectivityState";
import { useMobileTheme } from "@/lib/mobileTheme";
import {
  localLayoutTransition,
  localPresenceEntering,
  localPresenceExiting,
  useReduceMotionPreference
} from "@/lib/motion";

export function ConnectivityStatusStrip({
  style
}: {
  style?: StyleProp<ViewStyle>;
}) {
  useConnectivity();
  const viewModel = connectivityStatusViewModel(getConnectivitySnapshot());
  const { theme } = useMobileTheme();
  const reduceMotion = useReduceMotionPreference();

  if (!viewModel) return null;

  const foreground = viewModel.variant === "failure"
    ? theme.dangerText
    : viewModel.variant === "offline"
      ? theme.textSecondary
      : theme.textPrimary;

  return (
    <Reanimated.View
      accessibilityElementsHidden
      entering={localPresenceEntering(reduceMotion)}
      exiting={localPresenceExiting(reduceMotion)}
      importantForAccessibility="no-hide-descendants"
      layout={localLayoutTransition(reduceMotion)}
      pointerEvents="none"
      style={[
        styles.host,
        { backgroundColor: theme.surfaceMuted },
        style
      ]}
      testID="connectivity-status-strip"
    >
      <Text
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.6}
        minimumFontScale={0.8}
        numberOfLines={1}
        style={[styles.text, { color: foreground }]}
      >
        {viewModel.text}
      </Text>
    </Reanimated.View>
  );
}

export function ConnectivityAnnouncement() {
  useConnectivity();
  const viewModel = connectivityStatusViewModel(getConnectivitySnapshot());
  if (!viewModel) return null;

  return (
    <Text
      accessibilityLabel={viewModel.accessibilityLabel}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      pointerEvents="none"
      style={styles.announcement}
    >
      {viewModel.accessibilityLabel}
    </Text>
  );
}

const styles = StyleSheet.create({
  host: {
    minHeight: 36,
    maxHeight: 36,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden"
  },
  text: {
    width: "100%",
    fontFamily: "System",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    textAlign: "center"
  },
  announcement: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    opacity: 0.01,
    overflow: "hidden"
  }
});
