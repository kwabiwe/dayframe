import { useEffect, useMemo, useState } from "react";
import {
  Dimensions,
  Keyboard,
  type KeyboardEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { paletteColorFor } from "@dayframe/shared";
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
  const insets = useSafeAreaInsets();
  const windowDimensions = useWindowDimensions();
  const [description, setDescription] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [dateText, setDateText] = useState("");
  const [timeText, setTimeText] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [pickerStartAt, setPickerStartAt] = useState<Date | null>(null);

  const entryId = entry?.id ?? null;

  useEffect(() => {
    if (!entry || !visible) return;
    const startedAt = new Date(entry.startedAt);
    setDescription(entry.description ?? "");
    setSelectedCategoryId(entry.categoryId);
    setDateText(formatDateInput(startedAt));
    setTimeText(formatTimeInput(startedAt));
    setPickerStartAt(startedAt);
    setTimePickerOpen(false);
    setValidationError(null);
  }, [entryId, visible]);

  useEffect(() => {
    if (!visible) {
      setKeyboardInset(0);
      return undefined;
    }

    function updateKeyboardInset(event: KeyboardEvent) {
      const windowHeight = Dimensions.get("window").height;
      const nextInset = Math.max(0, windowHeight - event.endCoordinates.screenY);
      setKeyboardInset(nextInset);
    }

    const changeSubscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
      updateKeyboardInset
    );
    const hideSubscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardInset(0)
    );

    return () => {
      changeSubscription.remove();
      hideSubscription.remove();
    };
  }, [visible]);

  const parsedStart = useMemo(
    () => parseLocalDateTime(dateText, timeText),
    [dateText, timeText]
  );
  const previewStartAt = timePickerOpen && pickerStartAt ? pickerStartAt : parsedStart.date;
  const elapsedPreviewSeconds = previewStartAt && previewStartAt.getTime() <= Date.now()
    ? Math.max(0, Math.floor((Date.now() - previewStartAt.getTime()) / 1000))
    : elapsedSeconds;

  if (!entry) return null;
  const editingEntry = entry;

  const busy = saving || stopping;
  const keyboardAwareSheetHeight = keyboardInset > 0
    ? Math.max(
        360,
        windowDimensions.height - keyboardInset - insets.top - 12
      )
    : null;
  const keyboardAwareSheetStyle = keyboardAwareSheetHeight
    ? {
        height: keyboardAwareSheetHeight,
        marginBottom: keyboardInset,
        maxHeight: keyboardAwareSheetHeight
      }
    : null;

  async function saveChanges() {
    if (busy) return;
    const parsed = timePickerOpen && pickerStartAt
      ? { date: pickerStartAt, error: null }
      : parseLocalDateTime(dateText, timeText);
    if (parsed.error || !parsed.date) {
      setValidationError(parsed.error ?? "Choose a valid start date and time.");
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
    setPickerStartAt(stoppedAt);
    setValidationError(null);
  }

  function openStartPicker() {
    Keyboard.dismiss();
    const currentStart = parsedStart.date ?? new Date(editingEntry.startedAt);
    setPickerStartAt(currentStart);
    setTimePickerOpen(true);
    setValidationError(null);
  }

  function applyStartPicker() {
    if (!pickerStartAt) return;
    if (pickerStartAt.getTime() > Date.now()) {
      setValidationError("Start time cannot be in the future.");
      return;
    }
    setDateText(formatDateInput(pickerStartAt));
    setTimeText(formatTimeInput(pickerStartAt));
    setTimePickerOpen(false);
    setValidationError(null);
  }

  function cancelStartPicker() {
    setPickerStartAt(parsedStart.date ?? new Date(editingEntry.startedAt));
    setTimePickerOpen(false);
    setValidationError(null);
  }

  function adjustPickerStart(delta: { days?: number; hours?: number; minutes?: number }) {
    setPickerStartAt((current) => {
      const next = new Date((current ?? parsedStart.date ?? new Date(editingEntry.startedAt)).getTime());
      if (delta.days) next.setDate(next.getDate() + delta.days);
      if (delta.hours) next.setHours(next.getHours() + delta.hours);
      if (delta.minutes) next.setMinutes(next.getMinutes() + delta.minutes);
      next.setSeconds(0, 0);
      return clampStartToNow(next);
    });
    setValidationError(null);
  }

  function setPickerToToday() {
    setPickerStartAt((current) => {
      const source = current ?? parsedStart.date ?? new Date(editingEntry.startedAt);
      const today = new Date();
      const next = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
        source.getHours(),
        source.getMinutes(),
        0,
        0
      );
      return clampStartToNow(next);
    });
    setValidationError(null);
  }

  function setPickerToNow() {
    setPickerStartAt(clampStartToNow(new Date()));
    setValidationError(null);
  }

  const displayedStartAt = previewStartAt ?? new Date(editingEntry.startedAt);
  const pickerDate = pickerStartAt ?? displayedStartAt;

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
        <View pointerEvents="box-none" style={styles.sheetKeyboardAvoidingView}>
          <SafeAreaView edges={["bottom"]} pointerEvents="box-none" style={styles.sheetSafeArea}>
            <View style={[styles.activeEditSheet, keyboardAwareSheetStyle]}>
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
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                style={[
                  styles.activeEditScroller,
                  keyboardAwareSheetHeight ? styles.activeEditScrollerKeyboard : null
                ]}
              >
                <View style={styles.activeEditHeroRow}>
                  <View style={styles.activeEditElapsedStack}>
                    <Text style={styles.activeEditElapsed}>{formatClockDuration(elapsedPreviewSeconds)}</Text>
                    <Text style={styles.activeEditElapsedLabel}>Running</Text>
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
                  </Pressable>
                </View>

                <View style={styles.activeEditSection}>
                  <Text style={styles.activeEditSectionLabel}>Description</Text>
                  <TextInput
                    accessibilityLabel="Timer description"
                    style={[styles.textInput, styles.activeEditDescriptionInput]}
                    value={description}
                    onChangeText={setDescription}
                    onSubmitEditing={Keyboard.dismiss}
                    placeholder="What are you working on?"
                    placeholderTextColor={theme.textSecondary}
                    returnKeyType="done"
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
                  <Pressable
                    accessibilityLabel="Edit start date and time"
                    accessibilityRole="button"
                    onPress={openStartPicker}
                    style={pressable(styles.activeEditStartSummary, styles.buttonPressed)}
                  >
                    <View style={styles.activeEditStartSummaryText}>
                      <Text style={styles.activeEditStartDate}>{formatPickerDate(displayedStartAt)}</Text>
                      <Text style={styles.activeEditStartMeta}>{formatDateInput(displayedStartAt)}</Text>
                    </View>
                    <Text style={styles.activeEditStartTime}>{formatTimeInput(displayedStartAt)}</Text>
                  </Pressable>
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
                  {timePickerOpen ? (
                    <View style={styles.activeEditPickerPanel}>
                      <View style={styles.activeEditPickerHeader}>
                        <View style={styles.activeEditPickerHeaderText}>
                          <Text style={styles.activeEditPickerTitle}>Choose start</Text>
                          <Text style={styles.activeEditPickerMeta}>
                            {formatPickerDate(pickerDate)} at {formatTimeInput(pickerDate)}
                          </Text>
                        </View>
                        <View style={styles.activeEditPickerActions}>
                          <Pressable
                            accessibilityLabel="Cancel start time picker"
                            accessibilityRole="button"
                            onPress={cancelStartPicker}
                            style={pressable(styles.activeEditPickerSecondaryButton, styles.buttonPressed)}
                          >
                            <Text style={styles.activeEditPickerSecondaryText}>Cancel</Text>
                          </Pressable>
                          <Pressable
                            accessibilityLabel="Apply start time"
                            accessibilityRole="button"
                            onPress={applyStartPicker}
                            style={pressable(styles.activeEditPickerPrimaryButton, styles.buttonPressed)}
                          >
                            <Text style={styles.activeEditPickerPrimaryText}>Apply</Text>
                          </Pressable>
                        </View>
                      </View>

                      <View style={styles.activeEditPickerShortcutRow}>
                        <Pressable
                          accessibilityLabel="Set start date to today"
                          accessibilityRole="button"
                          onPress={setPickerToToday}
                          style={pressable(styles.activeEditPickerChip, styles.buttonPressed)}
                        >
                          <Text style={styles.activeEditPickerChipText}>Today</Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel="Set start time to now"
                          accessibilityRole="button"
                          onPress={setPickerToNow}
                          style={pressable(styles.activeEditPickerChip, styles.buttonPressed)}
                        >
                          <Text style={styles.activeEditPickerChipText}>Now</Text>
                        </Pressable>
                      </View>

                      <View style={styles.activeEditPickerGrid}>
                        <PickerStepper
                          decrementLabel="Previous day"
                          disableIncrement={isPickerIncrementFuture(pickerDate, { days: 1 })}
                          incrementLabel="Next day"
                          label="Date"
                          onDecrement={() => adjustPickerStart({ days: -1 })}
                          onIncrement={() => adjustPickerStart({ days: 1 })}
                          value={formatShortPickerDate(pickerDate)}
                          styles={styles}
                          theme={theme}
                        />
                        <PickerStepper
                          decrementLabel="Previous hour"
                          disableIncrement={isPickerIncrementFuture(pickerDate, { hours: 1 })}
                          incrementLabel="Next hour"
                          label="Hour"
                          onDecrement={() => adjustPickerStart({ hours: -1 })}
                          onIncrement={() => adjustPickerStart({ hours: 1 })}
                          value={pad2(pickerDate.getHours())}
                          styles={styles}
                          theme={theme}
                        />
                        <PickerStepper
                          decrementLabel="Previous minute"
                          disableIncrement={isPickerIncrementFuture(pickerDate, { minutes: 1 })}
                          incrementLabel="Next minute"
                          label="Minute"
                          onDecrement={() => adjustPickerStart({ minutes: -1 })}
                          onIncrement={() => adjustPickerStart({ minutes: 1 })}
                          value={pad2(pickerDate.getMinutes())}
                          styles={styles}
                          theme={theme}
                        />
                      </View>
                    </View>
                  ) : null}
                </View>

              </ScrollView>
            </View>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

function PickerStepper({
  decrementLabel,
  disableIncrement,
  incrementLabel,
  label,
  onDecrement,
  onIncrement,
  styles,
  theme,
  value
}: {
  decrementLabel: string;
  disableIncrement?: boolean;
  incrementLabel: string;
  label: string;
  onDecrement: () => void;
  onIncrement: () => void;
  styles: MobileStyles;
  theme: MobileTheme;
  value: string;
}) {
  return (
    <View style={styles.activeEditPickerStepper}>
      <Text style={styles.activeEditPickerStepperLabel}>{label}</Text>
      <View style={styles.activeEditPickerStepperControls}>
        <Pressable
          accessibilityLabel={decrementLabel}
          accessibilityRole="button"
          onPress={onDecrement}
          style={pressable(styles.activeEditPickerStepperButton, styles.buttonPressed)}
        >
          <Text style={styles.activeEditPickerStepperButtonText}>-</Text>
        </Pressable>
        <Text style={styles.activeEditPickerStepperValue} numberOfLines={1}>{value}</Text>
        <Pressable
          accessibilityLabel={incrementLabel}
          accessibilityRole="button"
          disabled={disableIncrement}
          onPress={onIncrement}
          style={({ pressed }) => [
            styles.activeEditPickerStepperButton,
            pressed && !disableIncrement ? styles.buttonPressed : null,
            disableIncrement ? styles.buttonDisabled : null
          ]}
        >
          <Text style={[
            styles.activeEditPickerStepperButtonText,
            disableIncrement ? { color: theme.textSecondary } : null
          ]}>
            +
          </Text>
        </Pressable>
      </View>
    </View>
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

function clampStartToNow(date: Date) {
  const now = new Date();
  const safeNow = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);
  const candidate = new Date(date.getTime());
  candidate.setSeconds(0, 0);
  return candidate.getTime() > Date.now() ? safeNow : candidate;
}

function isPickerIncrementFuture(date: Date, delta: { days?: number; hours?: number; minutes?: number }) {
  const next = new Date(date.getTime());
  if (delta.days) next.setDate(next.getDate() + delta.days);
  if (delta.hours) next.setHours(next.getHours() + delta.hours);
  if (delta.minutes) next.setMinutes(next.getMinutes() + delta.minutes);
  next.setSeconds(0, 0);
  return next.getTime() > Date.now();
}

function formatPickerDate(date: Date) {
  if (isToday(date)) return "Today";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function formatShortPickerDate(date: Date) {
  if (isToday(date)) return "Today";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function isToday(date: Date) {
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
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
