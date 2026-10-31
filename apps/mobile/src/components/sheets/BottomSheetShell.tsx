import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type KeyboardEvent,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import {
  SwipeDismissSheet,
  type SwipeDismissSheetHandle,
} from "@/components/SwipeDismissSheet";
import { keyboardInsetFromScreenY } from "@/lib/editSheetKeyboard";
import { MOBILE_MOTION } from "../../lib/motion";
import { createSheetScroller, type SheetScroller } from "../../lib/sheetScroller";
import type { MobileTheme } from "@/lib/mobileTheme";
import { REPORT_TEXT_CAP } from "@/lib/reportsTypography";
import { DAYFRAME_BLOCKS } from "@dayframe/shared";

type BottomSheetOutcome = "commit" | "discard";

export type BottomSheetScroller = Pick<SheetScroller, "reveal" | "top">;
// Expo Router's iOS NativeTabs host reserves a 52-point presentation strip
// below React sheet content, even though window/screen metrics remain full-size.
// A root-hosted overlay is attached to UIWindow, so it can safely settle through
// that strip while the tab bar is hidden by the root portal owner.
export const BOTTOM_SHEET_NATIVE_TAB_OFFSET = 52;

export function bottomSheetGeometry({
  rootHosted,
  safeAreaBottom,
  keyboardInset,
}: {
  rootHosted: boolean;
  safeAreaBottom: number;
  keyboardInset: number;
}) {
  // NativeTabs reserves its 52-point control plus the device safe area. The
  // root-hosted sheet crosses both once, then restores the safe area as
  // content padding so the action remains above the home indicator.
  const nativeTabsBottomOffset = rootHosted
    ? BOTTOM_SHEET_NATIVE_TAB_OFFSET + safeAreaBottom
    : 0;
  const contentBottomInset =
    keyboardInset > 0 ? keyboardInset + 16 : Math.max(10, safeAreaBottom);

  return {
    backdropBottom: nativeTabsBottomOffset === 0 ? 0 : -nativeTabsBottomOffset,
    contentPaddingBottom: contentBottomInset + nativeTabsBottomOffset,
    nativeTabsBottomOffset,
    surfaceTranslateY: nativeTabsBottomOffset,
  };
}

/**
 * The Blocks bottom sheet shared by the Reports filter sheet and `DateSheet`: one
 * `SwipeDismissSheet` only the handle drags, root-hosted (`FullWindowOverlay`) or in a Modal, with
 * the action pinned at the bottom. The action commits once (`onApply` returning false keeps the
 * sheet); a swipe, the backdrop or escape discards.
 */
export function BottomSheetShell({
  rootHosted,
  inline = false,
  title,
  calendarLayout = false,
  presentationId,
  theme,
  reduceMotion,
  onApply,
  onDismissed,
  action,
  disabled = false,
  fixedHeader,
  testID,
  commitRef,
  discardRef,
  scrollerRef,
  secondaryAction,
  actionTone,
  children,
}: {
  rootHosted: boolean;
  /**
   * Drawn in place, over whatever it is mounted inside (the entry sheet's own Modal), instead of
   * presenting another Modal: an absolute layer that is modal to VoiceOver, escape discards.
   */
  inline?: boolean;
  title: string;
  calendarLayout?: boolean;
  presentationId: number;
  theme: MobileTheme;
  reduceMotion: boolean;
  onApply: () => boolean | void;
  onDismissed: (presentationId: number) => void;
  action: string;
  disabled?: boolean;
  fixedHeader?: React.ReactNode;
  /** The sheet's test id; its body, scroll and action are `${testID}-body`, `-scroll`, `-action`. */
  testID: string;
  /**
   * Set to the action's own commit, so a control in the sheet (the trip sheet's "This wasn't a trip") can
   * close it as the action does: `onApply` runs, then the sheet leaves with its usual exit.
   */
  commitRef?: { current: (() => void) | null };
  /** Set to the sheet's own discard (its usual exit, no change), for a close control inside it. */
  discardRef?: { current: (() => void) | null };
  /** Set to the sheet's own scroller, for content that opens below the fold. */
  scrollerRef?: { current: BottomSheetScroller | null };
  /** A quiet action beside the primary one (the place sheet's "Don't log"): it does its own work; the sheet stays until told. */
  secondaryAction?: { disabled?: boolean; label: string; onPress: () => void; testID: string };
  /** The action's fill: coral for a filter's primary "Show", neutral for a Done (the date sheet's). Defaults by layout. */
  /** "quiet" (owner item O, 28 Oct 2026): a secondary-looking Done while nothing has changed. */
  actionTone?: "accent" | "neutral" | "quiet";
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const scrollView = useRef<ScrollView | null>(null);
  const scrollMetrics = useRef({ offset: 0, viewport: 0, content: 0 });
  const [scrollRoom, setScrollRoom] = useState(0);
  useEffect(() => {
    if (!scrollerRef) return;
    const scroller = createSheetScroller({
      afterScrollBackMs: MOBILE_MOTION.sheet,
      inner: () => (scrollView.current as unknown as { getInnerViewRef?: () => unknown } | null)?.getInnerViewRef?.() ?? null,
      metrics: scrollMetrics.current,
      nextFrame: (run) => { requestAnimationFrame(run); },
      reduceMotion,
      room: setScrollRoom,
      scrollTo: (y, animated) => scrollView.current?.scrollTo({ y, animated }),
    });
    scrollerRef.current = scroller;
    return () => {
      scroller.dispose();
      scrollerRef.current = null;
    };
  }, [reduceMotion, scrollerRef]);
  const compactCalendarLayout = calendarLayout && windowHeight <= 700;
  const sheetRef = useRef<SwipeDismissSheetHandle>(null);
  const outcome = useRef<{
    presentationId: number;
    value: BottomSheetOutcome;
  } | null>(null);
  const [closing, setClosing] = useState(false);
  const neutralAction = (actionTone ?? (calendarLayout ? "neutral" : "accent")) === "neutral";
  const [keyboardInset, setKeyboardInset] = useState(0);
  const bottomGeometry = bottomSheetGeometry({
    rootHosted,
    safeAreaBottom: insets.bottom,
    keyboardInset,
  });

  useEffect(() => {
    outcome.current = null;
    setClosing(false);
  }, [presentationId]);

  useEffect(() => {
    const update = (event: KeyboardEvent) => {
      setKeyboardInset(
        keyboardInsetFromScreenY({
          keyboardScreenY: event.endCoordinates.screenY,
          screenHeight: Dimensions.get("screen").height,
          windowHeight,
        }),
      );
    };
    const change = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
      update,
    );
    const show =
      Platform.OS === "ios"
        ? Keyboard.addListener("keyboardDidShow", update)
        : null;
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => {
        setKeyboardInset(0);
      },
    );
    const didHide =
      Platform.OS === "ios"
        ? Keyboard.addListener("keyboardDidHide", () => setKeyboardInset(0))
        : null;
    return () => {
      change.remove();
      show?.remove();
      hide.remove();
      didHide?.remove();
    };
  }, [windowHeight]);

  const claimDiscard = useCallback(() => {
    if (outcome.current?.presentationId !== presentationId)
      outcome.current = null;
    if (outcome.current) return outcome.current.value === "discard";
    outcome.current = { presentationId, value: "discard" };
    setClosing(true);
    return true;
  }, [presentationId]);

  const requestCommit = () => {
    if (outcome.current?.presentationId !== presentationId)
      outcome.current = null;
    if (disabled || outcome.current) return;
    if (onApply() === false) return;
    outcome.current = { presentationId, value: "commit" };
    setClosing(true);
    sheetRef.current?.dismiss();
  };

  const requestDiscard = () => sheetRef.current?.dismiss();
  useEffect(() => {
    if (!commitRef) return;
    commitRef.current = requestCommit;
    return () => {
      if (commitRef.current === requestCommit) commitRef.current = null;
    };
  });
  useEffect(() => {
    if (!discardRef) return;
    discardRef.current = requestDiscard;
    return () => {
      if (discardRef.current === requestDiscard) discardRef.current = null;
    };
  });

  const primaryAction = (
    <Pressable
      testID={`${testID}-action`}
      accessibilityRole="button"
      accessibilityLabel={action}
      accessibilityState={{ disabled: disabled || closing }}
      disabled={disabled || closing}
      onPress={requestCommit}
      style={[
        s.apply,
        calendarLayout ? s.dateAction : s.filterAction,
        compactCalendarLayout ? s.compactDateAction : null,
        {
          // The filter's "Show N activities" is the sheet's primary action (coral); a
          // date sheet's Done is neutral (UIA-026). Both are full width.
          backgroundColor:
            disabled || closing || actionTone === "quiet"
              ? theme.surfaceMuted
              : neutralAction
                ? theme.textPrimary
                : theme.accent,
        },
        secondaryAction ? s.footerPrimary : null,
      ]}
    >
      <Text
        maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
        style={[
          s.actionText,
          {
            color:
              disabled || closing
                ? theme.textSecondary
                : actionTone === "quiet"
                  ? theme.textPrimary
                  : neutralAction
                  ? theme.background
                  : theme.onAccent,
          },
        ]}
      >
        {action}
      </Text>
    </Pressable>
  );

  const overlay = (
    <View style={s.modal}>
      <SwipeDismissSheet
        ref={sheetRef}
        accessibilityLabel={title}
        backdropAccessibilityLabel={`Close ${title}`}
        backdropStyle={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: theme.overlay,
            bottom: bottomGeometry.backdropBottom,
          },
        ]}
        disabled={closing}
        gestureHandleOnly
        handleStyle={[s.handle, { backgroundColor: theme.borderStrong }]}
        keyboardInset={keyboardInset}
        onDismiss={(dismissedPresentationId) => {
          if (dismissedPresentationId !== presentationId) return;
          onDismissed(dismissedPresentationId);
        }}
        onDismissStart={(dismissedPresentationId) => {
          if (dismissedPresentationId !== presentationId) return false;
          return outcome.current?.presentationId === presentationId
            ? true
            : claimDiscard();
        }}
        onGestureStart={() => Keyboard.dismiss()}
        presentationId={presentationId}
        reduceMotion={reduceMotion}
        style={[
          s.sheet,
          calendarLayout ? s.dateSheet : s.filterSheet,
          // A tall sheet stops below the status bar (step 12 Simulator check).
          calendarLayout ? null : { maxHeight: windowHeight - insets.top - 8 },
          compactCalendarLayout ? s.compactDateSheet : null,
          {
            backgroundColor: theme.surfaceRaised,
            paddingBottom: bottomGeometry.contentPaddingBottom,
          },
        ]}
        testID={testID}
        translateYOffset={bottomGeometry.surfaceTranslateY}
        visible
      >
        <View
          accessibilityElementsHidden={closing}
          importantForAccessibility={closing ? "no-hide-descendants" : "auto"}
          pointerEvents={closing ? "none" : "auto"}
          style={[
            s.sheetContent,
            calendarLayout ? s.dateSheetContent : s.filterSheetContent,
            compactCalendarLayout ? s.compactDateSheetContent : null,
          ]}
        >
          {fixedHeader}
          {calendarLayout ? (
            <View
              testID={`${testID}-body`}
              style={[
                s.body,
                s.dateBody,
                compactCalendarLayout ? s.compactDateBody : null,
              ]}
            >
              {children}
            </View>
          ) : (
            <ScrollView
              testID={`${testID}-scroll`}
              ref={scrollView}
              onContentSizeChange={(_width, height) => { scrollMetrics.current.content = height; }}
              onLayout={(event) => { scrollMetrics.current.viewport = event.nativeEvent.layout.height; }}
              onScroll={(event) => { scrollMetrics.current.offset = event.nativeEvent.contentOffset.y; }}
              scrollEventThrottle={32}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={s.body}
              showsVerticalScrollIndicator={false}
              style={s.scroll}
            >
              {children}
              {scrollRoom ? <View style={{ height: scrollRoom }} /> : null}
            </ScrollView>
          )}
          {secondaryAction ? (
            <View style={s.footerRow}>
              <Pressable
                testID={secondaryAction.testID}
                accessibilityRole="button"
                accessibilityState={{ disabled: Boolean(secondaryAction.disabled) || closing }}
                disabled={Boolean(secondaryAction.disabled) || closing}
                hitSlop={4}
                onPress={secondaryAction.onPress}
                style={({ pressed }) => [s.secondary, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text maxFontSizeMultiplier={REPORT_TEXT_CAP.control} style={[s.actionText, { color: theme.textSecondary }]}>{secondaryAction.label}</Text>
              </Pressable>
              {primaryAction}
            </View>
          ) : primaryAction}
        </View>
      </SwipeDismissSheet>
    </View>
  );

  if (inline) {
    return (
      <View
        accessibilityViewIsModal
        onAccessibilityEscape={requestDiscard}
        style={StyleSheet.absoluteFill}
      >
        {overlay}
      </View>
    );
  }

  return rootHosted ? (
    <FullWindowOverlay unstable_accessibilityContainerViewIsModal>
      {overlay}
    </FullWindowOverlay>
  ) : (
    <Modal
      transparent
      animationType="none"
      onRequestClose={requestDiscard}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      visible
    >
      {overlay}
    </Modal>
  );
}

const s = StyleSheet.create({
  modal: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "90%",
    borderTopLeftRadius: DAYFRAME_BLOCKS.radius.sheet,
    borderTopRightRadius: DAYFRAME_BLOCKS.radius.sheet,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  dateSheet: { maxHeight: "100%", paddingHorizontal: 6 },
  filterSheet: { maxHeight: "100%" },
  compactDateSheet: { paddingTop: 4 },
  sheetContent: { flexShrink: 1, gap: 8 },
  dateSheetContent: { flexShrink: 0 },
  compactDateSheetContent: { gap: 4 },
  filterSheetContent: { flexShrink: 1, minHeight: 0 },
  handle: { width: 42, height: 5, borderRadius: 999 },
  actionText: { fontSize: 14, fontWeight: "600" },
  scroll: { flexShrink: 1, minHeight: 0 },
  body: { gap: 4 },
  dateBody: { flexShrink: 0 },
  compactDateBody: { gap: 0 },
  // One full-width pill: coral "Show 3 activities" on the filter sheet, a neutral Done on a date
  // sheet (date-picker audit 14 Oct 2026: the centred 160-point Done is gone).
  apply: {
    alignSelf: "stretch",
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  dateAction: { marginTop: 16, marginHorizontal: 10 },
  filterAction: { alignSelf: "stretch", width: "100%", maxWidth: "100%" },
  compactDateAction: { marginTop: 6 },
  // A quiet action to the left of the primary one, which keeps the rest of the row.
  footerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  footerPrimary: { flex: 1, width: undefined, alignSelf: "auto" },
  secondary: { minHeight: 48, minWidth: 88, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
});
