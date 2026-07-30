import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
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
import { Gesture, GestureDetector } from "react-native-gesture-handler";
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
  createSwipeDismissCoordinator,
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
  handleStyle: StyleProp<ViewStyle>;
  onDismiss: () => void;
  onDismissStart?: () => void;
  onGestureSettled?: () => void;
  onGestureStart?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  reduceMotion: boolean;
  style: StyleProp<ViewStyle>;
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
  handleStyle,
  onDismiss,
  onDismissStart,
  onGestureSettled,
  onGestureStart,
  onLayout,
  reduceMotion,
  style,
  translateYOffset = 0,
  visible
}, ref) {
  const { height: windowHeight } = useWindowDimensions();
  const initialExitTarget = windowHeight + OFFSCREEN_PADDING;
  const translationY = useSharedValue(initialExitTarget);
  const exitTarget = useSharedValue(initialExitTarget);
  const measuredSheetHeight = useSharedValue(windowHeight);
  const gestureOriginY = useSharedValue(0);
  const presence = useSharedValue(0);
  const gestureState = useSharedValue<"idle" | "dragging" | "settling" | "dismissing">("idle");
  const dismissCommitted = useSharedValue(false);
  const onDismissRef = useRef(onDismiss);
  const onDismissStartRef = useRef(onDismissStart);
  const onGestureSettledRef = useRef(onGestureSettled);
  const onGestureStartRef = useRef(onGestureStart);
  const wasVisibleRef = useRef(false);
  const coordinatorRef = useRef(createSwipeDismissCoordinator(() => onDismissRef.current()));
  onDismissRef.current = onDismiss;
  onDismissStartRef.current = onDismissStart;
  onGestureSettledRef.current = onGestureSettled;
  onGestureStartRef.current = onGestureStart;

  const notifyGestureStart = useCallback(() => {
    onGestureStartRef.current?.();
  }, []);

  const notifyGestureSettled = useCallback(() => {
    onGestureSettledRef.current?.();
  }, []);

  const notifyDismissStart = useCallback(() => {
    onDismissStartRef.current?.();
  }, []);

  const beginGestureDismiss = useCallback(() => {
    if (!coordinatorRef.current.commit()) return;
    onDismissStartRef.current?.();
  }, []);

  const finishDismiss = useCallback(() => {
    coordinatorRef.current.finish();
  }, []);

  const requestDismiss = useCallback(() => {
    if (!visible || dismissCommitted.value || !coordinatorRef.current.commit()) return;
    dismissCommitted.value = true;
    gestureState.value = "dismissing";
    notifyDismissStart();
    cancelAnimation(translationY);
    const exitPlan = swipeSheetExitPlan({
      currentTranslation: translationY.value,
      exitTarget: exitTarget.value,
      reduceMotion
    });
    if (exitPlan.fadeOnly) {
      presence.value = withTiming(0, { duration: REDUCE_MOTION_FADE_MS }, (finished) => {
        if (finished) runOnJS(finishDismiss)();
      });
      return;
    }
    translationY.value = withSpring(exitPlan.translationTarget, EXIT_SPRING, (finished) => {
      if (finished) runOnJS(finishDismiss)();
    });
  }, [
    dismissCommitted,
    exitTarget,
    finishDismiss,
    gestureState,
    notifyDismissStart,
    presence,
    reduceMotion,
    translationY,
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
      cancelAnimation(translationY);
      cancelAnimation(presence);
      wasVisibleRef.current = false;
      coordinatorRef.current.hide();
      dismissCommitted.value = false;
      gestureState.value = "idle";
      presence.value = plan.initialPresence;
      translationY.value = plan.initialTranslation;
      return;
    }
    if (wasVisibleRef.current) return;
    wasVisibleRef.current = true;
    cancelAnimation(translationY);
    cancelAnimation(presence);

    coordinatorRef.current.hide();
    dismissCommitted.value = false;
    gestureState.value = "idle";
    if (reduceMotion) {
      translationY.value = plan.initialTranslation;
      presence.value = plan.initialPresence;
      presence.value = withTiming(plan.animatePresenceTo, { duration: REDUCE_MOTION_FADE_MS });
      return;
    }
    presence.value = plan.initialPresence;
    translationY.value = plan.initialTranslation;
    translationY.value = withTiming(plan.animateTranslationTo, { duration: MOBILE_MOTION.sheet });
  }, [
    dismissCommitted,
    exitTarget,
    gestureState,
    presence,
    reduceMotion,
    translationY,
    visible
  ]);

  const gesture = useMemo(() => Gesture.Pan()
    .enabled(!disabled && visible)
    .activeOffsetY(SWIPE_DISMISS_MOTION.activeOffsetY)
    .failOffsetX([
      -SWIPE_DISMISS_MOTION.horizontalFailureOffset,
      SWIPE_DISMISS_MOTION.horizontalFailureOffset
    ])
    .onBegin(() => {
      if (dismissCommitted.value) return;
      cancelAnimation(translationY);
      gestureOriginY.value = translationY.value;
      gestureState.value = "dragging";
      runOnJS(notifyGestureStart)();
    })
    .onUpdate((event) => {
      if (gestureState.value !== "dragging" || dismissCommitted.value) return;
      translationY.value = Math.max(0, gestureOriginY.value + event.translationY);
    })
    .onEnd((event) => {
      if (gestureState.value !== "dragging" || dismissCommitted.value) return;
      const dismiss = shouldDismissSwipe({
        disabled,
        sheetHeight: measuredSheetHeight.value,
        translationX: event.translationX,
        translationY: translationY.value,
        velocityY: event.velocityY
      });
      if (!dismiss) {
        gestureState.value = "settling";
        if (reduceMotion) {
          translationY.value = 0;
          gestureState.value = "idle";
          runOnJS(notifyGestureSettled)();
          return;
        }
        translationY.value = withSpring(0, {
          ...RETURN_SPRING,
          velocity: event.velocityY
        }, (finished) => {
          if (!finished || dismissCommitted.value) return;
          gestureState.value = "idle";
          runOnJS(notifyGestureSettled)();
        });
        return;
      }

      dismissCommitted.value = true;
      gestureState.value = "dismissing";
      runOnJS(beginGestureDismiss)();
      const exitPlan = swipeSheetExitPlan({
        currentTranslation: translationY.value,
        exitTarget: exitTarget.value,
        reduceMotion
      });
      if (exitPlan.fadeOnly) {
        presence.value = withTiming(0, { duration: REDUCE_MOTION_FADE_MS }, (finished) => {
          if (finished) runOnJS(finishDismiss)();
        });
        return;
      }
      translationY.value = withSpring(exitPlan.translationTarget, {
        ...EXIT_SPRING,
        velocity: Math.max(0, event.velocityY)
      }, (finished) => {
        if (finished) runOnJS(finishDismiss)();
      });
    })
    .onFinalize((_event, succeeded) => {
      if (succeeded || gestureState.value !== "dragging" || dismissCommitted.value) return;
      gestureState.value = "settling";
      if (reduceMotion) {
        translationY.value = 0;
        gestureState.value = "idle";
        runOnJS(notifyGestureSettled)();
        return;
      }
      translationY.value = withSpring(0, RETURN_SPRING, (finished) => {
        if (!finished || dismissCommitted.value) return;
        gestureState.value = "idle";
        runOnJS(notifyGestureSettled)();
      });
    }), [
    disabled,
    dismissCommitted,
    exitTarget,
    finishDismiss,
    gestureOriginY,
    gestureState,
    measuredSheetHeight,
    beginGestureDismiss,
    notifyGestureSettled,
    notifyGestureStart,
    presence,
    reduceMotion,
    translationY,
    visible
  ]);

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translationY.value }]
  }));
  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: presence.value *
      backdropProgressForTranslation(translationY.value, exitTarget.value)
  }));

  return (
    <>
      <Reanimated.View pointerEvents={visible ? "auto" : "none"} style={[backdropStyle, backdropAnimatedStyle]}>
        <Pressable
          accessibilityLabel={backdropAccessibilityLabel}
          accessibilityRole="button"
          onPress={requestDismiss}
          style={BACKDROP_PRESSABLE_STYLE}
        />
      </Reanimated.View>
      <ReactNativeAnimated.View style={{ transform: [{ translateY: translateYOffset }] }}>
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
        >
          <GestureDetector gesture={gesture}>
            <View
              accessibilityHint="Swipe down or double tap to close"
              accessibilityLabel="Dismiss sheet"
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              onAccessibilityTap={disabled ? undefined : requestDismiss}
              style={HANDLE_TOUCH_STYLE}
            >
              <View pointerEvents="none" style={handleStyle} />
            </View>
          </GestureDetector>
          {children}
        </Reanimated.View>
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
