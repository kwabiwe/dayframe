import { useRef, useState } from "react";
import { AccessibilityInfo, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  DAYFRAME_APP_ICONS,
  DAYFRAME_BLOCKS,
  initialPreviousPlaceName,
  leavingRoleHolder,
  placeDisplayName,
  placeRoleLabel,
  placeRoleRequest,
  placeSecondaryName,
  type PlaceRole,
  type PlaceRoleSlot
} from "@dayframe/shared";
import { SwipeDismissSheet, type SwipeDismissSheetHandle } from "../SwipeDismissSheet";
import { DayframeIcon } from "../icons/DayframeIcon";
import type { MobileStyles, MobileTheme } from "../../lib/mobileTheme";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "../../lib/mobileTypography";

type RolePlace = { id: string; name: string; role: PlaceRole | null; radiusMeters: number };

export type PlaceRoleSheetMode = "choose" | "clear";

/**
 * Blocks parity step 7a: Set / Change / Clear Home or Work on iPhone, the same rules as the web
 * Places slots (`PlaceRoleSlots`): the role moves to a saved place (entries stay where they were
 * recorded), the place it leaves can be renamed so its history doesn't read as an address, and a
 * new place can be added straight into the slot. The Places screen owns saving; this sheet only
 * builds the request. `SwipeDismissSheet` owns presentation and dismissal.
 */
export function PlaceRoleSheet({
  mode,
  onAddNew,
  onClose,
  onSave,
  places,
  reduceMotion,
  slot,
  styles: shared,
  theme
}: {
  mode: PlaceRoleSheetMode;
  /** Leaves the sheet for the place editor, adding a new place straight into this slot. */
  onAddNew: (role: PlaceRole) => void;
  onClose: () => void;
  /** Resolves to null when saved, or a message to show when it could not be. */
  onSave: (request: ReturnType<typeof placeRoleRequest>) => Promise<string | null>;
  places: readonly RolePlace[];
  reduceMotion: boolean;
  slot: PlaceRoleSlot<RolePlace>;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const sheetRef = useRef<SwipeDismissSheetHandle>(null);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const clearing = mode === "clear";
  const [targetId, setTargetId] = useState<string | null>(clearing ? null : slot.place?.id ?? null);
  const holder = clearing ? slot.place : leavingRoleHolder(slot, targetId);
  const target = targetId ? places.find((place) => place.id === targetId) ?? null : null;
  const [previousName, setPreviousName] = useState(() => initialPreviousPlaceName(slot.role, holder, clearing ? null : target));
  // Once the person types a name, choosing another place no longer replaces it.
  const renameTouched = useRef(false);
  const [problem, setProblemState] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const done = useRef(false);
  const pendingAddNew = useRef(false);
  const label = slot.label;
  const otherRole = target?.role && target.role !== slot.role ? target.role : null;
  const roleLeavesHolder = Boolean(holder && (clearing || (targetId && targetId !== holder.id)));

  function setProblem(message: string | null) {
    setProblemState(message);
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }

  function choose(place: RolePlace) {
    setTargetId(place.id);
    setProblem(null);
    if (!renameTouched.current) {
      setPreviousName(initialPreviousPlaceName(slot.role, leavingRoleHolder(slot, place.id), place));
    }
  }

  async function save() {
    if (busy.current || done.current) return;
    if (!clearing && !targetId) {
      setProblem("Choose a saved place.");
      return;
    }
    busy.current = true;
    setSaving(true);
    setProblem(null);
    const request = placeRoleRequest({ role: slot.role, targetId: clearing ? null : targetId, holder, previousPlaceName: previousName });
    const result = await onSave(request).catch(() => "Couldn't save. Check your connection and try again.");
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

  function cancel() {
    done.current = true;
    sheetRef.current?.dismiss();
  }

  function addNew() {
    if (busy.current || done.current) return;
    done.current = true;
    // The editor opens once the sheet has gone (onDismiss), so the two never overlap.
    pendingAddNew.current = true;
    sheetRef.current?.dismiss();
  }

  const title = clearing ? `Clear ${label}?` : slot.place ? `Change ${label}` : `Set ${label}`;
  return (
    <Modal animationType="none" onRequestClose={cancel} presentationStyle="overFullScreen" transparent visible>
      <View accessibilityViewIsModal style={shared.sheetOverlay}>
        <SwipeDismissSheet
          ref={sheetRef}
          accessibilityLabel={title}
          backdropAccessibilityLabel="Close without saving"
          backdropStyle={shared.sheetBackdrop}
          handleStyle={shared.sheetHandle}
          onDismiss={() => {
            if (pendingAddNew.current) onAddNew(slot.role);
            onClose();
          }}
          onDismissStart={() => {
            done.current = true;
          }}
          reduceMotion={reduceMotion}
          style={[shared.activeEditSheet, { height: Math.round(windowHeight * (clearing ? 0.5 : 0.8)), paddingTop: 8 }]}
          testID="place-role-sheet"
          visible
        >
          <View style={sheetStyles.head}>
            <Pressable
              accessibilityRole="button"
              onPress={cancel}
              style={({ pressed }) => [sheetStyles.headButton, pressed ? sheetStyles.pressed : null]}
              testID="place-role-cancel"
            >
              <Text {...mobileTextProps("control")} style={[sheetStyles.cancelText, { color: theme.textSecondary }]}>Cancel</Text>
            </Pressable>
            <View style={sheetStyles.headTitle}>
              <Text {...mobileTextProps("counter")} style={[sheetStyles.eyebrow, { color: theme.textMuted }]}>HOME AND WORK</Text>
              <Text {...mobileTextProps("screenHeading")} accessibilityRole="header" numberOfLines={1} style={[sheetStyles.title, { color: theme.textPrimary }]}>
                {title}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: saving, disabled: saving }}
              disabled={saving}
              onPress={() => void save()}
              style={({ pressed }) => [
                sheetStyles.savePill,
                { backgroundColor: clearing ? theme.surfaceMuted : theme.accent },
                pressed ? sheetStyles.pressed : null
              ]}
              testID="place-role-save"
            >
              <Text {...mobileTextProps("control")} style={[sheetStyles.saveText, { color: clearing ? theme.dangerText : theme.onAccent }]}>
                {saving ? "Saving…" : clearing ? "Clear" : "Save"}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={[sheetStyles.body, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            style={sheetStyles.scroll}
          >
            <Text {...mobileTextProps("body")} style={[sheetStyles.lead, { color: theme.textSecondary }]}>
              {clearing
                ? `The place stays saved and keeps its entries; it just stops being ${label}.`
                : `Choose the saved place that is your ${label.toLowerCase()}. Past entries stay where they were recorded.`}
            </Text>

            {clearing ? null : (
              <View accessibilityLabel={`${label} place`} accessibilityRole="radiogroup" style={[sheetStyles.list, { backgroundColor: theme.surfaceInset }]}>
                {places.map((place, index) => {
                  const selected = place.id === targetId;
                  const secondary = placeSecondaryName(place);
                  const name = placeDisplayName(place);
                  return (
                    <Pressable
                      accessibilityLabel={secondary ? `${name}, ${secondary}` : name}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={place.id}
                      onPress={() => choose(place)}
                      style={({ pressed }) => [
                        sheetStyles.choice,
                        index > 0 ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth } : null,
                        pressed ? { backgroundColor: theme.surfaceMuted } : null
                      ]}
                      testID={`place-role-choice-${place.id}`}
                    >
                      <View style={sheetStyles.choiceText}>
                        <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[sheetStyles.choiceName, { color: theme.textPrimary }]}>{name}</Text>
                        {secondary ? (
                          <Text {...mobileTextProps("metadata")} numberOfLines={1} style={{ color: theme.textMuted }}>{secondary}</Text>
                        ) : null}
                      </View>
                      <View
                        style={[
                          sheetStyles.radio,
                          { borderColor: selected ? theme.textPrimary : theme.border },
                          selected ? { backgroundColor: theme.textPrimary } : null
                        ]}
                      >
                        {selected ? <DayframeIcon color={theme.surface} glyph={DAYFRAME_APP_ICONS.done} size={14} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {otherRole ? (
              <Text {...mobileTextProps("metadata")} style={{ color: theme.textSecondary }} testID="place-role-other-note">
                This place is your {placeRoleLabel(otherRole)}, so {placeRoleLabel(otherRole)} will be empty.
              </Text>
            ) : null}

            {clearing ? null : (
              <Pressable
                accessibilityRole="button"
                onPress={addNew}
                style={({ pressed }) => [sheetStyles.addNew, { backgroundColor: theme.surfaceMuted }, pressed ? sheetStyles.pressed : null]}
                testID="place-role-add-new"
              >
                <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.add} size={18} />
                <Text {...mobileTextProps("control")} style={[sheetStyles.addNewText, { color: theme.textPrimary }]}>Add a new place as {label}</Text>
              </Pressable>
            )}

            {holder && roleLeavesHolder ? (
              <View style={sheetStyles.renameGroup}>
                <Text {...mobileTextProps("counter")} style={[sheetStyles.eyebrow, { color: theme.textMuted }]}>
                  {clearing ? "NAME FOR THIS PLACE" : `RENAME THE OLD ${label.toUpperCase()}`}
                </Text>
                <TextInput
                  {...mobileTextProps("input")}
                  accessibilityHint="Its past entries keep this name. Leave it as it is to keep the current name."
                  accessibilityLabel={clearing ? "Name for this place" : `Rename the old ${label.toLowerCase()}`}
                  maxLength={120}
                  onChangeText={(value) => {
                    renameTouched.current = true;
                    setPreviousName(value);
                  }}
                  placeholder={holder.name}
                  placeholderTextColor={theme.textMuted}
                  returnKeyType="done"
                  style={[sheetStyles.input, { backgroundColor: theme.surfaceInset, color: theme.textPrimary }]}
                  testID="place-role-previous-name"
                  value={previousName}
                />
                <Text {...mobileTextProps("metadata")} style={{ color: theme.textMuted }}>
                  Its past entries keep this name, so they don&apos;t read as an address.
                </Text>
              </View>
            ) : null}

            {problem ? (
              <Text {...mobileTextProps("body")} accessibilityLiveRegion="assertive" style={[sheetStyles.problem, { color: theme.dangerText }]}>
                {problem}
              </Text>
            ) : null}
          </ScrollView>
        </SwipeDismissSheet>
      </View>
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
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
  lead: { fontSize: 15 },
  list: { borderRadius: 16, overflow: "hidden" },
  choice: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 8 },
  choiceText: { flex: 1, minWidth: 0 },
  choiceName: { fontSize: 15, fontWeight: "600" },
  radio: { alignItems: "center", borderRadius: 12, borderWidth: 2, height: 24, justifyContent: "center", width: 24 },
  addNew: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 48 },
  addNewText: { fontSize: 15, fontWeight: "700" },
  renameGroup: { gap: 6 },
  input: { borderRadius: 14, fontSize: 16, minHeight: 48, paddingHorizontal: 14 },
  problem: { fontSize: 14 },
  pressed: { opacity: 0.7 }
});
