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
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useConnectivity } from "@/lib/connectivity";
import {
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
import {
  getTimerBackgroundExecutionSnapshot,
  subscribeTimerBackgroundExecution
} from "@/lib/timerBackgroundExecution";
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
  const timerBackgroundExecution = useSyncExternalStore(
    subscribeTimerBackgroundExecution,
    getTimerBackgroundExecutionSnapshot,
    getTimerBackgroundExecutionSnapshot
  );
  const [presentation, setPresentation] = useState(createConnectivityPresentationState);
  const announcementTracker = useRef(createDistinctConnectivityAnnouncementTracker());
  const [, setClockRevision] = useState(0);
  const now = Date.now();

  const updated = updateConnectivityPresentation({
    accountKey: durableWork.accountKey,
    attentionCount:
      durableWork.timeEntryNeedsAttentionCount + durableWork.timerStopNeedsAttentionCount,
    isTransmitting:
      connectivity.recoveryStatus === "syncing" ||
      timerBackgroundExecution.activeLeaseCount > 0,
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
  const statusColor = theme.textSecondary;

  if (viewModel === undefined) {
    throw new Error("ConnectivityStatusIndicator must be used within ConnectivityStatusProvider");
  }

  const content = viewModel ? (
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
            color={statusColor}
            reduceMotion={reduceMotion || !isFocused}
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
            color={statusColor}
            reduceMotion={reduceMotion || !isFocused}
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
      withTiming(360, { duration: 3_200, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(rotation);
  }, [reduceMotion, rotation, variant]);

  const symbolName: Record<
    Exclude<ConnectivityStatusVariant, "pending" | "syncing">,
    SFSymbol
  > = {
    attention: "xmark.icloud",
    offline: "icloud.slash",
    synced: "checkmark.icloud"
  };

  if (variant === "syncing" || variant === "pending") {
    return (
      <View style={[styles.statusGlyph, styles.statusGlyphAligned]}>
        <Reanimated.View style={[styles.syncArrows, rotatingStyle]}>
          <SymbolView
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            name="arrow.triangle.2.circlepath"
            resizeMode="center"
            scale="medium"
            size={36}
            tintColor={color}
            weight="regular"
          />
        </Reanimated.View>
      </View>
    );
  }

  return (
    <View style={[styles.statusGlyph, styles.statusGlyphAligned]}>
      <SymbolView
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        name={symbolName[variant]}
        resizeMode="center"
        scale="medium"
        size={34}
        tintColor={color}
        weight="regular"
      />
    </View>
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
  statusGlyph: {
    alignItems: "center",
    height: 38,
    justifyContent: "center",
    position: "relative",
    width: 38
  },
  statusGlyphAligned: {
    transform: [{ translateY: 1 }]
  },
  syncArrows: {
    alignItems: "center",
    height: 38,
    justifyContent: "center",
    position: "absolute",
    width: 38
  },
  statusPressed: {
    opacity: 0.62
  }
});
