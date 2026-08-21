import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
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
import type { GestureType } from "react-native-gesture-handler";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import {
  consumeActiveHashtag,
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
import { ConnectivityBanner } from "@/components/ConnectivityBanner";
import {
  HistoricalSuggestionsOverlay,
  type HistoricalSuggestionsOverlayRenderState
} from "@/components/HistoricalSuggestionsOverlay";
import { PrimaryTimerGlyph } from "@/components/PrimaryTimerAction";
import { TimeEntryDurationDial } from "@/components/TimeEntryDurationDial";
import { pressable, type MobileStyles, type MobileTheme } from "@/lib/mobileTheme";
import {
  editSheetKeyboardLayout,
  keyboardInsetFromScreenY
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
  createTimeEntrySheetGeometryCache,
  invalidateTimeEntrySheetGeometry,
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
  shouldRetryKeyboardConfirmation,
  timeEntrySheetReducer,
  type TimeEntrySheetMutationPhase,
  type TimeEntrySheetPresentation
} from "@/lib/timeEntrySheetPresentation";
import {
  createTimeEntrySheetMutationTelemetry,
  timeEntrySheetMutationTelemetryReducer
} from "@/lib/timeEntrySheetTelemetry";
import {
  mergeTimeEntryDialLocalDateTime,
  TIME_ENTRY_DIAL_MAX_DURATION_MS,
  TIME_ENTRY_DIAL_MIN_DURATION_MS,
  type TimeEntryDialInterval
} from "@/lib/timeEntryDurationDial";
import {
  selectionAfterDescriptionChange,
  timeEntrySheetLayoutDensity,
  timeEntrySheetDraftHasChanges,
  type TimeEntrySheetDraftSnapshot
} from "@/lib/timeEntrySheetDraft";
import {
  createPendingDescriptionSelectionSync,
  createTimeEntrySheetTagSession,
  resolveDescriptionSelectionEvent,
  timeEntrySheetTagSessionReducer,
  type DescriptionSelection,
  type PendingDescriptionSelectionSync,
  type TimeEntrySheetTagSessionEvent
} from "@/lib/timeEntrySheetTagSession";

const HISTORICAL_SUGGESTION_LIMIT = 12;
const HISTORICAL_OVERLAY_MAX_HEIGHT = 384;
// UIKit can accept the TextInput as first responder before the Modal window is
// ready to own the software keyboard. Recover with a bounded, native-only
// responder handshake that deliberately leaves reducer/Suggestions focus state
// untouched.
const KEYBOARD_CONFIRMATION_TIMEOUT_MS = 700;
const KEYBOARD_CONFIRMATION_MAX_RETRIES = 3;
const KEYBOARD_CONFIRMATION_REFOCUS_DELAY_MS = 120;
const KEYBOARD_CONFIRMATION_SUPPRESSION_SETTLE_MS = 300;
const DESCRIPTION_SELECTION_SYNC_TIMEOUT_MS = 500;
const TAG_FOCUS_CONTINUITY_GRACE_MS = 500;

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
  onCreateTag: (name: string) => Promise<MobileTag | null>;
  onDelete?: (entryId: string) => Promise<boolean>;
  onPresented?: (presentationId: number) => void;
  onApplySuggestion?: (entryId: string, suggestion: RecentActivitySuggestion) => Promise<boolean>;
  onSave?: (entryId: string, patch: TimeEntryUpdatePatch) => Promise<boolean>;
  onStop?: () => Promise<boolean>;
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
  onCreateTag,
  onDelete,
  onPresented,
  onApplySuggestion,
  onSave,
  onStop,
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
  const [draftStartMs, setDraftStartMs] = useState(0);
  const [draftEndMs, setDraftEndMs] = useState(0);
  const [draftRevision, setDraftRevision] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [sheetHeightAnimating, setSheetHeightAnimating] = useState(false);
  const [startTimeEdited, setStartTimeEdited] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [datePickerDismissGuarded, setDatePickerDismissGuarded] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<"start" | "end">("start");
  const [pickerStartAt, setPickerStartAt] = useState<Date | null>(null);
  const [descriptionSelection, setDescriptionSelection] = useState({ start: 0, end: 0 });
  const [descriptionSelectionOverride, setDescriptionSelectionOverride] =
    useState<DescriptionSelection | undefined>(undefined);
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>([]);
  const [tagSession, setTagSession] = useState(() => createTimeEntrySheetTagSession());
  const [draftBaseline, setDraftBaseline] = useState<TimeEntrySheetDraftSnapshot | null>(null);
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
  const sheetDismissGestureRef = useRef<GestureType | undefined>(undefined);
  const discardPromptPresentationIdRef = useRef<number | null>(null);
  const discardBypassPresentationIdRef = useRef<number | null>(null);
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
  const descriptionValueRef = useRef("");
  const descriptionSelectionRef = useRef<DescriptionSelection>({ start: 0, end: 0 });
  const pendingDescriptionSelectionSyncRef =
    useRef<PendingDescriptionSelectionSync | null>(null);
  const selectionOverrideFrameRef = useRef<number | null>(null);
  const selectionSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tagSessionRef = useRef(tagSession);
  tagSessionRef.current = tagSession;
  const tagFocusContinuityRef = useRef({ presentationId: 0, until: 0 });
  const sheetRootLayoutRef = useRef<MeasuredRect | null>(null);
  const scrollViewportLayoutRef = useRef<MeasuredRect | null>(null);
  const descriptionSectionLayoutRef = useRef<MeasuredRect | null>(null);
  const descriptionAnchorLayoutRef = useRef<MeasuredRect | null>(null);
  const contentScrollOffsetRef = useRef({ x: 0, y: 0 });
  const timeInputRef = useRef<TextInput>(null);
  const endTimeInputRef = useRef<TextInput>(null);
  const focusFrameRef = useRef<number | null>(null);
  const tagFocusFrameRef = useRef<number | null>(null);
  const geometryFrameRef = useRef<number | null>(null);
  const datePickerDismissGuardFrameRef = useRef<number | null>(null);
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
  const keyboardConfirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardConfirmationRetryCountRef = useRef(0);
  const suppressDescriptionBlurDispatchRef = useRef(false);
  const appActivityRef = useRef<"active" | "background">(
    AppState.currentState === "active" ? "active" : "background"
  );
  const keyboardHeightAnimationTokenRef = useRef<KeyboardHeightAnimationToken | null>(null);
  const keyboardTopRef = useRef<number | null>(null);
  const operationTokenRef = useRef(0);
  const suggestionMutationSequenceRef = useRef(0);
  const tagCreationSequenceRef = useRef(0);
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
  const [keyboardConfirmationRetryCount, setKeyboardConfirmationRetryCount] = useState(0);
  const [tagBlurRecoveryCount, setTagBlurRecoveryCount] = useState(0);
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
  const clearKeyboardConfirmationWatchdog = useCallback(() => {
    if (keyboardConfirmationTimeoutRef.current !== null) {
      clearTimeout(keyboardConfirmationTimeoutRef.current);
      keyboardConfirmationTimeoutRef.current = null;
    }
  }, []);
  const synchronizeVisibleKeyboardMetrics = useCallback((sessionToken: number) => {
    if (
      appActivityRef.current !== "active" ||
      activeKeyboardSessionTokenRef.current !== sessionToken
    ) {
      return false;
    }
    // The initial keyboard frame can be delivered before the component's
    // listener effect subscribes. React Native keeps the last native metrics,
    // so reconcile them before assuming that focus failed and perturbing the
    // responder chain with a retry.
    const metrics = Keyboard.metrics();
    if (!metrics || metrics.height <= 0) return false;
    const windowHeight = Dimensions.get("window").height;
    const screenHeight = Dimensions.get("screen").height;
    const inset = keyboardInsetFromScreenY({
      keyboardScreenY: metrics.screenY,
      screenHeight,
      windowHeight
    });
    if (inset <= 0) return false;
    keyboardTopRef.current = metrics.screenY;
    keyboardFrameSequenceRef.current += 1;
    dispatchSheetEvent({
      type: "keyboard_frame_changed",
      presentationId: presentationRef.current.id,
      frame: {
        inset,
        sequence: keyboardFrameSequenceRef.current
      },
      interactive: false,
      sessionToken
    });
    applyKeyboardUpdateRef.current(inset, undefined, sessionToken, false);
    return true;
  }, []);
  const armKeyboardConfirmationWatchdog = useCallback((sessionToken: number) => {
    clearKeyboardConfirmationWatchdog();
    if (
      (!presentationRef.current.requestDescriptionFocus &&
        !tagSessionRef.current.activeHashtag &&
        tagSessionRef.current.focusRequestId === null) ||
      keyboardConfirmationRetryCountRef.current >= KEYBOARD_CONFIRMATION_MAX_RETRIES
    ) {
      return;
    }
    const watchdogPresentationId = presentationRef.current.id;
    keyboardConfirmationTimeoutRef.current = setTimeout(() => {
      keyboardConfirmationTimeoutRef.current = null;
      if (synchronizeVisibleKeyboardMetrics(sessionToken)) return;
      if (!shouldRetryKeyboardConfirmation({
        currentPresentationId: presentationRef.current.id,
        maxRetries: KEYBOARD_CONFIRMATION_MAX_RETRIES,
        retryCount: keyboardConfirmationRetryCountRef.current,
        state: sheetStateRef.current,
        watchdogPresentationId,
        watchdogSessionToken: sessionToken
      })) {
        return;
      }
      keyboardConfirmationRetryCountRef.current += 1;
      setKeyboardConfirmationRetryCount((count) => count + 1);
      suppressDescriptionBlurDispatchRef.current = true;
      descriptionInputRef.current?.blur();
      // Let UIKit finish resigning first responder before requesting it again.
      // A one-frame handoff can be coalesced into a no-op by the Modal's
      // responder window, leaving focus true but the software keyboard absent.
      keyboardConfirmationTimeoutRef.current = setTimeout(() => {
        keyboardConfirmationTimeoutRef.current = null;
        if (presentationRef.current.id !== watchdogPresentationId) {
          suppressDescriptionBlurDispatchRef.current = false;
          return;
        }
        descriptionInputRef.current?.focus();
        // UIKit does not guarantee that a second native onFocus callback is
        // emitted after a responder recovery. Re-arm explicitly so every
        // bounded attempt gets its own confirmation window.
        armKeyboardConfirmationWatchdog(sessionToken);
        setTimeout(() => {
          suppressDescriptionBlurDispatchRef.current = false;
        }, KEYBOARD_CONFIRMATION_SUPPRESSION_SETTLE_MS);
      }, KEYBOARD_CONFIRMATION_REFOCUS_DELAY_MS);
    }, KEYBOARD_CONFIRMATION_TIMEOUT_MS);
  }, [clearKeyboardConfirmationWatchdog, synchronizeVisibleKeyboardMetrics]);
  const transitionTagSession = useCallback((event: TimeEntrySheetTagSessionEvent) => {
    const previous = tagSessionRef.current;
    if (event.type === "presentation_opened" || event.type === "cancelled") {
      tagFocusContinuityRef.current = { presentationId: event.presentationId, until: 0 };
    } else if (event.type === "hashtag_changed") {
      if (event.active) {
        tagFocusContinuityRef.current = {
          presentationId: event.presentationId,
          until: Number.POSITIVE_INFINITY
        };
      } else if (
        previous.activeHashtag ||
        tagFocusContinuityRef.current.until === Number.POSITIVE_INFINITY
      ) {
        // A real keyboard frame already confirmed this responder session. Do
        // not let its startup watchdog fire while removing `#` commits the
        // closing tag overlay; iOS can briefly omit Keyboard.metrics() during
        // that commit and the watchdog's recovery blur would visibly cycle the
        // keyboard even though Description never lost focus.
        clearKeyboardConfirmationWatchdog();
        tagFocusContinuityRef.current = {
          presentationId: event.presentationId,
          until: Date.now() + TAG_FOCUS_CONTINUITY_GRACE_MS
        };
      }
    } else if (event.type === "hashtag_consumed") {
      tagFocusContinuityRef.current = {
        presentationId: event.presentationId,
        until: Date.now() + TAG_FOCUS_CONTINUITY_GRACE_MS
      };
    }
    const next = timeEntrySheetTagSessionReducer(tagSessionRef.current, event);
    tagSessionRef.current = next;
    setTagSession(next);
    return next;
  }, [clearKeyboardConfirmationWatchdog]);
  const cancelPendingTagFocus = useCallback((presentationId = presentationRef.current.id) => {
    if (tagFocusFrameRef.current !== null) {
      cancelAnimationFrame(tagFocusFrameRef.current);
      tagFocusFrameRef.current = null;
    }
    transitionTagSession({ type: "cancelled", presentationId });
  }, [transitionTagSession]);
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
    tagCreationSequenceRef.current += 1;
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
    cancelPendingTagFocus();
    transitionTagSession({ type: "presentation_opened", presentationId: presentation.id });
    if (geometryFrameRef.current !== null) {
      cancelAnimationFrame(geometryFrameRef.current);
      geometryFrameRef.current = null;
    }
    if (selectionOverrideFrameRef.current !== null) {
      cancelAnimationFrame(selectionOverrideFrameRef.current);
      selectionOverrideFrameRef.current = null;
    }
    if (selectionSyncTimeoutRef.current !== null) {
      clearTimeout(selectionSyncTimeoutRef.current);
      selectionSyncTimeoutRef.current = null;
    }
    pendingDescriptionSelectionSyncRef.current = null;
    setDescriptionSelectionOverride(undefined);
    clearKeyboardConfirmationWatchdog();
    keyboardConfirmationRetryCountRef.current = 0;
    suppressDescriptionBlurDispatchRef.current = false;
    setDraftBaseline(null);
    discardPromptPresentationIdRef.current = null;
    discardBypassPresentationIdRef.current = null;
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
    contentScrollOffsetRef.current = { x: 0, y: 0 };
    pendingKeyboardUpdate.current = null;
    keyboardMotionFrozen.current = false;
    invalidateNativeKeyboardSession();
    keyboardInsetRef.current = 0;
    keyboardTopRef.current = null;
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
    setKeyboardConfirmationRetryCount(0);
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
    clearKeyboardConfirmationWatchdog,
    presentation.id,
    recordStaleCallback,
    transitionTagSession,
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
    const hydratedDateText = formatDateInput(startedAt);
    const hydratedTimeText = formatTimeInput(startedAt);
    const hydratedTagNames = snapshot.tags.map((tag) => tag.name);
    commitDescriptionEditorState(
      hydratedDescription,
      { start: hydratedDescription.length, end: hydratedDescription.length },
      false
    );
    setSelectedTagNames(hydratedTagNames);
    setSelectedCategoryId(snapshot.categoryId);
    setDateText(hydratedDateText);
    setTimeText(hydratedTimeText);
    setDraftStartMs(startedAt.getTime());
    let hydratedStoppedDateText = "";
    let hydratedStoppedTimeText = "";
    if (snapshot.stoppedAt) {
      const stoppedAt = new Date(snapshot.stoppedAt);
      hydratedStoppedDateText = formatDateInput(stoppedAt);
      hydratedStoppedTimeText = formatTimeInput(stoppedAt);
      setStoppedDateText(hydratedStoppedDateText);
      setStoppedTimeText(hydratedStoppedTimeText);
      setDraftEndMs(stoppedAt.getTime());
    } else {
      setStoppedDateText("");
      setStoppedTimeText("");
      setDraftEndMs(Date.now());
    }
    setDraftBaseline({
      categoryId: snapshot.categoryId,
      dateText: hydratedDateText,
      description: hydratedDescription,
      stoppedDateText: hydratedStoppedDateText,
      stoppedTimeText: hydratedStoppedTimeText,
      tagNames: hydratedTagNames,
      timeText: hydratedTimeText
    });
    setDraftRevision(0);
    setPickerStartAt(startedAt);
    setDatePickerTarget("start");
    setStartTimeEdited(false);
    setDatePickerOpen(false);
    setValidationError(null);
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
        keyboardTop: Math.max(
          localGeometry.overlayTopBoundary,
          localGeometry.overlayBottomBoundary - keyboardInsetRef.current
        ),
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

  useEffect(() => () => {
    if (geometryFrameRef.current !== null) cancelAnimationFrame(geometryFrameRef.current);
    if (datePickerDismissGuardFrameRef.current !== null) {
      cancelAnimationFrame(datePickerDismissGuardFrameRef.current);
    }
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    if (tagFocusFrameRef.current !== null) cancelAnimationFrame(tagFocusFrameRef.current);
    if (selectionOverrideFrameRef.current !== null) {
      cancelAnimationFrame(selectionOverrideFrameRef.current);
    }
    if (selectionSyncTimeoutRef.current !== null) {
      clearTimeout(selectionSyncTimeoutRef.current);
    }
    if (keyboardConfirmationTimeoutRef.current !== null) {
      clearTimeout(keyboardConfirmationTimeoutRef.current);
      keyboardConfirmationTimeoutRef.current = null;
    }
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
      return undefined;
    }

  function animateKeyboardLayout(
      toValue: number,
      targetHeight: number | null,
      _event?: KeyboardEvent
    ) {
      // The keyboard is an internal occlusion boundary only. It must never
      // translate or resize the fixed outer sheet.
      keyboardHeightAnimationTokenRef.current = null;
      keyboardLift.stopAnimation();
      animatedSheetHeight.stopAnimation();
      keyboardLift.setValue(toValue);
      if (targetHeight !== null) {
        animatedSheetHeight.setValue(targetHeight);
      }
      setSheetHeightAnimating(false);
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
      keyboardInsetRef.current = nextInset;
      setKeyboardInset(nextInset);
      animateKeyboardLayout(0, nextLayout.sheetHeight, event);
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
      if (nextInset > 0) {
        // Once UIKit has supplied a positive keyboard frame there is nothing
        // left for the bounded first-focus recovery to prove. Cancelling it
        // here prevents a later tag-panel render from being mistaken for the
        // original missing-keyboard race.
        clearKeyboardConfirmationWatchdog();
      }
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
    // Simulator and some restored iOS keyboard states can omit the early
    // frame-change notification while still delivering keyboardDidShow.
    // Reconcile both phases; duplicate frames are harmless and keep the app's
    // geometry truthful to the actual native keyboard.
    const didShowSubscription = Platform.OS === "ios"
      ? Keyboard.addListener("keyboardDidShow", updateKeyboardInset)
      : null;
    const handleKeyboardHidden = (event: KeyboardEvent) => {
        if (suppressDescriptionBlurDispatchRef.current) return;
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
      };
    const hideSubscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      handleKeyboardHidden
    );
    const didHideSubscription = Platform.OS === "ios"
      ? Keyboard.addListener("keyboardDidHide", handleKeyboardHidden)
      : null;

    return () => {
      changeSubscription.remove();
      didShowSubscription?.remove();
      hideSubscription.remove();
      didHideSubscription?.remove();
    };
  }, [
    clearKeyboardConfirmationWatchdog,
    hashtagPanelProgress,
    insets.bottom,
    insets.top,
    invalidateNativeKeyboardSession,
    keyboardLift,
    presentation.id,
    recordStaleCallback,
    reduceMotion,
    scheduleGeometryMeasurement,
    visible,
    windowDimensions.height
  ]);

  function freezeKeyboardMotion(gesturePresentationId: number) {
    if (gesturePresentationId !== presentationRef.current.id) {
      recordStaleCallback();
      return;
    }
    if (mutationGateRef.current !== null) return;
    // Keyboard frames must keep flowing during an interactive downward swipe
    // so the native keyboard-to-sheet handoff remains observable.
    keyboardMotionFrozen.current = false;
    if (keyboardInsetRef.current > 0) {
      dismissTransientEditingSurfaces();
    }
    setSwipeStartedCount((count) => count + 1);
    setLastSwipeStartedPresentationId(gesturePresentationId);
    dispatchSheetEvent({ type: "swipe_started", presentationId: gesturePresentationId });
  }

  function releaseKeyboardMotion(gesturePresentationId: number) {
    if (gesturePresentationId !== presentationRef.current.id) {
      recordStaleCallback();
      return;
    }
    keyboardMotionFrozen.current = false;
    pendingKeyboardUpdate.current = null;
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
    if (discardBypassPresentationIdRef.current === committedPresentationId) {
      discardBypassPresentationIdRef.current = null;
    } else if (draftHasUnsavedChanges) {
      presentDiscardConfirmation();
      return false;
    }
    cancelPendingTagFocus();
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
    clearKeyboardConfirmationWatchdog();
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
        commitDescriptionEditorState(
          descriptionValueRef.current,
          { start: 0, end: 0 },
          true
        );
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
  const hashtagPanelVisible = Boolean(activeHashtag) && (
    sheetState.descriptionFocused || tagSession.activeHashtag
  );
  const selectedNormalizedTagNames = useMemo(
    () => new Set(selectedTagNames.map((name) => normalizeTagName(name).normalizedName)),
    [selectedTagNames]
  );
  const appliedTagNames = selectedTagNames;
  const draftHasUnsavedChanges = timeEntrySheetDraftHasChanges({
    baseline: draftBaseline,
    current: {
      categoryId: selectedCategoryId,
      dateText,
      description,
      stoppedDateText,
      stoppedTimeText,
      tagNames: appliedTagNames,
      timeText
    },
    includeStoppedTime: hasStoppedTime
  });

  useEffect(() => {
    if (!visible) return;
    transitionTagSession({
      type: "hashtag_changed",
      active: Boolean(activeHashtag),
      presentationId: presentation.id,
      requestFocus: false
    });
    dispatchSheetEvent({
      type: "hashtag_query_changed",
      presentationId: presentation.id,
      active: Boolean(activeHashtag)
    });
  }, [activeHashtag, presentation.id, transitionTagSession, visible]);

  useEffect(() => {
    if (reduceMotion) {
      hashtagPanelProgress.setValue(hashtagPanelVisible ? 1 : 0);
      return undefined;
    }
    hashtagPanelProgress.stopAnimation();
    const animation = Animated.timing(hashtagPanelProgress, {
      toValue: hashtagPanelVisible ? 1 : 0,
      duration: 140,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    });
    animation.start();
    return () => animation.stop();
  }, [hashtagPanelProgress, hashtagPanelVisible, reduceMotion]);

  useEffect(() => {
    const focusRequestId = tagSession.focusRequestId;
    if (focusRequestId === null || !visible) return undefined;
    const focusPresentationId = presentation.id;
    let attemptsRemaining = 3;

    const scheduleAttempt = () => {
      tagFocusFrameRef.current = requestAnimationFrame(() => {
        tagFocusFrameRef.current = null;
        const classification = classifyTimeEntrySheetDeferredFocus({
          currentPresentationId: presentationRef.current.id,
          currentSequence: tagSessionRef.current.focusRequestId ?? -1,
          requestPresentationId: focusPresentationId,
          requestSequence: focusRequestId,
          state: sheetStateRef.current
        });
        if (classification === "stale") {
          recordStaleCallback();
          return;
        }
        if (classification !== "accepted" || mutationGateRef.current !== null) return;

        const input = descriptionInputRef.current;
        if (!input) return;
        if (input.isFocused()) {
          // Do not use transient Keyboard.metrics() absence as permission to
          // resign first responder. During a TextInput/overlay commit iOS can
          // briefly report no metrics while the keyboard is still onscreen;
          // the former forced blur/refocus made that bookkeeping gap visible.
          transitionTagSession({
            type: "description_focused",
            presentationId: focusPresentationId
          });
          return;
        }

        attemptsRemaining -= 1;
        input.focus();
        if (
          attemptsRemaining > 0 &&
          tagSessionRef.current.focusRequestId === focusRequestId
        ) {
          scheduleAttempt();
        }
      });
    };

    scheduleAttempt();
    return () => {
      if (tagFocusFrameRef.current !== null) {
        cancelAnimationFrame(tagFocusFrameRef.current);
        tagFocusFrameRef.current = null;
      }
    };
  }, [
    presentation.id,
    recordStaleCallback,
    tagSession.focusRequestId,
    transitionTagSession,
    visible
  ]);

  const parsedStart = useMemo(() => {
    const result = mergeTimeEntryDialLocalDateTime({
      baseTimestampMs: draftStartMs,
      dateText,
      timeText
    });
    return {
      date: result.timestampMs === null ? null : new Date(result.timestampMs),
      error: result.error
    };
  }, [dateText, draftStartMs, timeText]);
  const parsedStop = useMemo(() => {
    const result = mergeTimeEntryDialLocalDateTime({
      baseTimestampMs: draftEndMs,
      dateText: stoppedDateText,
      timeText: stoppedTimeText
    });
    return {
      date: result.timestampMs === null ? null : new Date(result.timestampMs),
      error: result.error
    };
  }, [draftEndMs, stoppedDateText, stoppedTimeText]);
  const previewStartAt = datePickerOpen && datePickerTarget === "start" && pickerStartAt
    ? new Date(mergeTimeEntryDialLocalDateTime({
        baseTimestampMs: draftStartMs,
        dateText: formatDateInput(pickerStartAt),
        timeText
      }).timestampMs ?? draftStartMs)
    : parsedStart.date;
  const dialNowMs = Date.now();
  const elapsedPreviewSeconds = hasStoppedTime && parsedStart.date && parsedStop.date
      ? Math.max(0, Math.floor((parsedStop.date.getTime() - parsedStart.date.getTime()) / 1000))
      : runningTimerSheetElapsedSeconds({
          activeElapsedSeconds: elapsedSeconds,
          nowMs: dialNowMs,
          previewStartAt,
          startTimeEdited
        });

  const busy = saving || stopping || deleting || sheetState.mutationPhase !== "idle";
  const canStop = isRunningMode && Boolean(onStop);
  const canDelete = Boolean(onDelete);
  const showDeleteButton = canDelete || isAddMode;
  const cancelLabel = isRunningMode ? "Cancel editing timer" : isAddMode ? "Cancel adding time" : "Cancel editing entry";
  const saveLabel = isRunningMode ? "Save timer edits" : isAddMode ? "Create time entry" : "Save entry edits";
  const sheetTitle = isAddMode ? "Add time" : "Edit entry";
  const elapsedText = formatClockDuration(elapsedPreviewSeconds);
  const keyboardLayout = editSheetKeyboardLayout({
    bottomInset: insets.bottom,
    keyboardInset,
    topInset: insets.top,
    windowHeight: windowDimensions.height
  });
  const keyboardAwareSheetStyle = {
    height: keyboardLayout.sheetHeight,
    maxHeight: keyboardLayout.sheetMaxHeight
  };
  const layoutDensity = timeEntrySheetLayoutDensity({
    fontScale: windowDimensions.fontScale,
    windowHeight: windowDimensions.height
  });
  const pendingCallerDismissRequestId = pendingTimeEntrySheetDismissRequestId({
    dismissRequestId,
    handledDismissRequestId: handledDismissRequestIdRef.current,
    state: sheetState,
    visible
  });
  useEffect(() => {
    if (pendingCallerDismissRequestId === null) return;
    handledDismissRequestIdRef.current = pendingCallerDismissRequestId;
    requestCoordinatedDismiss({ bypassDiscardConfirmation: true });
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
    overlayRenderState.renderedHeight > 0 &&
    overlayRenderState.renderedHeight <= overlayGeometry.maxHeight
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
    keyboardConfirmationRetryCount,
    tagBlurRecoveryCount,
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
    formScrollEnabled: false,
    layoutDensity,
    hashtagPanelMounted: true,
    hashtagPanelVisible,
    tagSessionActiveHashtag: tagSession.activeHashtag,
    tagFocusRequestId: tagSession.focusRequestId,
    descriptionFocused: sheetState.descriptionFocused,
    descriptionSelection,
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

  function requestCoordinatedDismiss({
    bypassDiscardConfirmation = false
  }: { bypassDiscardConfirmation?: boolean } = {}) {
    const presentationId = presentationRef.current.id;
    if (bypassDiscardConfirmation) {
      discardBypassPresentationIdRef.current = presentationId;
    }
    cancelPendingTagFocus();
    dispatchSheetEvent({ type: "dismiss_requested", presentationId });
    sheetRef.current?.dismiss();
  }

  function presentDiscardConfirmation() {
    const promptPresentationId = presentationRef.current.id;
    if (discardPromptPresentationIdRef.current === promptPresentationId) return;
    discardPromptPresentationIdRef.current = promptPresentationId;
    Alert.alert(
      "Discard changes?",
      "Your unsaved changes will be lost.",
      [
        {
          text: "Keep editing",
          style: "cancel",
          onPress: () => {
            if (discardPromptPresentationIdRef.current === promptPresentationId) {
              discardPromptPresentationIdRef.current = null;
            }
          }
        },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            if (presentationRef.current.id !== promptPresentationId) return;
            discardPromptPresentationIdRef.current = null;
            requestCoordinatedDismiss({ bypassDiscardConfirmation: true });
          }
        }
      ],
      {
        cancelable: true,
        onDismiss: () => {
          if (discardPromptPresentationIdRef.current === promptPresentationId) {
            discardPromptPresentationIdRef.current = null;
          }
        }
      }
    );
  }

  function requestUserDismiss() {
    if (draftHasUnsavedChanges) {
      presentDiscardConfirmation();
      return;
    }
    requestCoordinatedDismiss();
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
    requestUserDismiss();
  }

  async function saveChanges() {
    if (busy || !entry || !onSave) return;
    const parsed = datePickerOpen && datePickerTarget === "start" && pickerStartAt
      ? (() => {
          const merged = mergeTimeEntryDialLocalDateTime({
            baseTimestampMs: draftStartMs,
            dateText: formatDateInput(pickerStartAt),
            timeText
          });
          return {
            date: merged.timestampMs === null ? null : new Date(merged.timestampMs),
            error: merged.error
          };
        })()
      : parsedStart;
    if (parsed.error || !parsed.date) {
      setValidationError(parsed.error ?? "Choose a valid start date and time.");
      return;
    }
    if (isRunningMode && parsed.date.getTime() > Date.now() - TIME_ENTRY_DIAL_MIN_DURATION_MS) {
      setValidationError("A running timer must start at least one second before now.");
      return;
    }
    if (isRunningMode && Date.now() - parsed.date.getTime() > TIME_ENTRY_DIAL_MAX_DURATION_MS) {
      setValidationError("Timers can be no longer than 24 hours.");
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
      const stopped = parsedStop;
      if (stopped.error || !stopped.date) {
        setValidationError(stopped.error ?? "Choose a valid end date and time.");
        return;
      }
      if (parsed.date.getTime() >= stopped.date.getTime()) {
        setValidationError("Start time must be before the end time.");
        return;
      }
      if (stopped.date.getTime() - parsed.date.getTime() > TIME_ENTRY_DIAL_MAX_DURATION_MS) {
        setValidationError("Entries can be no longer than 24 hours.");
        return;
      }
      patch.stoppedAt = stopped.date.toISOString();
    }

    const token = beginMutation("saving");
    if (token === null) return;
    setValidationError(null);
    const ok = await resolveMutation(() => onSave(entry.id, patch));
    const accepted = finishMutation(token, ok ? "succeeded" : "failed");
    if (accepted && ok) requestCoordinatedDismiss({ bypassDiscardConfirmation: true });
  }

  async function stopFromSheet() {
    if (busy || !onStop) return;
    dismissTransientEditingSurfaces();
    const token = beginMutation("stopping");
    if (token === null) return;
    const ok = await resolveMutation(onStop);
    const accepted = finishMutation(token, ok ? "succeeded" : "failed");
    if (accepted && ok) requestCoordinatedDismiss({ bypassDiscardConfirmation: true });
  }

  async function applyHistoricalSuggestion(suggestion: RecentActivitySuggestion) {
    if (busy || !entry) return;
    const patch = historicalSuggestionPatch(suggestion);
    const previousDescription = descriptionValueRef.current;
    const previousCategoryId = selectedCategoryId;
    const previousTagNames = [...selectedTagNames];
    const previousSelection = descriptionSelectionRef.current;
    const requiresPersistence = isRunningMode && Boolean(onApplySuggestion);
    suggestionMutationSequenceRef.current += 1;
    const suggestionMutationSequence = suggestionMutationSequenceRef.current;
    dispatchSheetEvent({ type: "suggestion_selected", presentationId: presentation.id });
    cancelPendingTagFocus();
    commitDescriptionEditorState(
      patch.description,
      { start: patch.description.length, end: patch.description.length },
      true
    );
    setSelectedCategoryId(patch.categoryId);
    setSelectedTagNames(patch.tagNames);
    setValidationError(null);
    if (!requiresPersistence || !onApplySuggestion) {
      AccessibilityInfo.announceForAccessibility(
        historicalSuggestionAppliedAnnouncement(suggestion)
      );
      return;
    }
    const ok = await resolveMutation(() => onApplySuggestion(entry.id, suggestion));
    const accepted = suggestionMutationSequence === suggestionMutationSequenceRef.current &&
      presentation.id === presentationRef.current.id;
    if (accepted && ok) {
      setDraftBaseline((current) => current ? {
        ...current,
        categoryId: patch.categoryId,
        description: patch.description,
        tagNames: patch.tagNames
      } : current);
      AccessibilityInfo.announceForAccessibility(
        historicalSuggestionAppliedAnnouncement(suggestion)
      );
    } else if (accepted) {
      // Keep subsequent typing/focus live while persistence is in flight. Only
      // restore fields that still contain this exact optimistic suggestion.
      if (descriptionValueRef.current === patch.description) {
        const currentSelection = descriptionSelectionRef.current;
        const selectionStillMatches =
          currentSelection.start === patch.description.length &&
          currentSelection.end === patch.description.length;
        commitDescriptionEditorState(
          previousDescription,
          selectionStillMatches ? previousSelection : currentSelection,
          true
        );
      }
      setSelectedCategoryId((current) => current === patch.categoryId ? previousCategoryId : current);
      setSelectedTagNames((current) => (
        current.join("\u0000") === patch.tagNames.join("\u0000") ? previousTagNames : current
      ));
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
    if (isAddMode) {
      requestUserDismiss();
      return;
    }
    if (busy || !entry || !onDelete) return;
    dismissTransientEditingSurfaces();
    const token = beginMutation("deleting");
    if (token === null) return;
    Keyboard.dismiss();
    const ok = await resolveMutation(() => onDelete(entry.id));
    const accepted = finishMutation(token, ok ? "succeeded" : "failed");
    if (accepted && ok) requestCoordinatedDismiss({ bypassDiscardConfirmation: true });
  }

  function updateTimeText(value: string) {
    if (!hasStoppedTime) setStartTimeEdited(true);
    setTimeText(formatEditableTime(value));
    setValidationError(null);
  }

  function commitDescriptionEditorState(
    nextText: string,
    nextSelection: DescriptionSelection,
    synchronizeNativeSelection: boolean
  ) {
    const previousSelection = descriptionSelectionRef.current;
    pendingDescriptionSelectionSyncRef.current = synchronizeNativeSelection
      ? createPendingDescriptionSelectionSync(previousSelection, nextSelection)
      : null;
    if (selectionOverrideFrameRef.current !== null) {
      cancelAnimationFrame(selectionOverrideFrameRef.current);
      selectionOverrideFrameRef.current = null;
    }
    if (selectionSyncTimeoutRef.current !== null) {
      clearTimeout(selectionSyncTimeoutRef.current);
      selectionSyncTimeoutRef.current = null;
    }
    if (synchronizeNativeSelection) {
      setDescriptionSelectionOverride(nextSelection);
      // Supply a controlled selection for one committed frame only. Native
      // typing owns the caret after that; keeping `selection` controlled on
      // every key can perturb iOS first-responder and keyboard continuity.
      selectionOverrideFrameRef.current = requestAnimationFrame(() => {
        selectionOverrideFrameRef.current = null;
        setDescriptionSelectionOverride(undefined);
      });
    } else {
      setDescriptionSelectionOverride(undefined);
    }
    if (pendingDescriptionSelectionSyncRef.current) {
      // UIKit selection acknowledgements can arrive well after one frame.
      // Keep rejecting the exact old-caret echo for a bounded interval while
      // accepting any genuinely different user caret immediately.
      selectionSyncTimeoutRef.current = setTimeout(() => {
        selectionSyncTimeoutRef.current = null;
        pendingDescriptionSelectionSyncRef.current = null;
      }, DESCRIPTION_SELECTION_SYNC_TIMEOUT_MS);
    }
    descriptionValueRef.current = nextText;
    descriptionSelectionRef.current = nextSelection;
    setDescription(nextText);
    setDescriptionSelection(nextSelection);
  }

  function focusDescriptionField() {
    if (!sheetStateRef.current.focusOwnershipReady) {
      descriptionInputRef.current?.blur();
      Keyboard.dismiss();
      return;
    }
    // An internal watchdog recovery is still the same native keyboard
    // ownership attempt. Starting a new session here would overwrite a frame
    // that arrived between blur and refocus, put the reducer back into
    // `focus_requested`, and trigger unnecessary retries while the keyboard is
    // already visible.
    const currentSheetState = sheetStateRef.current;
    const activeSessionToken = activeKeyboardSessionTokenRef.current;
    const sessionToken = activeSessionToken !== null &&
        currentSheetState.descriptionFocused
      ? activeSessionToken
      : beginNativeKeyboardSession();
    if (sessionToken === null) {
      descriptionInputRef.current?.blur();
      Keyboard.dismiss();
      return;
    }
    setDatePickerOpen(false);
    setInputFocusCount((count) => count + 1);
    const hasActiveHashtag = Boolean(findActiveHashtag(
      descriptionValueRef.current,
      descriptionSelectionRef.current.end
    ));
    transitionTagSession({
      type: "hashtag_changed",
      active: hasActiveHashtag,
      presentationId: presentation.id,
      requestFocus: false
    });
    transitionTagSession({
      type: "description_focused",
      presentationId: presentation.id
    });
    dispatchSheetEvent({ type: "date_picker_closed", presentationId: presentation.id });
    dispatchSheetEvent({ type: "description_focused", presentationId: presentation.id });
    scheduleGeometryMeasurement();
    armKeyboardConfirmationWatchdog(sessionToken);
  }

  async function selectHashtag(tagName: string) {
    const currentText = descriptionValueRef.current;
    const currentSelection = descriptionSelectionRef.current;
    const currentActiveHashtag = currentSelection.start === currentSelection.end
      ? findActiveHashtag(currentText, currentSelection.end)
      : null;
    if (!currentActiveHashtag) return;
    const normalized = normalizeTagName(tagName);
    const existing = tags.find((tag) => tag.normalizedName === normalized.normalizedName);
    const wasSelected = selectedNormalizedTagNames.has(normalized.normalizedName);
    const shouldPersistNewTag = !existing && !wasSelected;
    if (wasSelected) {
      setSelectedTagNames((current) => current.filter(
        (name) => normalizeTagName(name).normalizedName !== normalized.normalizedName
      ));
    } else {
      setSelectedTagNames((current) => [...current, existing?.name ?? normalized.name]);
    }
    const replacement = consumeActiveHashtag(currentText, currentActiveHashtag);
    commitDescriptionEditorState(
      replacement.text,
      { start: replacement.caret, end: replacement.caret },
      true
    );
    transitionTagSession({ type: "hashtag_consumed", presentationId: presentation.id });
    dispatchSheetEvent({ type: "suggestion_selected", presentationId: presentation.id });
    setValidationError(null);

    if (!shouldPersistNewTag) return;
    tagCreationSequenceRef.current += 1;
    const creationSequence = tagCreationSequenceRef.current;
    const createdTag = await onCreateTag(normalized.name);
    if (
      creationSequence !== tagCreationSequenceRef.current ||
      presentation.id !== presentationRef.current.id ||
      !visible
    ) return;
    if (createdTag) {
      setSelectedTagNames((current) => current.map((name) => (
        normalizeTagName(name).normalizedName === normalized.normalizedName
          ? createdTag.name
          : name
      )));
      return;
    }

    setSelectedTagNames((current) => current.filter(
      (name) => normalizeTagName(name).normalizedName !== normalized.normalizedName
    ));
    if (
      descriptionValueRef.current === replacement.text &&
      descriptionSelectionRef.current.start === replacement.caret &&
      descriptionSelectionRef.current.end === replacement.caret
    ) {
      commitDescriptionEditorState(currentText, currentSelection, true);
      transitionTagSession({
        type: "hashtag_changed",
        active: true,
        presentationId: presentation.id,
        requestFocus: true
      });
      dispatchSheetEvent({
        type: "description_query_changed",
        presentationId: presentation.id,
        queryActive: currentText.trim().length > 0
      });
    }
    setValidationError("Tag was not created. Check your connection and try again.");
    AccessibilityInfo.announceForAccessibility("Tag was not created. Try again.");
  }

  function startTagEntry() {
    if (busy) return;
    setDatePickerOpen(false);
    dispatchSheetEvent({ type: "date_picker_closed", presentationId: presentation.id });
    const requestFocus = !descriptionInputRef.current?.isFocused();
    const currentText = descriptionValueRef.current;
    const currentSelection = descriptionSelectionRef.current;
    const currentActive = findActiveHashtag(currentText, currentSelection.end);
    if (currentActive && currentSelection.start === currentSelection.end) {
      transitionTagSession({
        type: "hashtag_changed",
        active: true,
        presentationId: presentation.id,
        requestFocus
      });
      return;
    }
    const next = insertHashtagStarter(currentText, currentSelection);
    commitDescriptionEditorState(
      next.text,
      { start: next.caret, end: next.caret },
      true
    );
    transitionTagSession({
      type: "hashtag_changed",
      active: true,
      presentationId: presentation.id,
      requestFocus
    });
    setValidationError(null);
  }

  function beginTagEntryPress() {
    if (busy || !descriptionInputRef.current?.isFocused()) return;
    // Pressable's onPress arrives after UIKit has already resolved the touch
    // target. Arm the continuity window at touch-down so tapping Add a tag can
    // never create an unowned-responder frame before `#` is inserted.
    clearKeyboardConfirmationWatchdog();
    tagFocusContinuityRef.current = {
      presentationId: presentation.id,
      until: Date.now() + TAG_FOCUS_CONTINUITY_GRACE_MS
    };
  }

  function updateStoppedTimeText(value: string) {
    setStoppedTimeText(formatEditableTime(value));
    setValidationError(null);
  }

  function applyDialInterval(interval: TimeEntryDialInterval) {
    const start = new Date(interval.startMs);
    const end = new Date(interval.endMs);
    setDraftStartMs(interval.startMs);
    setDraftEndMs(interval.endMs);
    setDateText(formatDateInput(start));
    setTimeText(formatTimeInput(start));
    if (hasStoppedTime) {
      setStoppedDateText(formatDateInput(end));
      setStoppedTimeText(formatTimeInput(end));
    }
    if (isRunningMode) setStartTimeEdited(true);
    setDraftRevision((current) => current + 1);
    setValidationError(null);
  }

  function dismissTransientEditingSurfaces() {
    cancelPendingTagFocus();
    descriptionInputRef.current?.blur();
    timeInputRef.current?.blur();
    endTimeInputRef.current?.blur();
    setDatePickerOpen(false);
    dispatchSheetEvent({
      type: "background_interaction",
      presentationId: presentation.id
    });
    Keyboard.dismiss();
  }

  function closeDatePickerAfterTouch() {
    setDatePickerOpen(false);
    dispatchSheetEvent({ type: "date_picker_closed", presentationId: presentation.id });
    setDatePickerDismissGuarded(true);
    if (datePickerDismissGuardFrameRef.current !== null) {
      cancelAnimationFrame(datePickerDismissGuardFrameRef.current);
    }
    // Keep the underlying pan disabled until the selecting touch has finished
    // propagating through React Native's gesture graph.
    datePickerDismissGuardFrameRef.current = requestAnimationFrame(() => {
      datePickerDismissGuardFrameRef.current = requestAnimationFrame(() => {
        datePickerDismissGuardFrameRef.current = null;
        setDatePickerDismissGuarded(false);
      });
    });
  }

  function openStartPicker() {
    setDatePickerDismissGuarded(false);
    dismissTransientEditingSurfaces();
    dispatchSheetEvent({ type: "date_picker_requested", presentationId: presentation.id });
    const currentStart = parsedStart.date ?? fallbackStartAt();
    setDatePickerTarget("start");
    setPickerStartAt(currentStart);
    setDatePickerOpen(true);
    setValidationError(null);
  }

  function openEndPicker() {
    setDatePickerDismissGuarded(false);
    dismissTransientEditingSurfaces();
    dispatchSheetEvent({ type: "date_picker_requested", presentationId: presentation.id });
    const currentEnd = parsedStop.date ?? parsedStart.date ?? fallbackStartAt();
    setDatePickerTarget("end");
    setPickerStartAt(currentEnd);
    setDatePickerOpen(true);
    setValidationError(null);
  }

  function selectDate(date: Date) {
    if (datePickerTarget === "end") {
      const merged = mergeTimeEntryDialLocalDateTime({
        baseTimestampMs: draftEndMs,
        dateText: formatDateInput(date),
        timeText: stoppedTimeText
      });
      if (merged.error || merged.timestampMs === null) {
        setValidationError(merged.error ?? "Choose a valid end date and time.");
        return;
      }
      const parsedDate = new Date(merged.timestampMs);
      setDraftEndMs(merged.timestampMs);
      setDraftRevision((current) => current + 1);
      setPickerStartAt(parsedDate);
      setStoppedDateText(formatDateInput(parsedDate));
      closeDatePickerAfterTouch();
      setValidationError(null);
      return;
    }

    const merged = mergeTimeEntryDialLocalDateTime({
      baseTimestampMs: draftStartMs,
      dateText: formatDateInput(date),
      timeText
    });
    if (merged.error || merged.timestampMs === null) {
      setValidationError(merged.error ?? "Choose a valid start date and time.");
      return;
    }
    const parsedDate = new Date(merged.timestampMs);
    setDraftStartMs(merged.timestampMs);
    setDraftRevision((current) => current + 1);
    setPickerStartAt(parsedDate);
    setDateText(formatDateInput(parsedDate));
    if (isRunningMode) setStartTimeEdited(true);
    closeDatePickerAfterTouch();
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
    <Pressable
      accessibilityHint="Dismisses the keyboard and Suggestions"
      onPress={dismissTransientEditingSurfaces}
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
    </Pressable>
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
              disabled={busy || datePickerOpen || datePickerDismissGuarded}
              dismissGestureRef={sheetDismissGestureRef}
              handleStyle={styles.sheetHandle}
              keyboardInset={keyboardInset}
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
              translateYOffset={0}
              visible={visible}
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
              <Pressable
                accessible={false}
                onPress={dismissTransientEditingSurfaces}
                style={styles.sheetHeader}
                testID="time-entry-sheet-upper-dismiss-area"
              />

              {isRunningMode ? timeEntryHero : null}

              <Pressable
                accessible={false}
                onLayout={(event) => {
                  const { height, width, x, y } = event.nativeEvent.layout;
                  scrollViewportLayoutRef.current = { height, width, x, y };
                  scheduleGeometryMeasurement();
                }}
                onPress={dismissTransientEditingSurfaces}
                style={[
                  styles.activeEditScroller,
                  keyboardLayout.keyboardOpen ? styles.activeEditScrollerKeyboard : null
                ]}
                testID="time-entry-sheet-form"
              >
                <View
                  pointerEvents="box-none"
                  style={[
                    styles.activeEditContent,
                    layoutDensity === "compact" ? styles.activeEditContentCompact : null,
                    layoutDensity === "condensed" ? styles.activeEditContentCondensed : null
                  ]}
                  testID="time-entry-sheet-form-background"
                >
                <View pointerEvents="box-none" style={[
                  styles.activeEditSection,
                  layoutDensity === "compact" ? styles.activeEditSectionCompact : null,
                  layoutDensity === "condensed" ? styles.activeEditSectionCondensed : null,
                  // Keep the focused TextInput's native stacking context stable.
                  // Toggling an ancestor zIndex makes Fabric reorder this subtree,
                  // which resigns first responder while Tags opens or closes.
                  styles.activeEditTagSectionLayer
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
                      onBlur={() => {
                        if (suppressDescriptionBlurDispatchRef.current) return;
                        const continuity = tagFocusContinuityRef.current;
                        if (
                          visible &&
                          continuity.presentationId === presentation.id &&
                          continuity.until >= Date.now() &&
                          sheetStateRef.current.appState === "active" &&
                          sheetStateRef.current.sheetPhase === "presented" &&
                          sheetStateRef.current.surface === "form"
                        ) {
                          // This is a last-resort continuity guard. Normal tag
                          // transitions keep the Description subtree and its
                          // stacking context stable, so QA requires this path
                          // to remain unused while # is inserted or deleted.
                          setTagBlurRecoveryCount((count) => count + 1);
                          descriptionInputRef.current?.focus();
                          transitionTagSession({
                            type: "description_focused",
                            presentationId: presentation.id
                          });
                          dispatchSheetEvent({
                            type: "description_focused",
                            presentationId: presentation.id
                          });
                          return;
                        }
                        transitionTagSession({
                          type: "description_blurred",
                          presentationId: presentation.id
                        });
                        dispatchSheetEvent({
                          type: "description_blurred",
                          presentationId: presentation.id
                        });
                      }}
                      onFocus={focusDescriptionField}
                      onPressIn={() => {
                        if (!busy) descriptionInputRef.current?.focus();
                      }}
                      onSelectionChange={(event) => {
                        const resolution = resolveDescriptionSelectionEvent({
                          nextSelection: event.nativeEvent.selection,
                          pending: pendingDescriptionSelectionSyncRef.current,
                          textLength: descriptionValueRef.current.length
                        });
                        pendingDescriptionSelectionSyncRef.current = resolution.pending;
                        if (!resolution.accepted) {
                          descriptionSelectionRef.current = resolution.selection;
                          setDescriptionSelection(resolution.selection);
                          setDescriptionSelectionOverride(resolution.selection);
                          if (selectionOverrideFrameRef.current !== null) {
                            cancelAnimationFrame(selectionOverrideFrameRef.current);
                          }
                          selectionOverrideFrameRef.current = requestAnimationFrame(() => {
                            selectionOverrideFrameRef.current = null;
                            setDescriptionSelectionOverride(undefined);
                          });
                          return;
                        }
                        if (resolution.pending === null && selectionSyncTimeoutRef.current !== null) {
                          clearTimeout(selectionSyncTimeoutRef.current);
                          selectionSyncTimeoutRef.current = null;
                        }
                        descriptionSelectionRef.current = resolution.selection;
                        setDescriptionSelection(resolution.selection);
                        transitionTagSession({
                          type: "hashtag_changed",
                          active: Boolean(
                            resolution.selection.start === resolution.selection.end &&
                            findActiveHashtag(
                              descriptionValueRef.current,
                              resolution.selection.end
                            )
                          ),
                          presentationId: presentation.id,
                          requestFocus: false
                        });
                      }}
                      selection={descriptionSelectionOverride}
                      style={[styles.textInput, styles.activeEditDescriptionInput]}
                      value={description}
                      onChangeText={(value) => {
                        const previousText = descriptionValueRef.current;
                        const previousSelection = descriptionSelectionRef.current;
                        const nextSelection = selectionAfterDescriptionChange({
                          nextText: value,
                          previousSelection,
                          previousText
                        });
                        commitDescriptionEditorState(value, nextSelection, false);
                        transitionTagSession({
                          type: "hashtag_changed",
                          active: Boolean(findActiveHashtag(value, nextSelection.end)),
                          presentationId: presentation.id,
                          requestFocus: false
                        });
                        dispatchSheetEvent({
                          type: "description_query_changed",
                          presentationId: presentation.id,
                          queryActive: value.trim().length > 0
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
                    <Animated.View
                      accessibilityElementsHidden={!hashtagPanelVisible}
                      accessibilityLabel="Tag suggestions"
                      importantForAccessibility={hashtagPanelVisible ? "auto" : "no-hide-descendants"}
                      pointerEvents={hashtagPanelVisible ? "auto" : "none"}
                      style={[styles.tagAutocompletePanel, hashtagPanelAnimatedStyle]}
                    >
                      <View style={styles.tagAutocompleteHeader}>
                        <Text style={styles.tagAutocompleteTitle}>TAGS</Text>
                      </View>
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
                            isFirst={index === 0}
                            label={tag.name}
                            onPress={() => {
                              void selectHashtag(tag.name);
                            }}
                            styles={styles}
                          />
                        ))}
                        {createTagName ? (
                          <HashtagSuggestionRow
                            accessibilityLabel={`Create new tag, ${createTagName}`}
                            create
                            disabled={busy}
                            isFirst={matchingTags.length === 0}
                            label={`Create “${createTagName}”`}
                            onPress={() => {
                              void selectHashtag(createTagName);
                            }}
                            styles={styles}
                          />
                        ) : null}
                        {matchingTags.length === 0 && !createTagName ? (
                          <Text style={styles.tagSuggestionEmptyText}>Type a name to search or create</Text>
                        ) : null}
                      </ScrollView>
                    </Animated.View>
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
                      onPressIn={beginTagEntryPress}
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
                  pointerEvents="box-none"
                  style={[
                    styles.activeEditObscuredContent,
                    layoutDensity === "compact" ? styles.activeEditObscuredContentCompact : null,
                    layoutDensity === "condensed" ? styles.activeEditObscuredContentCondensed : null
                  ]}
                  testID="time-entry-sheet-obscured-form-content"
                >
                <View pointerEvents="box-none" style={[
                  styles.activeEditSection,
                  layoutDensity === "compact" ? styles.activeEditSectionCompact : null,
                  layoutDensity === "condensed" ? styles.activeEditSectionCondensed : null
                ]}>
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
                          dismissTransientEditingSurfaces();
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
                            dismissTransientEditingSurfaces();
                            setSelectedCategoryId(category.id);
                          }}
                        />
                      ))}
                    </ScrollView>
                  </View>
                </View>

                <View pointerEvents="box-none" style={[
                  styles.activeEditSection,
                  layoutDensity === "compact" ? styles.activeEditSectionCompact : null,
                  layoutDensity === "condensed" ? styles.activeEditSectionCondensed : null
                ]}>
                  <View pointerEvents="box-none" style={[
                    styles.activeEditTimeGroups,
                    windowDimensions.fontScale >= 1.6 ? styles.activeEditTimeGroupsStacked : null
                  ]}>
                    <View pointerEvents="box-none" style={styles.activeEditTimeGroup}>
                      <Text style={styles.activeEditSectionLabel}>Start</Text>
                      <View style={styles.activeEditCompactTimeRow}>
                        <Pressable
                          accessibilityLabel="Edit start date"
                          accessibilityRole="button"
                          disabled={busy}
                          onPress={openStartPicker}
                          style={pressable(styles.activeEditCompactDate, styles.buttonPressed)}
                          testID="time-entry-start-date"
                        >
                          <Text style={styles.activeEditCompactDateText} numberOfLines={1}>
                            {formatPickerDate(displayedStartAt)}
                          </Text>
                        </Pressable>
                        <View pointerEvents="none" style={styles.activeEditTimeDivider} />
                        <TextInput
                          ref={timeInputRef}
                          accessibilityLabel="Start time"
                          blurOnSubmit
                          caretHidden
                          contextMenuHidden
                          editable={!busy}
                          keyboardType="number-pad"
                          maxLength={5}
                          onChangeText={updateTimeText}
                          onFocus={() => {
                            if (beginNativeKeyboardSession() === null) {
                              timeInputRef.current?.blur();
                              Keyboard.dismiss();
                              return;
                            }
                            setDatePickerOpen(false);
                          }}
                          onSubmitEditing={Keyboard.dismiss}
                          placeholder="09:00"
                          placeholderTextColor={theme.textSecondary}
                          returnKeyType="done"
                          selectTextOnFocus
                          style={[styles.textInput, styles.activeEditCompactTimeInput]}
                          testID="time-entry-start-time"
                          value={timeText}
                        />
                      </View>
                    </View>
                    <View pointerEvents="box-none" style={styles.activeEditTimeGroup}>
                      <Text style={styles.activeEditSectionLabel}>End</Text>
                      {hasStoppedTime ? (
                        <View style={styles.activeEditCompactTimeRow}>
                          <Pressable
                            accessibilityLabel="Edit end date"
                            accessibilityRole="button"
                            disabled={busy}
                            onPress={openEndPicker}
                            style={pressable(styles.activeEditCompactDate, styles.buttonPressed)}
                            testID="time-entry-end-date"
                          >
                            <Text style={styles.activeEditCompactDateText} numberOfLines={1}>
                              {formatPickerDate(displayedEndAt)}
                            </Text>
                          </Pressable>
                          <View pointerEvents="none" style={styles.activeEditTimeDivider} />
                          <TextInput
                            ref={endTimeInputRef}
                            accessibilityLabel="End time"
                            blurOnSubmit
                            caretHidden
                            contextMenuHidden
                            editable={!busy}
                            keyboardType="number-pad"
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
                            selectTextOnFocus
                            style={[styles.textInput, styles.activeEditCompactTimeInput]}
                            testID="time-entry-end-time"
                            value={stoppedTimeText}
                          />
                        </View>
                      ) : (
                        <View style={styles.activeEditRunningEndSummary}>
                          <Text style={styles.activeEditCompactDateText} numberOfLines={1}>
                            {formatPickerDate(new Date(dialNowMs))}
                          </Text>
                          <View pointerEvents="none" style={styles.activeEditTimeDivider} />
                          <Text style={styles.activeEditRunningEndTime}>
                            {formatTimeInput(new Date(dialNowMs))}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  {validationError ? <Text style={styles.errorText}>{validationError}</Text> : null}
                </View>

                <TimeEntryDurationDial
                  disabled={busy}
                  endMs={parsedStop.date?.getTime() ?? draftEndMs}
                  lastStoppedAt={lastStoppedAt}
                  layoutDensity={layoutDensity}
                  mode={isRunningMode ? "running" : "stopped"}
                  nowMs={dialNowMs}
                  onChange={applyDialInterval}
                  onInteractionStart={dismissTransientEditingSurfaces}
                  presentationId={presentation.id}
                  reduceMotion={reduceMotion}
                  revision={draftRevision}
                  sheetDismissGestureRef={sheetDismissGestureRef}
                  startMs={parsedStart.date?.getTime() ?? draftStartMs}
                  styles={styles}
                  theme={theme}
                />

                {showDeleteButton ? (
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
                </View>
              </Pressable>
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
                onClose={() => {
                  dispatchSheetEvent({
                    type: "suggestions_dismissed",
                    presentationId: presentation.id
                  });
                  descriptionInputRef.current?.focus();
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
          onClose={() => {
            closeDatePickerAfterTouch();
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
      <ConnectivityBanner suppressAccessibilityAnnouncement />
      </Modal>
    </>
  );
}

function HashtagSuggestionRow({
  accessibilityLabel,
  create = false,
  disabled,
  isFirst,
  label,
  onPress,
  styles
}: {
  accessibilityLabel: string;
  create?: boolean;
  disabled: boolean;
  isFirst: boolean;
  label: string;
  onPress: () => void;
  styles: MobileStyles;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
          styles.tagSuggestionRow,
          pressed && !disabled ? styles.buttonPressed : null,
          disabled ? styles.buttonDisabled : null
      ]}
    >
      {!isFirst ? (
        <View pointerEvents="none" style={styles.tagSuggestionDivider} />
      ) : null}
      <Text style={create ? styles.tagSuggestionCreateText : styles.tagSuggestionText} numberOfLines={1}>
        {create ? "+ " : ""}{label}
      </Text>
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
      hitSlop={{ top: 6, bottom: 6 }}
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
