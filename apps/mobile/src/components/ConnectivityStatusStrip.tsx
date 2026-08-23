import {
  AccessibilityInfo,
  StyleSheet,
  Text
} from "react-native";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Reanimated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutUp,
  ReduceMotion
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConnectivity } from "@/lib/connectivity";
import {
  createDistinctConnectivityAnnouncementTracker,
  createConnectivityPresentationState,
  connectivityPillColorRoles,
  updateConnectivityPresentation
} from "@/lib/connectivityPresentation";
import {
  getDurableWorkSnapshot,
  subscribeDurableWork
} from "@/lib/durableWorkMonitor";
import { MOBILE_MOTION, useReduceMotionPreference } from "@/lib/motion";
import { useMobileTheme } from "@/lib/mobileTheme";

export function ConnectivityStatusOverlay() {
  const connectivity = useConnectivity();
  const durableWork = useSyncExternalStore(
    subscribeDurableWork,
    getDurableWorkSnapshot,
    getDurableWorkSnapshot
  );
  const { theme } = useMobileTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotionPreference();
  const [presentation, setPresentation] = useState(createConnectivityPresentationState);
  const announcementTracker = useRef(createDistinctConnectivityAnnouncementTracker());
  const [, setClockRevision] = useState(0);
  const now = Date.now();

  const updated = updateConnectivityPresentation({
    accountKey: durableWork.accountKey,
    now,
    pendingCount: durableWork.pendingCount,
    state: presentation,
    status: connectivity.status
  });
  const viewModel = updated.viewModel;

  useEffect(() => {
    setPresentation(updated.state);
  }, [updated.state]);

  useEffect(() => {
    const onlineUntil = updated.state.onlineUntil;
    if (onlineUntil === null) return undefined;
    const timeout = setTimeout(
      () => setClockRevision((revision) => revision + 1),
      Math.max(0, onlineUntil - Date.now())
    );
    return () => clearTimeout(timeout);
  }, [updated.state.onlineUntil]);

  useEffect(() => {
    const announcement = announcementTracker.current.next(viewModel);
    if (announcement) AccessibilityInfo.announceForAccessibility(announcement);
  }, [viewModel]);

  if (!viewModel) return null;

  const colorRoles = connectivityPillColorRoles(viewModel.variant);
  const colors = {
    backgroundColor: theme[colorRoles.background],
    color: theme[colorRoles.foreground]
  };
  const entering = reduceMotion
    ? FadeIn.duration(90).reduceMotion(ReduceMotion.Never)
    : FadeInDown.duration(MOBILE_MOTION.control).reduceMotion(ReduceMotion.Never);
  const exiting = reduceMotion
    ? FadeOut.duration(70).reduceMotion(ReduceMotion.Never)
    : FadeOutUp.duration(MOBILE_MOTION.control).reduceMotion(ReduceMotion.Never);

  return (
    <Reanimated.View
      accessibilityLabel={viewModel.accessibilityLabel}
      accessibilityRole="text"
      accessible
      entering={entering}
      exiting={exiting}
      pointerEvents="none"
      style={[
        styles.overlay,
        {
          backgroundColor: colors.backgroundColor,
          top: insets.top + 4
        }
      ]}
      testID="connectivity-status-overlay"
    >
      <Text
        accessible={false}
        numberOfLines={1}
        style={[styles.text, { color: colors.color }]}
      >
        {viewModel.text}
      </Text>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 30,
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible"
  },
  text: {
    width: "100%",
    fontFamily: "System",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 17,
    textAlign: "center"
  }
});
