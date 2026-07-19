import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
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
import {
  findActiveHashtag,
  descriptionWithTagTokens,
  normalizeTagName,
  paletteColorFor,
  replaceActiveHashtag,
  tagNamesFromDescription,
  type RecentActivitySuggestion
} from "@dayframe/shared";
import { FloatingDatePicker } from "@/components/FloatingDatePicker";
import { DeleteEntryConfirmation } from "@/components/DeleteEntryConfirmation";
import { pressable, type MobileStyles, type MobileTheme } from "@/lib/mobileTheme";
import {
  editSheetKeyboardLayout,
  keyboardInsetFromScreenY,
  keyboardLiftAnimationDuration
} from "@/lib/editSheetKeyboard";
import type { MobileBootstrap, MobileTag, MobileTimeEntry, TimeEntryUpdatePatch } from "@/lib/api";
import { MOBILE_MOTION, useReduceMotionPreference } from "@/lib/motion";
import { runningTimerSheetElapsedSeconds } from "@/lib/timerPresentation";
import { TagMetadata } from "@/components/TagMetadata";

const MAX_RUNNING_SUGGESTIONS = 6;

type Category = MobileBootstrap["categories"][number];
type EditSheetMode = "running" | "entry" | "add";

type ActiveTimerEditSheetProps = {
  categories: Category[];
  descriptionPlaceholder?: string;
  elapsedSeconds: number;
  entry: MobileTimeEntry | null;
  lastStoppedAt: string | null;
  onCancel: () => void;
  onDelete?: (entryId: string) => Promise<boolean>;
  onApplySuggestion?: (entryId: string, suggestion: RecentActivitySuggestion) => Promise<boolean>;
  onSave?: (entryId: string, patch: TimeEntryUpdatePatch) => Promise<boolean>;
  onStop?: () => Promise<boolean>;
  mode?: EditSheetMode;
  deleting?: boolean;
  saving: boolean;
  stopping: boolean;
  styles: MobileStyles;
  suggestions?: RecentActivitySuggestion[];
  tags?: MobileTag[];
  theme: MobileTheme;
  visible: boolean;
};

export function ActiveTimerEditSheet({
  categories,
  descriptionPlaceholder = "What are you working on?",
  elapsedSeconds,
  entry,
  lastStoppedAt,
  mode = "running",
  onCancel,
  onDelete,
  onApplySuggestion,
  onSave,
  onStop,
  deleting = false,
  saving,
  stopping,
  styles,
  suggestions = [],
  tags = [],
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
  const [suggestionsVisible, setSuggestionsVisible] = useState(false);
  const [suggestionsMounted, setSuggestionsMounted] = useState(false);
  const [deleteConfirmationVisible, setDeleteConfirmationVisible] = useState(false);
  const [descriptionFocused, setDescriptionFocused] = useState(false);
  const [descriptionSelection, setDescriptionSelection] = useState({ start: 0, end: 0 });
  const [hashtagPanelMounted, setHashtagPanelMounted] = useState(false);
  const [highlightedTagAction, setHighlightedTagAction] = useState<string | null>(null);
  const reduceMotion = useReduceMotionPreference();
  const dismissDragY = useRef(new Animated.Value(0)).current;
  const keyboardLift = useRef(new Animated.Value(0)).current;
  const suggestionsProgress = useRef(new Animated.Value(0)).current;
  const hashtagPanelProgress = useRef(new Animated.Value(0)).current;
  const descriptionInputRef = useRef<TextInput>(null);
  const descriptionEntryStarted = useRef(false);
  const timeInputRef = useRef<TextInput>(null);

  const isRunningMode = mode === "running";
  const isEntryMode = mode === "entry";
  const isAddMode = mode === "add";
  const hasStoppedTime = isEntryMode || isAddMode;
  const entryCategoryId = entry?.categoryId ?? null;
  const entryDescription = entry?.description ?? null;
  const entryStartedAt = entry?.startedAt ?? null;
  const entryStoppedAt = entry?.stoppedAt ?? null;
  const entryTags = entry?.tags ?? (entry?.tagNames ?? []).map((name) => ({
    id: `legacy-tag:${normalizeTagName(name).normalizedName}`,
    name,
    normalizedName: normalizeTagName(name).normalizedName
  }));
  const editorSessionKey = entryStartedAt ? `${mode}:${entryStartedAt}` : null;
  const editorSnapshot = useRef({
    categoryId: entryCategoryId,
    description: entryDescription,
    startedAt: entryStartedAt,
    stoppedAt: entryStoppedAt,
    tags: entryTags,
    suggestionsAvailable: suggestions.length > 0
  });
  editorSnapshot.current = {
    categoryId: entryCategoryId,
    description: entryDescription,
    startedAt: entryStartedAt,
    stoppedAt: entryStoppedAt,
    tags: entryTags,
    suggestionsAvailable: suggestions.length > 0
  };

  useLayoutEffect(() => {
    if (!visible) {
      descriptionEntryStarted.current = false;
      return;
    }
    const snapshot = editorSnapshot.current;
    if (!snapshot.startedAt) return;
    const startedAt = new Date(snapshot.startedAt);
    descriptionEntryStarted.current = false;
    const hydratedDescription = descriptionWithTagTokens(
      snapshot.description,
      snapshot.tags
    );
    setDescription(hydratedDescription);
    setDescriptionSelection({
      start: hydratedDescription.length,
      end: hydratedDescription.length
    });
    setDescriptionFocused(false);
    setSelectedCategoryId(snapshot.categoryId);
    setDateText(formatDateInput(startedAt));
    setTimeText(formatTimeInput(startedAt));
    if (snapshot.stoppedAt) {
      const stoppedAt = new Date(snapshot.stoppedAt);
      setStoppedDateText(formatDateInput(stoppedAt));
      setStoppedTimeText(formatTimeInput(stoppedAt));
    } else {
      setStoppedDateText("");
      setStoppedTimeText("");
    }
    setPickerStartAt(startedAt);
    setStartTimeEdited(false);
    setDatePickerOpen(false);
    const shouldShowSuggestions = (
      isRunningMode &&
      !snapshot.description &&
      snapshot.suggestionsAvailable
    );
    setSuggestionsMounted(shouldShowSuggestions);
    setSuggestionsVisible(shouldShowSuggestions);
    suggestionsProgress.setValue(shouldShowSuggestions ? 1 : 0);
    setDeleteConfirmationVisible(false);
    setValidationError(null);
    setHashtagPanelMounted(false);
    hashtagPanelProgress.setValue(0);
  }, [
    editorSessionKey,
    hashtagPanelProgress,
    isRunningMode,
    suggestionsProgress,
    visible
  ]);

  useLayoutEffect(() => {
    if (!visible || !editorSessionKey || !isRunningMode || descriptionEntryStarted.current) return;
    const shouldShowSuggestions = !entryDescription && suggestions.length > 0;
    setSuggestionsMounted(shouldShowSuggestions);
    setSuggestionsVisible(shouldShowSuggestions);
    suggestionsProgress.setValue(shouldShowSuggestions ? 1 : 0);
  }, [editorSessionKey, entryDescription, isRunningMode, suggestions.length, suggestionsProgress, visible]);

  useEffect(() => {
    if (!visible) {
      setKeyboardInset(0);
      dismissDragY.setValue(0);
      keyboardLift.setValue(0);
      suggestionsProgress.setValue(0);
      setSuggestionsMounted(false);
      hashtagPanelProgress.setValue(0);
      setHashtagPanelMounted(false);
      return undefined;
    }

    function animateKeyboardLift(toValue: number, event?: KeyboardEvent) {
      keyboardLift.stopAnimation();
      if (reduceMotion) {
        keyboardLift.setValue(toValue);
        return;
      }
      const duration = keyboardLiftAnimationDuration({
        eventDuration: event?.duration,
        platform: Platform.OS
      });
      if (duration === null) {
        keyboardLift.setValue(toValue);
        return;
      }
      Animated.timing(keyboardLift, {
        toValue,
        duration,
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
  }, [dismissDragY, hashtagPanelProgress, insets.bottom, insets.top, keyboardLift, reduceMotion, suggestionsProgress, visible, windowDimensions.height]);

  const activeHashtag = useMemo(
    () => descriptionSelection.start === descriptionSelection.end
      ? findActiveHashtag(description, descriptionSelection.end)
      : null,
    [description, descriptionSelection.end, descriptionSelection.start]
  );
  const matchingTags = useMemo(() => {
    if (!activeHashtag) return [];
    const query = activeHashtag.query.toLowerCase();
    return tags
      .filter((tag) => !query || tag.normalizedName.startsWith(query) || tag.name.toLowerCase().includes(query))
      .slice(0, 5);
  }, [activeHashtag, tags]);
  const exactTagMatch = activeHashtag
    ? tags.some((tag) => tag.normalizedName === activeHashtag.query.toLowerCase())
    : false;
  const createTagName = useMemo(() => {
    if (!activeHashtag?.query || exactTagMatch) return null;
    try {
      return normalizeTagName(activeHashtag.query).name;
    } catch {
      return null;
    }
  }, [activeHashtag, exactTagMatch]);
  const hashtagPanelVisible = descriptionFocused && Boolean(activeHashtag);
  const appliedTagNames = useMemo(
    () => tagNamesFromDescription(description, tags),
    [description, tags]
  );

  useEffect(() => {
    if (hashtagPanelVisible) setHashtagPanelMounted(true);
    if (reduceMotion) {
      hashtagPanelProgress.setValue(hashtagPanelVisible ? 1 : 0);
      if (!hashtagPanelVisible) setHashtagPanelMounted(false);
      return undefined;
    }
    hashtagPanelProgress.stopAnimation();
    const animation = Animated.timing(hashtagPanelProgress, {
      toValue: hashtagPanelVisible ? 1 : 0,
      duration: 140,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    });
    animation.start(({ finished }) => {
      if (finished && !hashtagPanelVisible) setHashtagPanelMounted(false);
    });
    return () => animation.stop();
  }, [hashtagPanelProgress, hashtagPanelVisible, reduceMotion]);

  useEffect(() => {
    setHighlightedTagAction(matchingTags[0]?.id ?? (createTagName ? "create" : null));
  }, [activeHashtag?.query, createTagName, matchingTags]);

  useEffect(() => {
    if (suggestionsVisible) setSuggestionsMounted(true);
    if (reduceMotion) {
      suggestionsProgress.setValue(suggestionsVisible ? 1 : 0);
      if (!suggestionsVisible) setSuggestionsMounted(false);
      return undefined;
    }

    const animation = Animated.timing(suggestionsProgress, {
      toValue: suggestionsVisible ? 1 : 0,
      duration: suggestionsVisible ? 160 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false
    });
    animation.start(({ finished }) => {
      if (finished && !suggestionsVisible) setSuggestionsMounted(false);
    });
    return () => animation.stop();
  }, [reduceMotion, suggestionsProgress, suggestionsVisible]);

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
  const elapsedPreviewSeconds = hasStoppedTime && parsedStart.date && parsedStop.date
      ? Math.max(0, Math.floor((parsedStop.date.getTime() - parsedStart.date.getTime()) / 1000))
      : runningTimerSheetElapsedSeconds({
          activeElapsedSeconds: elapsedSeconds,
          nowMs: Date.now(),
          previewStartAt,
          startTimeEdited
        });

  const busy = saving || stopping || deleting;
  const canStop = isRunningMode && Boolean(onStop);
  const canDelete = Boolean(onDelete);
  const cancelLabel = isRunningMode ? "Cancel editing timer" : isAddMode ? "Cancel adding time" : "Cancel editing entry";
  const saveLabel = isRunningMode ? "Save timer edits" : isAddMode ? "Create time entry" : "Save entry edits";
  const sheetTitle = isAddMode ? "Add time" : "Edit entry";
  const elapsedLabel = hasStoppedTime ? "Duration" : null;
  const elapsedText = formatClockDuration(elapsedPreviewSeconds);
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
  const suggestionsAnimatedStyle = {
    maxHeight: suggestionsProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 306]
    }),
    opacity: suggestionsProgress,
    transform: [
      {
        translateY: suggestionsProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [-6, 0]
        })
      }
    ]
  };

  if (!entry) return null;

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
      tagNames: appliedTagNames
    };

    if (!isRunningMode || startTimeEdited) {
      patch.startedAt = parsed.date.toISOString();
    }

    if (hasStoppedTime) {
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

  async function stopFromSheet() {
    if (busy || !onStop) return;
    const ok = await onStop();
    if (ok) onCancel();
  }

  async function applyRunningSuggestion(suggestion: RecentActivitySuggestion) {
    if (busy || !entry || !onApplySuggestion) return;
    const previousDescription = description;
    const previousCategoryId = selectedCategoryId;
    descriptionEntryStarted.current = true;
    setDescription(suggestion.description);
    setSelectedCategoryId(suggestion.categoryId);
    setSuggestionsVisible(false);
    const ok = await onApplySuggestion(entry.id, suggestion);
    if (!ok) {
      setDescription(previousDescription);
      setSelectedCategoryId(previousCategoryId);
      setSuggestionsVisible(true);
    }
  }

  function confirmDeleteEntry() {
    if (busy || !onDelete) return;
    Keyboard.dismiss();
    setDeleteConfirmationVisible(true);
  }

  async function deleteEntryFromSheet() {
    if (busy || !entry || !onDelete) return;
    setDeleteConfirmationVisible(false);
    const ok = await onDelete(entry.id);
    if (ok) onCancel();
  }

  function useLastStopTime() {
    if (!lastStoppedAt) return;
    const stoppedAt = new Date(lastStoppedAt);
    setDateText(formatDateInput(stoppedAt));
    setTimeText(formatTimeInput(stoppedAt));
    setPickerStartAt(stoppedAt);
    if (!hasStoppedTime) setStartTimeEdited(true);
    setDatePickerOpen(false);
    setValidationError(null);
  }

  function updateTimeText(value: string) {
    if (!hasStoppedTime) setStartTimeEdited(true);
    setTimeText(formatEditableTime(value));
    setValidationError(null);
  }

  function hideSuggestionsForDescriptionEntry() {
    setSuggestionsVisible(false);
  }

  function focusDescriptionField() {
    setDatePickerOpen(false);
    descriptionEntryStarted.current = true;
    hideSuggestionsForDescriptionEntry();
    setDescriptionFocused(true);
  }

  function selectHashtag(tagName: string) {
    if (!activeHashtag) return;
    const replacement = replaceActiveHashtag(description, activeHashtag, tagName);
    setDescription(replacement.text);
    setDescriptionSelection({ start: replacement.caret, end: replacement.caret });
    setValidationError(null);
    setTimeout(() => descriptionInputRef.current?.focus(), 0);
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

  function selectStartDate(date: Date) {
    const parsed = parseLocalDateTime(formatDateInput(date), timeText);
    if (parsed.error || !parsed.date) {
      setValidationError(parsed.error ?? "Choose a valid start date and time.");
      return;
    }
    if (parsed.date.getTime() > Date.now()) {
      setValidationError("Start time cannot be in the future.");
      return;
    }
    setPickerStartAt(parsed.date);
    setDateText(formatDateInput(parsed.date));
    if (isRunningMode) setStartTimeEdited(true);
    setDatePickerOpen(false);
    setValidationError(null);
  }

  const displayedStartAt = previewStartAt ?? fallbackStartAt();
  const pickerDate = pickerStartAt ?? displayedStartAt;
  const showDoneButton = Boolean(onSave);
  const hashtagPanelAnimatedStyle = {
    opacity: hashtagPanelProgress,
    transform: [{
      translateY: hashtagPanelProgress.interpolate({
        inputRange: [0, 1],
        outputRange: reduceMotion ? [0, 0] : [-4, 0]
      })
    }]
  };

  return (
    <>
      <Modal
      animationType={reduceMotion ? "none" : "slide"}
      onRequestClose={() => {
        if (deleteConfirmationVisible) {
          setDeleteConfirmationVisible(false);
          return;
        }
        onCancel();
      }}
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
          <SafeAreaView edges={[]} pointerEvents="box-none" style={styles.sheetSafeArea}>
            <Animated.View
              accessibilityLabel={isRunningMode ? "Edit timer" : sheetTitle}
              accessibilityViewIsModal
              style={[
                styles.activeEditSheet,
                keyboardAwareSheetStyle,
                { paddingBottom: Math.max(10, Math.min(16, insets.bottom)) },
                { transform: [{ translateY: sheetTranslateY }] }
              ]}
            >
              <View {...dismissResponder.panHandlers}>
                <View style={styles.sheetHandle} />
                <View style={[styles.sheetHeader, isRunningMode ? styles.sheetHeaderRunning : null]}>
                  {!isRunningMode ? <Text style={styles.sheetTitle}>{sheetTitle}</Text> : null}
                  {showDoneButton ? (
                    <Pressable
                      accessibilityLabel={saveLabel}
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={saveChanges}
                      style={({ pressed }) => [
                        styles.sheetDoneButton,
                        pressed && !busy ? styles.buttonPressed : null,
                        busy ? styles.buttonDisabled : null
                      ]}
                    >
                      <Text style={styles.sheetDoneText}>Done</Text>
                    </Pressable>
                  ) : null}
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
                </View>

                {suggestionsMounted ? (
                  <Animated.View
                    accessibilityLabel="Suggestions for this running timer"
                    style={[styles.taskSuggestionsPanel, suggestionsAnimatedStyle]}
                  >
                    <Text style={styles.taskSuggestionsTitle}>SUGGESTIONS</Text>
                    <View style={styles.taskSuggestionsList}>
                      {suggestions.slice(0, MAX_RUNNING_SUGGESTIONS).map((suggestion, index) => (
                        <RunningTimerSuggestionRow
                          key={suggestion.key}
                          disabled={busy}
                          isFirst={index === 0}
                          onPress={() => {
                            void applyRunningSuggestion(suggestion);
                          }}
                          suggestion={suggestion}
                          styles={styles}
                          theme={theme}
                        />
                      ))}
                    </View>
                  </Animated.View>
                ) : null}

                <View style={[
                  styles.activeEditSection,
                  hashtagPanelMounted ? styles.activeEditTagSectionOpen : null
                ]}>
                  <Text style={styles.activeEditSectionLabel}>Description</Text>
                  <View style={styles.activeEditDescriptionField}>
                    <TextInput
                      ref={descriptionInputRef}
                      accessibilityHint="Type a hashtag to add optional tag context"
                      accessibilityLabel={isRunningMode ? "Timer description" : "Entry description"}
                      blurOnSubmit
                      editable={!busy}
                      onBlur={() => setDescriptionFocused(false)}
                      onFocus={focusDescriptionField}
                      onPressIn={() => {
                        if (!busy) descriptionInputRef.current?.focus();
                      }}
                      onSelectionChange={(event) => setDescriptionSelection(event.nativeEvent.selection)}
                      selection={descriptionSelection}
                      style={[styles.textInput, styles.activeEditDescriptionInput]}
                      value={description}
                      onChangeText={(value) => {
                        setDescription(value);
                        setValidationError(null);
                      }}
                      onSubmitEditing={Keyboard.dismiss}
                      placeholder={descriptionPlaceholder}
                      placeholderTextColor={theme.textSecondary}
                      returnKeyType="done"
                      showSoftInputOnFocus
                    />
                    {hashtagPanelMounted ? (
                      <Animated.View
                        accessibilityLabel="Tag suggestions"
                        style={[styles.tagAutocompletePanel, hashtagPanelAnimatedStyle]}
                      >
                        <Text style={styles.tagAutocompleteTitle}>TAGS</Text>
                        <ScrollView
                          keyboardShouldPersistTaps="always"
                          nestedScrollEnabled
                          showsVerticalScrollIndicator={false}
                          style={styles.tagAutocompleteList}
                        >
                          {matchingTags.map((tag, index) => (
                            <HashtagSuggestionRow
                              key={tag.id}
                              accessibilityLabel={`Existing tag, ${tag.name}`}
                              disabled={busy}
                              highlighted={highlightedTagAction === tag.id}
                              isFirst={index === 0}
                              label={tag.name}
                              onHighlight={() => setHighlightedTagAction(tag.id)}
                              onPress={() => selectHashtag(tag.name)}
                              reduceMotion={reduceMotion}
                              styles={styles}
                              theme={theme}
                            />
                          ))}
                          {createTagName ? (
                            <HashtagSuggestionRow
                              accessibilityLabel={`Create new tag, ${createTagName}`}
                              create
                              disabled={busy}
                              highlighted={highlightedTagAction === "create"}
                              isFirst={matchingTags.length === 0}
                              label={`Create “${createTagName}”`}
                              onHighlight={() => setHighlightedTagAction("create")}
                              onPress={() => selectHashtag(createTagName)}
                              reduceMotion={reduceMotion}
                              styles={styles}
                              theme={theme}
                            />
                          ) : null}
                          {matchingTags.length === 0 && !createTagName ? (
                            <Text style={styles.tagSuggestionEmptyText}>Type a name to search or create</Text>
                          ) : null}
                        </ScrollView>
                      </Animated.View>
                    ) : null}
                  </View>
                  {appliedTagNames.length > 0 ? (
                    <TagMetadata active styles={styles} tagNames={appliedTagNames} theme={theme} />
                  ) : (
                    <Text style={styles.tagDescriptionHelper}>Type # to add a tag</Text>
                  )}
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
                      onPress={() => {
                        setSelectedCategoryId(null);
                      }}
                    />
                    {categories.map((category) => (
                      <CategoryChip
                        key={category.id}
                        category={category}
                        selected={selectedCategoryId === category.id}
                        styles={styles}
                        theme={theme}
                        onPress={() => {
                          setSelectedCategoryId(category.id);
                        }}
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
                        <Text style={styles.activeEditStartDate} numberOfLines={1}>
                          {formatPickerDate(displayedStartAt)}
                        </Text>
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
                      onFocus={() => {
                        setDatePickerOpen(false);
                      }}
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
                </View>

                {hasStoppedTime ? (
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
                    onTouchStart={(event) => event.stopPropagation()}
                    style={({ pressed }) => [
                      styles.activeEditDeleteButton,
                      pressed && !busy ? styles.buttonPressed : null,
                      busy ? styles.buttonDisabled : null
                    ]}
                  >
                    <Text style={styles.activeEditDeleteText}>Delete entry</Text>
                  </Pressable>
                ) : null}
              </ScrollView>
              <DeleteEntryConfirmation
                deleting={deleting}
                onCancel={() => setDeleteConfirmationVisible(false)}
                onConfirm={() => {
                  void deleteEntryFromSheet();
                }}
                styles={styles}
                visible={deleteConfirmationVisible}
              />
            </Animated.View>
          </SafeAreaView>
        </View>
        <FloatingDatePicker
          maxDate={new Date()}
          onClose={() => setDatePickerOpen(false)}
          onSelect={selectStartDate}
          selectedDate={pickerDate}
          styles={styles}
          theme={theme}
          visible={datePickerOpen}
        />
      </View>
      </Modal>
    </>
  );
}

function HashtagSuggestionRow({
  accessibilityLabel,
  create = false,
  disabled,
  highlighted,
  isFirst,
  label,
  onHighlight,
  onPress,
  reduceMotion,
  styles,
  theme
}: {
  accessibilityLabel: string;
  create?: boolean;
  disabled: boolean;
  highlighted: boolean;
  isFirst: boolean;
  label: string;
  onHighlight: () => void;
  onPress: () => void;
  reduceMotion: boolean;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const highlightProgress = useRef(new Animated.Value(highlighted ? 1 : 0)).current;

  useEffect(() => {
    highlightProgress.stopAnimation();
    if (reduceMotion) {
      highlightProgress.setValue(highlighted ? 1 : 0);
      return;
    }
    Animated.timing(highlightProgress, {
      toValue: highlighted ? 1 : 0,
      duration: 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false
    }).start();
  }, [highlightProgress, highlighted, reduceMotion]);

  return (
    <Animated.View style={{
      backgroundColor: highlightProgress.interpolate({
        inputRange: [0, 1],
        outputRange: ["transparent", theme.surfaceMuted]
      })
    }}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        onPressIn={onHighlight}
        style={[
          styles.tagSuggestionRow,
          !isFirst ? styles.tagSuggestionDivider : null,
          disabled ? styles.buttonDisabled : null
        ]}
      >
        <Text style={create ? styles.tagSuggestionCreateText : styles.tagSuggestionText} numberOfLines={1}>
          {create ? "+ " : ""}{label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function RunningTimerSuggestionRow({
  disabled,
  isFirst,
  onPress,
  suggestion,
  styles,
  theme
}: {
  disabled: boolean;
  isFirst: boolean;
  onPress: () => void;
  suggestion: RecentActivitySuggestion;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const categoryName = suggestion.categoryName;
  const color = categoryName
    ? paletteColorFor(suggestion.categoryColor ?? null, categoryName, theme.mode)
    : null;

  return (
    <Pressable
      accessibilityLabel={categoryName
        ? `Apply ${suggestion.description} in ${categoryName} to this timer`
        : `Apply ${suggestion.description} to this timer`}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={pressable(
        [
          styles.taskSuggestionRow,
          !isFirst ? styles.taskSuggestionRowDivider : null,
          disabled ? styles.buttonDisabled : null
        ],
        styles.buttonPressed
      )}
    >
      <View style={styles.taskSuggestionTextStack}>
        <Text style={styles.taskSuggestionTitle} numberOfLines={1}>{suggestion.description}</Text>
        {categoryName && color ? (
          <View style={styles.taskSuggestionMetaRow}>
            <View style={[styles.colorDot, { backgroundColor: color }]} />
            <Text style={styles.taskSuggestionMeta} numberOfLines={1}>{categoryName}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
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
          selected ? { backgroundColor: category ? colorWithAlpha(color, theme.mode === "dark" ? 0.22 : 0.15) : theme.accentSoft } : null
        ],
        styles.buttonPressed
      )}
    >
      <View style={[styles.colorDot, { backgroundColor: category ? color : theme.textSecondary }]} />
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

function formatPickerDate(date: Date) {
  if (isToday(date)) return "Today";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
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

function colorWithAlpha(hex: string, alpha: number) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function StopGlyph({ color }: { color: string }) {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24">
      <Path d="M6 6h12v12H6V6Z" fill={color} />
    </Svg>
  );
}
