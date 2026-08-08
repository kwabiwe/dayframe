import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Dimensions,
  Easing,
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
import {
  consumeActiveHashtag,
  analyzeTimeIntervals,
  buildHistoricalEntrySuggestions,
  findActiveHashtag,
  historicalSuggestionPatch,
  insertHashtagStarter,
  normalizeNewTagName,
  normalizeTagName,
  paletteColorFor,
  type RecentActivitySuggestion
} from "@dayframe/shared";
import { FloatingDatePicker } from "@/components/FloatingDatePicker";
import {
  HistoricalSuggestionsOverlay,
  type HistoricalSuggestionsOverlayRenderState
} from "@/components/HistoricalSuggestionsOverlay";
import { PrimaryTimerGlyph } from "@/components/PrimaryTimerAction";
import { pressable, type MobileStyles, type MobileTheme } from "@/lib/mobileTheme";
import {
  editSheetKeyboardLayout,
  keyboardInsetFromScreenY,
  keyboardLiftAnimationDuration
} from "@/lib/editSheetKeyboard";
import type { MobileBootstrap, MobileTag, MobileTimeEntry, TimeEntryUpdatePatch } from "@/lib/api";
import { runningTimerSheetElapsedSeconds } from "@/lib/timerPresentation";
import {
  HISTORICAL_SUGGESTION_ROLLBACK_ANNOUNCEMENT,
  historicalSuggestionAppliedAnnouncement
} from "@/lib/historicalSuggestionsAccessibility";
import { TagMetadata } from "@/components/TagMetadata";
import {
  SwipeDismissSheet,
  type SwipeDismissSheetHandle
} from "@/components/SwipeDismissSheet";
import {
  beginTimeEntrySheetGeometryPresentation,
  calculateHistoricalSuggestionsOverlayGeometry,
  classifyKeyboardHeightAnimationCompletion,
  createTimeEntrySheetGeometryCache,
  invalidateTimeEntrySheetGeometry,
  isCurrentTimeEntrySheetFrameToken,
  recordTimeEntrySheetGeometry,
  resolveTimeEntrySheetLocalGeometry,
  timeEntrySheetVisualReadiness,
  type HistoricalSuggestionsOverlayGeometry,
  type KeyboardHeightAnimationToken,
  type MeasuredRect
} from "@/lib/timeEntrySheetGeometry";
import {
  classifyTimeEntrySheetDeferredFocus,
  createClosedTimeEntrySheetState,
  historicalSuggestionsObscureFormAccessibility,
  pendingDescriptionFocusPresentationId,
  pendingTimeEntrySheetDismissRequestId,
  timeEntrySheetReducer,
  type TimeEntrySheetMutationPhase,
  type TimeEntrySheetPresentation
} from "@/lib/timeEntrySheetPresentation";
import {
  createTimeEntrySheetMutationTelemetry,
  timeEntrySheetMutationTelemetryReducer
} from "@/lib/timeEntrySheetTelemetry";

const HISTORICAL_SUGGESTION_LIMIT = 12;
const HISTORICAL_OVERLAY_MAX_HEIGHT = 384;

type Category = MobileBootstrap["categories"][number];
type EditSheetMode = "running" | "entry" | "add";

type ActiveTimerEditSheetProps = {
  categories: Category[];
  debugTelemetry?: boolean;
  descriptionPlaceholder?: string;
  dismissRequestId?: number | null;
  elapsedSeconds: number;
  entry: MobileTimeEntry | null;
  historicalEntries?: MobileTimeEntry[];
  lastStoppedAt: string | null;
  onCancel: (presentationId: number) => void;
  onDelete?: (entryId: string) => Promise<boolean>;
  onPresented?: (presentationId: number) => void;
  onApplySuggestion?: (entryId: string, suggestion: RecentActivitySuggestion) => Promise<boolean>;
  onSave?: (entryId: string, patch: TimeEntryUpdatePatch) => Promise<boolean>;
  onStop?: () => Promise<boolean>;
  peerEntries?: MobileTimeEntry[];
  presentation: TimeEntrySheetPresentation;
  reduceMotion: boolean;
  mode?: EditSheetMode;
  deleting?: boolean;
  saving: boolean;
  stopping: boolean;
  styles: MobileStyles;
  tags?: MobileTag[];
  theme: MobileTheme;
  visible: boolean;
};

export function ActiveTimerEditSheet({
  categories,
  debugTelemetry = false,
  descriptionPlaceholder = "What are you working on?",
  dismissRequestId = null,
  elapsedSeconds,
  entry: currentEntry,
  historicalEntries = [],
  lastStoppedAt,
  mode = "running",
  onCancel,
  onDelete,
  onPresented,
  onApplySuggestion,
  onSave,
  onStop,
  peerEntries = [],
  presentation,
  reduceMotion,
  deleting = false,
  saving,
  stopping,
  styles,
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
  const [sheetHeightAnimating, setSheetHeightAnimating] = useState(false);
  const [startTimeEdited, setStartTimeEdited] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<"start" | "end">("start");
  const [pickerStartAt, setPickerStartAt] = useState<Date | null>(null);
  const [descriptionSelection, setDescriptionSelection] = useState({ start: 0, end: 0 });
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>([]);
  const [hashtagPanelMounted, setHashtagPanelMounted] = useState(false);
  const [highlightedTagAction, setHighlightedTagAction] = useState<string | null>(null);
  const [sheetState, dispatchSheetEvent] = useReducer(
    timeEntrySheetReducer,
    undefined,
    createClosedTimeEntrySheetState
  );
  const [mutationTelemetry, dispatchMutationTelemetry] = useReducer(
    timeEntrySheetMutationTelemetryReducer,
    undefined,
    createTimeEntrySheetMutationTelemetry
  );
  const sheetStateRef = useRef(sheetState);
  sheetStateRef.current = sheetState;
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;
  const keyboardLift = useRef(new Animated.Value(0)).current;
  const animatedSheetHeight = useRef(new Animated.Value(0)).current;
  const sheetRef = useRef<SwipeDismissSheetHandle>(null);
  const presentedEntryRef = useRef<MobileTimeEntry | null>(currentEntry);
  const keyboardMotionFrozen = useRef(false);
  const keyboardInsetRef = useRef(0);
  const measuredSheetHeight = useRef(0);
  const closedSheetHeight = useRef(0);
  const pendingKeyboardUpdate = useRef<{
    event?: KeyboardEvent;
    inset: number;
    sessionToken: number;
  } | null>(null);
  const applyKeyboardUpdateRef = useRef<(
    inset: number,
    event: KeyboardEvent | undefined,
    sessionToken: number,
    terminal?: boolean
  ) => void>(() => undefined);
  const hashtagPanelProgress = useRef(new Animated.Value(0)).current;
  const descriptionInputRef = useRef<TextInput>(null);
  const contentScrollRef = useRef<ScrollView>(null);
  const sheetRootLayoutRef = useRef<MeasuredRect | null>(null);
  const scrollViewportLayoutRef = useRef<MeasuredRect | null>(null);
  const descriptionSectionLayoutRef = useRef<MeasuredRect | null>(null);
  const descriptionAnchorLayoutRef = useRef<MeasuredRect | null>(null);
  const contentScrollOffsetRef = useRef({ x: 0, y: 0 });
  const timeInputRef = useRef<TextInput>(null);
  const endTimeInputRef = useRef<TextInput>(null);
  const startTimeFocused = useRef(false);
  const focusFrameRef = useRef<number | null>(null);
  const tagFocusFrameRef = useRef<number | null>(null);
  const tagFocusRequestSequenceRef = useRef(0);
  const geometryFrameRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollFrameSequenceRef = useRef(0);
  const geometryCacheRef = useRef(createTimeEntrySheetGeometryCache());
  const geometryEnvironmentRef = useRef({
    presentationId: presentation.id,
    windowHeight: windowDimensions.height,
    windowWidth: windowDimensions.width,
    fontScale: windowDimensions.fontScale,
    safeAreaBottom: insets.bottom,
    safeAreaTop: insets.top
  });
  const keyboardFrameSequenceRef = useRef(0);
  const keyboardSessionSequenceRef = useRef(0);
  const activeKeyboardSessionTokenRef = useRef<number | null>(null);
  const appActivityRef = useRef<"active" | "background">(
    AppState.currentState === "active" ? "active" : "background"
  );
  const keyboardHeightAnimationTokenRef = useRef<KeyboardHeightAnimationToken | null>(null);
  const keyboardTopRef = useRef<number | null>(null);
  const operationTokenRef = useRef(0);
  const mutationGateRef = useRef<{ presentationId: number; token: number } | null>(null);
  const handledDismissRequestIdRef = useRef<number | null>(null);
  const [overlayGeometry, setOverlayGeometry] = useState<HistoricalSuggestionsOverlayGeometry | null>(null);
  const [overlayRenderState, setOverlayRenderState] =
    useState<HistoricalSuggestionsOverlayRenderState | null>(null);
  const [overlayUpdateVisibilityDropCount, setOverlayUpdateVisibilityDropCount] =
    useState(0);
  const [telemetryBaseRect, setTelemetryBaseRect] = useState<MeasuredRect | null>(null);
  const [telemetrySheetRect, setTelemetrySheetRect] = useState<MeasuredRect | null>(null);
  const [telemetryDescriptionRect, setTelemetryDescriptionRect] = useState<MeasuredRect | null>(null);
  const [telemetryOverlayBottomBoundary, setTelemetryOverlayBottomBoundary] = useState<number | null>(null);
  const [telemetryOverlayTopBoundary, setTelemetryOverlayTopBoundary] = useState<number | null>(null);
  const [focusCommandCount, setFocusCommandCount] = useState(0);
  const [inputFocusCount, setInputFocusCount] = useState(0);
  const [presentedCallbackCount, setPresentedCallbackCount] = useState(0);
  const [dismissedCallbackCount, setDismissedCallbackCount] = useState(0);
  const [staleCallbackCount, setStaleCallbackCount] = useState(0);
  const [interactiveKeyboardFrameCount, setInteractiveKeyboardFrameCount] = useState(0);
  const [swipeStartedCount, setSwipeStartedCount] = useState(0);
  const [swipeCancelledCount, setSwipeCancelledCount] = useState(0);
  const [lastSwipeStartedPresentationId, setLastSwipeStartedPresentationId] =
    useState<number | null>(null);
  const [lastSwipeCancelledPresentationId, setLastSwipeCancelledPresentationId] =
    useState<number | null>(null);
  const recordStaleCallback = useCallback(() => {
    setStaleCallbackCount((count) => count + 1);
  }, []);
  const invalidateNativeKeyboardSession = useCallback(() => {
    keyboardSessionSequenceRef.current += 1;
    activeKeyboardSessionTokenRef.current = null;
  }, []);
  const beginNativeKeyboardSession = useCallback(() => {
    if (
      appActivityRef.current !== "active" ||
      sheetStateRef.current.sheetPhase !== "presented"
    ) {
      return null;
    }
    keyboardSessionSequenceRef.current += 1;
    const sessionToken = keyboardSessionSequenceRef.current;
    activeKeyboardSessionTokenRef.current = sessionToken;
    dispatchSheetEvent({
      type: "keyboard_focus_requested",
      presentationId: presentationRef.current.id,
      sessionToken
    });
    return sessionToken;
  }, []);
  const cancelPendingTagFocus = useCallback(() => {
    tagFocusRequestSequenceRef.current += 1;
    if (tagFocusFrameRef.current !== null) {
      cancelAnimationFrame(tagFocusFrameRef.current);
      tagFocusFrameRef.current = null;
    }
  }, []);
  if (currentEntry) {
    presentedEntryRef.current = currentEntry;
  } else if (!visible) {
    presentedEntryRef.current = null;
  }
  const entry = currentEntry ?? (visible ? presentedEntryRef.current : null);

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
  const editorSnapshot = useRef({
    categoryId: entryCategoryId,
    description: entryDescription,
    startedAt: entryStartedAt,
    stoppedAt: entryStoppedAt,
    tags: entryTags
  });
  editorSnapshot.current = {
    categoryId: entryCategoryId,
    description: entryDescription,
    startedAt: entryStartedAt,
    stoppedAt: entryStoppedAt,
    tags: entryTags
  };

  useLayoutEffect(() => {
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
    cancelPendingTagFocus();
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    scrollFrameSequenceRef.current += 1;
    if (!visible) {
      if (sheetStateRef.current.presentation?.id === presentation.id) {
        dispatchSheetEvent({ type: "externally_hidden", presentationId: presentation.id });
      }
      setOverlayGeometry(null);
      setTelemetryOverlayBottomBoundary(null);
      setTelemetryOverlayTopBoundary(null);
      return;
    }
    const modalAlreadyShown = Boolean(
      sheetStateRef.current.active && sheetStateRef.current.modalShown
    );
    // The Modal and TextInput can remain mounted while the caller advances to a
    // new presentation. Reset the native first responder before that generation
    // is allowed to honor its own explicit focus intent.
    descriptionInputRef.current?.blur();
    timeInputRef.current?.blur();
    Keyboard.dismiss();
    contentScrollRef.current?.scrollTo({ animated: false, y: 0 });
    contentScrollOffsetRef.current = { x: 0, y: 0 };
    pendingKeyboardUpdate.current = null;
    keyboardMotionFrozen.current = false;
    invalidateNativeKeyboardSession();
    keyboardInsetRef.current = 0;
    keyboardTopRef.current = null;
    startTimeFocused.current = false;
    keyboardFrameSequenceRef.current += 1;
    keyboardHeightAnimationTokenRef.current = null;
    keyboardLift.stopAnimation();
    keyboardLift.setValue(0);
    animatedSheetHeight.stopAnimation();
    setKeyboardInset(0);
    setSheetHeightAnimating(false);
    setOverlayGeometry(null);
    setOverlayRenderState(null);
    setTelemetryOverlayBottomBoundary(null);
    setTelemetryOverlayTopBoundary(null);
    geometryCacheRef.current = beginTimeEntrySheetGeometryPresentation(
      geometryCacheRef.current,
      presentation.id
    );
    if (mutationGateRef.current !== null) {
      mutationGateRef.current = null;
      dispatchMutationTelemetry({ type: "mutation_abandoned" });
      recordStaleCallback();
    }
    setFocusCommandCount(0);
    setInputFocusCount(0);
    setPresentedCallbackCount(0);
    setDismissedCallbackCount(0);
    setInteractiveKeyboardFrameCount(0);
    setTelemetryBaseRect(null);
    setTelemetrySheetRect(null);
    setTelemetryDescriptionRect(null);
    dispatchSheetEvent({ type: "open_requested", presentation, reduceMotion });
    if (modalAlreadyShown) {
      dispatchSheetEvent({ type: "modal_shown", presentationId: presentation.id });
    }
    dispatchSheetEvent({
      type: "focus_ownership_reset",
      presentationId: presentation.id
    });
  }, [
    invalidateNativeKeyboardSession,
    cancelPendingTagFocus,
    presentation.id,
    recordStaleCallback,
    visible
  ]);

  useEffect(() => {
    if (!visible) return;
    dispatchSheetEvent({
      type: "reduce_motion_changed",
      presentationId: presentation.id,
      reduceMotion
    });
  }, [presentation.id, reduceMotion, visible]);

  useLayoutEffect(() => {
    if (!visible) return;
    const snapshot = editorSnapshot.current;
    if (!snapshot.startedAt) return;
    const startedAt = new Date(snapshot.startedAt);
    const hydratedDescription = snapshot.description ?? "";
    setDescription(hydratedDescription);
    setSelectedTagNames(snapshot.tags.map((tag) => tag.name));
    setDescriptionSelection({
      start: hydratedDescription.length,
      end: hydratedDescription.length
    });
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
    setDatePickerTarget("start");
    setStartTimeEdited(false);
    setDatePickerOpen(false);
    setValidationError(null);
    setHashtagPanelMounted(false);
    hashtagPanelProgress.setValue(0);
  }, [hashtagPanelProgress, presentation.id, visible]);

  const normalizedHistoricalEntries = useMemo(
    () => historicalEntries.map((candidate) => ({
      ...candidate,
      tagNames: candidate.tagNames ?? candidate.tags?.map((tag) => tag.name) ?? []
    })),
    [historicalEntries]
  );
  const historicalSuggestions = useMemo(
    () => buildHistoricalEntrySuggestions(normalizedHistoricalEntries, {
      contextDate: entryStartedAt ?? undefined,
      currentEntryId: entry?.id ?? null,
      limit: HISTORICAL_SUGGESTION_LIMIT,
      query: description
    }),
    [description, entry?.id, entryStartedAt, normalizedHistoricalEntries]
  );
  const historicalSuggestionResultSignature = JSON.stringify(
    historicalSuggestions.map((suggestion) => [
      suggestion.key,
      suggestion.description,
      suggestion.categoryId,
      suggestion.categoryName,
      suggestion.categoryColor,
      suggestion.tagNames
    ])
  );

  useEffect(() => {
    if (!visible) return;
    dispatchSheetEvent({
      type: "suggestion_results_changed",
      presentationId: presentation.id,
      count: historicalSuggestions.length
    });
  }, [
    description,
    historicalSuggestionResultSignature,
    presentation.id,
    visible
  ]);

  const scheduleGeometryMeasurement = useCallback(() => {
    if (!visible) return;
    if (geometryFrameRef.current !== null) {
      cancelAnimationFrame(geometryFrameRef.current);
    }
    const measurementPresentationId = presentation.id;
    geometryFrameRef.current = requestAnimationFrame(() => {
      geometryFrameRef.current = null;
      if (presentationRef.current.id !== measurementPresentationId) {
        recordStaleCallback();
        return;
      }
      const rootLayout = sheetRootLayoutRef.current;
      const scrollViewportLayout = scrollViewportLayoutRef.current;
      const descriptionSectionLayout = descriptionSectionLayoutRef.current;
      const descriptionAnchorLayout = descriptionAnchorLayoutRef.current;
      if (
        !rootLayout ||
        !scrollViewportLayout ||
        !descriptionSectionLayout ||
        !descriptionAnchorLayout
      ) {
        return;
      }
      const localGeometry = resolveTimeEntrySheetLocalGeometry({
        contentOffset: contentScrollOffsetRef.current,
        descriptionAnchorRect: descriptionAnchorLayout,
        descriptionSectionRect: descriptionSectionLayout,
        rootSize: rootLayout,
        scrollViewportRect: scrollViewportLayout
      });
      if (!localGeometry) {
        return;
      }
      const cachedBaseRect = geometryCacheRef.current.baseSheetRect ?? localGeometry.sheetRect;
      geometryCacheRef.current = recordTimeEntrySheetGeometry(
        geometryCacheRef.current,
        {
          baseSheetRect: cachedBaseRect,
          descriptionRect: localGeometry.descriptionRect,
          presentationId: measurementPresentationId
        }
      );
      const nextOverlayGeometry = calculateHistoricalSuggestionsOverlayGeometry({
        descriptionRect: localGeometry.descriptionRect,
        desiredHeight: HISTORICAL_OVERLAY_MAX_HEIGHT,
        keyboardTop: localGeometry.overlayBottomBoundary,
        safeAreaBottom: 0,
        sheetRect: localGeometry.sheetRect,
        topBoundary: localGeometry.overlayTopBoundary
      });
      setTelemetryBaseRect(cachedBaseRect);
      setTelemetrySheetRect(localGeometry.sheetRect);
      setTelemetryDescriptionRect(localGeometry.descriptionRect);
      setTelemetryOverlayBottomBoundary(localGeometry.overlayBottomBoundary);
      setTelemetryOverlayTopBoundary(localGeometry.overlayTopBoundary);
      setOverlayGeometry(nextOverlayGeometry);
      dispatchSheetEvent({
        type: "description_anchor_ready",
        presentationId: measurementPresentationId
      });
    });
  }, [presentation.id, recordStaleCallback, visible]);

  const scheduleScrollToEnd = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameSequenceRef.current += 1;
    const token = {
      presentationId: presentation.id,
      sequence: scrollFrameSequenceRef.current
    };
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (
        !visible ||
        !isCurrentTimeEntrySheetFrameToken(
          token,
          presentationRef.current.id,
          scrollFrameSequenceRef.current
        )
      ) {
        recordStaleCallback();
        return;
      }
      contentScrollRef.current?.scrollToEnd({ animated: !reduceMotion });
    });
  }, [presentation.id, recordStaleCallback, reduceMotion, visible]);

  useEffect(() => () => {
    if (geometryFrameRef.current !== null) cancelAnimationFrame(geometryFrameRef.current);
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    if (tagFocusFrameRef.current !== null) cancelAnimationFrame(tagFocusFrameRef.current);
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameSequenceRef.current += 1;
  }, []);

  useEffect(() => {
    if (!visible || !descriptionInputRef.current) return;
    dispatchSheetEvent({
      type: "description_input_ready",
      presentationId: presentation.id
    });
    scheduleGeometryMeasurement();
  }, [presentation.id, scheduleGeometryMeasurement, visible]);

  useEffect(() => {
    if (!visible) return;
    const previousEnvironment = geometryEnvironmentRef.current;
    const nextEnvironment = {
      presentationId: presentation.id,
      windowHeight: windowDimensions.height,
      windowWidth: windowDimensions.width,
      fontScale: windowDimensions.fontScale,
      safeAreaBottom: insets.bottom,
      safeAreaTop: insets.top
    };
    const invalidationReason = previousEnvironment.presentationId !== presentation.id
      ? "presentation"
      : previousEnvironment.fontScale !== windowDimensions.fontScale
        ? "dynamic_type"
        : previousEnvironment.safeAreaBottom !== insets.bottom ||
            previousEnvironment.safeAreaTop !== insets.top
          ? "safe_area"
          : "window";
    geometryEnvironmentRef.current = nextEnvironment;
    geometryCacheRef.current = invalidateTimeEntrySheetGeometry(
      geometryCacheRef.current,
      presentation.id,
      invalidationReason
    );
    dispatchSheetEvent({
      type: "base_geometry_invalidated",
      presentationId: presentation.id
    });
    setOverlayGeometry(null);
    setTelemetryBaseRect(null);
    setTelemetrySheetRect(null);
    setTelemetryDescriptionRect(null);
    setTelemetryOverlayBottomBoundary(null);
    setTelemetryOverlayTopBoundary(null);
    scheduleGeometryMeasurement();
  }, [
    insets.bottom,
    insets.top,
    presentation.id,
    scheduleGeometryMeasurement,
    visible,
    windowDimensions.fontScale,
    windowDimensions.height,
    windowDimensions.width
  ]);

  useEffect(() => {
    if (!visible) return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      const type = nextState === "active" ? "app_foregrounded" : "app_backgrounded";
      appActivityRef.current = type === "app_foregrounded" ? "active" : "background";
      // App transitions invalidate native keyboard ownership synchronously.
      // UIKit may emit delayed restoration frames after the reducer has already
      // cleared its keyboard state; those frames must not acquire a new session.
      invalidateNativeKeyboardSession();
      cancelPendingTagFocus();
      pendingKeyboardUpdate.current = null;
      keyboardMotionFrozen.current = false;
      keyboardInsetRef.current = 0;
      keyboardTopRef.current = null;
      startTimeFocused.current = false;
      keyboardFrameSequenceRef.current += 1;
      keyboardHeightAnimationTokenRef.current = null;
      keyboardLift.stopAnimation();
      keyboardLift.setValue(0);
      animatedSheetHeight.stopAnimation();
      setKeyboardInset(0);
      setSheetHeightAnimating(false);
      dispatchSheetEvent({ type, presentationId: presentation.id });
      if (type === "app_backgrounded") {
        descriptionInputRef.current?.blur();
        timeInputRef.current?.blur();
        endTimeInputRef.current?.blur();
        Keyboard.dismiss();
      } else {
        scheduleGeometryMeasurement();
      }
    });
    return () => subscription.remove();
  }, [
    animatedSheetHeight,
    cancelPendingTagFocus,
    invalidateNativeKeyboardSession,
    keyboardLift,
    presentation.id,
    scheduleGeometryMeasurement,
    visible
  ]);

  useEffect(() => {
    if (!visible) {
      keyboardMotionFrozen.current = false;
      pendingKeyboardUpdate.current = null;
      invalidateNativeKeyboardSession();
      setKeyboardInset(0);
      keyboardInsetRef.current = 0;
      keyboardTopRef.current = null;
      keyboardFrameSequenceRef.current += 1;
      keyboardHeightAnimationTokenRef.current = null;
      setSheetHeightAnimating(false);
      keyboardLift.setValue(0);
      hashtagPanelProgress.setValue(0);
      setHashtagPanelMounted(false);
      return undefined;
    }

    function animateKeyboardLayout(
      toValue: number,
      targetHeight: number | null,
      event?: KeyboardEvent
    ) {
      const completionToken = {
        presentationId: presentation.id,
        sequence: keyboardFrameSequenceRef.current
      } satisfies KeyboardHeightAnimationToken;
      keyboardHeightAnimationTokenRef.current = completionToken;
      keyboardLift.stopAnimation();
      animatedSheetHeight.stopAnimation();
      if (reduceMotion) {
        keyboardLift.setValue(toValue);
        if (targetHeight !== null) animatedSheetHeight.setValue(targetHeight);
        keyboardHeightAnimationTokenRef.current = null;
        setSheetHeightAnimating(false);
        return;
      }
      const duration = keyboardLiftAnimationDuration({
        eventDuration: event?.duration,
        platform: Platform.OS
      });
      if (duration === null) {
        keyboardLift.setValue(toValue);
        if (targetHeight !== null) animatedSheetHeight.setValue(targetHeight);
        keyboardHeightAnimationTokenRef.current = null;
        setSheetHeightAnimating(false);
        return;
      }
      const animations = [
        Animated.timing(keyboardLift, {
          toValue,
          duration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false
        })
      ];
      if (targetHeight !== null) {
        const currentHeight = measuredSheetHeight.current || targetHeight;
        animatedSheetHeight.setValue(currentHeight);
        setSheetHeightAnimating(true);
        animations.push(Animated.timing(animatedSheetHeight, {
          toValue: targetHeight,
          duration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false
        }));
      }
      Animated.parallel(animations).start(({ finished }) => {
        const completion = classifyKeyboardHeightAnimationCompletion({
          completionToken,
          currentPresentationId: presentationRef.current.id,
          currentSequence: keyboardFrameSequenceRef.current,
          currentToken: keyboardHeightAnimationTokenRef.current,
          finished
        });
        if (completion === "stale") {
          recordStaleCallback();
          return;
        }
        if (completion !== "accepted") return;
        keyboardHeightAnimationTokenRef.current = null;
        setSheetHeightAnimating(false);
      });
    }

    function applyKeyboardUpdateForSession(
      nextInset: number,
      event: KeyboardEvent | undefined,
      sessionToken: number,
      terminal = false
    ) {
      if (
        appActivityRef.current !== "active" ||
        (!terminal && activeKeyboardSessionTokenRef.current !== sessionToken)
      ) {
        return;
      }
      const nextLayout = editSheetKeyboardLayout({
        bottomInset: insets.bottom,
        keyboardInset: nextInset,
        topInset: insets.top,
        windowHeight: windowDimensions.height
      });
      const opening = nextInset > 0;
      if (opening && keyboardInsetRef.current === 0 && measuredSheetHeight.current > 0) {
        closedSheetHeight.current = measuredSheetHeight.current;
      }
      keyboardInsetRef.current = nextInset;
      setKeyboardInset(nextInset);
      const targetHeight = opening
        ? nextLayout.sheetHeight
        : closedSheetHeight.current || null;
      animateKeyboardLayout(nextLayout.bottomLift, targetHeight, event);
      if (startTimeFocused.current) {
        scheduleScrollToEnd();
      }
    }
    applyKeyboardUpdateRef.current = applyKeyboardUpdateForSession;

    function queueOrApplyKeyboardUpdate(
      nextInset: number,
      event: KeyboardEvent | undefined,
      sessionToken: number
    ) {
      if (keyboardMotionFrozen.current) {
        pendingKeyboardUpdate.current = { event, inset: nextInset, sessionToken };
        return;
      }
      applyKeyboardUpdateForSession(nextInset, event, sessionToken, nextInset === 0);
    }

    function updateKeyboardInset(event: KeyboardEvent) {
      const sessionToken = activeKeyboardSessionTokenRef.current;
      if (appActivityRef.current !== "active" || sessionToken === null) return;
      Keyboard.scheduleLayoutAnimation(event);
      const windowHeight = Dimensions.get("window").height;
      const screenHeight = Dimensions.get("screen").height;
      const nextInset = keyboardInsetFromScreenY({
        keyboardScreenY: event.endCoordinates.screenY,
        screenHeight,
        windowHeight
      });
      const previousInset = keyboardInsetRef.current;
      const interactive = Boolean(
        Platform.OS === "ios" &&
        previousInset > 0 &&
        nextInset > 0 &&
        nextInset < previousInset
      );
      if (
        interactive &&
        nextInset < previousInset
      ) {
        setInteractiveKeyboardFrameCount((count) => count + 1);
      }
      keyboardTopRef.current = event.endCoordinates.screenY;
      keyboardFrameSequenceRef.current += 1;
      dispatchSheetEvent({
        type: "keyboard_frame_changed",
        presentationId: presentation.id,
        frame: {
          inset: nextInset,
          sequence: keyboardFrameSequenceRef.current
        },
        interactive,
        sessionToken
      });
      queueOrApplyKeyboardUpdate(nextInset, event, sessionToken);
      scheduleGeometryMeasurement();
    }

    const changeSubscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
      updateKeyboardInset
    );
    const hideSubscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      (event) => {
        const sessionToken = activeKeyboardSessionTokenRef.current;
        if (appActivityRef.current !== "active" || sessionToken === null) return;
        Keyboard.scheduleLayoutAnimation(event);
        keyboardTopRef.current = null;
        keyboardFrameSequenceRef.current += 1;
        dispatchSheetEvent({
          type: "keyboard_hidden",
          presentationId: presentation.id,
          sessionToken
        });
        queueOrApplyKeyboardUpdate(0, event, sessionToken);
        activeKeyboardSessionTokenRef.current = null;
        scheduleGeometryMeasurement();
      }
    );

    return () => {
      changeSubscription.remove();
      hideSubscription.remove();
    };
  }, [
    hashtagPanelProgress,
    insets.bottom,
    insets.top,
    invalidateNativeKeyboardSession,
    keyboardLift,
    presentation.id,
    recordStaleCallback,
    reduceMotion,
    scheduleGeometryMeasurement,
    scheduleScrollToEnd,
    visible,
    windowDimensions.height
  ]);

  function freezeKeyboardMotion(gesturePresentationId: number) {
    if (gesturePresentationId !== presentationRef.current.id) {
      recordStaleCallback();
      return;
    }
    if (mutationGateRef.current !== null) return;
    keyboardMotionFrozen.current = true;
    keyboardFrameSequenceRef.current += 1;
    keyboardHeightAnimationTokenRef.current = null;
    keyboardLift.stopAnimation();
    animatedSheetHeight.stopAnimation();
    setSwipeStartedCount((count) => count + 1);
    setLastSwipeStartedPresentationId(gesturePresentationId);
    dispatchSheetEvent({ type: "swipe_started", presentationId: gesturePresentationId });
  }

  function releaseKeyboardMotion(gesturePresentationId: number) {
    if (gesturePresentationId !== presentationRef.current.id) {
      recordStaleCallback();
      return;
    }
    if (!keyboardMotionFrozen.current) return;
    keyboardMotionFrozen.current = false;
    const pending = pendingKeyboardUpdate.current;
    pendingKeyboardUpdate.current = null;
    // A swipe can cancel the Animated.parallel completion before a new native
    // keyboard frame arrives. Always start a fresh generation toward the last
    // authoritative inset so sheetHeightAnimating reaches a terminal state.
    const sessionToken = pending?.sessionToken ?? activeKeyboardSessionTokenRef.current;
    if (sessionToken !== null) {
      applyKeyboardUpdateRef.current(
        pending?.inset ?? keyboardInsetRef.current,
        pending?.event,
        sessionToken,
        pending?.inset === 0
      );
    }
    setSwipeCancelledCount((count) => count + 1);
    setLastSwipeCancelledPresentationId(gesturePresentationId);
    dispatchSheetEvent({ type: "swipe_cancelled", presentationId: gesturePresentationId });
  }

  function commitSheetDismissal(committedPresentationId: number) {
    if (committedPresentationId !== presentationRef.current.id) {
      recordStaleCallback();
      return false;
    }
    if (mutationGateRef.current !== null) return false;
    cancelPendingTagFocus();
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
    keyboardMotionFrozen.current = true;
    invalidateNativeKeyboardSession();
    keyboardFrameSequenceRef.current += 1;
    keyboardHeightAnimationTokenRef.current = null;
    keyboardLift.stopAnimation();
    animatedSheetHeight.stopAnimation();
    pendingKeyboardUpdate.current = null;
    dispatchSheetEvent({
      type: "dismiss_committed",
      presentationId: committedPresentationId
    });
    Keyboard.dismiss();
    return true;
  }

  const pendingFocusPresentationId = pendingDescriptionFocusPresentationId(sheetState);
  useEffect(() => {
    if (pendingFocusPresentationId === null) return;
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    const focusPresentationId = pendingFocusPresentationId;
    // RN needs one native frame after both Modal and the custom sheet report
    // presentation so the mounted TextInput can become first responder.
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      if (
        presentationRef.current.id !== focusPresentationId ||
        pendingDescriptionFocusPresentationId(sheetStateRef.current) !== focusPresentationId
      ) {
        recordStaleCallback();
        return;
      }
      dispatchSheetEvent({
        type: "description_focus_effect_started",
        presentationId: focusPresentationId
      });
      setFocusCommandCount((count) => count + 1);
      if (presentationRef.current.reason === "blank_timer_started") {
        setDescriptionSelection({ start: 0, end: 0 });
      }
      descriptionInputRef.current?.focus();
    });
    return () => {
      if (focusFrameRef.current !== null) {
        cancelAnimationFrame(focusFrameRef.current);
        focusFrameRef.current = null;
      }
    };
  }, [pendingFocusPresentationId, recordStaleCallback]);

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
      return normalizeNewTagName(activeHashtag.query).name;
    } catch {
      return null;
    }
  }, [activeHashtag, exactTagMatch]);
  const hashtagPanelVisible = sheetState.descriptionFocused && Boolean(activeHashtag);
  const selectedNormalizedTagNames = useMemo(
    () => new Set(selectedTagNames.map((name) => normalizeTagName(name).normalizedName)),
    [selectedTagNames]
  );
  const appliedTagNames = selectedTagNames;

  useEffect(() => {
    if (!visible) return;
    dispatchSheetEvent({
      type: "hashtag_query_changed",
      presentationId: presentation.id,
      active: Boolean(activeHashtag)
    });
  }, [activeHashtag, presentation.id, visible]);

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
  const overlapWarning = useMemo(() => {
    if (!entry || !parsedStart.date || (hasStoppedTime && !parsedStop.date)) return null;
    const candidateId = "__mobile_overlap_candidate__";
    return analyzeTimeIntervals(
      [
        ...peerEntries
          .filter((candidate) => candidate.id !== entry.id)
          .map((candidate) => ({
            id: candidate.id,
            startedAt: candidate.startedAt,
            stoppedAt: candidate.stoppedAt
          })),
        {
          id: candidateId,
          startedAt: parsedStart.date,
          stoppedAt: hasStoppedTime ? parsedStop.date : null
        }
      ],
      { now: new Date() }
    ).entries.find((candidate) => candidate.id === candidateId) ?? null;
  }, [entry, hasStoppedTime, parsedStart.date, parsedStop.date, peerEntries]);
  const overlapPeers = useMemo(() => {
    if (!overlapWarning) return [];
    const peerById = new Map(peerEntries.map((candidate) => [candidate.id, candidate]));
    return overlapWarning.overlappingEntryIds
      .map((id) => peerById.get(id))
      .filter((candidate): candidate is MobileTimeEntry => Boolean(candidate))
      .slice(0, 2);
  }, [overlapWarning, peerEntries]);

  const busy = saving || stopping || deleting || sheetState.mutationPhase !== "idle";
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
  const keyboardAwareSheetStyle = sheetHeightAnimating
    ? {
        height: animatedSheetHeight,
        maxHeight: keyboardLayout.sheetMaxHeight
      }
    : keyboardLayout.keyboardOpen
    ? {
        height: keyboardLayout.sheetHeight ?? undefined,
        maxHeight: keyboardLayout.sheetHeight ?? keyboardLayout.sheetMaxHeight
      }
    : { maxHeight: keyboardLayout.sheetMaxHeight };
  const pendingCallerDismissRequestId = pendingTimeEntrySheetDismissRequestId({
    dismissRequestId,
    handledDismissRequestId: handledDismissRequestIdRef.current,
    state: sheetState,
    visible
  });
  useEffect(() => {
    if (pendingCallerDismissRequestId === null) return;
    handledDismissRequestIdRef.current = pendingCallerDismissRequestId;
    requestCoordinatedDismiss();
  }, [pendingCallerDismissRequestId]);
  const suggestionsExpectedForReady = Boolean(
    presentation.allowSuggestionsOnFocus &&
    sheetState.sheetPhase === "presented" &&
    sheetState.appState === "active" &&
    sheetState.descriptionFocused &&
    sheetState.surface === "form" &&
    !sheetState.hashtagQueryActive &&
    !sheetState.suggestionsSuppressed &&
    historicalSuggestions.length > 0
  );
  const overlayMeasuredForCurrentContent = Boolean(
    overlayRenderState?.presentationId === presentation.id &&
    overlayRenderState.contentKey === historicalSuggestionResultSignature &&
    overlayRenderState.suggestionCount === historicalSuggestions.length
  );
  const suggestionsAreVisiblyRenderable = Boolean(
    sheetState.suggestionsPhase === "visible" &&
    overlayGeometry &&
    overlayGeometry.maxHeight > 0 &&
    overlayMeasuredForCurrentContent &&
    overlayRenderState?.contentMeasured &&
    overlayRenderState.containerVisible &&
    overlayRenderState.renderedHeight > 0
  );
  const visualStateReady = timeEntrySheetVisualReadiness({
    baseSheetRect: telemetryBaseRect,
    descriptionFocused: sheetState.descriptionFocused,
    descriptionRect: telemetryDescriptionRect,
    keyboardInset,
    keyboardPhase: sheetState.keyboardPhase,
    overlayContainerVisible: Boolean(
      overlayMeasuredForCurrentContent && overlayRenderState?.containerVisible
    ),
    overlayContentMeasured: Boolean(
      overlayMeasuredForCurrentContent && overlayRenderState?.contentMeasured
    ),
    overlayGeometry,
    overlayRenderedHeight: overlayMeasuredForCurrentContent
      ? overlayRenderState?.renderedHeight ?? 0
      : 0,
    sheetHeightAnimating,
    sheetRect: telemetrySheetRect,
    suggestionsExpected: suggestionsExpectedForReady,
    suggestionsPhase: sheetState.suggestionsPhase
  });
  const suggestionsObscureFormAccessibility =
    historicalSuggestionsObscureFormAccessibility(
      sheetState,
      Boolean(overlayGeometry && overlayGeometry.maxHeight > 0)
    );
  const presentationInteractionReady = Boolean(
    sheetState.sheetPhase === "presented" && sheetState.appState === "active"
  );
  const qaReady = Boolean(
    sheetState.sheetPhase === "presented" &&
    sheetState.modalShown &&
    sheetState.sheetPresented &&
    sheetState.inputReady &&
    sheetState.anchorReady &&
    sheetState.focusOwnershipReady &&
    (!presentation.requestDescriptionFocus || (
      sheetState.focusCommandConsumed && sheetState.focusConfirmed
    )) &&
    visualStateReady
  );
  const qaStateJson = JSON.stringify({
    presentationId: presentation.id,
    reason: presentation.reason,
    sheetPhase: sheetState.sheetPhase,
    keyboardPhase: sheetState.keyboardPhase,
    keyboardSessionToken: sheetState.keyboardSessionToken,
    suggestionsPhase: sheetState.suggestionsPhase,
    suggestionsAreVisiblyRenderable,
    focusOwnershipReady: sheetState.focusOwnershipReady,
    focusCommandCount,
    inputFocusCount,
    interactiveKeyboardFrameCount,
    swipeStartedCount,
    swipeCancelledCount,
    lastSwipeStartedPresentationId,
    lastSwipeCancelledPresentationId,
    swipePhase: sheetState.swipePhase,
    presentedCallbackCount,
    dismissedCallbackCount,
    dismissRequestId,
    handledDismissRequestId: handledDismissRequestIdRef.current,
    reduceMotion,
    ready: qaReady,
    keyboardInset,
    keyboardTop: keyboardTopRef.current,
    keyboardTopLocal: keyboardLayout.keyboardOpen ? telemetryOverlayBottomBoundary : null,
    geometryCoordinateSpace: "sheet_local",
    baseSheetRect: telemetryBaseRect,
    sheetRect: telemetrySheetRect,
    descriptionRect: telemetryDescriptionRect,
    overlayGeometry,
    overlayBottomBoundary: telemetryOverlayBottomBoundary,
    overlayTopBoundary: telemetryOverlayTopBoundary,
    overlayContainerVisible: Boolean(
      overlayMeasuredForCurrentContent && overlayRenderState?.containerVisible
    ),
    overlayContentHeight: overlayMeasuredForCurrentContent
      ? overlayRenderState?.contentHeight ?? 0
      : 0,
    overlayContentKeyMatches: overlayMeasuredForCurrentContent,
    overlayContentMeasured: Boolean(
      overlayMeasuredForCurrentContent && overlayRenderState?.contentMeasured
    ),
    overlayHeaderHeight: overlayMeasuredForCurrentContent
      ? overlayRenderState?.headerHeight ?? 0
      : 0,
    overlayMeasuredSuggestionCount: overlayMeasuredForCurrentContent
      ? overlayRenderState?.suggestionCount ?? 0
      : 0,
    overlayRenderedHeight: overlayMeasuredForCurrentContent
      ? overlayRenderState?.renderedHeight ?? 0
      : 0,
    overlaySuggestionCount: historicalSuggestions.length,
    overlayUpdatePending: Boolean(
      overlayMeasuredForCurrentContent && overlayRenderState?.updatePending
    ),
    overlayUpdateVisibilityDropCount,
    obscuredFormAccessibilityHidden: suggestionsObscureFormAccessibility,
    activeMutationToken: mutationTelemetry.activeMutationToken,
    duplicateMutationCount: mutationTelemetry.duplicateMutationCount,
    lastMutationToken: mutationTelemetry.lastMutationToken,
    mutationAttemptCount: mutationTelemetry.mutationAttemptCount,
    mutationCompletionRejectedCount: mutationTelemetry.mutationCompletionRejectedCount,
    mutationFinishedCount: mutationTelemetry.mutationFinishedCount,
    mutationRejectedCount: mutationTelemetry.mutationRejectedCount,
    mutationStartedCount: mutationTelemetry.mutationStartedCount,
    staleCallbackCount
  });
  if (!entry) return null;

  function fallbackStartAt() {
    if (entry) return new Date(entry.startedAt);
    return parsedStart.date ?? new Date();
  }

  function beginMutation(
    mutation: Exclude<TimeEntrySheetMutationPhase, "idle">
  ): number | null {
    const duplicate = Boolean(
      saving || stopping || deleting ||
      mutationGateRef.current !== null ||
      sheetStateRef.current.mutationPhase !== "idle"
    );
    const swipeOwnsSheet = Boolean(
      keyboardMotionFrozen.current || sheetStateRef.current.swipePhase !== "idle"
    );
    if (
      duplicate ||
      swipeOwnsSheet ||
      sheetStateRef.current.sheetPhase !== "presented"
    ) {
      dispatchMutationTelemetry({
        type: "mutation_rejected",
        duplicate
      });
      return null;
    }
    operationTokenRef.current += 1;
    const token = operationTokenRef.current;
    mutationGateRef.current = { presentationId: presentation.id, token };
    dispatchMutationTelemetry({
      type: "mutation_started",
      operationToken: token
    });
    dispatchSheetEvent({
      type: "mutation_started",
      presentationId: presentation.id,
      mutation,
      operationToken: token
    });
    return token;
  }

  function finishMutation(token: number, outcome: "succeeded" | "failed") {
    const gate = mutationGateRef.current;
    if (!gate || gate.presentationId !== presentationRef.current.id || gate.token !== token) {
      dispatchMutationTelemetry({ type: "mutation_completion_rejected" });
      recordStaleCallback();
      return false;
    }
    mutationGateRef.current = null;
    dispatchMutationTelemetry({
      type: "mutation_finished",
      operationToken: token
    });
    dispatchSheetEvent({
      type: "mutation_finished",
      presentationId: gate.presentationId,
      operationToken: token,
      outcome
    });
    return true;
  }

  async function resolveMutation(action: () => Promise<boolean>) {
    try {
      return Boolean(await action());
    } catch {
      return false;
    }
  }

  function requestCoordinatedDismiss() {
    const presentationId = presentationRef.current.id;
    cancelPendingTagFocus();
    dispatchSheetEvent({ type: "dismiss_requested", presentationId });
    sheetRef.current?.dismiss();
  }

  function handleUserRequestClose() {
    if (datePickerOpen) {
      setDatePickerOpen(false);
      dispatchSheetEvent({
        type: "date_picker_closed",
        presentationId: presentationRef.current.id
      });
      return;
    }
    if (busy) return;
    requestCoordinatedDismiss();
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

    const token = beginMutation("saving");
    if (token === null) return;
    setValidationError(null);
    const ok = await resolveMutation(() => onSave(entry.id, patch));
    const accepted = finishMutation(token, ok ? "succeeded" : "failed");
    if (accepted && ok) requestCoordinatedDismiss();
  }

  async function stopFromSheet() {
    if (busy || !onStop) return;
    const token = beginMutation("stopping");
    if (token === null) return;
    const ok = await resolveMutation(onStop);
    const accepted = finishMutation(token, ok ? "succeeded" : "failed");
    if (accepted && ok) requestCoordinatedDismiss();
  }

  async function applyHistoricalSuggestion(suggestion: RecentActivitySuggestion) {
    if (busy || !entry) return;
    const patch = historicalSuggestionPatch(suggestion);
    const previousDescription = description;
    const previousCategoryId = selectedCategoryId;
    const previousTagNames = [...selectedTagNames];
    const previousSelection = descriptionSelection;
    const requiresPersistence = isRunningMode && Boolean(onApplySuggestion);
    const token = requiresPersistence ? beginMutation("saving") : null;
    if (requiresPersistence && token === null) return;
    dispatchSheetEvent({ type: "suggestion_selected", presentationId: presentation.id });
    setDescription(patch.description);
    setDescriptionSelection({ start: patch.description.length, end: patch.description.length });
    setSelectedCategoryId(patch.categoryId);
    setSelectedTagNames(patch.tagNames);
    setValidationError(null);
    if (!requiresPersistence || !onApplySuggestion || token === null) {
      AccessibilityInfo.announceForAccessibility(
        historicalSuggestionAppliedAnnouncement(suggestion)
      );
      return;
    }
    const ok = await resolveMutation(() => onApplySuggestion(entry.id, suggestion));
    const accepted = finishMutation(token, ok ? "succeeded" : "failed");
    if (accepted && ok) {
      AccessibilityInfo.announceForAccessibility(
        historicalSuggestionAppliedAnnouncement(suggestion)
      );
    } else if (accepted) {
      setDescription(previousDescription);
      setDescriptionSelection(previousSelection);
      setSelectedCategoryId(previousCategoryId);
      setSelectedTagNames(previousTagNames);
      dispatchSheetEvent({
        type: "suggestion_selection_failed",
        presentationId: presentation.id
      });
      AccessibilityInfo.announceForAccessibility(
        HISTORICAL_SUGGESTION_ROLLBACK_ANNOUNCEMENT
      );
    }
  }

  async function deleteEntryFromSheet() {
    if (busy || !entry || !onDelete) return;
    const token = beginMutation("deleting");
    if (token === null) return;
    Keyboard.dismiss();
    const ok = await resolveMutation(() => onDelete(entry.id));
    const accepted = finishMutation(token, ok ? "succeeded" : "failed");
    if (accepted && ok) requestCoordinatedDismiss();
  }

  function useLastStopTime() {
    if (!lastStoppedAt) return;
    const stoppedAt = new Date(lastStoppedAt);
    setDateText(formatDateInput(stoppedAt));
    setTimeText(formatTimeInput(stoppedAt));
    setPickerStartAt(stoppedAt);
    if (!hasStoppedTime) setStartTimeEdited(true);
    setDatePickerOpen(false);
    dispatchSheetEvent({ type: "date_picker_closed", presentationId: presentation.id });
    setValidationError(null);
  }

  function updateTimeText(value: string) {
    if (!hasStoppedTime) setStartTimeEdited(true);
    setTimeText(formatEditableTime(value));
    setValidationError(null);
  }

  function focusDescriptionField() {
    if (!sheetStateRef.current.focusOwnershipReady) {
      descriptionInputRef.current?.blur();
      Keyboard.dismiss();
      return;
    }
    if (beginNativeKeyboardSession() === null) {
      descriptionInputRef.current?.blur();
      Keyboard.dismiss();
      return;
    }
    setDatePickerOpen(false);
    setInputFocusCount((count) => count + 1);
    dispatchSheetEvent({ type: "date_picker_closed", presentationId: presentation.id });
    dispatchSheetEvent({ type: "description_focused", presentationId: presentation.id });
    scheduleGeometryMeasurement();
  }

  function focusDescriptionAfterTagUpdate() {
    cancelPendingTagFocus();
    const tagPresentationId = presentation.id;
    const tagFocusRequestSequence = tagFocusRequestSequenceRef.current;
    tagFocusFrameRef.current = requestAnimationFrame(() => {
      tagFocusFrameRef.current = null;
      const classification = classifyTimeEntrySheetDeferredFocus({
        currentPresentationId: presentationRef.current.id,
        currentSequence: tagFocusRequestSequenceRef.current,
        requestPresentationId: tagPresentationId,
        requestSequence: tagFocusRequestSequence,
        state: sheetStateRef.current
      });
      if (classification === "stale") {
        recordStaleCallback();
        return;
      }
      if (classification !== "accepted" || mutationGateRef.current !== null) return;
      descriptionInputRef.current?.focus();
    });
  }

  function selectHashtag(tagName: string) {
    if (!activeHashtag) return;
    const normalized = normalizeTagName(tagName);
    const existing = tags.find((tag) => tag.normalizedName === normalized.normalizedName);
    if (selectedNormalizedTagNames.has(normalized.normalizedName)) {
      setSelectedTagNames((current) => current.filter(
        (name) => normalizeTagName(name).normalizedName !== normalized.normalizedName
      ));
    } else {
      setSelectedTagNames((current) => [...current, existing?.name ?? normalized.name]);
    }
    const replacement = consumeActiveHashtag(description, activeHashtag);
    setDescription(replacement.text);
    setDescriptionSelection({ start: replacement.caret, end: replacement.caret });
    dispatchSheetEvent({ type: "suggestion_selected", presentationId: presentation.id });
    setValidationError(null);
    focusDescriptionAfterTagUpdate();
  }

  function startTagEntry() {
    if (busy) return;
    setDatePickerOpen(false);
    dispatchSheetEvent({ type: "date_picker_closed", presentationId: presentation.id });
    const currentActive = findActiveHashtag(description, descriptionSelection.end);
    if (currentActive && descriptionSelection.start === descriptionSelection.end) {
      focusDescriptionAfterTagUpdate();
      return;
    }
    const next = insertHashtagStarter(description, descriptionSelection);
    setDescription(next.text);
    setDescriptionSelection({ start: next.caret, end: next.caret });
    setValidationError(null);
    focusDescriptionAfterTagUpdate();
  }

  function updateStoppedTimeText(value: string) {
    setStoppedTimeText(formatEditableTime(value));
    setValidationError(null);
  }

  function openStartPicker() {
    Keyboard.dismiss();
    dispatchSheetEvent({ type: "date_picker_requested", presentationId: presentation.id });
    const currentStart = parsedStart.date ?? fallbackStartAt();
    setDatePickerTarget("start");
    setPickerStartAt(currentStart);
    setDatePickerOpen(true);
    setValidationError(null);
  }

  function openEndPicker() {
    Keyboard.dismiss();
    dispatchSheetEvent({ type: "date_picker_requested", presentationId: presentation.id });
    const currentEnd = parsedStop.date ?? parsedStart.date ?? fallbackStartAt();
    setDatePickerTarget("end");
    setPickerStartAt(currentEnd);
    setDatePickerOpen(true);
    setValidationError(null);
  }

  function selectDate(date: Date) {
    if (datePickerTarget === "end") {
      const parsed = parseLocalDateTime(formatDateInput(date), stoppedTimeText);
      if (parsed.error || !parsed.date) {
        setValidationError(parsed.error ?? "Choose a valid end date and time.");
        return;
      }
      if (parsed.date.getTime() > Date.now()) {
        setValidationError("End time cannot be in the future.");
        return;
      }
      setPickerStartAt(parsed.date);
      setStoppedDateText(formatDateInput(parsed.date));
      setDatePickerOpen(false);
      dispatchSheetEvent({ type: "date_picker_closed", presentationId: presentation.id });
      setValidationError(null);
      return;
    }

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
    dispatchSheetEvent({ type: "date_picker_closed", presentationId: presentation.id });
    setValidationError(null);
  }

  const displayedStartAt = previewStartAt ?? fallbackStartAt();
  const displayedEndAt = parsedStop.date ?? displayedStartAt;
  const pickerDate = pickerStartAt ?? (
    datePickerTarget === "end" ? displayedEndAt : displayedStartAt
  );
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

  function handleModalShow() {
    dispatchSheetEvent({
      type: "modal_shown",
      presentationId: presentationRef.current.id
    });
  }

  const timeEntryHero = (
    <View
      style={[
        styles.activeEditHeroRow,
        isRunningMode ? styles.activeEditPinnedHeroRow : null
      ]}
      testID="time-entry-sheet-hero"
    >
      <View style={styles.activeEditElapsedStack}>
        <Text style={styles.activeEditElapsed} testID="time-entry-sheet-elapsed">
          {elapsedText}
        </Text>
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
          testID="time-entry-sheet-stop"
        >
          <PrimaryTimerGlyph color={theme.onAccent} mode="stop" />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <>
      <Modal
      animationType="none"
      onRequestClose={handleUserRequestClose}
      onShow={handleModalShow}
      presentationStyle="overFullScreen"
      testID="time-entry-sheet-modal"
      transparent
      visible={visible}
    >
      <View style={styles.sheetOverlay}>
        <View pointerEvents="box-none" style={styles.sheetKeyboardAvoidingView}>
          <SafeAreaView edges={[]} pointerEvents="box-none" style={styles.sheetSafeArea}>
            <SwipeDismissSheet
              ref={sheetRef}
              accessibilityLabel={isRunningMode ? "Edit timer" : sheetTitle}
              backdropAccessibilityLabel={cancelLabel}
              backdropStyle={styles.sheetBackdrop}
              disabled={busy || datePickerOpen}
              handleStyle={styles.sheetHandle}
              onDismiss={(dismissedPresentationId) => {
                if (dismissedPresentationId !== presentationRef.current.id) {
                  recordStaleCallback();
                  return;
                }
                dispatchSheetEvent({
                  type: "sheet_exit_finished",
                  presentationId: dismissedPresentationId
                });
                setDismissedCallbackCount((count) => count + 1);
                onCancel(dismissedPresentationId);
              }}
              onDismissStart={commitSheetDismissal}
              onGestureSettled={releaseKeyboardMotion}
              onGestureStart={freezeKeyboardMotion}
              onPresented={(presentedPresentationId) => {
                if (presentedPresentationId !== presentationRef.current.id) {
                  recordStaleCallback();
                  return;
                }
                dispatchSheetEvent({
                  type: "sheet_presented",
                  presentationId: presentedPresentationId
                });
                setPresentedCallbackCount((count) => count + 1);
                onPresented?.(presentedPresentationId);
              }}
              onStaleCallback={recordStaleCallback}
              presentationId={presentation.id}
              reduceMotion={reduceMotion}
              style={[
                styles.activeEditSheet,
                keyboardAwareSheetStyle,
                { paddingBottom: Math.max(10, Math.min(16, insets.bottom)) }
              ]}
              onLayout={(event) => {
                measuredSheetHeight.current = event.nativeEvent.layout.height;
                if (!keyboardLayout.keyboardOpen && !sheetHeightAnimating) {
                  closedSheetHeight.current = event.nativeEvent.layout.height;
                }
                scheduleGeometryMeasurement();
              }}
              testID="time-entry-sheet"
              translateYOffset={Animated.multiply(keyboardLift, -1)}
              visible={visible}
            >
              <View
                accessibilityElementsHidden={!presentationInteractionReady}
                collapsable={false}
                importantForAccessibility={
                  presentationInteractionReady ? "auto" : "no-hide-descendants"
                }
                onLayout={(event) => {
                  const { height, width } = event.nativeEvent.layout;
                  sheetRootLayoutRef.current = { height, width, x: 0, y: 0 };
                  scheduleGeometryMeasurement();
                }}
                style={[
                  styles.activeEditBody,
                  keyboardLayout.keyboardOpen ? styles.activeEditBodyKeyboard : null
                ]}
                pointerEvents={presentationInteractionReady ? "auto" : "none"}
                testID="time-entry-sheet-content"
              >
              {showDoneButton ? (
                <View pointerEvents="box-none" style={styles.sheetTopActionLayer}>
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
                    testID="time-entry-sheet-done"
                  >
                    <Text style={styles.sheetDoneText}>Done</Text>
                  </Pressable>
                </View>
              ) : null}
              <View style={[
                styles.sheetHeader,
                showDoneButton ? styles.sheetHeaderWithTopAction : null
              ]}>
                {!isRunningMode ? <Text style={styles.sheetTitle}>{sheetTitle}</Text> : null}
              </View>

              {isRunningMode ? timeEntryHero : null}

              <ScrollView
                ref={contentScrollRef}
                contentContainerStyle={[
                  styles.activeEditContent,
                  keyboardLayout.keyboardOpen ? { paddingBottom: keyboardLayout.contentPaddingBottom } : null
                ]}
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                keyboardShouldPersistTaps="always"
                onLayout={(event) => {
                  const { height, width, x, y } = event.nativeEvent.layout;
                  scrollViewportLayoutRef.current = { height, width, x, y };
                  scheduleGeometryMeasurement();
                }}
                onScroll={(event) => {
                  const { x, y } = event.nativeEvent.contentOffset;
                  contentScrollOffsetRef.current = { x, y };
                  scheduleGeometryMeasurement();
                }}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                style={[
                  styles.activeEditScroller,
                  keyboardLayout.keyboardOpen ? styles.activeEditScrollerKeyboard : null
                ]}
                testID="time-entry-sheet-form"
              >
                {!isRunningMode ? timeEntryHero : null}

                <View style={[
                  styles.activeEditSection,
                  hashtagPanelMounted ? styles.activeEditTagSectionOpen : null
                ]} onLayout={(event) => {
                  const { height, width, x, y } = event.nativeEvent.layout;
                  descriptionSectionLayoutRef.current = { height, width, x, y };
                  scheduleGeometryMeasurement();
                }}>
                  <Text style={styles.activeEditSectionLabel}>Description</Text>
                  <View
                    collapsable={false}
                    onLayout={(event) => {
                      const { height, width, x, y } = event.nativeEvent.layout;
                      descriptionAnchorLayoutRef.current = { height, width, x, y };
                      scheduleGeometryMeasurement();
                    }}
                    style={styles.activeEditDescriptionField}
                    testID="time-entry-description-anchor"
                  >
                    <TextInput
                      ref={descriptionInputRef}
                      accessibilityHint="Type a hashtag to add optional tag context"
                      accessibilityLabel={isRunningMode ? "Timer description" : "Entry description"}
                      blurOnSubmit
                      editable={!busy}
                      onBlur={() => dispatchSheetEvent({
                        type: "description_blurred",
                        presentationId: presentation.id
                      })}
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
                        dispatchSheetEvent({
                          type: "description_query_changed",
                          presentationId: presentation.id
                        });
                        setValidationError(null);
                      }}
                      onSubmitEditing={Keyboard.dismiss}
                      placeholder={descriptionPlaceholder}
                      placeholderTextColor={theme.textSecondary}
                      returnKeyType="done"
                      showSoftInputOnFocus
                      testID="time-entry-description"
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
                              accessibilityLabel={`${selectedNormalizedTagNames.has(tag.normalizedName) ? "Remove selected" : "Existing"} tag, ${tag.name}`}
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
                  <View
                    accessibilityElementsHidden={suggestionsObscureFormAccessibility}
                    importantForAccessibility={
                      suggestionsObscureFormAccessibility ? "no-hide-descendants" : "auto"
                    }
                    style={styles.tagEditorFooter}
                    testID="time-entry-description-obscured-footer"
                  >
                    <Pressable
                      accessibilityHint="Focuses Description and starts tag entry"
                      accessibilityLabel="Add a tag"
                      accessibilityRole="button"
                      disabled={busy}
                      hitSlop={8}
                      onPress={startTagEntry}
                      style={({ pressed }) => [
                        styles.tagAddButton,
                        pressed && !busy ? styles.buttonPressed : null,
                        busy ? styles.buttonDisabled : null
                      ]}
                    >
                      <Text style={styles.tagAddButtonText}>Add a tag</Text>
                    </Pressable>
                    {appliedTagNames.length > 0 ? (
                      <TagMetadata
                        active
                        onPressTag={(tagName) => {
                          const normalizedName = normalizeTagName(tagName).normalizedName;
                          setSelectedTagNames((current) => current.filter(
                            (name) => normalizeTagName(name).normalizedName !== normalizedName
                          ));
                          setValidationError(null);
                        }}
                        styles={styles}
                        tagNames={appliedTagNames}
                        theme={theme}
                      />
                    ) : null}
                  </View>
                </View>

                <View
                  accessibilityElementsHidden={suggestionsObscureFormAccessibility}
                  importantForAccessibility={
                    suggestionsObscureFormAccessibility ? "no-hide-descendants" : "auto"
                  }
                  style={styles.activeEditObscuredContent}
                  testID="time-entry-sheet-obscured-form-content"
                >
                <View style={styles.activeEditSection}>
                  <Text style={styles.activeEditSectionLabel}>Category</Text>
                  <View style={styles.activeEditCategoryViewport}>
                    <ScrollView
                      alwaysBounceVertical={false}
                      bounces={false}
                      contentContainerStyle={styles.activeEditCategoryScroller}
                      directionalLockEnabled
                      horizontal
                      keyboardShouldPersistTaps="always"
                      nestedScrollEnabled
                      showsHorizontalScrollIndicator={false}
                      showsVerticalScrollIndicator={false}
                      style={styles.activeEditCategoryScroll}
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
                </View>

                <View style={styles.activeEditSection}>
                  <Text style={styles.activeEditSectionLabel}>Start time</Text>
                  <View style={styles.activeEditTimeRow}>
                    <Pressable
                      accessibilityLabel="Edit start date"
                      accessibilityRole="button"
                      onPress={openStartPicker}
                      style={pressable(styles.activeEditStartSummary, styles.buttonPressed)}
                      testID="time-entry-start-date"
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
                        if (beginNativeKeyboardSession() === null) {
                          timeInputRef.current?.blur();
                          Keyboard.dismiss();
                          return;
                        }
                        startTimeFocused.current = true;
                        setDatePickerOpen(false);
                        scheduleScrollToEnd();
                      }}
                      onBlur={() => {
                        startTimeFocused.current = false;
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
                      testID="time-entry-start-time"
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
                      <Pressable
                        accessibilityLabel="End date"
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={openEndPicker}
                        style={({ pressed }) => [
                          styles.activeEditStartSummary,
                          pressed && !busy ? styles.buttonPressed : null,
                          busy ? styles.buttonDisabled : null
                        ]}
                        testID="time-entry-end-date"
                      >
                        <View style={styles.activeEditStartSummaryText}>
                          <Text style={styles.activeEditStartDate} numberOfLines={1}>
                            {formatPickerDate(displayedEndAt)}
                          </Text>
                        </View>
                      </Pressable>
                      <TextInput
                        ref={endTimeInputRef}
                        accessibilityLabel="End time"
                        blurOnSubmit
                        editable={!busy}
                        keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric"}
                        maxLength={5}
                        onChangeText={updateStoppedTimeText}
                        onFocus={() => {
                          if (beginNativeKeyboardSession() === null) {
                            endTimeInputRef.current?.blur();
                            Keyboard.dismiss();
                            return;
                          }
                          setDatePickerOpen(false);
                        }}
                        onSubmitEditing={Keyboard.dismiss}
                        placeholder="17:30"
                        placeholderTextColor={theme.textSecondary}
                        returnKeyType="done"
                        showSoftInputOnFocus
                        style={[styles.textInput, styles.activeEditTimeInput]}
                        testID="time-entry-end-time"
                        value={stoppedTimeText}
                      />
                    </View>
                  </View>
                ) : null}

                {overlapWarning?.overlapCount ? (
                  <View
                    accessibilityLiveRegion="polite"
                    style={{
                      backgroundColor: colorWithAlpha(theme.warning, theme.mode === "dark" ? 0.14 : 0.11),
                      borderRadius: 12,
                      gap: 3,
                      paddingHorizontal: 12,
                      paddingVertical: 10
                    }}
                  >
                    <Text style={[styles.activeEditSectionLabel, { color: theme.warningText }]}>
                      Overlap · {formatClockDuration(overlapWarning.uniqueOverlapSeconds)}
                    </Text>
                    <Text style={[styles.muted, { color: theme.textSecondary }]}>
                      Overlaps {overlapWarning.overlapCount} other {overlapWarning.overlapCount === 1 ? "entry" : "entries"}.
                      You can still save it; reports show both Total logged and Time covered.
                    </Text>
                    {overlapPeers.map((candidate) => (
                      <Text key={candidate.id} style={[styles.muted, { color: theme.textPrimary }]} numberOfLines={1}>
                        {candidate.description?.trim() || candidate.categoryName?.trim() || "Untitled entry"}
                        {" · "}{formatTimeInput(new Date(candidate.startedAt))}–
                        {candidate.stoppedAt ? formatTimeInput(new Date(candidate.stoppedAt)) : "now"}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {canDelete ? (
                  <Pressable
                    accessibilityLabel="Delete entry"
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => {
                      void deleteEntryFromSheet();
                    }}
                    onTouchStart={(event) => event.stopPropagation()}
                    style={({ pressed }) => [
                      styles.activeEditDeleteButton,
                      pressed && !busy ? styles.buttonPressed : null,
                      busy ? styles.buttonDisabled : null
                    ]}
                    testID="time-entry-sheet-delete"
                  >
                    <Text style={styles.activeEditDeleteText}>Delete entry</Text>
                  </Pressable>
                ) : null}
                </View>
              </ScrollView>
              <HistoricalSuggestionsOverlay
                contentKey={historicalSuggestionResultSignature}
                disabled={busy}
                geometry={overlayGeometry}
                onAnimationFinished={(animationPresentationId, direction) => {
                  if (animationPresentationId !== presentationRef.current.id) {
                    recordStaleCallback();
                    return;
                  }
                  dispatchSheetEvent({
                    type: "suggestions_animation_finished",
                    presentationId: animationPresentationId,
                    direction
                  });
                }}
                onRenderStateChange={(nextRenderState) => {
                  if (nextRenderState.presentationId !== presentationRef.current.id) {
                    recordStaleCallback();
                    return;
                  }
                  if (nextRenderState.contentKey !== historicalSuggestionResultSignature) return;
                  setOverlayUpdateVisibilityDropCount((current) => Math.max(
                    current,
                    nextRenderState.updateVisibilityDropCount
                  ));
                  setOverlayRenderState(nextRenderState);
                }}
                onSelect={(suggestion) => {
                  void applyHistoricalSuggestion(suggestion);
                }}
                onStaleCallback={recordStaleCallback}
                presentationId={presentation.id}
                reduceMotion={reduceMotion}
                styles={styles}
                suggestions={historicalSuggestions}
                theme={theme}
                visible={
                  sheetState.suggestionsPhase === "opening" ||
                  sheetState.suggestionsPhase === "visible" ||
                  sheetState.suggestionsPhase === "updating"
                }
              />
              </View>
            </SwipeDismissSheet>
          </SafeAreaView>
        </View>
        <FloatingDatePicker
          maxDate={new Date()}
          onClose={() => {
            setDatePickerOpen(false);
            dispatchSheetEvent({
              type: "date_picker_closed",
              presentationId: presentation.id
            });
          }}
          onSelect={selectDate}
          selectedDate={pickerDate}
          styles={styles}
          theme={theme}
          visible={datePickerOpen}
        />
        {__DEV__ && debugTelemetry ? (
          <View
            collapsable={false}
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 1,
              height: 1,
              overflow: "hidden",
              zIndex: 100,
              opacity: 0.01
            }}
            testID="sheet-qa-telemetry"
          >
            <Text
              accessible
              accessibilityLabel={qaStateJson}
              style={{ width: 1, height: 1, fontSize: 1, lineHeight: 1 }}
              testID="sheet-qa-state"
            >
              {qaStateJson}
            </Text>
          </View>
        ) : null}
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
      hitSlop={{ top: 2, bottom: 2 }}
      onPress={onPress}
      testID={category ? `time-entry-category-${category.id}` : "time-entry-category-clear"}
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
      ]} maxFontSizeMultiplier={1.5}>
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
