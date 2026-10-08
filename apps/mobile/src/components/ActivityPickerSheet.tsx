import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DAYFRAME_APP_ICONS, blockColorsFor } from "@dayframe/shared";
import { SwipeDismissSheet, type SwipeDismissSheetHandle } from "./SwipeDismissSheet";
import { ActivityIcon, DayframeIcon } from "./icons/DayframeIcon";
import { activityPickerSections, canCreateActivity, type ChoosableActivity } from "../lib/activityChoice";
import type { MobileStyles, MobileTheme } from "../lib/mobileTheme";
import { mobileTextProps } from "../lib/mobileTypography";

const ROW_BLOCK = 34;

/**
 * "All activities" (Blocks prototype openActivityPicker): a tall sheet over the entry sheet with
 * a focused search field and Cancel. Without a query it lists Recent, then the groups A–Z; with
 * one it lists matches, earliest first, and offers "Create “q”" when no activity has that name.
 * A pick (or a created activity) is handed back and the sheet leaves. `SwipeDismissSheet` owns
 * the presentation, dismissal and Reduce Motion path.
 */
export function ActivityPickerSheet<T extends ChoosableActivity>({
  activities,
  onClose,
  onCreate,
  onPick,
  recentIds,
  reduceMotion,
  selectedId,
  styles: shared,
  theme,
}: {
  activities: readonly T[];
  onClose: () => void;
  /** Creates the activity; resolves to its id, or a message to show when it could not be created. */
  onCreate?: (name: string) => Promise<{ id: string } | { error: string }>;
  onPick: (activityId: string) => void;
  recentIds: readonly string[];
  reduceMotion: boolean;
  selectedId: string | null;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const sheetRef = useRef<SwipeDismissSheetHandle>(null);
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const done = useRef(false);
  const sections = useMemo(() => activityPickerSections(activities, query, recentIds), [activities, query, recentIds]);
  const offerCreate = Boolean(onCreate) && canCreateActivity(activities, query);
  const trimmed = query.trim();
  const noMatches = Boolean(trimmed) && sections.every((section) => section.rows.length === 0);

  function finish(activityId: string) {
    if (done.current) return;
    done.current = true;
    onPick(activityId);
    sheetRef.current?.dismiss();
  }

  async function create() {
    if (!onCreate || creating || !trimmed || done.current) return;
    setCreating(true);
    setCreateError(null);
    const result = await onCreate(trimmed).catch(() => ({ error: `Couldn't create "${trimmed}". Check your connection and try again.` }));
    // Cancelled (or picked) while creating: never change the entry after the sheet was dismissed.
    if (done.current) return;
    setCreating(false);
    if ("id" in result) finish(result.id);
    else setCreateError(result.error);
  }

  function cancel() {
    done.current = true;
    sheetRef.current?.dismiss();
  }

  return (
    <Modal animationType="none" onRequestClose={cancel} presentationStyle="overFullScreen" transparent visible>
      <View accessibilityViewIsModal style={shared.sheetOverlay}>
        <SwipeDismissSheet
          ref={sheetRef}
          accessibilityLabel="All activities"
          backdropAccessibilityLabel="Close All activities"
          backdropStyle={shared.sheetBackdrop}
          handleStyle={shared.sheetHandle}
          onDismiss={onClose}
          // Any way out (Cancel, backdrop, swipe, a pick) ends the picker: a create that resolves
          // while it leaves never changes the entry.
          onDismissStart={() => {
            done.current = true;
          }}
          reduceMotion={reduceMotion}
          style={[shared.activeEditSheet, styles.sheet, { paddingTop: 8 }]}
          testID="activity-picker"
          visible
        >
          <View style={styles.head}>
            <View style={[styles.search, { backgroundColor: theme.surfaceInset }]}>
              <DayframeIcon color={theme.textMuted} glyph={DAYFRAME_APP_ICONS.search} size={18} />
              <TextInput
                {...mobileTextProps("input")}
                accessibilityLabel="Search activities"
                autoCapitalize="sentences"
                autoCorrect={false}
                autoFocus
                clearButtonMode="while-editing"
                onChangeText={(value) => {
                  setQuery(value);
                  setCreateError(null);
                }}
                onSubmitEditing={() => {
                  const first = sections.find((section) => section.rows.length)?.rows[0];
                  if (first) finish(first.id);
                  else if (offerCreate) void create();
                }}
                placeholder="Search activities"
                placeholderTextColor={theme.textMuted}
                returnKeyType="done"
                style={[styles.searchInput, { color: theme.textPrimary }]}
                // Uncontrolled: native typing owns the text, so fast input never drops characters.
                testID="activity-picker-search"
              />
            </View>
            <Pressable
              accessibilityLabel="Cancel"
              accessibilityRole="button"
              onPress={cancel}
              style={({ pressed }) => [styles.cancel, pressed ? styles.pressed : null]}
              testID="activity-picker-cancel"
            >
              <Text {...mobileTextProps("control")} style={[styles.cancelText, { color: theme.textSecondary }]}>Cancel</Text>
            </Pressable>
          </View>
          {trimmed ? null : (
            <Text {...mobileTextProps("metadata")} style={[styles.count, { color: theme.textMuted }]}>
              {activities.length} {activities.length === 1 ? "activity" : "activities"}
            </Text>
          )}
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            style={styles.list}
          >
            {sections.map((section) => section.rows.length ? (
              <View key={section.key}>
                {section.title ? (
                  <Text {...mobileTextProps("counter")} accessibilityRole="header" style={[styles.groupTitle, { color: theme.textMuted }]}>
                    {section.title.toUpperCase()}
                  </Text>
                ) : null}
                {section.rows.map((activity) => (
                  <PickerRow
                    activity={activity}
                    key={`${section.key}-${activity.id}`}
                    sectionKey={section.key}
                    onPress={() => finish(activity.id)}
                    selected={activity.id === selectedId}
                    theme={theme}
                  />
                ))}
              </View>
            ) : null)}
            {noMatches ? (
              <Text {...mobileTextProps("body")} style={[styles.empty, { color: theme.textSecondary }]}>
                No activity called "{trimmed}" yet.
              </Text>
            ) : null}
            {offerCreate ? (
              <Pressable
                accessibilityLabel={`Create ${trimmed}`}
                accessibilityRole="button"
                disabled={creating}
                onPress={() => void create()}
                style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
                testID="activity-picker-create"
              >
                <View style={[styles.rowBlock, { backgroundColor: theme.surfaceMuted }]}>
                  {creating ? (
                    <ActivityIndicator color={theme.textSecondary} size="small" />
                  ) : (
                    <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.add} size={18} />
                  )}
                </View>
                <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[styles.rowName, { color: theme.textPrimary }]}>
                  Create “{trimmed}”
                </Text>
              </Pressable>
            ) : null}
            {createError ? (
              <Text {...mobileTextProps("body")} accessibilityLiveRegion="polite" style={[styles.empty, { color: theme.dangerText }]}>
                {createError}
              </Text>
            ) : null}
          </ScrollView>
        </SwipeDismissSheet>
      </View>
    </Modal>
  );
}

function PickerRow({
  activity,
  onPress,
  sectionKey,
  selected,
  theme,
}: {
  activity: ChoosableActivity;
  onPress: () => void;
  sectionKey: string;
  selected: boolean;
  theme: MobileTheme;
}) {
  const colors = blockColorsFor(activity.color ?? activity.id, theme.mode, activity.name);
  return (
    <Pressable
      accessibilityLabel={activity.name}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      testID={`activity-picker-row-${sectionKey}-${activity.id}`}
    >
      <View style={[styles.rowBlock, { backgroundColor: colors.fill }]}>
        <ActivityIcon color={colors.text} icon={activity.icon ?? null} name={activity.name} size={18} />
      </View>
      <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[styles.rowName, { color: theme.textPrimary }]}>
        {activity.name}
      </Text>
      {selected ? <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.done} size={18} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { height: "92%" },
  head: { alignItems: "center", flexDirection: "row", gap: 10, paddingTop: 6 },
  search: { alignItems: "center", borderRadius: 14, flex: 1, flexDirection: "row", gap: 8, minHeight: 44, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 16, minHeight: 44 },
  cancel: { alignItems: "center", justifyContent: "center", minHeight: 44, paddingHorizontal: 6 },
  cancelText: { fontSize: 15, fontWeight: "600" },
  count: { fontSize: 12.5, paddingHorizontal: 4, paddingTop: 8 },
  list: { flex: 1, marginTop: 4 },
  groupTitle: { fontSize: 11, fontWeight: "600", letterSpacing: 0.9, paddingBottom: 4, paddingHorizontal: 4, paddingTop: 14 },
  row: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 52, paddingHorizontal: 4, paddingVertical: 6 },
  rowBlock: { alignItems: "center", borderRadius: 10, height: ROW_BLOCK, justifyContent: "center", width: ROW_BLOCK },
  rowName: { flex: 1, fontSize: 15, fontWeight: "600" },
  empty: { fontSize: 14, lineHeight: 20, paddingHorizontal: 4, paddingVertical: 10 },
  pressed: { opacity: 0.7 },
});
