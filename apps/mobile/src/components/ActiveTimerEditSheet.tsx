import { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { paletteColorFor } from "@dayframe/shared";
import { useKeyboardAccessory, type KeyboardAccessoryField } from "@/components/KeyboardAccessory";
import { pressable, type MobileStyles, type MobileTheme } from "@/lib/mobileTheme";
import type { MobileBootstrap, TimeEntryUpdatePatch } from "@/lib/api";

type ActiveEntry = NonNullable<MobileBootstrap["activeEntry"]>;
type Category = MobileBootstrap["categories"][number];

type ActiveTimerEditSheetProps = {
  categories: Category[];
  elapsedSeconds: number;
  entry: ActiveEntry | null;
  lastStoppedAt: string | null;
  onCancel: () => void;
  onSave: (entryId: string, patch: TimeEntryUpdatePatch) => Promise<boolean>;
  onStop: () => Promise<boolean>;
  saving: boolean;
  stopping: boolean;
  styles: MobileStyles;
  theme: MobileTheme;
  visible: boolean;
};

const EDIT_KEYBOARD_ACCESSORY_ID = "dayframe-active-timer-edit-keyboard-accessory";

export function ActiveTimerEditSheet({
  categories,
  elapsedSeconds,
  entry,
  lastStoppedAt,
  onCancel,
  onSave,
  onStop,
  saving,
  stopping,
  styles,
  theme,
  visible
}: ActiveTimerEditSheetProps) {
  const [description, setDescription] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [dateText, setDateText] = useState("");
  const [timeText, setTimeText] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const descriptionRef = useRef<TextInput>(null);
  const dateRef = useRef<TextInput>(null);
  const timeRef = useRef<TextInput>(null);
  const keyboardFields = useMemo<KeyboardAccessoryField[]>(() => [
    { id: "edit-description", ref: descriptionRef },
    { id: "edit-date", ref: dateRef },
    { id: "edit-time", ref: timeRef }
  ], []);
  const keyboard = useKeyboardAccessory({
    nativeID: EDIT_KEYBOARD_ACCESSORY_ID,
    fields: keyboardFields,
    theme
  });

  const entryId = entry?.id ?? null;

  useEffect(() => {
    if (!entry || !visible) return;
    const startedAt = new Date(entry.startedAt);
    setDescription(entry.description ?? "");
    setSelectedCategoryId(entry.categoryId);
    setDateText(formatDateInput(startedAt));
    setTimeText(formatTimeInput(startedAt));
    setValidationError(null);
  }, [entryId, visible]);

  const parsedStart = useMemo(
    () => parseLocalDateTime(dateText, timeText),
    [dateText, timeText]
  );
  const elapsedPreviewSeconds = parsedStart.date && parsedStart.date.getTime() <= Date.now()
    ? Math.max(0, Math.floor((Date.now() - parsedStart.date.getTime()) / 1000))
    : elapsedSeconds;

  if (!entry) return null;
  const editingEntry = entry;

  const busy = saving || stopping;

  async function saveChanges() {
    if (busy) return;
    const parsed = parseLocalDateTime(dateText, timeText);
    if (parsed.error || !parsed.date) {
      setValidationError(parsed.error ?? "Enter a valid start date and time.");
      return;
    }
    if (parsed.date.getTime() > Date.now()) {
      setValidationError("Start time cannot be in the future.");
      return;
    }

    setValidationError(null);
    const ok = await onSave(editingEntry.id, {
      categoryId: selectedCategoryId,
      description: description.trim() || null,
      startedAt: parsed.date.toISOString()
    });
    if (ok) onCancel();
  }

  async function stopFromSheet() {
    if (busy) return;
    const ok = await onStop();
    if (ok) onCancel();
  }

  function useLastStopTime() {
    if (!lastStoppedAt) return;
    const stoppedAt = new Date(lastStoppedAt);
    setDateText(formatDateInput(stoppedAt));
    setTimeText(formatTimeInput(stoppedAt));
    setValidationError(null);
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onCancel}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.sheetOverlay}>
        <Pressable
          accessibilityLabel="Cancel editing timer"
          accessibilityRole="button"
          onPress={onCancel}
          style={styles.sheetBackdrop}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
          style={styles.sheetKeyboardAvoidingView}
        >
          <SafeAreaView edges={["bottom"]} style={styles.sheetSafeArea}>
            <View style={styles.activeEditSheet}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <Pressable
                  accessibilityLabel="Cancel editing timer"
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={onCancel}
                  style={({ pressed }) => [
                    styles.sheetIconButton,
                    pressed && !busy ? styles.buttonPressed : null,
                    busy ? styles.buttonDisabled : null
                  ]}
                >
                  <CloseGlyph color={theme.textPrimary} />
                </Pressable>
                <Text style={styles.sheetTitle}>Edit timer</Text>
                <Pressable
                  accessibilityLabel="Save timer edits"
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={saveChanges}
                  style={({ pressed }) => [
                    styles.sheetSaveButton,
                    pressed && !busy ? styles.buttonPressed : null,
                    busy ? styles.buttonDisabled : null
                  ]}
                >
                  <CheckGlyph color={theme.mode === "dark" ? theme.background : "#FFFFFF"} />
                </Pressable>
              </View>

              <ScrollView
                contentContainerStyle={styles.activeEditContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.activeEditElapsed}>{formatClockDuration(elapsedPreviewSeconds)}</Text>

                <View style={styles.activeEditSection}>
                  <Text style={styles.activeEditSectionLabel}>Description</Text>
                  <TextInput
                    accessibilityLabel="Timer description"
                    ref={descriptionRef}
                    style={[styles.textInput, styles.activeEditDescriptionInput]}
                    value={description}
                    onChangeText={setDescription}
                    onSubmitEditing={keyboard.focusNext}
                    placeholder="What are you working on?"
                    placeholderTextColor={theme.textSecondary}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    {...keyboard.getTextInputProps("edit-description")}
                  />
                </View>

                <View style={styles.activeEditSection}>
                  <Text style={styles.activeEditSectionLabel}>Category</Text>
                  <ScrollView
                    horizontal
                    keyboardShouldPersistTaps="handled"
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.activeEditCategoryScroller}
                  >
                    <CategoryChip
                      category={null}
                      selected={selectedCategoryId === null}
                      styles={styles}
                      theme={theme}
                      onPress={() => setSelectedCategoryId(null)}
                    />
                    {categories.map((category) => (
                      <CategoryChip
                        key={category.id}
                        category={category}
                        selected={selectedCategoryId === category.id}
                        styles={styles}
                        theme={theme}
                        onPress={() => setSelectedCategoryId(category.id)}
                      />
                    ))}
                  </ScrollView>
                </View>

                <View style={styles.activeEditSection}>
                  <Text style={styles.activeEditSectionLabel}>Start time</Text>
                  <View style={styles.activeEditTimeRow}>
                    <TextInput
                      accessibilityLabel="Start date"
                      ref={dateRef}
                      style={[styles.textInput, styles.activeEditDateInput]}
                      value={dateText}
                      onChangeText={(value) => {
                        setDateText(value);
                        setValidationError(null);
                      }}
                      onSubmitEditing={keyboard.focusNext}
                      keyboardType="numbers-and-punctuation"
                      maxLength={10}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={theme.textSecondary}
                      returnKeyType="next"
                      blurOnSubmit={false}
                      selectTextOnFocus
                      {...keyboard.getTextInputProps("edit-date")}
                    />
                    <TextInput
                      accessibilityLabel="Start time"
                      ref={timeRef}
                      style={[styles.textInput, styles.activeEditTimeInput]}
                      value={timeText}
                      onChangeText={(value) => {
                        setTimeText(value);
                        setValidationError(null);
                      }}
                      onSubmitEditing={saveChanges}
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      placeholder="HH:mm"
                      placeholderTextColor={theme.textSecondary}
                      returnKeyType="done"
                      selectTextOnFocus
                      {...keyboard.getTextInputProps("edit-time")}
                    />
                  </View>
                  {lastStoppedAt ? (
                    <Pressable
                      accessibilityLabel="Set start time to last stop time"
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={useLastStopTime}
                      style={pressable(styles.activeEditLastStopButton, styles.buttonPressed)}
                    >
                      <Text style={styles.activeEditLastStopText}>Set to last stop time</Text>
                      <Text style={styles.activeEditLastStopMeta}>{formatTimeInput(new Date(lastStoppedAt))}</Text>
                    </Pressable>
                  ) : null}
                  {validationError ? <Text style={styles.errorText}>{validationError}</Text> : null}
                </View>

                <Pressable
                  accessibilityLabel="Stop timer from edit sheet"
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={stopFromSheet}
                  style={({ pressed }) => [
                    styles.activeEditStopButton,
                    pressed && !busy ? styles.buttonPressed : null,
                    busy ? styles.buttonDisabled : null
                  ]}
                >
                  <StopGlyph color={theme.mode === "dark" ? theme.background : "#FFFFFF"} />
                  <Text style={styles.activeEditStopButtonText}>{stopping ? "Stopping..." : "Stop timer"}</Text>
                </Pressable>
              </ScrollView>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
      {keyboard.accessory}
    </Modal>
  );
}

function CategoryChip({
  category,
  onPress,
  selected,
  styles,
  theme
}: {
  category: Category | null;
  onPress: () => void;
  selected: boolean;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const label = category?.name ?? "No category";
  const color = category ? paletteColorFor(category.color, category.name) : theme.textSecondary;

  return (
    <Pressable
      accessibilityLabel={category ? `Set category to ${category.name}` : "Clear category"}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={pressable(
        [
          styles.activeEditCategoryChip,
          selected ? styles.activeEditCategoryChipSelected : null,
          category ? { borderColor: color } : null
        ],
        styles.buttonPressed
      )}
    >
      <View style={[styles.colorDot, { backgroundColor: category ? color : "transparent" }]} />
      <Text style={[
        styles.activeEditCategoryChipText,
        selected ? styles.activeEditCategoryChipTextSelected : null
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function parseLocalDateTime(dateText: string, timeText: string): { date: Date | null; error: string | null } {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText.trim());
  if (!dateMatch) return { date: null, error: "Enter the date as YYYY-MM-DD." };
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeText.trim());
  if (!timeMatch) return { date: null, error: "Enter the time as HH:mm." };

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return { date: null, error: "Enter a valid start date and time." };
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return { date: null, error: "Enter a valid start date and time." };
  }

  return { date, error: null };
}

function formatDateInput(date: Date) {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join("-");
}

function formatTimeInput(date: Date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function formatClockDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;

  if (hours === 0) {
    return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
    .toString()
    .padStart(2, "0")}`;
}

function CloseGlyph({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path d="M6 6l12 12M18 6 6 18" stroke={color} strokeLinecap="round" strokeWidth={2.4} />
    </Svg>
  );
}

function CheckGlyph({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path d="m5 12 4 4L19 6" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} />
    </Svg>
  );
}

function StopGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path d="M7 7h10v10H7V7Z" fill={color} />
    </Svg>
  );
}
