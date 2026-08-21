import { StyleSheet, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import { useConnectivity } from "@/lib/connectivity";
import { getConnectivitySnapshot } from "@/lib/connectivityMonitor";
import { connectivityBannerViewModel } from "@/lib/connectivityState";
import { useMobileTheme } from "@/lib/mobileTheme";
import {
  localPresenceEntering,
  localPresenceExiting,
  useReduceMotionPreference
} from "@/lib/motion";

export function ConnectivityBanner({
  suppressAccessibilityAnnouncement = false
}: {
  suppressAccessibilityAnnouncement?: boolean;
}) {
  useConnectivity();
  const snapshot = getConnectivitySnapshot();
  const viewModel = connectivityBannerViewModel(snapshot);
  const { theme } = useMobileTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotionPreference();

  if (!viewModel) return null;
  const reconnected = viewModel.variant === "reconnected";
  const foreground = reconnected ? theme.onAccent : theme.textPrimary;
  const secondaryForeground = reconnected ? theme.onAccent : theme.textSecondary;

  return (
    <View
      accessibilityElementsHidden={suppressAccessibilityAnnouncement}
      importantForAccessibility={
        suppressAccessibilityAnnouncement ? "no-hide-descendants" : "yes"
      }
      pointerEvents="none"
      style={[styles.host, { top: insets.top + 8 }]}
    >
      <Reanimated.View
        key={viewModel.id}
        accessibilityLabel={viewModel.accessibilityLabel}
        accessibilityLiveRegion={
          suppressAccessibilityAnnouncement ? "none" : "polite"
        }
        accessibilityRole={
          suppressAccessibilityAnnouncement ? undefined : "alert"
        }
        accessible={!suppressAccessibilityAnnouncement}
        entering={localPresenceEntering(reduceMotion, "rise")}
        exiting={localPresenceExiting(reduceMotion)}
        pointerEvents="none"
        style={[
          styles.notice,
          {
            backgroundColor: reconnected ? theme.success : theme.surfaceMuted,
            borderColor: reconnected ? theme.success : theme.borderStrong,
            shadowColor: theme.shadow
          }
        ]}
      >
        <ConnectivityGlyph
          color={foreground}
          variant={viewModel.variant}
        />
        <View pointerEvents="none" style={styles.copy}>
          <Text style={[styles.title, { color: foreground }]}>
            {viewModel.title}
          </Text>
          {viewModel.body ? (
            <Text style={[styles.body, { color: secondaryForeground }]}>
              {viewModel.body}
            </Text>
          ) : null}
        </View>
      </Reanimated.View>
    </View>
  );
}

function ConnectivityGlyph({
  color,
  variant
}: {
  color: string;
  variant: "offline" | "reconnected";
}) {
  if (variant === "reconnected") {
    return (
      <Svg accessibilityElementsHidden height={20} viewBox="0 0 20 20" width={20}>
        <Circle cx={10} cy={10} fill="none" r={8} stroke={color} strokeWidth={1.8} />
        <Path
          d="m6.2 10.1 2.45 2.45 5.2-5.35"
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
        />
      </Svg>
    );
  }
  return (
    <Svg accessibilityElementsHidden height={20} viewBox="0 0 20 20" width={20}>
      <Path
        d="M3.15 7.7a10.7 10.7 0 0 1 9.9-2.1M5.5 10.4a7.1 7.1 0 0 1 4.95-1.55M8.1 13.1a3.55 3.55 0 0 1 2.8-.4M10 16h.01M3 3l14 14"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth={1.8}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 1_000,
    elevation: 50,
    alignItems: "center"
  },
  notice: {
    width: "100%",
    maxWidth: 520,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 }
  },
  copy: {
    flex: 1,
    minWidth: 0
  },
  title: {
    fontFamily: "System",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 19
  },
  body: {
    fontFamily: "System",
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 17
  }
});
