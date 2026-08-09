import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode
} from "react";
import {
  Animated as ReactNativeAnimated,
  Pressable,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
  useWindowDimensions,
  View
} from "react-native";
import {
  Gesture,
  GestureDetector,
  type GestureType
} from "react-native-gesture-handler";
import Reanimated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from "react-native-reanimated";
import { MOBILE_MOTION } from "@/lib/motion";
import {
  backdropProgressForTranslation,
  canSettleSwipeGesture,
  createSwipeDismissCoordinator,
  createSwipeSheetPresentationCoordinator,
  shouldDismissSwipe,
  swipeSheetExitPlan,
  swipeSheetPresentationPlan,
  SWIPE_DISMISS_MOTION
} from "@/lib/swipeDismissMotion";

const REDUCE_MOTION_FADE_MS = 70;
const OFFSCREEN_PADDING = 32;
const RETURN_SPRING = {
  damping: 36,
  mass: 1,
  overshootClamping: true,
  stiffness: 320
} as const;
const EXIT_SPRING = {
  damping: 34,
  mass: 1,
  overshootClamping: true,
  stiffness: 290
} as const;

export type SwipeDismissSheetHandle = {
  dismiss: () => void;
};

type SwipeDismissSheetProps = {
  accessibilityLabel?: string;
  backdropAccessibilityLabel: string;
  backdropStyle: StyleProp<ViewStyle>;
  children: ReactNode;
  disabled?: boolean;
  dismissGestureRef?: MutableRefObject<GestureType | undefined>;
  handleStyle: StyleProp<ViewStyle>;
  keyboardInset?: number;
  onDismiss: (presentationId: number) => void;
  onDismissStart?: (presentationId: number) => boolean | void;
  onGestureSettled?: (presentationId: number) => void;
  onGestureStart?: (presentationId: number) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  onPresented?: (presentationId: number) => void;
  onStaleCallback?: (presentationId: number) => void;
  presentationId?: number;
  reduceMotion: boolean;
  style: StyleProp<ViewStyle>;
  testID?: string;
  translateYOffset?: ReactNativeAnimated.Value | ReactNativeAnimated.AnimatedInterpolation<number> | number;
  visible: boolean;
};

export const SwipeDismissSheet = forwardRef<SwipeDismissSheetHandle, SwipeDismissSheetProps>(
function SwipeDismissSheet({
  accessibilityLabel,
  backdropAccessibilityLabel,
  backdropStyle,
  children,
  disabled = false,
  dismissGestureRef,
  handleStyle,
  keyboardInset = 0,
  onDismiss,
  onDismissStart,
  onGestureSettled,
  onGestureStart,
  onLayout,
  onPresented,
  onStaleCallback,
  presentationId = 0,
  reduceMotion,
  style,
  testID,
  translateYOffset = 0,
  visible
}, ref) {
  const { height: windowHeight } = useWindowDimensions();
  const initialExitTarget = windowHeight + OFFSCREEN_PADDING;
  const translationY = useSharedValue(initialExitTarget);
  const exitTarget = useSharedValue(initialExitTarget);
  const measuredSheetHeight = useSharedValue(windowHeight);
  const gestureOriginY = useSharedValue(0);
  const keyboardInsetValue = useSharedValue(keyboardInset);
  const keyboardHandoffPending = useSharedValue(false);
  const keyboardHandoffTranslationY = useSharedValue(0);
  const gestureTravelY = useSharedValue(0);
  const presence = useSharedValue(0);
  const gestureState = useSharedValue<"idle" | "dragging" | "settling" | "dismissing">("idle");
  const dismissCommitted = useSharedValue(false);
  const onDismissRef = useRef(onDismiss);
  const onDismissStartRef = useRef(onDismissStart);
  const onGestureSettledRef = useRef(onGestureSettled);
  const onGestureStartRef = useRef(onGestureStart);
  const onPresentedRef = useRef(onPresented);
  const onStaleCallbackRef = useRef(onStaleCallback);
  const activePresentationIdRef = useRef(presentationId);
  const committedPresentationIdRef = useRef<number | null>(null);
  const dismissRequestInFlightRef = useRef<number | null>(null);
  const visiblePresentationRef = useRef<number | null>(null);
  const visibleRef = useRef(visible);
  const presentationAnimationSequenceRef = useRef(0);
  const presentationCoordinatorRef = useRef(
    createSwipeSheetPresentationCoordinator()
  );
  const coordinatorRef = useRef(createSwipeDismissCoordinator(() => {
    const committedPresentationId = committedPresentationIdRef.current;
    if (
      committedPresentationId === null ||
      committedPresentationId !== activePresentationIdRef.current ||
      !visibleRef.current
    ) return;
    onDismissRef.current(committedPresentationId);
  }));
  onDismissRef.current = onDismiss;
  onDismissStartRef.current = onDismissStart;
  onGestureSettledRef.current = onGestureSettled;
  onGestureStartRef.current = onGestureStart;
  onPresentedRef.current = onPresented;
  onStaleCallbackRef.current = onStaleCallback;
  activePresentationIdRef.current = presentationId;
  visibleRef.current = visible;

  useEffect(() => {
    keyboardInsetValue.value = keyboardInset;
  }, [keyboardInset, keyboardInsetValue]);

  const notifyGestureStart = useCallback((gesturePresentationId: number) => {
    if (
      gesturePresentationId !== activePresentationIdRef.current ||
      !visibleRef.current
    ) {
      onStaleCallbackRef.current?.(gesturePresentationId);
      return;
    }
    onGestureStartRef.current?.(gesturePresentationId);
  }, []);

  const notifyGestureSettled = useCallback((gesturePresentationId: number) => {
    if (
      gesturePresentationId !== activePresentationIdRef.current ||
      !visibleRef.current
    ) {
      onStaleCallbackRef.current?.(gesturePresentationId);
      return false;
    }
    onGestureSettledRef.current?.(gesturePresentationId);
    return true;
  }, []);

  const approveDismissStart = useCallback((committedPresentationId: number) => {
    if (
      committedPresentationId !== activePresentationIdRef.current ||
      !visibleRef.current
    ) {
      onStaleCallbackRef.current?.(committedPresentationId);
      return false;
    }
    return onDismissStartRef.current?.(committedPresentationId) !== false;
  }, []);

  const notifyPresented = useCallback((
    presentedId: number,
    animationSequence: number
  ) => {
    if (animationSequence !== presentationAnimationSequenceRef.current) return;
    if (
      presentedId !== activePresentationIdRef.current ||
      visiblePresentationRef.current !== presentedId ||
      !visibleRef.current
    ) {
      onStaleCallbackRef.current?.(presentedId);
      return;
    }
    const completion = presentationCoordinatorRef.current.complete(presentedId);
    if (completion === "stale") {
      onStaleCallbackRef.current?.(presentedId);
      return;
    }
    if (completion !== "accepted") return;
    onPresentedRef.current?.(presentedId);
  }, []);

  const notifyGestureSettledAtRest = useCallback((gesturePresentationId: number) => {
    if (!canSettleSwipeGesture({
      activePresentationId: activePresentationIdRef.current,
      committedPresentationId: committedPresentationIdRef.current,
      coordinatorCanSettle: coordinatorRef.current.canSettle(),
      dismissCommitted: dismissCommitted.value,
      dismissRequestPresentationId: dismissRequestInFlightRef.current,
      gesturePresentationId,
      presentationCanSettle: presentationCoordinatorRef.current.canSettle(
        gesturePresentationId
      ),
      visible: visibleRef.current
    })) {
      if (gesturePresentationId !== activePresentationIdRef.current) {
        onStaleCallbackRef.current?.(gesturePresentationId);
      }
      return;
    }
    if (!notifyGestureSettled(gesturePresentationId)) return;
    translationY.value = 0;
    presence.value = 1;
    notifyPresented(
      gesturePresentationId,
      presentationAnimationSequenceRef.current
    );
  }, [dismissCommitted, notifyGestureSettled, notifyPresented, presence, translationY]);

  const finishDismiss = useCallback((committedPresentationId: number) => {
    if (
      committedPresentationId !== activePresentationIdRef.current ||
      committedPresentationIdRef.current !== committedPresentationId ||
      !visibleRef.current
    ) {
      onStaleCallbackRef.current?.(committedPresentationId);
      return;
    }
    coordinatorRef.current.finish();
  }, []);

  const commitDismiss = useCallback((
    committedPresentationId: number,
    velocityY: number,
    gestureOwned: boolean
  ) => {
    if (
      committedPresentationId !== activePresentationIdRef.current ||
      !visibleRef.current
    ) {
      onStaleCallbackRef.current?.(committedPresentationId);
      return;
    }
    if (dismissRequestInFlightRef.current === committedPresentationId) return;
    dismissRequestInFlightRef.current = committedPresentationId;
    if (!approveDismissStart(committedPresentationId)) {
      dismissRequestInFlightRef.current = null;
      if (!gestureOwned) return;
      dismissCommitted.value = false;
      gestureState.value = "settling";
      cancelAnimation(translationY);
      cancelAnimation(presence);
      if (reduceMotion) {
        translationY.value = 0;
        presence.value = 1;
        gestureState.value = "idle";
        notifyGestureSettledAtRest(committedPresentationId);
        return;
      }
      translationY.value = withSpring(0, {
        ...RETURN_SPRING,
        velocity: Math.max(0, velocityY)
      }, (finished) => {
        if (!finished || dismissCommitted.value) return;
        gestureState.value = "idle";
        runOnJS(notifyGestureSettledAtRest)(committedPresentationId);
      });
      return;
    }
    if (
      !presentationCoordinatorRef.current.commitDismiss(committedPresentationId) ||
      !coordinatorRef.current.commit()
    ) {
      dismissRequestInFlightRef.current = null;
      return;
    }
    presentationAnimationSequenceRef.current += 1;
    committedPresentationIdRef.current = committedPresentationId;
    dismissCommitted.value = true;
    gestureState.value = "dismissing";
    cancelAnimation(translationY);
    cancelAnimation(presence);
    const exitPlan = swipeSheetExitPlan({
      currentTranslation: translationY.value,
      exitTarget: exitTarget.value,
      reduceMotion
    });
    if (exitPlan.fadeOnly) {
      presence.value = withTiming(0, { duration: REDUCE_MOTION_FADE_MS }, (finished) => {
        if (finished) runOnJS(finishDismiss)(committedPresentationId);
      });
      return;
    }
    translationY.value = withSpring(exitPlan.translationTarget, {
      ...EXIT_SPRING,
      velocity: Math.max(0, velocityY)
    }, (finished) => {
      if (finished) runOnJS(finishDismiss)(committedPresentationId);
    });
  }, [
    approveDismissStart,
    dismissCommitted,
    exitTarget,
    finishDismiss,
    gestureState,
    notifyGestureSettledAtRest,
    presence,
    reduceMotion,
    translationY
  ]);

  const requestDismiss = useCallback(() => {
    if (!visible || dismissCommitted.value) return;
    const committedPresentationId = presentationId;
    commitDismiss(committedPresentationId, 0, false);
  }, [
    commitDismiss,
    dismissCommitted,
    presentationId,
    visible
  ]);

  useImperativeHandle(ref, () => ({ dismiss: requestDismiss }), [requestDismiss]);

  useLayoutEffect(() => {
    const plan = swipeSheetPresentationPlan({
      exitTarget: exitTarget.value,
      reduceMotion,
      visible
    });
    if (!visible) {
      presentationAnimationSequenceRef.current += 1;
      cancelAnimation(translationY);
      cancelAnimation(presence);
      visiblePresentationRef.current = null;
      presentationCoordinatorRef.current.hide();
      coordinatorRef.current.hide();
      committedPresentationIdRef.current = null;
      dismissRequestInFlightRef.current = null;
      dismissCommitted.value = false;
      gestureState.value = "idle";
      presence.value = plan.initialPresence;
      translationY.value = plan.initialTranslation;
      return;
    }
    const presentationMode = reduceMotion ? "fade" : "slide";
    const presentationAction = presentationCoordinatorRef.current.begin(
      presentationId,
      presentationMode
    );
    if (presentationAction === "unchanged") return;
    visiblePresentationRef.current = presentationId;
    presentationAnimationSequenceRef.current += 1;
    const presentationAnimationSequence = presentationAnimationSequenceRef.current;
    cancelAnimation(translationY);
    cancelAnimation(presence);

    coordinatorRef.current.hide();
    committedPresentationIdRef.current = null;
    dismissRequestInFlightRef.current = null;
    dismissCommitted.value = false;
    gestureState.value = "idle";
    if (reduceMotion) {
      translationY.value = plan.initialTranslation;
      presence.value = plan.initialPresence;
      presence.value = withTiming(
        plan.animatePresenceTo,
        { duration: REDUCE_MOTION_FADE_MS },
        (finished) => {
          if (finished) {
            runOnJS(notifyPresented)(presentationId, presentationAnimationSequence);
          }
        }
      );
      return;
    }
    presence.value = plan.initialPresence;
    translationY.value = plan.initialTranslation;
    translationY.value = withTiming(
      plan.animateTranslationTo,
      { duration: MOBILE_MOTION.sheet },
      (finished) => {
        if (finished) {
          runOnJS(notifyPresented)(presentationId, presentationAnimationSequence);
        }
      }
    );
  }, [
    dismissCommitted,
    exitTarget,
    gestureState,
    notifyPresented,
    presentationId,
    presence,
    reduceMotion,
    translationY,
    visible
  ]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
    .enabled(!disabled && visible)
    .activeOffsetY(SWIPE_DISMISS_MOTION.activeOffsetY)
    .failOffsetX([
      -SWIPE_DISMISS_MOTION.horizontalFailureOffset,
      SWIPE_DISMISS_MOTION.horizontalFailureOffset
    ])
    // Only claim the interaction after the pan crosses activeOffsetY. Using
    // onBegin here would dismiss the keyboard for ordinary taps on fields,
    // Suggestions, and quick actions before those controls can respond.
    .onStart(() => {
      if (dismissCommitted.value) return;
      cancelAnimation(translationY);
      cancelAnimation(presence);
      gestureOriginY.value = translationY.value;
      keyboardHandoffPending.value = keyboardInsetValue.value > 0.5;
      keyboardHandoffTranslationY.value = 0;
      gestureTravelY.value = 0;
      gestureState.value = "dragging";
      runOnJS(notifyGestureStart)(presentationId);
    })
    .onUpdate((event) => {
      if (gestureState.value !== "dragging" || dismissCommitted.value) return;
      if (keyboardHandoffPending.value) {
        if (keyboardInsetValue.value > 0.5) {
          translationY.value = 0;
          gestureTravelY.value = 0;
          return;
        }
        keyboardHandoffPending.value = false;
        keyboardHandoffTranslationY.value = event.translationY;
      }
      gestureTravelY.value = Math.max(
        0,
        event.translationY - keyboardHandoffTranslationY.value
      );
      translationY.value = Math.max(0, gestureOriginY.value + gestureTravelY.value);
    })
    .onEnd((event) => {
      if (gestureState.value !== "dragging" || dismissCommitted.value) return;
      const dismiss = shouldDismissSwipe({
        disabled,
        sheetHeight: measuredSheetHeight.value,
        translationX: event.translationX,
        // The animated sheet may still carry entrance translation. Dismissal
        // ownership is decided only from travel caused by this gesture.
        translationY: gestureTravelY.value,
        velocityY: event.velocityY
      });
      if (!dismiss) {
        gestureState.value = "settling";
        if (reduceMotion) {
          translationY.value = 0;
          gestureState.value = "idle";
          runOnJS(notifyGestureSettledAtRest)(presentationId);
          return;
        }
        translationY.value = withSpring(0, {
          ...RETURN_SPRING,
          velocity: event.velocityY
        }, (finished) => {
          if (!finished || dismissCommitted.value) return;
          gestureState.value = "idle";
          runOnJS(notifyGestureSettledAtRest)(presentationId);
        });
        return;
      }

      const committedPresentationId = presentationId;
      gestureState.value = "settling";
      runOnJS(commitDismiss)(committedPresentationId, event.velocityY, true);
    })
    .onFinalize((_event, succeeded) => {
      if (succeeded || gestureState.value !== "dragging" || dismissCommitted.value) return;
      gestureState.value = "settling";
      if (reduceMotion) {
        translationY.value = 0;
        gestureState.value = "idle";
        runOnJS(notifyGestureSettledAtRest)(presentationId);
        return;
      }
      translationY.value = withSpring(0, RETURN_SPRING, (finished) => {
        if (!finished || dismissCommitted.value) return;
        gestureState.value = "idle";
        runOnJS(notifyGestureSettledAtRest)(presentationId);
      });
    });
    return dismissGestureRef ? pan.withRef(dismissGestureRef) : pan;
  }, [
    disabled,
    dismissGestureRef,
    dismissCommitted,
    commitDismiss,
    gestureOriginY,
    gestureTravelY,
    gestureState,
    keyboardHandoffPending,
    keyboardHandoffTranslationY,
    keyboardInsetValue,
    measuredSheetHeight,
    notifyGestureSettledAtRest,
    notifyGestureStart,
    presence,
    presentationId,
    reduceMotion,
    translationY,
    visible
  ]);

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    opacity: presence.value,
    transform: [{ translateY: translationY.value }]
  }));
  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: presence.value *
      backdropProgressForTranslation(translationY.value, exitTarget.value)
  }));

  return (
    <>
      <Reanimated.View
        pointerEvents={visible ? "auto" : "none"}
        style={[backdropStyle, backdropAnimatedStyle]}
        testID={testID ? `${testID}-backdrop` : undefined}
      >
        <Pressable
          accessibilityLabel={backdropAccessibilityLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={disabled ? undefined : requestDismiss}
          style={BACKDROP_PRESSABLE_STYLE}
        />
      </Reanimated.View>
      <ReactNativeAnimated.View style={{ transform: [{ translateY: translateYOffset }] }}>
        <GestureDetector gesture={gesture}>
          <Reanimated.View
            accessibilityLabel={accessibilityLabel}
            accessibilityViewIsModal
            onLayout={(event) => {
              const measuredTarget = Math.max(
                event.nativeEvent.layout.height + OFFSCREEN_PADDING,
                windowHeight + OFFSCREEN_PADDING
              );
              measuredSheetHeight.value = event.nativeEvent.layout.height;
              exitTarget.value = measuredTarget;
              onLayout?.(event);
            }}
            style={[style, sheetAnimatedStyle]}
            testID={testID}
          >
            <View
              accessibilityHint="Swipe down or double tap to close"
              accessibilityLabel="Dismiss sheet"
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              onAccessibilityTap={disabled ? undefined : requestDismiss}
              style={HANDLE_TOUCH_STYLE}
              testID={testID ? `${testID}-handle` : undefined}
            >
              <View pointerEvents="none" style={handleStyle} />
            </View>
            {children}
          </Reanimated.View>
        </GestureDetector>
      </ReactNativeAnimated.View>
    </>
  );
});

const BACKDROP_PRESSABLE_STYLE: ViewStyle = {
  flex: 1
};

const HANDLE_TOUCH_STYLE: ViewStyle = {
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  marginBottom: -8,
  marginHorizontal: -16,
  marginTop: -8
};
