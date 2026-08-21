import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  Text,
  View,
  findNodeHandle
} from "react-native";
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConnectivityBanner } from "@/components/ConnectivityBanner";
import { pressable, useMobileTheme } from "@/lib/mobileTheme";
import { MOBILE_MOTION, useReduceMotionPreference } from "@/lib/motion";
import type { ReviewMenuAction } from "@/lib/review";

export type OverflowMenuAction = ReviewMenuAction;

type RenderedPresentation = {
  id: string;
  title: string;
  token: number;
};

type PresentationPhase = "idle" | "presenting" | "open" | "closing" | "dismissing";

export function OverflowMenu({
  disabled,
  instanceId,
  onClose,
  onClosed,
  onSelect,
  title,
  visible
}: {
  disabled: boolean;
  instanceId: string | null;
  onClose: () => void;
  onClosed: (instanceId: string) => void;
  onSelect: (action: OverflowMenuAction, instanceId: string) => void;
  title: string;
  visible: boolean;
}) {
  const { styles } = useMobileTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotionPreference();
  const initialPresentation = visible && instanceId
    ? { id: instanceId, title, token: 1 }
    : null;
  const [renderedPresentation, setRenderedPresentation] =
    useState<RenderedPresentation | null>(initialPresentation);
  const [modalVisible, setModalVisible] = useState(Boolean(initialPresentation));
  const [interactive, setInteractive] = useState(false);
  const [closing, setClosing] = useState(false);
  const progress = useSharedValue(0);
  const actionLocked = useRef(false);
  const firstActionRef = useRef<View>(null);
  const phaseRef = useRef<PresentationPhase>(
    initialPresentation ? "presenting" : "idle"
  );
  const presentationToken = useRef(initialPresentation?.token ?? 0);
  const requestedPresentation = useRef({ instanceId, title, visible });
  const closeCompletion = useRef<RenderedPresentation | null>(null);
  requestedPresentation.current = { instanceId, title, visible };

  const finishEntrance = useCallback((presentation: RenderedPresentation) => {
    if (
      phaseRef.current !== "presenting" ||
      presentationToken.current !== presentation.token ||
      requestedPresentation.current.instanceId !== presentation.id ||
      !requestedPresentation.current.visible
    ) return;
    phaseRef.current = "open";
    setInteractive(true);
    const handle = findNodeHandle(firstActionRef.current);
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  }, []);

  const finishExitAnimation = useCallback((presentation: RenderedPresentation) => {
    if (
      phaseRef.current !== "closing" ||
      presentationToken.current !== presentation.token
    ) return;
    phaseRef.current = "dismissing";
    setModalVisible(false);
  }, []);

  const beginExit = useCallback((presentation: RenderedPresentation) => {
    if (
      presentationToken.current !== presentation.token ||
      phaseRef.current === "closing" ||
      phaseRef.current === "dismissing" ||
      phaseRef.current === "idle"
    ) return;
    phaseRef.current = "closing";
    actionLocked.current = true;
    setInteractive(false);
    setClosing(true);
    progress.value = withTiming(
      0,
      {
        duration: MOBILE_MOTION.layout,
        easing: Easing.in(Easing.cubic)
      },
      (finished) => {
        if (finished) runOnJS(finishExitAnimation)(presentation);
      }
    );
  }, [finishExitAnimation, progress]);

  useEffect(() => {
    if (visible && instanceId) {
      if (!renderedPresentation) {
        const presentation = {
          id: instanceId,
          title,
          token: presentationToken.current + 1
        };
        presentationToken.current = presentation.token;
        phaseRef.current = "presenting";
        actionLocked.current = false;
        progress.value = 0;
        setInteractive(false);
        setClosing(false);
        setRenderedPresentation(presentation);
        setModalVisible(true);
        return;
      }
      if (renderedPresentation.id !== instanceId) {
        beginExit(renderedPresentation);
      }
      return;
    }
    if (renderedPresentation) beginExit(renderedPresentation);
  }, [
    beginExit,
    instanceId,
    progress,
    renderedPresentation,
    title,
    visible
  ]);

  useLayoutEffect(() => {
    if (renderedPresentation) return;
    const completed = closeCompletion.current;
    if (!completed) return;
    closeCompletion.current = null;
    onClosed(completed.id);
  }, [onClosed, renderedPresentation]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value
  }));
  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduceMotion ? 0 : (1 - progress.value) * 8 }]
  }));

  function handleModalShow() {
    const presentation = renderedPresentation;
    if (!presentation || phaseRef.current !== "presenting") return;
    if (
      !requestedPresentation.current.visible ||
      requestedPresentation.current.instanceId !== presentation.id
    ) {
      beginExit(presentation);
      return;
    }
    progress.value = 0;
    progress.value = withTiming(
      1,
      {
        duration: MOBILE_MOTION.layout,
        easing: Easing.out(Easing.cubic)
      },
      (finished) => {
        if (finished) runOnJS(finishEntrance)(presentation);
      }
    );
  }

  function handleModalDismiss() {
    const presentation = renderedPresentation;
    if (!presentation || presentationToken.current !== presentation.token) return;
    phaseRef.current = "idle";
    closeCompletion.current = presentation;
    setRenderedPresentation(null);
    setInteractive(false);
    setClosing(false);
  }

  function requestClose() {
    if (phaseRef.current !== "presenting" && phaseRef.current !== "open") return;
    onClose();
  }

  function select(action: OverflowMenuAction) {
    const presentation = renderedPresentation;
    if (
      !presentation ||
      disabled ||
      !interactive ||
      phaseRef.current !== "open" ||
      actionLocked.current
    ) return;
    actionLocked.current = true;
    onSelect(action, presentation.id);
  }

  if (!renderedPresentation) return null;

  return (
    <Modal
      animationType="none"
      onDismiss={handleModalDismiss}
      onRequestClose={requestClose}
      onShow={handleModalShow}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={modalVisible}
    >
      <View
        accessibilityElementsHidden={closing}
        accessibilityViewIsModal
        importantForAccessibility={closing ? "no-hide-descendants" : "yes"}
        style={[
          styles.overflowMenuOverlay,
          { paddingBottom: Math.max(12, insets.bottom) }
        ]}
      >
        <Reanimated.View
          pointerEvents="none"
          style={[styles.overflowMenuBackdrop, backdropStyle]}
        />
        <Pressable
          accessibilityLabel="Close actions"
          accessibilityRole="button"
          pointerEvents={closing ? "none" : "auto"}
          style={styles.overflowMenuDismissLayer}
          onPress={requestClose}
        />
        <Reanimated.View
          accessibilityLabel={`Actions for ${renderedPresentation.title}`}
          style={[styles.overflowMenuSurface, menuStyle]}
        >
          <Pressable
            ref={firstActionRef}
            accessibilityLabel="Edit details"
            accessibilityRole="button"
            disabled={disabled || !interactive}
            style={pressable(styles.overflowMenuRow, styles.buttonPressed)}
            onPress={() => select("edit")}
          >
            <Text style={styles.overflowMenuRowText}>Edit details</Text>
          </Pressable>
          <View style={styles.overflowMenuDivider} />
          <Pressable
            accessibilityLabel="Dismiss suggestion"
            accessibilityRole="button"
            disabled={disabled || !interactive}
            style={pressable(styles.overflowMenuRow, styles.buttonPressed)}
            onPress={() => select("dismiss")}
          >
            <Text style={styles.overflowMenuDangerText}>Dismiss suggestion</Text>
          </Pressable>
        </Reanimated.View>
      </View>
      <ConnectivityBanner suppressAccessibilityAnnouncement />
    </Modal>
  );
}
