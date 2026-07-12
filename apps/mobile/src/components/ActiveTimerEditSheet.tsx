import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  type KeyboardEvent,
  Modal,
  PanResponder,
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
import { editSheetKeyboardLayout, keyboardInsetFromScreenY } from "@/lib/editSheetKeyboard";
import type { MobileBootstrap, MobileTimeEntry, TimeEntryUpdatePatch } from "@/lib/api";
import { MOBILE_MOTION, useReduceMotionPreference } from "@/lib/motion";

type Category = MobileBootstrap["categories"][number];
type EditSheetMode = "running" | "entry" | "start";
type StartTimerInput = {
  categoryId: string | null;
  description: string | null;
  startedAt?: string | null;
};

type ActiveTimerEditSheetProps = {
  categories: Category[];
  elapsedSeconds: number;
  entry: MobileTimeEntry | null;
  initialCategoryId?: string | null;
  initialDescription?: string;
  lastStoppedAt: string | null;
  onCancel: () => void;
  onDelete?: (entryId: string) => Promise<boolean>;
  onSave?: (entryId: string, patch: TimeEntryUpdatePatch) => Promise<boolean>;
  onStart?: (input: StartTimerInput) => Promise<boolean>;
  onStop?: () => Promise<boolean>;
  mode?: EditSheetMode;
  deleting?: boolean;
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
  initialCategoryId = null,
  initialDescription = "",
  lastStoppedAt,
  mode = "running",
  onCancel,
  onDelete,
  onSave,
  onStart,
  onStop,
  deleting = false,
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
  const [stoppedDateText, setStoppedDateText] = useState("");
  const [stoppedTimeText, setStoppedTimeText] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [startTimeEdited, setStartTimeEdited] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [pickerStartAt, setPickerStartAt] = useState<Date | null>(null);
  const reduceMotion = useReduceMotionPreference();
  const dismissDragY = useRef(new Animated.Value(0)).current;
  const keyboardLift = useRef(new Animated.Value(0)).current;
  const descriptionInputRef = useRef<TextInput>(null);
  const timeInputRef = useRef<TextInput>(null);

  const entryId = entry?.id ?? null;
  const isStartMode = mode === "start";
  const isRunningMode = mode === "running";
  const isEntryMode = mode === "entry";

  useEffect(() => {
    if (!visible) return;
    if (isStartMode) {
      const startedAt = new Date();
      setDescription(initialDescription);
      setSelectedCategoryId(initialCategoryId);
      setDateText(formatDateInput(startedAt));
      setTimeText(formatTimeInput(startedAt));
      setStoppedDateText("");
      setStoppedTimeText("");
      setPickerStartAt(startedAt);
      setStartTimeEdited(false);
      setDatePickerOpen(false);
      setValidationError(null);
      return;
    }
    if (!entry) return;
    const startedAt = new Date(entry.startedAt);
    setDescription(entry.description ?? "");
    setSelectedCategoryId(entry.categoryId);
    setDateText(formatDateInput(startedAt));
    setTimeText(formatTimeInput(startedAt));
    if (entry.stoppedAt) {
      const stoppedAt = new Date(entry.stoppedAt);
      setStoppedDateText(formatDateInput(stoppedAt));
      setStoppedTimeText(formatTimeInput(stoppedAt));
    } else {
      setStoppedDateText("");
      setStoppedTimeText("");
    }
    setPickerStartAt(startedAt);
    setStartTimeEdited(false);
    setDatePickerOpen(false);
    setValidationError(null);
  }, [entryId, initialCategoryId, initialDescription, isStartMode, visible]);

  useEffect(() => {
    if (!visible) {
      setKeyboardInset(0);
      dismissDragY.setValue(0);
      keyboardLift.setValue(0);
      return undefined;
    }

    function animateKeyboardLift(toValue: number, event?: KeyboardEvent) {
      keyboardLift.stopAnimation();
      if (reduceMotion) {
        keyboardLift.setValue(toValue);
        return;
      }
      Animated.timing(keyboardLift, {
        toValue,
        duration: Math.max(120, Math.min(event?.duration ?? MOBILE_MOTION.sheet, 360)),
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false
      }).start();
    }

    function updateKeyboardInset(event: KeyboardEvent) {
      Keyboard.scheduleLayoutAnimation(event);
      const windowHeight = Dimensions.get("window").height;
      const screenHeight = Dimensions.get("screen").height;
      const nextInset = keyboardInsetFromScreenY({
        keyboardScreenY: event.endCoordinates.screenY,
        screenHeight,
        windowHeight
      });
      const nextLayout = editSheetKeyboardLayout({
        bottomInset: insets.bottom,
        keyboardInset: nextInset,
        topInset: insets.top,
        windowHeight: windowDimensions.height
      });
      setKeyboardInset(nextInset);
      animateKeyboardLift(nextLayout.bottomLift, event);
    }

    const changeSubscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
      updateKeyboardInset
    );
    const hideSubscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      (event) => {
        Keyboard.scheduleLayoutAnimation(event);
        setKeyboardInset(0);
        animateKeyboardLift(0, event);
      }
    );

    return () => {
      changeSubscription.remove();
      hideSubscription.remove();
    };
  }, [dismissDragY, insets.bottom, insets.top, keyboardLift, reduceMotion, visible, windowDimensions.height]);

  const parsedStart = useMemo(
    () => parseLocalDateTime(dateText, timeText),
    [dateText, timeText]
  );
  const parsedStop = useMemo(
    () => parseLocalDateTime(stoppedDateText, stoppedTimeText),
    [stoppedDateText, stoppedTimeText]
  );
  const previewStartAt = datePickerOpen && pickerStartAt
    ? parseLocalDateTime(formatDateInput(pickerStartAt), timeText).date
    : parsedStart.date;
  const elapsedPreviewSeconds = isStartMode
    ? 0
    : isEntryMode && parsedStart.date && parsedStop.date
      ? Math.max(0, Math.floor((parsedStop.date.getTime() - parsedStart.date.getTime()) / 1000))
      : previewStartAt && previewStartAt.getTime() <= Date.now()
        ? Math.max(0, Math.floor((Date.now() - previewStartAt.getTime()) / 1000))
        : elapsedSeconds;

  const busy = saving || stopping || deleting;
  const canStop = isRunningMode && Boolean(onStop);
  const canStart = isStartMode && Boolean(onStart);
  const canDelete = !isStartMode && Boolean(onDelete);
  const cancelLabel = isStartMode
    ? "Cancel starting task"
    : isRunningMode ? "Cancel editing timer" : "Cancel editing entry";
  const saveLabel = isRunningMode ? "Save timer edits" : "Save entry edits";
  const sheetTitle = isStartMode ? "Start task" : isRunningMode ? "Edit timer" : "Edit entry";
  const elapsedLabel = isEntryMode ? "Duration" : null;
  const elapsedText = isStartMode ? "--:--" : formatClockDuration(elapsedPreviewSeconds);
  const keyboardLayout = editSheetKeyboardLayout({
    bottomInset: insets.bottom,
    keyboardInset,
    topInset: insets.top,
    windowHeight: windowDimensions.height
  });
  const keyboardAwareSheetStyle = keyboardLayout.keyboardOpen
    ? {
        height: keyboardLayout.sheetHeight ?? undefined,
        maxHeight: keyboardLayout.sheetHeight ?? keyboardLayout.sheetMaxHeight
      }
    : { maxHeight: keyboardLayout.sheetMaxHeight };
  const sheetTranslateY = Animated.add(dismissDragY, Animated.multiply(keyboardLift, -1));
  const dismissResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      !busy && gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2,
    onPanResponderMove: (_event, gesture) => {
      dismissDragY.setValue(Math.max(0, gesture.dy));
    },
    onPanResponderRelease: (_event, gesture) => {
      const shouldDismiss = gesture.dy > 96 || gesture.vy > 0.85;
      if (shouldDismiss) {
        if (reduceMotion) {
          dismissDragY.setValue(0);
          onCancel();
          return;
        }
        Animated.timing(dismissDragY, {
          toValue: windowDimensions.height,
          duration: MOBILE_MOTION.sheet,
          useNativeDriver: true
        }).start(({ finished }) => {
          dismissDragY.setValue(0);
          if (finished) onCancel();
        });
        return;
      }
      if (reduceMotion) {
        dismissDragY.setValue(0);
        return;
      }
      Animated.spring(dismissDragY, {
        toValue: 0,
        damping: 20,
        stiffness: 220,
        useNativeDriver: true
      }).start();
    },
    onPanResponderTerminate: () => {
      if (reduceMotion) {
        dismissDragY.setValue(0);
        return;
      }
      Animated.spring(dismissDragY, {
        toValue: 0,
        damping: 20,
        stiffness: 220,
        useNativeDriver: true
      }).start();
    }
  }), [busy, dismissDragY, onCancel, reduceMotion, windowDimensions.height]);

  if (!entry && !isStartMode) return null;

  function fallbackStartAt() {
    if (entry) return new Date(entry.startedAt);
    return parsedStart.date ?? new Date();
  }

  async function saveChanges() {
    if (busy || !entry || !onSave) return;
    const parsed = datePickerOpen && pickerStartAt
      ? parseLocalDateTime(formatDateInput(pickerStartAt), timeText)
      : parseLocalDateTime(dateText, timeText);
    if (parsed.error || !parsed.date) {
      setValidationError(parsed.error ?? "Choose a valid start date and time.");
      return;
    }
    if (parsed.date.getTime() > Date.now()) {
      setValidationError("Start time cannot be in the future.");
      return;
    }

    const patch: TimeEntryUpdatePatch = {
      categoryId: selectedCategoryId,
      description: description.trim() || null,
      startedAt: parsed.date.toISOString()
    };

    if (isEntryMode) {
      const stopped = parseLocalDateTime(stoppedDateText, stoppedTimeText);
      if (stopped.error || !stopped.date) {
        setValidationError(stopped.error ?? "Choose a valid end date and time.");
        return;
      }
      if (stopped.date.getTime() > Date.now()) {
        setValidationError("End time cannot be in the future.");
        return;
      }
      if (parsed.date.getTime() >= stopped.date.getTime()) {
        setValidationError("Start time must be before the end time.");
        return;
      }
      patch.stoppedAt = stopped.date.toISOString();
    }

    setValidationError(null);
    const ok = await onSave(entry.id, patch);
    if (ok) onCancel();
  }

  async function startFromSheet() {
    if (busy || !onStart) return;
    const parsed = datePickerOpen && pickerStartAt
      ? parseLocalDateTime(formatDateInput(pickerStartAt), timeText)
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
    const ok = await onStart({
      categoryId: selectedCategoryId,
      description: description.trim() || null,
      startedAt: startTimeEdited ? parsed.date.toISOString() : null
    });
    if (ok) onCancel();
  }

  async function stopFromSheet() {
    if (busy || !onStop) return;
    const ok = await onStop();
    if (ok) onCancel();
  }

  function confirmDeleteEntry() {
    if (busy || !onDelete) return;
    Alert.alert(
      "Delete entry",
      "Delete this time entry? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteEntryFromSheet();
          }
        }
      ]
    );
  }

  async function deleteEntryFromSheet() {
    if (busy || !entry || !onDelete) return;
    const ok = await onDelete(entry.id);
    if (ok) onCancel();
  }

  function useLastStopTime() {
    if (!lastStoppedAt) return;
    const stoppedAt = new Date(lastStoppedAt);
    setDateText(formatDateInput(stoppedAt));
    setTimeText(formatTimeInput(stoppedAt));
    setPickerStartAt(stoppedAt);
    if (isStartMode) setStartTimeEdited(true);
    setDatePickerOpen(false);
    setValidationError(null);
  }

  function updateTimeText(value: string) {
    if (isStartMode) setStartTimeEdited(true);
    setTimeText(formatEditableTime(value));
    setValidationError(null);
  }

  function focusDescriptionField() {
    setDatePickerOpen(false);
  }

  function updateStoppedDateText(value: string) {
    setStoppedDateText(formatEditableDate(value));
    setValidationError(null);
  }

  function updateStoppedTimeText(value: string) {
    setStoppedTimeText(formatEditableTime(value));
    setValidationError(null);
  }

  function openStartPicker() {
    Keyboard.dismiss();
    const currentStart = parsedStart.date ?? fallbackStartAt();
    setPickerStartAt(currentStart);
    setDatePickerOpen(true);
    setValidationError(null);
  }

  function applyStartPicker() {
    if (!pickerStartAt) return;
    const parsed = parseLocalDateTime(formatDateInput(pickerStartAt), timeText);
    if (parsed.error || !parsed.date) {
      setValidationError(parsed.error ?? "Choose a valid start date and time.");
      return;
    }
    if (parsed.date.getTime() > Date.now()) {
      setValidationError("Start time cannot be in the future.");
      return;
    }
    setDateText(formatDateInput(pickerStartAt));
    if (isStartMode) setStartTimeEdited(true);
    setDatePickerOpen(false);
    setValidationError(null);
  }

  function cancelStartPicker() {
    setPickerStartAt(parsedStart.date ?? fallbackStartAt());
    setDatePickerOpen(false);
    setValidationError(null);
  }

  function adjustPickerDate(days: number) {
    setPickerStartAt((current) => {
      const next = new Date((current ?? parsedStart.date ?? fallbackStartAt()).getTime());
      next.setDate(next.getDate() + days);
      next.setSeconds(0, 0);
      return next;
    });
    setValidationError(null);
  }

  function setPickerToToday() {
    setPickerStartAt((current) => {
      const source = current ?? parsedStart.date ?? fallbackStartAt();
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
      return next;
    });
    setValidationError(null);
  }

  const displayedStartAt = previewStartAt ?? fallbackStartAt();
  const pickerDate = pickerStartAt ?? displayedStartAt;

  return (
    <Modal
      animationType={reduceMotion ? "none" : "slide"}
      onRequestClose={onCancel}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.sheetOverlay}>
        <Pressable
          accessibilityLabel={cancelLabel}
          accessibilityRole="button"
          onPress={onCancel}
          style={styles.sheetBackdrop}
        />
        <View pointerEvents="box-none" style={styles.sheetKeyboardAvoidingView}>
          <SafeAreaView edges={["bottom"]} pointerEvents="box-none" style={styles.sheetSafeArea}>
            <Animated.View
              style={[
                styles.activeEditSheet,
                keyboardAwareSheetStyle,
                { transform: [{ translateY: sheetTranslateY }] }
              ]}
            >
              <View {...dismissResponder.panHandlers}>
                <View style={styles.sheetHandle} />
                <View style={styles.sheetHeader}>
                  <Pressable
                    accessibilityLabel={cancelLabel}
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
                  <Text style={styles.sheetTitle}>{sheetTitle}</Text>
                  {isStartMode ? (
                    <View style={styles.sheetHeaderSpacer} />
                  ) : (
                    <Pressable
                      accessibilityLabel={saveLabel}
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={saveChanges}
                      style={({ pressed }) => [
                        styles.sheetSaveButton,
                        pressed && !busy ? styles.buttonPressed : null,
                        busy ? styles.buttonDisabled : null
                      ]}
                    >
                      <CheckGlyph color={theme.accentText} />
                    </Pressable>
                  )}
                </View>
              </View>

              <ScrollView
                contentContainerStyle={[
                  styles.activeEditContent,
                  keyboardLayout.keyboardOpen ? { paddingBottom: keyboardLayout.contentPaddingBottom } : null
                ]}
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                keyboardShouldPersistTaps="always"
                showsVerticalScrollIndicator={false}
                style={[
                  styles.activeEditScroller,
                  keyboardLayout.keyboardOpen ? styles.activeEditScrollerKeyboard : null
                ]}
              >
                <View style={styles.activeEditHeroRow}>
                  <View style={styles.activeEditElapsedStack}>
                    <Text style={styles.activeEditElapsed}>{elapsedText}</Text>
                    {elapsedLabel ? <Text style={styles.activeEditElapsedLabel}>{elapsedLabel}</Text> : null}
                  </View>
                  {canStop ? (
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
                      <StopGlyph color={theme.onAccent} />
                    </Pressable>
                  ) : null}
                  {canStart ? (
                    <Pressable
                      accessibilityLabel="Start timer from start sheet"
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={startFromSheet}
                      style={({ pressed }) => [
                        styles.activeEditStartButton,
                        pressed && !busy ? styles.buttonPressed : null,
                        busy ? styles.buttonDisabled : null
                      ]}
                    >
                      <PlayGlyph color={theme.accentText} />
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.activeEditSection}>
                  <Text style={styles.activeEditSectionLabel}>Description</Text>
                  <TextInput
                    ref={descriptionInputRef}
                    accessibilityLabel={isStartMode ? "Task description" : isRunningMode ? "Timer description" : "Entry description"}
                    blurOnSubmit
                    editable={!busy}
                    onFocus={focusDescriptionField}
                    onPressIn={() => {
                      if (!busy) descriptionInputRef.current?.focus();
                    }}
                    style={[styles.textInput, styles.activeEditDescriptionInput]}
                    value={description}
                    onChangeText={setDescription}
                    onSubmitEditing={Keyboard.dismiss}
                    placeholder="What are you working on?"
                    placeholderTextColor={theme.textSecondary}
                    returnKeyType="done"
                    showSoftInputOnFocus
                  />
                </View>

                <View style={styles.activeEditSection}>
                  <Text style={styles.activeEditSectionLabel}>Category</Text>
                  <ScrollView
                    horizontal
                    keyboardShouldPersistTaps="always"
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
                    <Pressable
                      accessibilityLabel="Edit start date"
                      accessibilityRole="button"
                      onPress={openStartPicker}
                      style={pressable(styles.activeEditStartSummary, styles.buttonPressed)}
                    >
                      <View style={styles.activeEditStartSummaryText}>
                        <Text style={styles.activeEditStartDate}>{formatPickerDate(displayedStartAt)}</Text>
                        <Text style={styles.activeEditStartMeta}>{formatDateInput(displayedStartAt)}</Text>
                      </View>
                    </Pressable>
                    <TextInput
                      ref={timeInputRef}
                      accessibilityLabel="Start time"
                      blurOnSubmit
                      editable={!busy}
                      keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric"}
                      maxLength={5}
                      onChangeText={updateTimeText}
                      onFocus={() => setDatePickerOpen(false)}
                      onPressIn={() => {
                        if (!busy) timeInputRef.current?.focus();
                      }}
                      onSubmitEditing={Keyboard.dismiss}
                      placeholder="21:22"
                      placeholderTextColor={theme.textSecondary}
                      returnKeyType="done"
                      showSoftInputOnFocus
                      style={[styles.textInput, styles.activeEditTimeInput]}
                      value={timeText}
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
                  {datePickerOpen ? (
                    <View style={styles.activeEditPickerPanel}>
                      <View style={styles.activeEditPickerHeader}>
                        <View style={styles.activeEditPickerHeaderText}>
                          <Text style={styles.activeEditPickerTitle}>Choose date</Text>
                          <Text style={styles.activeEditPickerMeta}>
                            {formatPickerDate(pickerDate)} · {formatDateInput(pickerDate)}
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
                            accessibilityLabel="Apply start date"
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
                      </View>

                      <View style={styles.activeEditPickerGrid}>
                        <PickerStepper
                          decrementLabel="Previous day"
                          disableIncrement={isPickerDateIncrementFuture(pickerDate, 1)}
                          incrementLabel="Next day"
                          label="Date"
                          onDecrement={() => adjustPickerDate(-1)}
                          onIncrement={() => adjustPickerDate(1)}
                          value={formatShortPickerDate(pickerDate)}
                          styles={styles}
                          theme={theme}
                        />
                      </View>
                    </View>
                  ) : null}
                </View>

                {isEntryMode ? (
                  <View style={styles.activeEditSection}>
                    <Text style={styles.activeEditSectionLabel}>End time</Text>
                    <View style={styles.activeEditTimeRow}>
                      <TextInput
                        accessibilityLabel="End date"
                        blurOnSubmit
                        editable={!busy}
                        keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric"}
                        maxLength={10}
                        onChangeText={updateStoppedDateText}
                        onFocus={() => setDatePickerOpen(false)}
                        onSubmitEditing={Keyboard.dismiss}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={theme.textSecondary}
                        returnKeyType="done"
                        showSoftInputOnFocus
                        style={[styles.textInput, styles.activeEditDateInput]}
                        value={stoppedDateText}
                      />
                      <TextInput
                        accessibilityLabel="End time"
                        blurOnSubmit
                        editable={!busy}
                        keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric"}
                        maxLength={5}
                        onChangeText={updateStoppedTimeText}
                        onFocus={() => setDatePickerOpen(false)}
                        onSubmitEditing={Keyboard.dismiss}
                        placeholder="17:30"
                        placeholderTextColor={theme.textSecondary}
                        returnKeyType="done"
                        showSoftInputOnFocus
                        style={[styles.textInput, styles.activeEditTimeInput]}
                        value={stoppedTimeText}
                      />
                    </View>
                  </View>
                ) : null}

                {canDelete ? (
                  <Pressable
                    accessibilityLabel="Delete entry"
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={confirmDeleteEntry}
                    style={({ pressed }) => [
                      styles.activeEditDeleteButton,
                      pressed && !busy ? styles.buttonPressed : null,
                      busy ? styles.buttonDisabled : null
                    ]}
                  >
                    <Text style={styles.activeEditDeleteText}>
                      {deleting ? "Deleting..." : "Delete entry"}
                    </Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            </Animated.View>
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
  const color = category
    ? paletteColorFor(category.color, category.name, theme.mode)
    : theme.textSecondary;

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

function isPickerDateIncrementFuture(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  next.setSeconds(0, 0);
  const today = new Date();
  const nextDate = new Date(next.getFullYear(), next.getMonth(), next.getDate()).getTime();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return nextDate > todayDate;
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

function formatEditableTime(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length === 0) return "";
  if (digits.length === 1) {
    const hour = Number(digits);
    return hour > 2 ? `0${hour}:` : digits;
  }
  if (digits.length === 2) {
    const hour = Number(digits);
    if (hour > 23) return `0${digits[0]}:${digits[1]}`;
    return value.includes(":") ? `${digits}:` : digits;
  }
  if (digits.length === 3) {
    const hour = Number(digits.slice(0, 2));
    return hour > 23 ? `0${digits[0]}:${digits.slice(1)}` : `${digits.slice(0, 2)}:${digits[2]}`;
  }

  const hour = Math.min(Number(digits.slice(0, 2)), 23);
  const minute = Math.min(Number(digits.slice(2)), 59);
  return `${pad2(hour)}:${pad2(minute)}`;
}

function formatEditableDate(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
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

function PlayGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path d="M8 5v14l11-7L8 5Z" fill={color} />
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
