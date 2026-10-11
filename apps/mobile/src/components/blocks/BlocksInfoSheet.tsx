import { useRef } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DAYFRAME_BLOCKS, type DayframeGlyph } from "@dayframe/shared";
import { SwipeDismissSheet, type SwipeDismissSheetHandle } from "../SwipeDismissSheet";
import { DayframeIcon } from "../icons/DayframeIcon";
import type { MobileStyles, MobileTheme } from "../../lib/mobileTheme";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "../../lib/mobileTypography";

export type BlocksInfoRow = { glyph: DayframeGlyph; lead: string; text: string };

/**
 * A Blocks explanation sheet (UIA-022): the eyebrow and title head with a Done pill, a few short
 * icon rows like onboarding's (a bold lead, then one or two plain sentences) and an optional
 * privacy note on an inset card. `SwipeDismissSheet` owns presentation and every dismissal path
 * (Done, backdrop, swipe, accessibility escape), with its Reduce Motion fade.
 */
export function BlocksInfoSheet({
  eyebrow,
  note,
  onClose,
  reduceMotion,
  rows,
  styles,
  testID,
  theme,
  title
}: {
  eyebrow: string;
  note?: { glyph: DayframeGlyph; text: string } | null;
  onClose: () => void;
  reduceMotion: boolean;
  rows: readonly BlocksInfoRow[];
  styles: MobileStyles;
  testID?: string;
  theme: MobileTheme;
  title: string;
}) {
  const sheetRef = useRef<SwipeDismissSheetHandle>(null);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  return (
    <Modal
      animationType="none"
      onRequestClose={() => sheetRef.current?.dismiss()}
      presentationStyle="overFullScreen"
      transparent
      visible
    >
      <View accessibilityViewIsModal style={styles.sheetOverlay}>
        <SwipeDismissSheet
          ref={sheetRef}
          accessibilityLabel={title}
          backdropAccessibilityLabel={`Close ${title}`}
          backdropStyle={styles.sheetBackdrop}
          handleStyle={styles.sheetHandle}
          onDismiss={onClose}
          reduceMotion={reduceMotion}
          style={[styles.activeEditSheet, { maxHeight: Math.round(windowHeight * 0.85), paddingTop: 8 }]}
          testID={testID}
          visible
        >
          <View style={sheetStyles.head}>
            <View style={sheetStyles.headTitle}>
              <Text {...mobileTextProps("counter")} style={[sheetStyles.eyebrow, { color: theme.textMuted }]}>
                {eyebrow.toUpperCase()}
              </Text>
              <Text {...mobileTextProps("screenHeading")} accessibilityRole="header" style={[sheetStyles.title, { color: theme.textPrimary }]}>
                {title}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={`Done, close ${title}`}
              accessibilityRole="button"
              onPress={() => sheetRef.current?.dismiss()}
              style={({ pressed }) => [sheetStyles.donePill, { backgroundColor: theme.surfaceMuted }, pressed ? sheetStyles.pressed : null]}
              testID={testID ? `${testID}-done` : undefined}
            >
              <Text {...mobileTextProps("control")} style={[sheetStyles.doneText, { color: theme.textPrimary }]}>Done</Text>
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={[sheetStyles.body, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}
            style={sheetStyles.scroll}
          >
            {rows.map((row) => (
              <View key={row.lead} accessible style={sheetStyles.row}>
                <View style={[sheetStyles.rowIcon, { backgroundColor: theme.surfaceInset }]}>
                  <DayframeIcon color={theme.textSecondary} glyph={row.glyph} size={18} />
                </View>
                <Text {...mobileTextProps("body")} style={[sheetStyles.rowText, { color: theme.textSecondary }]}>
                  <Text style={[sheetStyles.rowLead, { color: theme.textPrimary }]}>{row.lead}</Text> {row.text}
                </Text>
              </View>
            ))}
            {note ? (
              <View accessible style={[sheetStyles.note, { backgroundColor: theme.surfaceInset }]}>
                <DayframeIcon color={theme.textSecondary} glyph={note.glyph} size={18} />
                <Text {...mobileTextProps("body")} style={[sheetStyles.noteText, { color: theme.textSecondary }]}>{note.text}</Text>
              </View>
            ) : null}
          </ScrollView>
        </SwipeDismissSheet>
      </View>
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
  head: { alignItems: "center", flexDirection: "row", gap: 12, paddingBottom: 12, paddingHorizontal: 4, paddingTop: 6 },
  headTitle: { flex: 1, gap: 2, minWidth: 0 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.9 },
  title: { fontFamily: MOBILE_DISPLAY_FONT.bold, fontSize: 22 },
  donePill: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, justifyContent: "center", minHeight: 44, minWidth: 64, paddingHorizontal: 16 },
  doneText: { fontSize: 15, fontWeight: "700" },
  scroll: { flexGrow: 0 },
  body: { gap: 18, paddingHorizontal: 4, paddingTop: 4 },
  row: { alignItems: "flex-start", flexDirection: "row", gap: 14 },
  rowIcon: { alignItems: "center", borderRadius: 12, height: 36, justifyContent: "center", width: 36 },
  rowText: { flex: 1, fontSize: 15, lineHeight: 21, minWidth: 0 },
  rowLead: { fontWeight: "700" },
  note: { alignItems: "flex-start", borderRadius: 16, flexDirection: "row", gap: 12, padding: 16 },
  noteText: { flex: 1, fontSize: 14, lineHeight: 20, minWidth: 0 },
  pressed: { opacity: 0.7 }
});
