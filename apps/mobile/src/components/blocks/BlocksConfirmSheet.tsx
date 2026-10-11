import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DAYFRAME_BLOCKS } from "@dayframe/shared";
import { SwipeDismissSheet, type SwipeDismissSheetHandle } from "../SwipeDismissSheet";
import type { MobileStyles, MobileTheme } from "../../lib/mobileTheme";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "../../lib/mobileTypography";

export type BlocksConfirmRequest = {
  /** Shown as typed, e.g. "LOCATION HISTORY"; keep it short. */
  eyebrow: string;
  title: string;
  /** One or two short sentences: what happens, and what stays. */
  message: string;
  confirmLabel: string;
  /** "Cancel" unless the surface already names it ("Keep editing"). */
  cancelLabel?: string;
  /** "danger" (default) for removals; "neutral" for a reversible hide such as Ignore. */
  tone?: "danger" | "neutral";
  /**
   * What VoiceOver adds on the confirm pill, only when it is true for this action ("This can't be
   * undone." for a removal; nothing for Skip, which has Undo, or Archive, which has Restore).
   */
  confirmHint?: string;
  /** Runs once, after the sheet has left. */
  onConfirm: () => void;
  /** Runs once for Cancel, a backdrop tap, a swipe down, VoiceOver escape or dismissal. */
  onCancel?: () => void;
};

type Choice = "confirm" | "cancel";

/**
 * The Blocks confirm sheet (UIA-005; prototype "Clear recent location history?"): a bottom sheet
 * with an eyebrow, a title, a short body, Cancel and a danger pill. `SwipeDismissSheet` is the one
 * animation owner (sheet spring in and out, swipe down to cancel, a short fade under Reduce
 * Motion). The choice is taken once, on the first press, and its callback runs after the sheet has
 * left, so a double tap never confirms twice and what follows never overlaps the sheet. Every way
 * out other than the danger pill is Cancel.
 */
export function BlocksConfirmSheet({
  onClosed,
  reduceMotion,
  request,
  styles: shared,
  testID = "blocks-confirm-sheet",
  theme
}: {
  /** The owner forgets the request here; the sheet has already left. */
  onClosed: () => void;
  reduceMotion: boolean;
  request: BlocksConfirmRequest;
  styles: MobileStyles;
  testID?: string;
  theme: MobileTheme;
}) {
  const sheetRef = useRef<SwipeDismissSheetHandle>(null);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // At the largest text sizes the body can outgrow the screen: the sheet stops below the status
  // bar, the body scrolls inside it and both actions stay on screen under it.
  const maxSheetHeight = Math.max(240, windowHeight - insets.top - 24);
  const choice = useRef<Choice | null>(null);
  const settled = useRef(false);
  const tone = request.tone ?? "danger";

  useEffect(() => {
    // A field focused underneath (the entry sheet) must not keep its keyboard over the sheet.
    Keyboard.dismiss();
  }, []);

  function choose(next: Choice) {
    if (choice.current) return;
    choice.current = next;
    sheetRef.current?.dismiss();
  }

  function settle() {
    if (settled.current) return;
    settled.current = true;
    const chosen = choice.current ?? "cancel";
    onClosed();
    if (chosen === "confirm") request.onConfirm();
    else request.onCancel?.();
  }

  const cancel = () => choose("cancel");
  return (
    <Modal animationType="none" onRequestClose={cancel} presentationStyle="overFullScreen" transparent visible>
      <View accessibilityViewIsModal onAccessibilityEscape={cancel} style={shared.sheetOverlay}>
        <SwipeDismissSheet
          ref={sheetRef}
          accessibilityLabel={request.title}
          backdropAccessibilityLabel={request.cancelLabel ?? "Cancel"}
          backdropStyle={shared.sheetBackdrop}
          handleStyle={shared.sheetHandle}
          onDismiss={settle}
          onDismissStart={() => {
            // A swipe down or backdrop tap is Cancel unless the danger pill was already pressed.
            if (!choice.current) choice.current = "cancel";
          }}
          reduceMotion={reduceMotion}
          style={[shared.activeEditSheet, { maxHeight: maxSheetHeight, paddingBottom: Math.max(insets.bottom, 16) + 8, paddingTop: 8 }]}
          testID={testID}
          visible
        >
          <ScrollView
            alwaysBounceVertical={false}
            contentContainerStyle={confirmStyles.body}
            style={confirmStyles.scroll}
            testID={`${testID}-body`}
          >
            <Text {...mobileTextProps("counter")} style={[confirmStyles.eyebrow, { color: theme.textMuted }]}>
              {request.eyebrow.toUpperCase()}
            </Text>
            <Text {...mobileTextProps("screenHeading")} accessibilityRole="header" style={[confirmStyles.title, { color: theme.textPrimary }]}>
              {request.title}
            </Text>
            <Text {...mobileTextProps("body")} style={[confirmStyles.message, { color: theme.textSecondary }]}>
              {request.message}
            </Text>
          </ScrollView>
          <View style={confirmStyles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={cancel}
              style={({ pressed }) => [confirmStyles.pill, { backgroundColor: theme.surfaceMuted }, pressed ? confirmStyles.pressed : null]}
              testID={`${testID}-cancel`}
            >
              <Text {...mobileTextProps("control")} style={[confirmStyles.pillText, { color: theme.textPrimary }]}>
                {request.cancelLabel ?? "Cancel"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityHint={request.confirmHint}
              accessibilityRole="button"
              onPress={() => choose("confirm")}
              style={({ pressed }) => [
                confirmStyles.pill,
                { backgroundColor: tone === "danger" ? theme.danger : theme.textPrimary },
                pressed ? confirmStyles.pressed : null
              ]}
              testID={`${testID}-confirm`}
            >
              <Text
                {...mobileTextProps("control")}
                style={[confirmStyles.pillText, { color: tone === "danger" ? theme.onDanger : theme.background }]}
              >
                {request.confirmLabel}
              </Text>
            </Pressable>
          </View>
        </SwipeDismissSheet>
      </View>
    </Modal>
  );
}

type ConfirmState = BlocksConfirmRequest & { id: number };

/**
 * One confirm sheet per screen. `confirm` returns false (and shows nothing) while another
 * confirmation is still on screen, so the caller can release any gate it took.
 */
export function useBlocksConfirm() {
  const [request, setRequest] = useState<ConfirmState | null>(null);
  const sequence = useRef(0);
  const open = useRef(false);
  const confirm = useCallback((next: BlocksConfirmRequest) => {
    if (open.current) return false;
    open.current = true;
    setRequest({ ...next, id: ++sequence.current });
    return true;
  }, []);
  const close = useCallback(() => {
    open.current = false;
    setRequest(null);
  }, []);
  return { close, confirm, request };
}

export type BlocksConfirmController = ReturnType<typeof useBlocksConfirm>;

/** Renders the controller's current confirmation, if any (a new request re-mounts the sheet). */
export function BlocksConfirmHost({
  controller,
  reduceMotion,
  styles,
  testID,
  theme
}: {
  controller: BlocksConfirmController;
  reduceMotion: boolean;
  styles: MobileStyles;
  testID?: string;
  theme: MobileTheme;
}) {
  const { close, request } = controller;
  if (!request) return null;
  return (
    <BlocksConfirmSheet
      key={request.id}
      onClosed={close}
      reduceMotion={reduceMotion}
      request={request}
      styles={styles}
      testID={testID}
      theme={theme}
    />
  );
}

const confirmStyles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { gap: 6, paddingHorizontal: 4, paddingTop: 10 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.9 },
  title: { fontFamily: MOBILE_DISPLAY_FONT.bold, fontSize: 22 },
  message: { fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: "row", flexShrink: 0, gap: 10, paddingHorizontal: 4, paddingTop: 18 },
  pill: {
    alignItems: "center",
    borderRadius: DAYFRAME_BLOCKS.radius.pill,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16
  },
  pillText: { fontSize: 15, fontWeight: "700", textAlign: "center" },
  pressed: { opacity: 0.7 }
});
