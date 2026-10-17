import { useRef, useState } from "react";
import { AccessibilityInfo, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import MapView, { Circle } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DAYFRAME_BLOCKS, SAVE_PLACE_RADIUS_METERS } from "@dayframe/shared";
import { BlocksSheetHead } from "../blocks/BlocksSheetHead";
import { SwipeDismissSheet, type SwipeDismissSheetHandle } from "../SwipeDismissSheet";
import { SettingsSwitch } from "../settings/SettingsBlocks";
import type { MobileStyles, MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";

export type SavePlaceSize = keyof typeof SAVE_PLACE_RADIUS_METERS;
export type SavePlaceRequest = { name: string; radiusMeters: number; suggestVisits: boolean; autoLog: boolean };

const SIZE_LABELS: Record<SavePlaceSize, string> = { small: "Small", medium: "Medium", large: "Large" };

/**
 * "Save this place" (PRD D19, design §7) from Location evidence: saves where the visit was as a
 * place without logging it. Name (the chosen venue's, editable), the circle on a map, Size, the
 * visit's activity it logs as, Suggest visits here (on) and Log automatically (off). The evidence
 * screen owns saving (one durable Review outbox commit); this sheet builds the request.
 * `SwipeDismissSheet` owns presentation: on Save the sheet leaves first, and the screen changes the
 * row and raises its toast once it has gone (`onSaved` runs from `onDismiss`).
 */
export function SavePlaceSheet({
  centre,
  initialName,
  logsAs,
  onClose,
  onSave,
  onSaved,
  reduceMotion,
  styles: shared,
  theme
}: {
  centre: { latitude: number; longitude: number } | null;
  initialName: string;
  /** The visit's activity name, which the place logs as; null for none. */
  logsAs: string | null;
  onClose: () => void;
  /** Resolves to null when saved on this iPhone, or a message to show when it could not be. */
  onSave: (request: SavePlaceRequest) => Promise<string | null>;
  /** After the sheet has gone, for a save that went through. */
  onSaved: (request: SavePlaceRequest) => void;
  reduceMotion: boolean;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const sheetRef = useRef<SwipeDismissSheetHandle>(null);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [name, setName] = useState(initialName);
  const [size, setSize] = useState<SavePlaceSize>("medium");
  const [suggestVisits, setSuggestVisits] = useState(true);
  const [autoLog, setAutoLog] = useState(false);
  const [problem, setProblemState] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const done = useRef(false);
  const saved = useRef<SavePlaceRequest | null>(null);
  const radiusMeters = SAVE_PLACE_RADIUS_METERS[size];

  function setProblem(message: string | null) {
    setProblemState(message);
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }

  async function save() {
    // One-shot: a second tap, or a tap after the sheet started leaving, does nothing.
    if (busy.current || done.current) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setProblem("Give this place a name.");
      return;
    }
    busy.current = true;
    setSaving(true);
    setProblem(null);
    const request = { name: trimmed, radiusMeters, suggestVisits, autoLog: suggestVisits && autoLog };
    const result = await onSave(request).catch(() => "Couldn't save this place on this iPhone. Try again.");
    busy.current = false;
    if (done.current) return;
    setSaving(false);
    if (result) {
      // The draft stays as it is, with the reason.
      setProblem(result);
      return;
    }
    done.current = true;
    saved.current = request;
    sheetRef.current?.dismiss();
  }

  function cancel() {
    if (busy.current) return;
    done.current = true;
    sheetRef.current?.dismiss();
  }

  return (
    <Modal animationType="none" onRequestClose={cancel} presentationStyle="overFullScreen" transparent visible>
      <View accessibilityViewIsModal style={shared.sheetOverlay}>
        <SwipeDismissSheet
          ref={sheetRef}
          accessibilityLabel="Save this place"
          backdropAccessibilityLabel="Close without saving"
          backdropStyle={shared.sheetBackdrop}
          handleStyle={shared.sheetHandle}
          disabled={saving}
          onDismiss={() => {
            const request = saved.current;
            onClose();
            if (request) onSaved(request);
          }}
          onDismissStart={() => {
            if (busy.current) return false;
            done.current = true;
          }}
          reduceMotion={reduceMotion}
          style={[shared.activeEditSheet, { height: Math.round(windowHeight * 0.86), paddingTop: 8 }]}
          testID="save-place-sheet"
          visible
        >
          <View style={sheetStyles.head}>
            <BlocksSheetHead
              action={{ busy: saving, label: saving ? "Saving…" : "Save", onPress: () => void save(), testID: "save-place-save", tone: "primary" }}
              eyebrow="SAVE THIS PLACE"
              theme={theme}
              title="Save place"
            />
          </View>
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={[sheetStyles.body, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            style={sheetStyles.scroll}
          >
            <Text {...mobileTextProps("body")} style={[sheetStyles.lead, { color: theme.textSecondary }]}>
              Dayframe will recognise visits here. This visit stays in Review until you log it.
            </Text>
            <View style={sheetStyles.group}>
              <Text {...mobileTextProps("counter")} style={[sheetStyles.eyebrow, { color: theme.textMuted }]}>NAME</Text>
              <TextInput
                {...mobileTextProps("input")}
                accessibilityLabel="Place name"
                maxLength={120}
                onChangeText={(value) => {
                  setName(value);
                  if (problem) setProblem(null);
                }}
                placeholder="Place name"
                placeholderTextColor={theme.textMuted}
                returnKeyType="done"
                style={[sheetStyles.input, { backgroundColor: theme.surfaceInset, color: theme.textPrimary }]}
                testID="save-place-name"
                value={name}
              />
            </View>
            {centre ? (
              <View style={[sheetStyles.mapCard, { backgroundColor: theme.surfaceInset }]}>
                {/* Where you were, with the circle the size draws. Display only: the centre is the visit's. */}
                <MapView
                  accessibilityLabel={`Map of where you were with a ${radiusMeters} metre circle.`}
                  pitchEnabled={false}
                  pointerEvents="none"
                  region={{ ...centre, latitudeDelta: radiusMeters / 25_000, longitudeDelta: radiusMeters / 25_000 }}
                  rotateEnabled={false}
                  scrollEnabled={false}
                  style={sheetStyles.map}
                  testID="save-place-map"
                  zoomEnabled={false}
                >
                  <Circle center={centre} fillColor={`${theme.textPrimary}22`} radius={radiusMeters} strokeColor={theme.textPrimary} strokeWidth={2} />
                </MapView>
              </View>
            ) : null}
            <View style={sheetStyles.group}>
              <Text {...mobileTextProps("counter")} style={[sheetStyles.eyebrow, { color: theme.textMuted }]}>SIZE</Text>
              <View accessibilityLabel="Place size" accessibilityRole="radiogroup" style={[sheetStyles.segments, { backgroundColor: theme.surfaceInset }]}>
                {(Object.keys(SIZE_LABELS) as SavePlaceSize[]).map((option) => {
                  const selected = option === size;
                  return (
                    <Pressable
                      accessibilityLabel={`${SIZE_LABELS[option]}, ${SAVE_PLACE_RADIUS_METERS[option]} metres`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: saving }}
                      disabled={saving}
                      key={option}
                      onPress={() => setSize(option)}
                      style={[sheetStyles.segment, selected ? { backgroundColor: theme.surfaceRaised } : null]}
                      testID={`save-place-size-${option}`}
                    >
                      <Text {...mobileTextProps("control")} style={[sheetStyles.segmentText, { color: selected ? theme.textPrimary : theme.textSecondary }]}>
                        {SIZE_LABELS[option]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={[sheetStyles.rows, { backgroundColor: theme.surfaceInset }]}>
              <View style={sheetStyles.row}>
                <View style={sheetStyles.rowText}>
                  <Text {...mobileTextProps("control")} style={[sheetStyles.rowTitle, { color: theme.textPrimary }]}>Logs as</Text>
                  <Text {...mobileTextProps("metadata")} style={{ color: theme.textMuted }}>{logsAs ?? "No activity"} · this visit&apos;s activity</Text>
                </View>
              </View>
              <View style={[sheetStyles.row, sheetStyles.divided, { borderTopColor: theme.border }]}>
                <View style={sheetStyles.rowText}>
                  <Text {...mobileTextProps("control")} style={[sheetStyles.rowTitle, { color: theme.textPrimary }]}>Suggest visits here</Text>
                  <Text {...mobileTextProps("metadata")} style={{ color: theme.textMuted }}>
                    {suggestVisits ? "Show detected visits in Review." : "Do not suggest visits for this place."}
                  </Text>
                </View>
                <SettingsSwitch
                  disabled={saving}
                  label="Suggest visits here"
                  onValueChange={(value) => {
                    setSuggestVisits(value);
                    if (!value) setAutoLog(false);
                  }}
                  theme={theme}
                  value={suggestVisits}
                />
              </View>
              <View style={[sheetStyles.row, sheetStyles.divided, { borderTopColor: theme.border }]}>
                <View style={sheetStyles.rowText}>
                  <Text {...mobileTextProps("control")} style={[sheetStyles.rowTitle, { color: theme.textPrimary }]}>Log automatically</Text>
                  <Text {...mobileTextProps("metadata")} style={{ color: theme.textMuted }}>
                    {suggestVisits
                      ? "Visits here become blocks without a Review card."
                      : "Visits here become blocks without a Review card. Turn on Suggest visits here first."}
                  </Text>
                </View>
                <SettingsSwitch
                  disabled={saving || !suggestVisits}
                  label="Log automatically"
                  onValueChange={setAutoLog}
                  theme={theme}
                  value={suggestVisits && autoLog}
                />
              </View>
            </View>
            {problem ? (
              <Text {...mobileTextProps("body")} accessibilityLiveRegion="assertive" style={[sheetStyles.problem, { color: theme.dangerText }]} testID="save-place-problem">
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
  head: { paddingBottom: 8, paddingHorizontal: 4 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.9 },
  scroll: { flex: 1 },
  body: { gap: 16, paddingHorizontal: 4, paddingTop: 6 },
  lead: { fontSize: 15 },
  group: { gap: 6 },
  input: { borderRadius: 14, fontSize: 16, minHeight: 48, paddingHorizontal: 14 },
  mapCard: { borderRadius: 16, overflow: "hidden" },
  map: { height: 160, width: "100%" },
  segments: { borderRadius: DAYFRAME_BLOCKS.radius.pill, flexDirection: "row", gap: 2, padding: 4 },
  segment: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, flex: 1, justifyContent: "center", minHeight: 44 },
  segmentText: { fontSize: 14, fontWeight: "600" },
  rows: { borderRadius: 16, overflow: "hidden" },
  row: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: "600" },
  problem: { fontSize: 14 }
});
