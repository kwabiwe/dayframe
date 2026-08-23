import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle
} from "react-native";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react";
import Reanimated, {
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useConnectivity } from "@/lib/connectivity";
import {
  connectivityStatusColorRole,
  createDistinctConnectivityAnnouncementTracker,
  createConnectivityPresentationState,
  updateConnectivityPresentation,
  type ConnectivityStatusVariant,
  type ConnectivityStatusViewModel
} from "@/lib/connectivityPresentation";
import {
  getDurableWorkSnapshot,
  subscribeDurableWork
} from "@/lib/durableWorkMonitor";
import { MOBILE_MOTION, useReduceMotionPreference } from "@/lib/motion";
import { useMobileTheme } from "@/lib/mobileTheme";

const ConnectivityStatusContext = createContext<ConnectivityStatusViewModel | null | undefined>(
  undefined
);

export function ConnectivityStatusProvider({ children }: { children: ReactNode }) {
  const connectivity = useConnectivity();
  const durableWork = useSyncExternalStore(
    subscribeDurableWork,
    getDurableWorkSnapshot,
    getDurableWorkSnapshot
  );
  const [presentation, setPresentation] = useState(createConnectivityPresentationState);
  const announcementTracker = useRef(createDistinctConnectivityAnnouncementTracker());
  const [, setClockRevision] = useState(0);
  const now = Date.now();

  const updated = updateConnectivityPresentation({
    accountKey: durableWork.accountKey,
    attentionCount:
      durableWork.timeEntryNeedsAttentionCount + durableWork.timerStopNeedsAttentionCount,
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

  return (
    <ConnectivityStatusContext.Provider value={viewModel}>
      {children}
    </ConnectivityStatusContext.Provider>
  );
}

export function ConnectivityStatusIndicator({
  isFocused = true,
  onOpenDiagnostics
}: {
  isFocused?: boolean;
  onOpenDiagnostics: () => void;
}) {
  const viewModel = useContext(ConnectivityStatusContext);
  const { theme } = useMobileTheme();
  const reduceMotion = useReduceMotionPreference();

  if (viewModel === undefined) {
    throw new Error("ConnectivityStatusIndicator must be used within ConnectivityStatusProvider");
  }

  const content = viewModel && isFocused ? (
    <Reanimated.View
      key={viewModel.id}
      entering={FadeIn.duration(reduceMotion ? 70 : MOBILE_MOTION.control)}
      exiting={FadeOut.duration(reduceMotion ? 60 : MOBILE_MOTION.control)}
      style={styles.statusLayer}
      testID="connectivity-status-indicator"
    >
      {viewModel.isActionable ? (
        <Pressable
          accessibilityHint="Opens Settings, Sync and diagnostics"
          accessibilityLabel={viewModel.accessibilityLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: !isFocused }}
          disabled={!isFocused}
          onPress={onOpenDiagnostics}
          style={({ pressed }) => [
            styles.statusTarget,
            pressed ? styles.statusPressed : null
          ]}
          testID="connectivity-status-attention"
        >
          <ConnectivityStatusGlyph
            color={theme[connectivityStatusColorRole(viewModel.variant)]}
            reduceMotion={reduceMotion}
            variant={viewModel.variant}
          />
        </Pressable>
      ) : (
        <View
          accessibilityLabel={viewModel.accessibilityLabel}
          accessibilityRole="text"
          accessible={isFocused}
          importantForAccessibility={isFocused ? "auto" : "no-hide-descendants"}
          pointerEvents="none"
          style={styles.statusTarget}
        >
          <ConnectivityStatusGlyph
            color={theme[connectivityStatusColorRole(viewModel.variant)]}
            reduceMotion={reduceMotion}
            variant={viewModel.variant}
          />
        </View>
      )}
    </Reanimated.View>
  ) : null;

  return (
    <View
      accessibilityElementsHidden={!isFocused}
      collapsable={false}
      importantForAccessibility={isFocused ? "auto" : "no-hide-descendants"}
      pointerEvents={viewModel?.isActionable && isFocused ? "auto" : "none"}
      style={styles.statusSlot}
    >
      {content}
    </View>
  );
}

function ConnectivityStatusGlyph({
  color,
  reduceMotion,
  variant
}: {
  color: string;
  reduceMotion: boolean;
  variant: ConnectivityStatusVariant;
}) {
  const rotation = useSharedValue(0);
  const rotatingStyle = useAnimatedStyle<ViewStyle>(() => ({
    transform: [{ rotate: `${rotation.value}deg` }]
  }));

  useEffect(() => {
    cancelAnimation(rotation);
    rotation.value = 0;
    if (variant !== "syncing" || reduceMotion) return undefined;
    rotation.value = withRepeat(
      withTiming(360, { duration: 2_200, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(rotation);
  }, [reduceMotion, rotation, variant]);

  return (
    <Reanimated.View style={variant === "syncing" ? rotatingStyle : undefined}>
      <Svg
        accessibilityElementsHidden
        height={22}
        importantForAccessibility="no-hide-descendants"
        viewBox="0 0 24 24"
        width={22}
      >
        {variant === "syncing" ? (
          <>
            <Path
              d="M20 7h-5V2M4 17h5v5M19 7a8 8 0 0 0-13.5-2M5 17a8 8 0 0 0 13.5 2"
              fill="none"
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.9}
            />
          </>
        ) : (
          <>
            <Path
              d="M7 18h10a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.3 8.7 4.5 4.5 0 0 0 7 18Z"
              fill="none"
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.8}
            />
            {variant === "offline" ? (
              <Path d="M5 5l14 14" stroke={color} strokeLinecap="round" strokeWidth={2} />
            ) : null}
            {variant === "synced" ? (
              <Path
                d="m9 13 2 2 4-4"
                fill="none"
                stroke={color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            ) : null}
            {variant === "attention" ? (
              <Path
                d="m10 11 4 4m0-4-4 4"
                fill="none"
                stroke={color}
                strokeLinecap="round"
                strokeWidth={2}
              />
            ) : null}
          </>
        )}
      </Svg>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  statusSlot: {
    width: 44,
    height: 44,
    position: "relative"
  },
  statusLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  },
  statusTarget: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center"
  },
  statusPressed: {
    opacity: 0.62
  }
});
