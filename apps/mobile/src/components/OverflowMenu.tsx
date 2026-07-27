import { useCallback, useEffect, useRef, useState } from "react";
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
import { pressable, useMobileTheme } from "@/lib/mobileTheme";
import { MOBILE_MOTION, useReduceMotionPreference } from "@/lib/motion";

export type OverflowMenuAction = "edit" | "dismiss";

export function OverflowMenu({
  disabled,
  onClose,
  onSelect,
  title,
  visible
}: {
  disabled: boolean;
  onClose: () => void;
  onSelect: (action: OverflowMenuAction) => void;
  title: string;
  visible: boolean;
}) {
  const { styles } = useMobileTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotionPreference();
  const [rendered, setRendered] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);
  const actionLocked = useRef(false);
  const firstActionRef = useRef<View>(null);
  const finishClosing = useCallback(() => setRendered(false), []);

  useEffect(() => {
    if (visible) {
      actionLocked.current = false;
      setRendered(true);
      progress.value = withTiming(1, {
        duration: reduceMotion ? 80 : MOBILE_MOTION.control,
        easing: Easing.out(Easing.cubic)
      });
      return;
    }
    if (!rendered) return;
    progress.value = withTiming(
      0,
      {
        duration: reduceMotion ? 60 : 100,
        easing: Easing.in(Easing.cubic)
      },
      (finished) => {
        if (finished) runOnJS(finishClosing)();
      }
    );
  }, [finishClosing, progress, reduceMotion, rendered, visible]);

  useEffect(() => {
    if (!rendered || !visible) return;
    const timeout = setTimeout(() => {
      const handle = findNodeHandle(firstActionRef.current);
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    }, 0);
    return () => clearTimeout(timeout);
  }, [rendered, visible]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value
  }));
  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduceMotion ? 0 : (1 - progress.value) * 8 }]
  }));

  function select(action: OverflowMenuAction) {
    if (disabled || !visible || actionLocked.current) return;
    actionLocked.current = true;
    onSelect(action);
  }

  if (!rendered) return null;

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible
    >
      <View
        accessibilityViewIsModal
        importantForAccessibility="yes"
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
          style={styles.overflowMenuDismissLayer}
          onPress={onClose}
        />
        <Reanimated.View
          accessibilityLabel={`Actions for ${title}`}
          style={[styles.overflowMenuSurface, menuStyle]}
        >
          <Pressable
            ref={firstActionRef}
            accessibilityLabel="Edit details"
            accessibilityRole="button"
            disabled={disabled || !visible}
            style={pressable(styles.overflowMenuRow, styles.buttonPressed)}
            onPress={() => select("edit")}
          >
            <Text style={styles.overflowMenuRowText}>Edit details</Text>
          </Pressable>
          <View style={styles.overflowMenuDivider} />
          <Pressable
            accessibilityLabel="Dismiss suggestion"
            accessibilityRole="button"
            disabled={disabled || !visible}
            style={pressable(styles.overflowMenuRow, styles.buttonPressed)}
            onPress={() => select("dismiss")}
          >
            <Text style={styles.overflowMenuDangerText}>Dismiss suggestion</Text>
          </Pressable>
        </Reanimated.View>
      </View>
    </Modal>
  );
}
