import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { COMPACT_PILL_HIT_SLOP, compactPillStyles } from "../compactPill";
import { localPresenceEntering, localPresenceExiting } from "../../lib/motion";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";

/** A block's own "?" at the top of its sheet (location v4 design §7): "Team sync ran 18m into your trip". */
export type BlockQuestion = {
  text: string;
  /** "End it at 09:42": the one Yes; null when it can't be sent from here (Keep it alone). */
  endLabel: string | null;
  keepLabel: string;
  /** End it (true) or Keep it (false). The sheet closes once the answer is taken (held for Undo). */
  onAnswer: (end: boolean) => void;
};

/**
 * The question on its block's sheet, in compact pills with 44-point targets (owner rule: one Yes only). Motion: the
 * sheet's presentation owns its entrance and exit; it only fades in or out on its own when the question arrives or
 * leaves while the sheet is up (none with Reduce Motion).
 */
export function BlockQuestionCard({ locked = false, onLocked, question, reduceMotion, theme }: {
  /** The sheet has unsaved edits: the answers are disabled until they are saved or discarded (as on the web). */
  locked?: boolean;
  /** A tap on a disabled answer: the sheet's own "Discard changes?" prompt. */
  onLocked?: () => void;
  question: BlockQuestion;
  reduceMotion: boolean;
  theme: MobileTheme;
}) {
  const press = (end: boolean) => {
    if (locked) onLocked?.();
    else question.onAnswer(end);
  };
  const lockedHint = locked ? "Save or discard your changes to answer" : undefined;
  return (
    <Animated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)}
      style={[styles.card, { backgroundColor: theme.surfaceMuted }]} testID="time-entry-sheet-question">
      <View accessibilityLabel={`${question.text}. Needs a look`} accessible role="group">
        <Text {...mobileTextProps("itemTitle")} accessibilityRole="header" style={[styles.text, { color: theme.textPrimary }]}>{question.text}</Text>
      </View>
      {locked ? (
        <Text {...mobileTextProps("metadata")} style={{ color: theme.textSecondary }} testID="time-entry-sheet-question-locked">
          Save or discard your changes to answer.
        </Text>
      ) : null}
      <View style={compactPillStyles.answers}>
        {question.endLabel ? (
          <Pressable accessibilityHint={lockedHint} accessibilityRole="button" accessibilityState={{ disabled: locked }}
            hitSlop={COMPACT_PILL_HIT_SLOP} onPress={() => press(true)}
            style={({ pressed }) => [compactPillStyles.pill, { backgroundColor: theme.textPrimary, opacity: locked ? 0.4 : pressed ? 0.8 : 1 }]}
            testID="time-entry-sheet-question-end">
            <Text {...mobileTextProps("control")} style={[compactPillStyles.text, { color: theme.surface }]}>{question.endLabel}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityHint={lockedHint} accessibilityRole="button" accessibilityState={{ disabled: locked }}
          hitSlop={COMPACT_PILL_HIT_SLOP} onPress={() => press(false)}
          style={({ pressed }) => [compactPillStyles.pill, { backgroundColor: theme.surface, opacity: locked ? 0.4 : pressed ? 0.8 : 1 }]}
          testID="time-entry-sheet-question-keep">
          <Text {...mobileTextProps("control")} style={[compactPillStyles.text, { color: theme.textPrimary }]}>{question.keepLabel}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, borderRadius: 16, padding: 14, marginHorizontal: 16, marginBottom: 8 },
  text: { fontSize: 16, fontWeight: "700" }
});
