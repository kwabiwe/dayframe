import { useRef } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DAYFRAME_APP_ICONS } from "@dayframe/shared";
import type { MobileTimeEntry } from "../../lib/api";
import type { MobileStyles, MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { switchRecentMeta, type SwitchRecent } from "../../lib/todaySwitch";
import { SwipeDismissSheet, type SwipeDismissSheetHandle } from "../SwipeDismissSheet";
import { DayframeIcon } from "../icons/DayframeIcon";
import { ActivityBlockMark } from "./ActivityBlockMark";

const SWITCH_BLOCK_HEIGHT = 34;

/**
 * The Switch sheet (Blocks prototype): opened by pulling the live block left, it offers up to six
 * recently finished blocks to pick up. A pick starts that block straight away (the Dashboard's
 * Start owner stops the running one first) and the sheet leaves. `SwipeDismissSheet` owns the
 * presentation, dismissal and Reduce Motion path.
 */
export function TodaySwitchSheet({
  activityIconFor,
  nowMs,
  onClose,
  onPick,
  recents,
  reduceMotion,
  running,
  styles: shared,
  theme,
}: {
  activityIconFor: (categoryId: string | null | undefined) => string | null;
  nowMs: number;
  onClose: () => void;
  onPick: (entry: MobileTimeEntry) => void;
  /** Taken when the sheet opened; the sheet never reorders while it is up. */
  recents: readonly SwitchRecent[];
  reduceMotion: boolean;
  /** Whether a block is recording now (it may have been stopped elsewhere while the sheet is up). */
  running: boolean;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const sheetRef = useRef<SwipeDismissSheetHandle>(null);
  const picked = useRef(false);
  const insets = useSafeAreaInsets();

  return (
    <Modal
      animationType="none"
      onRequestClose={() => sheetRef.current?.dismiss()}
      presentationStyle="overFullScreen"
      transparent
      visible
    >
      <View accessibilityViewIsModal style={shared.sheetOverlay}>
        <SwipeDismissSheet
          ref={sheetRef}
          accessibilityLabel="Switch"
          backdropAccessibilityLabel="Close Switch"
          backdropStyle={shared.sheetBackdrop}
          handleStyle={shared.sheetHandle}
          onDismiss={onClose}
          reduceMotion={reduceMotion}
          style={shared.activeEditSheet}
          testID="today-switch-sheet"
          visible
        >
          <View style={styles.head}>
            <Text {...mobileTextProps("counter")} style={[styles.eyebrow, { color: theme.textMuted }]}>
              SWITCH
            </Text>
            <Text {...mobileTextProps("sectionHeading")} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
              Pick up something recent
            </Text>
          </View>
          <ScrollView contentContainerStyle={[styles.list, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            {recents.length === 0 ? (
              <Text {...mobileTextProps("body")} style={[styles.empty, { color: theme.textSecondary }]}>
                Finished blocks with a description show up here.
              </Text>
            ) : recents.map(({ entry, title }, index) => {
              const meta = switchRecentMeta(entry, nowMs);
              return (
                <Pressable
                  accessibilityHint={running ? "Stops the running block and starts this one" : "Starts this block"}
                  accessibilityLabel={`${running ? "Switch to" : "Start"} ${title}, ${meta.replace(" · ", ", ")}`}
                  accessibilityRole="button"
                  key={entry.id}
                  onPress={() => {
                    // One pick per presentation, even if a second tap lands while the sheet leaves.
                    if (picked.current) return;
                    picked.current = true;
                    onPick(entry);
                    sheetRef.current?.dismiss();
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth } : null,
                    pressed ? styles.pressed : null,
                  ]}
                  testID={`today-switch-${entry.id}`}
                >
                  <ActivityBlockMark
                    categoryColor={entry.categoryColor ?? entry.categoryId ?? null}
                    categoryIcon={activityIconFor(entry.categoryId)}
                    categoryName={entry.categoryName ?? null}
                    entryId={entry.id}
                    height={SWITCH_BLOCK_HEIGHT}
                    landing={null}
                    reduceMotion={reduceMotion}
                    theme={theme}
                    width={SWITCH_BLOCK_HEIGHT}
                  />
                  <View style={styles.text}>
                    <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[styles.rowTitle, { color: theme.textPrimary }]}>
                      {title}
                    </Text>
                    <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[styles.rowMeta, { color: theme.textSecondary }]}>
                      {meta}
                    </Text>
                  </View>
                  <DayframeIcon color={theme.textSecondary} glyph={DAYFRAME_APP_ICONS.start} size={20} />
                </Pressable>
              );
            })}
          </ScrollView>
        </SwipeDismissSheet>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: { gap: 2, paddingHorizontal: 4, paddingTop: 8 },
  eyebrow: { fontSize: 11, fontWeight: "600", letterSpacing: 0.9 },
  title: { fontSize: 17, fontWeight: "700" },
  list: { paddingTop: 10 },
  empty: { fontSize: 15, lineHeight: 21, paddingHorizontal: 4, paddingVertical: 12 },
  row: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 56, paddingHorizontal: 4, paddingVertical: 10 },
  pressed: { opacity: 0.7 },
  text: { flex: 1, gap: 2, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: "600" },
  rowMeta: { fontSize: 13 },
});
