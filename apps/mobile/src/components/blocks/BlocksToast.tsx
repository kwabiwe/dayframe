import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Reanimated, { useSharedValue } from "react-native-reanimated";
import { DAYFRAME_BLOCKS } from "@dayframe/shared";
import { colorWithAlpha } from "../today/todayBlocksLayout";
import { blocksToastEntering, blocksToastExiting, type ToastPhase } from "../../lib/blocksMotion";
import { toastAccessibilityText, type BlocksToastCopy } from "../../lib/blocksToastCopy";
import type { MobileTheme } from "../../lib/mobileTheme";
import { MOBILE_TEXT_CAP, mobileTextProps } from "../../lib/mobileTypography";

/** How long a toast stays (prototype `DF.toast`, the web's BlocksToast). Review's hold keeps its own 4.8 s. */
export const BLOCKS_TOAST_DURATION_MS = 5_000;

/**
 * The toast's measures. At its 52-point rest height it is a pill (corners of half that height);
 * a plain sentence may wrap to a second line at the largest text sizes, and the toast then keeps
 * those corners instead of becoming a capsule that would clip its text. A named toast ("Switched
 * to {name}") is always one line: its lead never shrinks and only the name ends in "…".
 */
export const BLOCKS_TOAST_METRICS = {
  minHeight: 52,
  radius: 26,
  paddingLeft: 16,
  /** With an action the pill's own padding holds the right end; without one the text keeps 16. */
  paddingRightWithAction: 4,
  paddingRightWithoutAction: 16,
  swatchSize: 12,
  swatchGap: 10,
  messageFontSize: 13,
  messageLineHeight: 17,
  messageMaxLines: 2,
  /** A named toast: the space between its fixed lead and the name, which alone truncates. */
  leadNameGap: 4,
  /** Dynamic Type stops growing here (the `control` role), so every line still fits on screen. */
  maxFontScale: MOBILE_TEXT_CAP.control
} as const;

export type BlocksToastProps = {
  /** "Undo"; omitted for a notice without an action. */
  actionLabel?: string;
  /** What VoiceOver reads for the action, e.g. "Undo deleting Deep work". */
  actionAccessibilityLabel?: string;
  actionTestID?: string;
  message: string;
  /**
   * With `name`, the message is drawn as one line: this fixed lead ("Switched to"), never cut,
   * then the name, which alone ends in "…" when it is too long. Omitted for a plain sentence.
   */
  lead?: string | null;
  name?: string | null;
  /** The one sentence VoiceOver reads for the toast; defaults to the message. */
  accessibilityLabel?: string;
  onAction?: () => void;
  reduceMotion: boolean;
  /** Placement from the owner (absolute position on Today, anchored above the deck actions on Review). */
  style?: StyleProp<ViewStyle>;
  /** The activity's colour; a neutral swatch when there is no activity (a batch, a bare block). */
  swatchColor?: string | null;
  testID?: string;
  theme: MobileTheme;
  /**
   * The toast is already on screen and only moved to another slot (the Review deck changing
   * branch): it appears at rest with no entrance, settled, so its later exit starts from rest.
   */
  appearSettled?: boolean;
};

/**
 * The iPhone Blocks toast (mirrors `apps/web/src/components/blocks/BlocksToast.tsx`): an inverse
 * pill with the activity swatch, one sentence and an optional neutral pill action (never coral).
 * A plain sentence may wrap to two lines at the largest text sizes, so the toast may be taller
 * than its pill height; its owner's out-of-flow place anchors one edge (Today's bottom edge above
 * the tab bar), so the extra line grows away from that edge and moves nothing. A named toast
 * (`lead` + `name`, "Switched to School run") is one line whose name alone truncates.
 * Its owner keeps the notice's lifetime and token and renders it with `key={token}`, so a
 * replacing notice re-mounts (a fresh entrance) and a stale exit can never hide a newer one.
 * Reanimated owns the presence: rise + fade in, fade out; Reduce Motion fades only.
 */
export function BlocksToast({
  appearSettled = false,
  accessibilityLabel,
  actionAccessibilityLabel,
  actionLabel,
  actionTestID,
  lead,
  message,
  name,
  onAction,
  reduceMotion,
  style,
  swatchColor,
  testID,
  theme
}: BlocksToastProps) {
  // Where the entrance is, so the exit knows where to start (blocksToastExiting).
  const phase = useSharedValue<ToastPhase["value"]>(appearSettled ? "settled" : "entering");
  const hasAction = Boolean(actionLabel && onAction);
  const label = toastAccessibilityText({ accessibilityLabel, message });
  const named = Boolean(lead && name);
  return (
    <Reanimated.View
      accessibilityLiveRegion="polite"
      entering={appearSettled ? undefined : blocksToastEntering(reduceMotion, phase)}
      exiting={blocksToastExiting(reduceMotion, phase)}
      style={[
        toastStyles.toast,
        hasAction ? toastStyles.toastWithAction : toastStyles.toastWithoutAction,
        { backgroundColor: theme.textPrimary, shadowColor: theme.shadow },
        style
      ]}
      testID={testID}
    >
      {/* The swatch and the words are one VoiceOver element reading one sentence. */}
      <View accessibilityLabel={label} accessible style={toastStyles.label} testID={testID ? `${testID}-label` : undefined}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[toastStyles.swatch, { backgroundColor: swatchColor ?? theme.textMuted }]}
          testID={testID ? `${testID}-swatch` : undefined}
        />
        <View style={toastStyles.lines}>
          {named ? (
            // One line: the lead keeps its width, the name shrinks into what is left and ends in "…".
            <View style={toastStyles.namedLine} testID={testID ? `${testID}-line` : undefined}>
              <Text
                {...mobileTextProps("control")}
                numberOfLines={1}
                style={[toastStyles.message, toastStyles.lead, { color: theme.background }]}
                testID={testID ? `${testID}-lead` : undefined}
              >
                {lead}
              </Text>
              <Text
                {...mobileTextProps("control")}
                ellipsizeMode="tail"
                numberOfLines={1}
                style={[toastStyles.message, toastStyles.name, { color: theme.background }]}
                testID={testID ? `${testID}-name` : undefined}
              >
                {name}
              </Text>
            </View>
          ) : (
            <Text
              {...mobileTextProps("control")}
              numberOfLines={BLOCKS_TOAST_METRICS.messageMaxLines}
              style={[toastStyles.message, { color: theme.background }]}
              testID={testID ? `${testID}-message` : undefined}
            >
              {message}
            </Text>
          )}
        </View>
      </View>
      {hasAction ? (
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
  accessibilityLabel?: string;
  lead?: string | null;
  message: string;
  name?: string | null;
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

  const show = useCallback((copy: string | BlocksToastCopy, swatchColor?: string | null) => {
    const next = ++token.current;
    if (timer.current) clearTimeout(timer.current);
    const words = typeof copy === "string" ? { message: copy } : copy;
    setNotice({
      accessibilityLabel: words.accessibilityLabel,
      lead: words.lead ?? null,
      message: words.message,
      name: words.name ?? null,
      swatchColor: swatchColor ?? null,
      token: next
    });
    AccessibilityInfo.announceForAccessibility(toastAccessibilityText(words));
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
    borderRadius: BLOCKS_TOAST_METRICS.radius,
    elevation: 5,
    flexDirection: "row",
    gap: 12,
    minHeight: BLOCKS_TOAST_METRICS.minHeight,
    paddingLeft: BLOCKS_TOAST_METRICS.paddingLeft,
    paddingVertical: 4,
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 12
  },
  toastWithAction: {
    paddingRight: BLOCKS_TOAST_METRICS.paddingRightWithAction
  },
  toastWithoutAction: {
    paddingRight: BLOCKS_TOAST_METRICS.paddingRightWithoutAction
  },
  label: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: BLOCKS_TOAST_METRICS.swatchGap,
    minHeight: 44,
    minWidth: 0
  },
  swatch: {
    borderRadius: 4,
    height: BLOCKS_TOAST_METRICS.swatchSize,
    width: BLOCKS_TOAST_METRICS.swatchSize
  },
  lines: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
    paddingVertical: 4
  },
  message: {
    fontSize: BLOCKS_TOAST_METRICS.messageFontSize,
    fontWeight: "600",
    lineHeight: BLOCKS_TOAST_METRICS.messageLineHeight
  },
  namedLine: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: BLOCKS_TOAST_METRICS.leadNameGap,
    minWidth: 0
  },
  lead: {
    flexShrink: 0
  },
  name: {
    flexShrink: 1,
    minWidth: 0
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
