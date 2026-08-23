import { Pressable, Text, View } from "react-native";
import { pressable, type MobileStyles } from "@/lib/mobileTheme";

export function TimerStopIssueActions({
  clientEventId,
  onDiscard,
  onRetry,
  styles
}: {
  clientEventId: string;
  onDiscard: (clientEventId: string) => void;
  onRetry: (clientEventId: string) => void;
  styles: Pick<
    MobileStyles,
    "buttonPressed" | "buttonRow" | "secondaryButton" | "secondaryButtonText"
  >;
}) {
  return (
    <View style={styles.buttonRow}>
      <Pressable
        accessibilityLabel="Retry rejected timer Stop"
        accessibilityRole="button"
        style={pressable(styles.secondaryButton, styles.buttonPressed)}
        onPress={() => onRetry(clientEventId)}
      >
        <Text style={styles.secondaryButtonText}>Retry Stop</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Discard rejected timer Stop"
        accessibilityRole="button"
        style={pressable(styles.secondaryButton, styles.buttonPressed)}
        onPress={() => onDiscard(clientEventId)}
      >
        <Text style={styles.secondaryButtonText}>Discard Stop</Text>
      </Pressable>
    </View>
  );
}
