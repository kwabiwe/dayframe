import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  type StyleProp,
  type ViewStyle,
  useWindowDimensions,
  View
} from "react-native";
import { MOBILE_MOTION } from "@/lib/motion";

const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 0.85;

type SwipeDismissSheetProps = {
  accessibilityLabel?: string;
  children: ReactNode;
  disabled?: boolean;
  handleStyle: StyleProp<ViewStyle>;
  onDismiss: () => void;
  reduceMotion: boolean;
  style: StyleProp<ViewStyle>;
  translateYOffset?: Animated.Value | Animated.AnimatedInterpolation<number> | number;
};

export function SwipeDismissSheet({
  accessibilityLabel,
  children,
  disabled = false,
  handleStyle,
  onDismiss,
  reduceMotion,
  style,
  translateYOffset = 0
}: SwipeDismissSheetProps) {
  const { height: windowHeight } = useWindowDimensions();
  const dragY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    dragY.setValue(0);
    return () => dragY.stopAnimation();
  }, [dragY]);

  const responder = useMemo(() => {
    function settle() {
      dragY.stopAnimation();
      if (reduceMotion) {
        dragY.setValue(0);
        return;
      }
      Animated.timing(dragY, {
        toValue: 0,
        duration: MOBILE_MOTION.sheet,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }).start();
    }

    return PanResponder.create({
      // The dedicated 44-point handle owns the gesture from touch-down. Keeping
      // the responder off the scrolling form prevents conflicts with controls.
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        !disabled && gesture.dy > 2 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderGrant: () => {
        dragY.stopAnimation();
      },
      onPanResponderMove: (_event, gesture) => {
        dragY.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_event, gesture) => {
        const shouldDismiss =
          gesture.dy >= DISMISS_DISTANCE ||
          (gesture.dy > 12 && gesture.vy >= DISMISS_VELOCITY);
        if (!shouldDismiss) {
          settle();
          return;
        }
        if (reduceMotion) {
          dragY.setValue(0);
          onDismiss();
          return;
        }
        Animated.timing(dragY, {
          toValue: windowHeight,
          duration: MOBILE_MOTION.sheet,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true
        }).start(({ finished }) => {
          dragY.setValue(0);
          if (finished) onDismiss();
        });
      },
      onPanResponderTerminate: settle,
      onPanResponderTerminationRequest: () => false
    });
  }, [disabled, dragY, onDismiss, reduceMotion, windowHeight]);

  const translateY = Animated.add(dragY, translateYOffset);

  return (
    <Animated.View
      accessibilityLabel={accessibilityLabel}
      accessibilityViewIsModal
      style={[style, { transform: [{ translateY }] }]}
    >
      <View
        accessibilityLabel="Dismiss sheet"
        accessibilityRole="adjustable"
        style={HANDLE_TOUCH_STYLE}
        {...responder.panHandlers}
      >
        <View pointerEvents="none" style={handleStyle} />
      </View>
      {children}
    </Animated.View>
  );
}

const HANDLE_TOUCH_STYLE: ViewStyle = {
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  marginBottom: -8,
  marginHorizontal: -16,
  marginTop: -8
};
