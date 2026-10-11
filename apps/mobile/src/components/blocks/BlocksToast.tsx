import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Reanimated from "react-native-reanimated";
import { DAYFRAME_BLOCKS } from "@dayframe/shared";
import { colorWithAlpha } from "../today/todayBlocksLayout";
import { localPresenceEntering, localPresenceExiting } from "../../lib/motion";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";

/** How long a toast stays (prototype `DF.toast`, the web's BlocksToast). Review's hold keeps its own 4.8 s. */
export const BLOCKS_TOAST_DURATION_MS = 5_000;

export type BlocksToastProps = {
  /** "Undo"; omitted for a notice without an action. */
  actionLabel?: string;
  /** What VoiceOver reads for the action, e.g. "Undo deleting Deep work". */
  actionAccessibilityLabel?: string;
  actionTestID?: string;
  message: string;
  onAction?: () => void;
  reduceMotion: boolean;
  /** Placement from the owner (absolute position on Today, anchored above the deck actions on Review). */
  style?: StyleProp<ViewStyle>;
  /** The activity's colour; a neutral swatch when there is no activity (a batch, a bare block). */
  swatchColor?: string | null;
  testID?: string;
  theme: MobileTheme;
};

/**
 * The iPhone Blocks toast (mirrors `apps/web/src/components/blocks/BlocksToast.tsx`): an inverse
 * pill with the activity swatch, one sentence and an optional neutral pill action (never coral).
 * Its owner keeps the notice's lifetime and token and renders it with `key={token}`, so a
 * replacing notice re-mounts (a fresh entrance) and a stale exit can never hide a newer one.
 * Reanimated owns the presence: rise + fade in, fade out; Reduce Motion fades only.
 */
export function BlocksToast({
  actionAccessibilityLabel,
  actionLabel,
  actionTestID,
  message,
  onAction,
  reduceMotion,
  style,
  swatchColor,
  testID,
  theme
}: BlocksToastProps) {
  return (
    <Reanimated.View
      accessibilityLiveRegion="polite"
      entering={localPresenceEntering(reduceMotion, "rise")}
      exiting={localPresenceExiting(reduceMotion)}
      style={[toastStyles.toast, { backgroundColor: theme.textPrimary, shadowColor: theme.shadow }, style]}
      testID={testID}
    >
      <View style={toastStyles.label}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[toastStyles.swatch, { backgroundColor: swatchColor ?? theme.textMuted }]}
          testID={testID ? `${testID}-swatch` : undefined}
        />
        <Text {...mobileTextProps("control")} numberOfLines={1} style={[toastStyles.message, { color: theme.background }]}>
          {message}
        </Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [
            toastStyles.action,
            { backgroundColor: colorWithAlpha(theme.background, pressed ? 0.24 : 0.14) }
          ]}
          testID={actionTestID}
        >
          <Text {...mobileTextProps("control")} style={[toastStyles.actionText, { color: theme.background }]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </Reanimated.View>
  );
}

export type BlocksNotice = {
  message: string;
  swatchColor?: string | null;
  token: number;
};

/**
 * A notice without an action ("Switched to …", "Already recording", "Quick start is full"): one at
 * a time, 5 s, each with a new token. A second notice replaces the first and clears its timer, so
 * a stale timeout never hides a newer notice. VoiceOver hears each one as it appears.
 */
export function useBlocksNotice(durationMs = BLOCKS_TOAST_DURATION_MS) {
  const [notice, setNotice] = useState<BlocksNotice | null>(null);
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    token.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setNotice(null);
  }, []);

  const show = useCallback((message: string, swatchColor?: string | null) => {
    const next = ++token.current;
    if (timer.current) clearTimeout(timer.current);
    setNotice({ message, swatchColor: swatchColor ?? null, token: next });
    AccessibilityInfo.announceForAccessibility(message);
    timer.current = setTimeout(() => {
      if (token.current !== next) return;
      timer.current = null;
      setNotice(null);
    }, durationMs);
  }, [durationMs]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  return { clear, notice, show };
}

const toastStyles = StyleSheet.create({
  toast: {
    alignItems: "center",
    borderRadius: DAYFRAME_BLOCKS.radius.pill,
    elevation: 5,
    flexDirection: "row",
    gap: 12,
    minHeight: 52,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 4,
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 12
  },
  label: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
    minWidth: 0
  },
  swatch: {
    borderRadius: 4,
    height: 12,
    width: 12
  },
  message: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "600"
  },
  action: {
    alignItems: "center",
    borderRadius: DAYFRAME_BLOCKS.radius.pill,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 14
  },
  actionText: {
    fontSize: 13,
    fontWeight: "700"
  }
});
