import { AccessibilityInfo, StyleSheet, View } from "react-native";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react";
import Reanimated, { FadeIn, FadeOut } from "react-native-reanimated";
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
import { MOBILE_MOTION, useReduceMotionPreference } from "@/lib/motion";
import { useMobileTheme } from "@/lib/mobileTheme";

const ConnectivityStatusContext = createContext<ConnectivityStatusViewModel | null | undefined>(
  undefined
);
/** Rejected changes that need the user (the account avatar's badge). */
const SyncAttentionContext = createContext(0);

export function ConnectivityStatusProvider({ children }: { children: ReactNode }) {
  const connectivity = useConnectivity();
  const durableWork = useSyncExternalStore(
    subscribeDurableWork,
    getDurableWorkSnapshot,
    getDurableWorkSnapshot
  );
  const [presentation, setPresentation] = useState(createConnectivityPresentationState);
  const announcementTracker = useRef(createDistinctConnectivityAnnouncementTracker());
  const attentionCount =
    durableWork.timeEntryNeedsAttentionCount + durableWork.timerStopNeedsAttentionCount;
  const attentionIds = durableWork.attentionIds ?? [];
  const attentionKey = attentionIds.join("|");
  // Starts from the current rejections, so a cold launch does not re-announce an older one; compares
  // identities, so a new rejection is announced even when another one cleared in the same update.
  const announcedAttention = useRef({ accountKey: durableWork.accountKey, ids: new Set(attentionIds) });
  const [, setClockRevision] = useState(0);
  const now = Date.now();

  const updated = updateConnectivityPresentation({
    accountKey: durableWork.accountKey,
    now,
    state: presentation,
    status: connectivity.status
  });
  const viewModel = updated.viewModel;

  useEffect(() => {
    setPresentation(updated.state);
  }, [updated.state]);

  useEffect(() => {
    const backOnlineUntil = updated.state.backOnlineUntil;
    if (backOnlineUntil === null) return undefined;
    const timeout = setTimeout(
      () => setClockRevision((revision) => revision + 1),
      Math.max(0, backOnlineUntil - Date.now())
    );
    return () => clearTimeout(timeout);
  }, [updated.state.backOnlineUntil]);

  useEffect(() => {
    const announcement = announcementTracker.current.next(viewModel);
    if (announcement) AccessibilityInfo.announceForAccessibility(announcement);
  }, [viewModel]);

  // A newly rejected change is announced once; the badge stays until Sync help resolves it.
  useEffect(() => {
    const previous = announcedAttention.current;
    const sameAccount = previous.accountKey === durableWork.accountKey;
    const current = new Set(attentionKey ? attentionKey.split("|") : []);
    announcedAttention.current = { accountKey: durableWork.accountKey, ids: current };
    if (sameAccount && [...current].some((id) => !previous.ids.has(id))) {
      AccessibilityInfo.announceForAccessibility(
        "A change couldn't be saved. Open Sync help from the account button."
      );
    }
  }, [attentionKey, durableWork.accountKey]);

  return (
    <ConnectivityStatusContext.Provider value={viewModel}>
      <SyncAttentionContext.Provider value={attentionCount}>{children}</SyncAttentionContext.Provider>
    </ConnectivityStatusContext.Provider>
  );
}

/** How many rejected changes need the user; the account avatar shows a badge while it is above 0. */
export function useSyncAttentionCount() {
  return useContext(SyncAttentionContext);
}

/**
 * The fixed 44-point slot after the Dayframe wordmark: confirmed offline (cloud-slash) or, briefly,
 * back online (cloud-check). Otherwise it is visually empty. It is never a button.
 */
export function ConnectivityStatusIndicator({ isFocused = true }: { isFocused?: boolean }) {
  const viewModel = useContext(ConnectivityStatusContext);
  const { theme } = useMobileTheme();
  const reduceMotion = useReduceMotionPreference();

  if (viewModel === undefined) {
    throw new Error("ConnectivityStatusIndicator must be used within ConnectivityStatusProvider");
  }

  return (
    <View
      accessibilityElementsHidden={!isFocused}
      collapsable={false}
      importantForAccessibility={isFocused ? "auto" : "no-hide-descendants"}
      pointerEvents="none"
      style={styles.statusSlot}
    >
      {viewModel ? (
        <Reanimated.View
          key={viewModel.id}
          entering={FadeIn.duration(reduceMotion ? 70 : MOBILE_MOTION.control)}
          exiting={FadeOut.duration(reduceMotion ? 60 : MOBILE_MOTION.control)}
          style={styles.statusLayer}
          testID="connectivity-status-indicator"
        >
          <View
            accessibilityLabel={viewModel.accessibilityLabel}
            accessibilityRole="text"
            accessible={isFocused}
            style={styles.statusTarget}
          >
            <View style={[styles.statusGlyph, styles.statusGlyphAligned]}>
              <SymbolView
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                name={SYMBOLS[viewModel.variant]}
                resizeMode="center"
                scale="medium"
                size={34}
                tintColor={theme.textSecondary}
                weight="regular"
              />
            </View>
          </View>
        </Reanimated.View>
      ) : null}
    </View>
  );
}

const SYMBOLS: Record<ConnectivityStatusVariant, SFSymbol> = {
  offline: "icloud.slash",
  online: "checkmark.icloud"
};

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
  }
});
