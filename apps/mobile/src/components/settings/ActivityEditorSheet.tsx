import { useRef, useState } from "react";
import { AccessibilityInfo, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  DAYFRAME_ACTIVITY_ICONS,
  DAYFRAME_BLOCKS,
  DAYFRAME_PALETTE_PICKER,
  blockColorsFor,
  paletteColorFor,
  paletteKeyFor,
  resolveActivityIcon,
  type DayframePaletteKey
} from "@dayframe/shared";
import { SwipeDismissSheet, type SwipeDismissSheetHandle } from "../SwipeDismissSheet";
import { ActivityIcon } from "../icons/DayframeIcon";
import { SettingsSwitch } from "./SettingsBlocks";
import { QUICK_START_PIN_LIMIT, activityNameProblem } from "../../lib/activitiesPage";
import type { MobileStyles, MobileTheme } from "../../lib/mobileTheme";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "../../lib/mobileTypography";

/** isPinned is only used when creating; an existing activity's pin is the page's pin button. */
export type ActivityEditorDraft = { name: string; color: DayframePaletteKey; icon: string | null; isPinned: boolean };

type EditableActivity = { id: string; name: string; color: string; icon?: string | null; starterKey?: string | null };

/**
 * Blocks parity step 6b-1 (prototype openActivityEditor): New activity / Edit activity as a tall
 * sheet with a live preview block, the name, a six-column icon grid and the colour swatches; an
 * existing activity can be archived (its history stays). The Settings screen owns saving and
 * archiving; this sheet only edits a draft. `SwipeDismissSheet` owns presentation and dismissal.
 */
export function ActivityEditorSheet({
  activities,
  activity,
  defaultColor,
  onArchive,
  onClose,
  onSave,
  pinnedCount,
  reduceMotion,
  styles: shared,
  theme
}: {
  activities: readonly { id: string; name: string }[];
  /** null for New activity. */
  activity: EditableActivity | null;
  defaultColor: DayframePaletteKey;
  /** Archives after the sheet's own confirmation; null when done, or a message to show. */
  onArchive: (activity: EditableActivity) => Promise<string | null>;
  onClose: () => void;
  /** Resolves to null when saved, or a message to show when it could not be. */
  onSave: (draft: ActivityEditorDraft) => Promise<string | null>;
  /** How many activities are pinned now (quick start holds QUICK_START_PIN_LIMIT). */
  pinnedCount: number;
  reduceMotion: boolean;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const sheetRef = useRef<SwipeDismissSheetHandle>(null);
  const insets = useSafeAreaInsets();
  // A percentage height resolves against the sheet's auto-height wrapper, which left a gap under
  // the sheet; a measured height keeps it flush with the bottom of the screen.
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  // Six icon columns: the sheet's 16-point sides and the body's 4-point inset, 8-point gaps.
  // Measured rather than wrapped with aspectRatio, which over-measured the grid's height.
  const iconRow = windowWidth - 2 * 16 - 2 * 4;
  // Six columns even on a 320-point phone: the gaps narrow first, and a cell under 44 points gets
  // the rest of its 44-point target as hit slop.
  const iconGap = iconRow >= 6 * 44 + 5 * ICON_GAP ? ICON_GAP : 4;
  const iconCell = Math.floor((iconRow - 5 * iconGap) / 6);
  const iconSlop = Math.max(0, Math.ceil((44 - iconCell) / 2));
  const [name, setName] = useState(activity?.name ?? "");
  const [color, setColor] = useState<DayframePaletteKey>(() => activity ? paletteKeyFor(activity.color, activity.name) : defaultColor);
  // null: the icon follows the name (as for activities that never chose one).
  const [icon, setIcon] = useState<string | null>(activity?.icon ?? null);
  const quickStartFull = pinnedCount >= QUICK_START_PIN_LIMIT;
  // A new activity joins quick start by default while there is room (as before this page).
  const [pinNew, setPinNew] = useState(!quickStartFull);
  const [problem, setProblemState] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const done = useRef(false);
  // One synchronous gate for Save and a confirmed Archive: a second tap before React commits,
  // or an Archive confirmed while a save runs, does nothing.
  const busy = useRef(false);
  function setProblem(message: string | null) {
    setProblemState(message);
    // accessibilityLiveRegion is Android-only; VoiceOver hears the reason here.
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }
  const block = blockColorsFor(color, theme.mode);
  const shownIcon = resolveActivityIcon({ icon, name }).key;

  async function save() {
    if (busy.current || done.current) return;
    const nameProblem = activityNameProblem(activities, name, activity?.id ?? null);
    if (nameProblem) {
      setProblem(nameProblem);
      return;
    }
    busy.current = true;
    setSaving(true);
    setProblem(null);
    const result = await onSave({ name: name.trim(), color, icon, isPinned: !activity && pinNew && !quickStartFull })
      .catch(() => "Couldn't save. Check your connection and try again.");
    busy.current = false;
    if (done.current) return;
    setSaving(false);
    if (result) {
      setProblem(result);
      return;
    }
    done.current = true;
    sheetRef.current?.dismiss();
  }

  function archive(target: EditableActivity) {
    if (busy.current || done.current) return;
    Alert.alert(`Archive ${target.name}?`, "It leaves your lists and quick start. Its history stays.", [
      { style: "cancel", text: "Cancel" },
      {
        style: "destructive",
        text: "Archive",
        onPress: () => {
          // Re-checked: a save may have started while the confirmation was up.
          if (busy.current || done.current) return;
          busy.current = true;
          setSaving(true);
          setProblem(null);
          void onArchive(target)
            .catch(() => "Couldn't archive. Check your connection and try again.")
            .then((result) => {
              busy.current = false;
              if (done.current) return;
              setSaving(false);
              if (result) {
                setProblem(result);
                return;
              }
              // Archived: the sheet leaves with its own exit motion.
              done.current = true;
              sheetRef.current?.dismiss();
            });
        }
      }
    ]);
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
          accessibilityLabel={activity ? "Edit activity" : "New activity"}
          backdropAccessibilityLabel="Close without saving"
          backdropStyle={shared.sheetBackdrop}
          handleStyle={shared.sheetHandle}
          onDismiss={onClose}
          onDismissStart={() => {
            done.current = true;
          }}
          reduceMotion={reduceMotion}
          style={[shared.activeEditSheet, { height: Math.round(windowHeight * 0.92), paddingTop: 8 }]}
          testID="activity-editor"
          visible
        >
          <View style={styles.head}>
            <Pressable
              accessibilityRole="button"
              onPress={cancel}
              style={({ pressed }) => [styles.headButton, pressed ? styles.pressed : null]}
              testID="activity-editor-cancel"
            >
              <Text {...mobileTextProps("control")} style={[styles.cancelText, { color: theme.textSecondary }]}>Cancel</Text>
            </Pressable>
            <View style={styles.headTitle}>
              <Text {...mobileTextProps("counter")} style={[styles.eyebrow, { color: theme.textMuted }]}>
                {activity ? (activity.starterKey ? "STARTER ACTIVITY" : "YOUR ACTIVITY") : "NEW"}
              </Text>
              <Text {...mobileTextProps("screenHeading")} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
                {activity ? "Edit activity" : "New activity"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: saving, busy: saving }}
              disabled={saving}
              onPress={() => void save()}
              style={({ pressed }) => [styles.savePill, { backgroundColor: theme.accent }, pressed ? styles.pressed : null]}
              testID="activity-editor-save"
            >
              <Text {...mobileTextProps("control")} style={[styles.saveText, { color: theme.onAccent }]}>
                {saving ? "Saving…" : activity ? "Save" : "Create"}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            // Fills the sheet (as All activities does), so the sheet always reaches the bottom.
            style={styles.scroll}
          >
            {/* The live preview: the block this activity becomes on Today. Updates in place. */}
            <View
              accessibilityLabel={`Preview: ${name.trim() || "New activity"}`}
              style={[styles.preview, { backgroundColor: block.fill }]}
              testID="activity-editor-preview"
            >
              <ActivityIcon color={block.text} icon={icon} name={name} size={26} />
              <Text numberOfLines={2} style={[styles.previewName, { color: block.text }]}>{name.trim() || "New activity"}</Text>
            </View>

            <TextInput
              {...mobileTextProps("input")}
              accessibilityLabel="Activity name"
              autoCapitalize="sentences"
              autoFocus={!activity}
              maxLength={80}
              onChangeText={(value) => {
                setName(value);
                setProblem(null);
              }}
              placeholder="Name, like Gardening or Piano"
              placeholderTextColor={theme.textMuted}
              returnKeyType="done"
              style={[styles.nameInput, { backgroundColor: theme.surfaceInset, color: theme.textPrimary }]}
              testID="activity-editor-name"
              value={name}
            />
            {problem ? (
              <Text {...mobileTextProps("body")} accessibilityLiveRegion="assertive" style={[styles.problem, { color: theme.dangerText }]}>
                {problem}
              </Text>
            ) : null}

            {activity ? null : (
              <View style={styles.pinRow}>
                <View style={styles.pinText}>
                  <Text {...mobileTextProps("itemTitle")} style={{ color: theme.textPrimary, fontSize: 15, fontWeight: "600" }}>Pin to quick start</Text>
                  <Text {...mobileTextProps("metadata")} style={{ color: theme.textMuted }}>
                    {quickStartFull ? `Quick start holds ${QUICK_START_PIN_LIMIT}. Unpin one to add this.` : "Shows it in the Start tiles on Today"}
                  </Text>
                </View>
                <SettingsSwitch
                  disabled={quickStartFull || saving}
                  label="Pin to quick start"
                  onValueChange={setPinNew}
                  theme={theme}
                  value={pinNew && !quickStartFull}
                />
              </View>
            )}

            <Text {...mobileTextProps("counter")} accessibilityRole="header" style={[styles.eyebrow, { color: theme.textMuted }]}>ICON</Text>
            <View accessibilityLabel="Icon" accessibilityRole="radiogroup" style={[styles.iconGrid, { gap: iconGap }]}>
              {DAYFRAME_ACTIVITY_ICONS.map((option) => {
                const selected = shownIcon === option.key;
                return (
                  <Pressable
                    accessibilityLabel={option.label}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    hitSlop={iconSlop}
                    key={option.key}
                    onPress={() => setIcon(option.key)}
                    style={({ pressed }) => [
                      styles.iconCell,
                      { backgroundColor: selected ? block.fill : theme.surfaceInset, height: iconCell, width: iconCell },
                      pressed ? styles.pressed : null
                    ]}
                  >
                    <ActivityIcon color={selected ? block.text : theme.textPrimary} icon={option.key} size={20} />
                  </Pressable>
                );
              })}
            </View>

            <Text {...mobileTextProps("counter")} accessibilityRole="header" style={[styles.eyebrow, { color: theme.textMuted }]}>COLOUR</Text>
            <View accessibilityLabel="Colour" accessibilityRole="radiogroup" style={styles.swatches}>
              {DAYFRAME_PALETTE_PICKER.map((option) => {
                const selected = option.key === color;
                return (
                  <Pressable
                    accessibilityLabel={option.label}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    key={option.key}
                    onPress={() => setColor(option.key)}
                    style={({ pressed }) => [styles.swatchTarget, pressed ? styles.pressed : null]}
                  >
                    <View
                      style={[
                        styles.swatch,
                        { backgroundColor: paletteColorFor(option.key, "", theme.mode) },
                        selected ? { borderColor: theme.textPrimary, borderWidth: 3 } : null
                      ]}
                    />
                  </Pressable>
                );
              })}
            </View>

            {activity ? (
              <Pressable
                accessibilityHint="Removes it from your lists. Its history stays."
                accessibilityRole="button"
                disabled={saving}
                onPress={() => archive(activity)}
                style={({ pressed }) => [styles.archive, { backgroundColor: theme.surfaceMuted }, pressed ? styles.pressed : null]}
                testID="activity-editor-archive"
              >
                <Text {...mobileTextProps("control")} style={[styles.archiveText, { color: theme.dangerText }]}>Archive activity</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </SwipeDismissSheet>
      </View>
    </Modal>
  );
}

const ICON_GAP = 8;

const styles = StyleSheet.create({
  head: { alignItems: "center", flexDirection: "row", gap: 8, paddingBottom: 8, paddingTop: 6 },
  headButton: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 64, paddingHorizontal: 6 },
  headTitle: { alignItems: "center", flex: 1 },
  cancelText: { fontSize: 15, fontWeight: "600" },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.9 },
  title: { fontFamily: MOBILE_DISPLAY_FONT.bold, fontSize: 20 },
  savePill: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, justifyContent: "center", minHeight: 44, minWidth: 64, paddingHorizontal: 16 },
  saveText: { fontSize: 15, fontWeight: "700" },
  scroll: { flex: 1 },
  body: { gap: 14, paddingHorizontal: 4, paddingTop: 6 },
  preview: { borderRadius: 22, gap: 10, justifyContent: "flex-end", minHeight: 120, padding: 18 },
  previewName: { fontFamily: MOBILE_DISPLAY_FONT.bold, fontSize: 24 },
  nameInput: { borderRadius: 14, fontSize: 16, minHeight: 48, paddingHorizontal: 14 },
  problem: { fontSize: 14, marginTop: -6 },
  iconGrid: { flexDirection: "row", flexWrap: "wrap" },
  iconCell: { alignItems: "center", borderRadius: 12, justifyContent: "center" },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  swatchTarget: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  swatch: { borderColor: "transparent", borderRadius: 18, borderWidth: 0, height: 36, width: 36 },
  pinRow: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 52, paddingHorizontal: 4 },
  pinText: { flex: 1, gap: 2 },
  archive: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, justifyContent: "center", marginTop: 8, minHeight: 48 },
  archiveText: { fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.7 }
});
