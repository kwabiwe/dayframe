import { Modal, Pressable, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { type MobileStyles } from "@/lib/mobileTheme";
import {
  localPresenceEntering,
  localPresenceExiting,
  useReduceMotionPreference
} from "@/lib/motion";

type DeleteEntryConfirmationProps = {
  deleting?: boolean;
  message?: string;
  onCancel: () => void;
  onConfirm: () => void;
  presentation?: "contained" | "screen";
  styles: MobileStyles;
  visible: boolean;
};

export function DeleteEntryConfirmation({
  deleting = false,
  message = "This time entry will be removed. This cannot be undone.",
  onCancel,
  onConfirm,
  presentation = "contained",
  styles,
  visible
}: DeleteEntryConfirmationProps) {
  const reduceMotion = useReduceMotionPreference();

  if (!visible && presentation === "contained") return null;

  const card = (
    <View style={styles.sheetDeleteConfirmationCard}>
        <Text style={styles.sheetDeleteConfirmationTitle}>Delete entry?</Text>
        <Text style={styles.sheetDeleteConfirmationText}>{message}</Text>
        <View style={styles.sheetDeleteConfirmationActions}>
          <Pressable
            accessibilityLabel="Cancel deleting entry"
            accessibilityRole="button"
            disabled={deleting}
            onPress={onCancel}
            style={({ pressed }) => [
              styles.sheetDeleteConfirmationCancel,
              pressed && !deleting ? styles.buttonPressed : null,
              deleting ? styles.buttonDisabled : null
            ]}
          >
            <Text style={styles.sheetDeleteConfirmationCancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Confirm delete entry"
            accessibilityRole="button"
            disabled={deleting}
            onPress={onConfirm}
            style={({ pressed }) => [
              styles.sheetDeleteConfirmationDelete,
              pressed && !deleting ? styles.buttonPressed : null,
              deleting ? styles.buttonDisabled : null
            ]}
          >
            <Text style={styles.sheetDeleteConfirmationDeleteText}>Delete</Text>
          </Pressable>
        </View>
    </View>
  );

  if (presentation === "contained") {
    return (
      <Reanimated.View
        accessibilityLabel="Confirm delete entry"
        accessibilityViewIsModal
        entering={localPresenceEntering(reduceMotion, "scale")}
        exiting={localPresenceExiting(reduceMotion)}
        onAccessibilityEscape={onCancel}
        style={styles.sheetDeleteConfirmationOverlay}
      >
        {card}
      </Reanimated.View>
    );
  }

  const confirmation = visible ? (
    <View
      accessibilityLabel="Confirm delete entry"
      accessibilityViewIsModal
      onAccessibilityEscape={onCancel}
      style={[styles.sheetDeleteConfirmationOverlay, styles.screenDeleteConfirmationOverlay]}
    >
      {card}
    </View>
  ) : null;

  return (
    <Modal
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onCancel}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.deleteConfirmationModalRoot}>{confirmation}</View>
    </Modal>
  );
}
