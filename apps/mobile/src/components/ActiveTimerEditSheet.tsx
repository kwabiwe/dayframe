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
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import type { GestureType } from "react-native-gesture-handler";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import Reanimated from "react-native-reanimated";
import {
  consumeActiveHashtag,
  buildHistoricalEntrySuggestions,
  findActiveHashtag,
  historicalSuggestionPatch,
  insertHashtagStarter,
  normalizeNewTagName,
  normalizeTagName,
  DAYFRAME_APP_ICONS,
  activityControlColor,
  formatDuration,
  type PreviousEndOffer,
  type RecentActivitySuggestion
} from "@dayframe/shared";
import {
  PREVIOUS_END_CHANGED_MESSAGE,
  draftInstantMs,
  previousEndStillHolds
} from "@/lib/previousEndChip";
import { DateSheet } from "@/components/DateSheet";
import { DayframeTimeWheelView, type DayframeTimeWheelChange } from "../../modules/dayframe-time-wheel";
import { localPresenceEntering, localPresenceExiting } from "@/lib/motion";
import { timeWheelAccessibilityStep, timeWheelMinuteInterval } from "@/lib/timeWheel";
import { entryDatePickerMaxDate } from "@/lib/entryDatePickerLimit";
import { addLocalDays, formatLocalDateKey, parseLocalDate } from "@/lib/reportsRanges";
import {
  HistoricalSuggestionsOverlay,
  type HistoricalSuggestionsOverlayRenderState
} from "@/components/HistoricalSuggestionsOverlay";
import { PrimaryTimerGlyph } from "@/components/PrimaryTimerAction";
import { DayframeIcon } from "@/components/icons/DayframeIcon";
import { ActivityPickerSheet } from "@/components/ActivityPickerSheet";
import { ActivityChip, AllActivitiesChip } from "@/components/ActivityChips";
import { BlocksConfirmHost, useBlocksConfirm } from "@/components/blocks/BlocksConfirmSheet";
import { BlocksSheetHead } from "@/components/blocks/BlocksSheetHead";
import { activityChips, chipsThatFit, recentActivityIds } from "@/lib/activityChoice";
import { playHaptic } from "@/lib/haptics";
import { dialTrackColor, TimeEntryDurationDial } from "@/components/TimeEntryDurationDial";
import { pressable, type MobileStyles, type MobileTheme } from "@/lib/mobileTheme";
import { mobileTextProps } from "@/lib/mobileTypography";
import {
  editSheetKeyboardLayout,
  keyboardInsetFromScreenY
} from "@/lib/editSheetKeyboard";
import type { MobileBootstrap, MobileTag, MobileTimeEntry, TimeEntryUpdatePatch } from "@/lib/api";
import {
  HISTORICAL_SUGGESTION_ROLLBACK_ANNOUNCEMENT,
  historicalSuggestionAppliedAnnouncement
} from "@/lib/historicalSuggestionsAccessibility";
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
import { formatLocaleDate } from "../lib/localeDateFormat";

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
  /** Creates an activity from the All-activities picker; resolves to its id or a message to show. */
  onCreateActivity?: (name: string) => Promise<{ id: string } | { error: string }>;
  onDelete?: (entryId: string) => Promise<boolean>;
  onPresented?: (presentationId: number) => void;
  onApplySuggestion?: (entryId: string, suggestion: RecentActivitySuggestion) => Promise<boolean>;
  onSave?: (entryId: string, patch: TimeEntryUpdatePatch) => Promise<boolean>;
  /**
   * PRD D16: where today's last finished block ended, when the running block started 1 min–4 h
   * after it. Fixed for each presentation (read when the sheet hydrates), so the chip never appears
   * or leaves while the sheet is up.
   */
  previousEnd?: PreviousEndOffer | null;
  /** A stopped block's "Start again": called with the saved values once its edits are saved. */
  onStartAgain?: (values: Pick<TimeEntryUpdatePatch, "categoryId" | "description" | "tagNames">) => void;
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
  onCreateActivity,
  onDelete,
  onPresented,
  onApplySuggestion,
  onSave,
  onStartAgain,
  onStop,
  presentation,
  previousEnd = null,
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
  const [activityPickerOpen, setActivityPickerOpen] = useState(false);
  // The chips' order is fixed while the sheet is up (the prototype re-sorts only when it opens or
  // after a pick from All activities), so a tap never moves the chip under the finger.
  const [chipAnchorId, setChipAnchorId] = useState<string | null>(null);
  // Measured widths (a hidden row measures every candidate chip) for fitting the wrap to its rows.
  const [chipWidths, setChipWidths] = useState<Record<string, number>>({});
  const [chipPillWidth, setChipPillWidth] = useState(0);
  const [chipRowWidth, setChipRowWidth] = useState(0);
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
  const [presentedPreviousEnd, setPresentedPreviousEnd] = useState<PreviousEndOffer | null>(null);
  const [presentedPreviousEndEntryStart, setPresentedPreviousEndEntryStart] = useState<string | null>(null);
  const previousEndRef = useRef(previousEnd);
  previousEndRef.current = previousEnd;
  const previousEndEntryStartRef = useRef<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [datePickerDismissGuarded, setDatePickerDismissGuarded] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<"start" | "end">("start");
  // The date sheet's own draft (D1, 14 Oct 2026: a day tap only changes it; Done applies it).
  const [dateDraftKey, setDateDraftKey] = useState<string | null>(null);
  const [dateSheetMonth, setDateSheetMonth] = useState("");
  const [dateSheetPresentationId, setDateSheetPresentationId] = useState(0);
  const dateSheetPresentationRef = useRef(0);
  // A11b time wheel (owner decisions 12 Oct 2026): one inline native wheel under the time cards,
  // aimed at one card. It writes the draft live (React owns it); `timeWheelRevision` counts outside
  // changes (the dial, a date, the previous-end chip) so the wheel re-aims only for those.
  const [timeWheel, setTimeWheelState] = useState<{ presentationId: number; target: "start" | "end" } | null>(null);
  // The refs change in the same tick as the action (not at the next render), so a spin queued
  // behind a close, a retarget or an outside change is already stale when it arrives (Codex r1 on #428).
  const timeWheelRef = useRef<{ presentationId: number; target: "start" | "end" } | null>(null);
  const setTimeWheel = (next: { presentationId: number; target: "start" | "end" } | null) => {
    timeWheelRef.current = next;
    setTimeWheelState(next);
  };
  const timeWheelPresentationRef = useRef(0);
  const [timeWheelRevision, setTimeWheelRevision] = useState(0);
  const timeWheelRevisionRef = useRef(0);
  const bumpTimeWheelRevision = () => {
    timeWheelRevisionRef.current += 1;
    setTimeWheelRevision(timeWheelRevisionRef.current);
  };
  // 5-minute rows unless the person asked for Every minute in this sheet (the prototype's stepPref).
  const [timeWheelStepPref, setTimeWheelStepPref] = useState<1 | 5>(5);
  // The dial's measured height (with its hint row): the open wheel takes exactly that room.
  const [dialAreaHeight, setDialAreaHeight] = useState<number | null>(null);
  // "Type time" (and VoiceOver's activate) types into the card's own field; otherwise it isn't editable.
  const [typingTarget, setTypingTarget] = useState<"start" | "end" | null>(null);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((enabled) => {
        if (mounted) setScreenReaderEnabled(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", (enabled) => {
      setScreenReaderEnabled(enabled);
      // VoiceOver gets the adjustable card, never the wheel.
      if (enabled) setTimeWheel(null);
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
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
  // "Discard changes?" is a Blocks confirm sheet over this sheet's modal (UIA-005).
  const discardConfirm = useBlocksConfirm();
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
  previousEndEntryStartRef.current = entry?.startedAt ?? null;

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
    setChipAnchorId(snapshot.categoryId);
    setActivityPickerOpen(false);
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
    setDateDraftKey(null);
    setDatePickerTarget("start");
    setStartTimeEdited(false);
    // Only the running block's sheet is given one (Dashboard).
    setPresentedPreviousEnd(previousEndRef.current);
    setPresentedPreviousEndEntryStart(previousEndRef.current ? previousEndEntryStartRef.current : null);
    setDatePickerOpen(false);
    setTimeWheel(null);
    setTimeWheelStepPref(5);
    setTypingTarget(null);
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
  // Activity chips (Blocks prototype): the chosen one, pinned, then recently used; at most seven,
  // fewer on short screens and large text so the sheet's bottom actions stay on screen.
  const recentActivities = useMemo(() => recentActivityIds(historicalEntries), [historicalEntries]);
  const timeCardsStacked = windowDimensions.fontScale >= 1.6;
  // Room for "00:00" (about 52 pt at 18 pt) at the input's current, capped text size plus the
  // card's padding, so a time is never clipped; the date beside it truncates first.
  const timeCardMinWidth = 18 + Math.ceil(52 * Math.min(windowDimensions.fontScale, 1.35));
  const chipDensity = timeEntrySheetLayoutDensity({
    fontScale: windowDimensions.fontScale,
    windowHeight: windowDimensions.height
  });
  // The dial's ring takes the chosen activity's colour, as in the prototype, deepened (or lifted)
  // where a pale colour would measure under 3:1 against the dial's track or the sheet.
  const dialActivityColor = useMemo(() => {
    const chosen = categories.find((category) => category.id === selectedCategoryId);
    return chosen
      ? activityControlColor(chosen.color ?? chosen.id, theme.mode, [dialTrackColor(theme), theme.surfaceRaised], chosen.name)
      : null;
  }, [categories, selectedCategoryId, theme]);
  const chipCandidates = useMemo(
    () => activityChips(categories, chipAnchorId, recentActivities, ACTIVITY_CHIP_LIMIT_BY_DENSITY[chipDensity]),
    [categories, chipAnchorId, chipDensity, recentActivities]
  );
  // The non-scrolling sheet keeps Discard/Stop on screen only if the chips stay within their rows:
  // show the most leading chips that wrap, with All activities, into the row budget (the chosen one
  // always stays). Until every candidate is measured, show them all (the sheet is still entering).
  // The "From 10:15 · after …" row (PRD D16) takes one activity row, so Discard/Stop stay on screen.
  const chipRowBudget = Math.max(1, ACTIVITY_CHIP_ROWS_BY_DENSITY[chipDensity] - (presentedPreviousEnd ? 1 : 0));
  const chipActivities = useMemo(() => {
    const widths = chipCandidates.map((category) => chipWidths[category.id]);
    if (chipRowWidth <= 0 || chipPillWidth <= 0 || widths.some((width) => !width)) return chipCandidates;
    const count = chipsThatFit({
      chipWidths: widths as number[],
      gap: ACTIVITY_CHIP_GAP,
      keepFirst: chipCandidates[0]?.id === chipAnchorId,
      maxRows: chipRowBudget,
      pillWidth: chipPillWidth,
      rowWidth: chipRowWidth
    });
    return chipCandidates.slice(0, count);
  }, [chipAnchorId, chipCandidates, chipPillWidth, chipRowBudget, chipRowWidth, chipWidths]);
  const recordChipWidth = (id: string, width: number) => {
    const rounded = Math.ceil(width);
    setChipWidths((current) => (current[id] === rounded ? current : { ...current, [id]: rounded }));
  };
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
    // The draft's own instant while the fields still show it (the repeated hour at a clock change).
    const startMs = draftInstantMs({
      dateText,
      draftMs: draftStartMs,
      formatDate: formatDateInput,
      formatTime: formatTimeInput,
      parse: () => result.timestampMs,
      timeText
    });
    return {
      date: startMs === null ? null : new Date(startMs),
      error: startMs === null ? result.error : null
    };
  }, [dateText, draftStartMs, timeText]);
  const parsedStop = useMemo(() => {
    const result = mergeTimeEntryDialLocalDateTime({
      baseTimestampMs: draftEndMs,
      dateText: stoppedDateText,
      timeText: stoppedTimeText
    });
    // The draft's own end while the fields still show it, as for the start (Codex r2 on #419).
    const endMs = draftInstantMs({
      dateText: stoppedDateText,
      draftMs: draftEndMs,
      formatDate: formatDateInput,
      formatTime: formatTimeInput,
      parse: () => result.timestampMs,
      timeText: stoppedTimeText
    });
    return {
      date: endMs === null ? null : new Date(endMs),
      error: endMs === null ? result.error : null
    };
  }, [draftEndMs, stoppedDateText, stoppedTimeText]);
  // The date sheet keeps its own draft until Done, so the cards always show what Done would save.
  const previewStartAt = parsedStart.date;
  const dialNowMs = Date.now();
  const busy = saving || stopping || deleting || sheetState.mutationPhase !== "idle";
  const canStop = isRunningMode && Boolean(onStop);
  const canDelete = Boolean(onDelete);
  const showDeleteButton = canDelete || isAddMode;
  const cancelLabel = isRunningMode ? "Cancel editing block" : isAddMode ? "Cancel adding time" : "Cancel editing block";
  const saveLabel = isRunningMode ? "Save block" : isAddMode ? "Add block" : "Save block";
  const sheetTitle = isAddMode ? "Add time" : "Edit block";
  // The prototype's sheet head: an eyebrow and a title above the form, Done on the right.
  // A stopped block's eyebrow names the day it was saved on, not a start date being edited.
  const headEyebrow = isRunningMode ? "RECORDING" : isAddMode ? "ADD PAST TIME" : formatSheetDay(new Date(entry?.startedAt ?? draftStartMs));
  const headTitle = isRunningMode ? "Running block" : isAddMode ? "New block" : "Edit block";
  const canStartAgain = !isRunningMode && !isAddMode && Boolean(onStartAgain) && Boolean(onSave);
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
    // The draft is captured: the wheel closes and its later spins are stale (Codex r1 on #428).
    setTimeWheel(null);
    bumpTimeWheelRevision();
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
    const shown = discardConfirm.confirm({
      eyebrow: "Unsaved changes",
      title: "Discard changes?",
      message: "Your unsaved changes will be lost.",
      cancelLabel: "Keep editing",
      confirmLabel: "Discard",
      confirmHint: "Your unsaved changes can't be recovered.",
      // Keep editing, a swipe down, a backdrop tap or VoiceOver escape.
      onCancel: () => {
        if (discardPromptPresentationIdRef.current === promptPresentationId) {
          discardPromptPresentationIdRef.current = null;
        }
      },
      onConfirm: () => {
        if (presentationRef.current.id !== promptPresentationId) return;
        discardPromptPresentationIdRef.current = null;
        requestCoordinatedDismiss({ bypassDiscardConfirmation: true });
      }
    });
    if (!shown && discardPromptPresentationIdRef.current === promptPresentationId) {
      discardPromptPresentationIdRef.current = null;
    }
  }

  function requestUserDismiss() {
    if (draftHasUnsavedChanges) {
      presentDiscardConfirmation();
      return;
    }
    requestCoordinatedDismiss();
  }

  function handleUserRequestClose() {
    // Escape with the wheel open sets the time and closes only the wheel (A11b).
    if (timeWheelRef.current) {
      closeTimeWheel({ haptic: true });
      return;
    }
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

  async function saveChanges(afterSave?: (patch: TimeEntryUpdatePatch) => void) {
    if (busy || !entry || !onSave) return;
    const parsed = parsedStart;
    if (parsed.error || !parsed.date) {
      setValidationError(parsed.error ?? "Choose a valid start date and time.");
      return;
    }
    if (isRunningMode && parsed.date.getTime() > Date.now() - TIME_ENTRY_DIAL_MIN_DURATION_MS) {
      setValidationError("A running block must start at least one second before now.");
      return;
    }
    if (isRunningMode && Date.now() - parsed.date.getTime() > TIME_ENTRY_DIAL_MAX_DURATION_MS) {
      setValidationError("A block can be no longer than 24 hours.");
      return;
    }
    // A start the chip moved to the previous end saves only while that end still holds (PRD D16).
    if (presentedPreviousEnd && parsed.date.getTime() === previousEndMs && !previousEndHolds()) {
      setValidationError(PREVIOUS_END_CHANGED_MESSAGE);
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
        setValidationError("A block can be no longer than 24 hours.");
        return;
      }
      patch.stoppedAt = stopped.date.toISOString();
    }

    const token = beginMutation("saving");
    if (token === null) return;
    setValidationError(null);
    const ok = await resolveMutation(() => onSave(entry.id, patch));
    const accepted = finishMutation(token, ok ? "succeeded" : "failed");
    if (accepted && ok) {
      requestCoordinatedDismiss({ bypassDiscardConfirmation: true });
      afterSave?.(patch);
    }
  }

  // Start again saves the block's edits first, then starts a new block with the saved values.
  function startAgainFromSheet() {
    if (!canStartAgain || !onStartAgain) return;
    void saveChanges((patch) => onStartAgain({
      categoryId: patch.categoryId,
      description: patch.description,
      tagNames: patch.tagNames
    }));
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
    setChipAnchorId(patch.categoryId);
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
    setTimeWheel(null);
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
    bumpTimeWheelRevision();
    setValidationError(null);
  }

  // A11b: the wheel (or VoiceOver's adjustable card) moved one card's time. Only that card changes;
  // End before Start stays flagged rather than crossing midnight (owner decision 3).
  function applyCardTime(target: "start" | "end", valueMs: number) {
    const at = new Date(valueMs);
    if (target === "end") {
      setDraftEndMs(valueMs);
      setStoppedDateText(formatDateInput(at));
      setStoppedTimeText(formatTimeInput(at));
    } else {
      setDraftStartMs(valueMs);
      setDateText(formatDateInput(at));
      setTimeText(formatTimeInput(at));
      if (isRunningMode) setStartTimeEdited(true);
    }
    setDraftRevision((current) => current + 1);
    setValidationError(null);
  }

  const cardTextValid = (target: "start" | "end") => (target === "end" ? parsedStop.date : parsedStart.date) !== null;
  const cardTimeMs = (target: "start" | "end") => target === "end"
    ? parsedStop.date?.getTime() ?? draftEndMs
    : parsedStart.date?.getTime() ?? draftStartMs;
  // A running block's start can't pass now (the end of the current minute, so it holds still
  // between the sheet's minute renders).
  const cardMaximumMs = (target: "start" | "end") => target === "start" && isRunningMode
    ? Math.floor(dialNowMs / 60_000) * 60_000 + 59_999
    : null;

  function openTimeWheel(target: "start" | "end") {
    if (busy) return;
    // VoiceOver never gets the wheel: activating the card types the time instead.
    if (screenReaderEnabled) {
      typeCardTime(target);
      return;
    }
    const open = timeWheelRef.current;
    if (open?.target === target) {
      closeTimeWheel({ haptic: true });
      return;
    }
    // A card whose text isn't a valid time (a half-typed "09:") takes the time the wheel will show,
    // so the wheel's selection is always the draft (Codex r1 on #428).
    if (!cardTextValid(target)) applyCardTime(target, cardTimeMs(target));
    if (open) {
      // The other card: the same wheel spins to its time.
      setTimeWheel({ presentationId: open.presentationId, target });
      bumpTimeWheelRevision();
      return;
    }
    dismissTransientEditingSurfaces({ keepTimeWheel: true });
    timeWheelPresentationRef.current += 1;
    setTimeWheel({ presentationId: timeWheelPresentationRef.current, target });
  }

  function closeTimeWheel({ haptic }: { haptic: boolean }) {
    if (!timeWheelRef.current) return;
    setTimeWheel(null);
    if (haptic) playHaptic("timeSet");
  }

  function handleTimeWheelChange(change: DayframeTimeWheelChange) {
    // A spin reported before an outside change re-aimed the wheel, or from an earlier opening or
    // card, would undo that change: only the current presentation and revision count. Nothing
    // changes the draft once a save, stop or delete has captured it.
    const wheel = timeWheelRef.current;
    if (!wheel || change.presentationId !== wheel.presentationId) return;
    if (change.revision !== timeWheelRevisionRef.current) return;
    if (mutationGateRef.current !== null || !Number.isFinite(change.valueMs)) return;
    // No "same as the card" skip: the card's value is the last render's, and a spin back to it
    // in the same batch must still win (Codex r2 on #428). Applying the same time again is harmless.
    applyCardTime(wheel.target, change.valueMs);
  }

  function toggleEveryMinute() {
    const wheel = timeWheelRef.current;
    if (!wheel || busy) return;
    const target = wheel.target;
    const valueMs = cardTimeMs(target);
    playHaptic("tick");
    if (timeWheelMinuteInterval(valueMs, timeWheelStepPref === 1) === 5) {
      setTimeWheelStepPref(1);
      return;
    }
    setTimeWheelStepPref(5);
    // Back to 5-minute steps is an explicit choice, so an off-step time rounds visibly to the
    // nearest step in its hour (as in the prototype).
    const at = new Date(valueMs);
    const minute = at.getMinutes();
    if (minute % 5 === 0) return;
    const rounded = Math.min(55, Math.round(minute / 5) * 5);
    const roundedMs = valueMs - at.getSeconds() * 1000 - at.getMilliseconds() + (rounded - minute) * 60_000;
    const maximumMs = cardMaximumMs(target);
    applyCardTime(target, maximumMs !== null && roundedMs > maximumMs ? roundedMs - 5 * 60_000 : roundedMs);
    bumpTimeWheelRevision();
  }

  function typeCardTime(target: "start" | "end") {
    if (busy) return;
    closeTimeWheel({ haptic: false });
    setTypingTarget(target);
    requestAnimationFrame(() => (target === "end" ? endTimeInputRef : timeInputRef).current?.focus());
  }

  function stepCardTime(target: "start" | "end", direction: 1 | -1) {
    if (busy) return;
    const next = timeWheelAccessibilityStep(cardTimeMs(target), direction, { maximumMs: cardMaximumMs(target) });
    if (next === null) return;
    applyCardTime(target, next);
    bumpTimeWheelRevision();
  }

  function handleFormBackgroundPress() {
    // A tap outside the cards and the wheel sets the time (it is already in the draft).
    closeTimeWheel({ haptic: true });
    dismissTransientEditingSurfaces();
  }

  // PRD D16: "From 10:15 · after Write report" moves the draft start to the previous block's end
  // (saved with Done, like any start edit); pressed again it returns to the block's own start.
  const previousEndMs = presentedPreviousEnd ? Date.parse(presentedPreviousEnd.startedAt) : Number.NaN;
  const previousEndApplied = Number.isFinite(previousEndMs) && parsedStart.date?.getTime() === previousEndMs;
  const previousEndHolds = () => previousEndStillHolds({
    current: previousEndRef.current,
    currentEntryStartedAt: entry?.startedAt,
    presented: presentedPreviousEnd,
    presentedEntryStartedAt: presentedPreviousEndEntryStart
  });
  function togglePreviousEnd() {
    if (busy || !Number.isFinite(previousEndMs)) return;
    const ownStart = editorSnapshot.current.startedAt ? Date.parse(editorSnapshot.current.startedAt) : Number.NaN;
    const startMs = previousEndApplied ? ownStart : previousEndMs;
    if (!Number.isFinite(startMs)) return;
    // Moving to the end it offered only while that end still holds; going back always works.
    if (!previousEndApplied && !previousEndHolds()) {
      setValidationError(PREVIOUS_END_CHANGED_MESSAGE);
      return;
    }
    // An open wheel stays and re-aims, as for the dial.
    dismissTransientEditingSurfaces({ keepTimeWheel: true });
    applyDialInterval({ startMs, endMs: Date.now() });
  }

  function dismissTransientEditingSurfaces({ keepTimeWheel = false }: { keepTimeWheel?: boolean } = {}) {
    if (!keepTimeWheel) setTimeWheel(null);
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

  function openDateSheet(target: "start" | "end", current: Date) {
    setDatePickerDismissGuarded(false);
    dismissTransientEditingSurfaces();
    dispatchSheetEvent({ type: "date_picker_requested", presentationId: presentation.id });
    const key = formatLocalDateKey(current);
    setDatePickerTarget(target);
    setDateDraftKey(key);
    setDateSheetMonth(key);
    dateSheetPresentationRef.current += 1;
    setDateSheetPresentationId(dateSheetPresentationRef.current);
    setDatePickerOpen(true);
    setValidationError(null);
  }

  function openStartPicker() {
    openDateSheet("start", parsedStart.date ?? fallbackStartAt());
  }

  function openEndPicker() {
    openDateSheet("end", parsedStop.date ?? parsedStart.date ?? fallbackStartAt());
  }

  // Done on the date sheet: the chosen day with the card's own time. False (an invalid merge)
  // keeps the date sheet up with the reason.
  function selectDate(date: Date): boolean {
    // The same day keeps the draft's exact instant (the repeated hour at a clock change; Codex r2 on
    // #419): there is nothing to merge.
    const ownDraftMs = datePickerTarget === "end" ? draftEndMs : draftStartMs;
    if (formatDateInput(date) === (datePickerTarget === "end" ? stoppedDateText : dateText) && ownDraftMs > 0) {
      setValidationError(null);
      return true;
    }
    if (datePickerTarget === "end") {
      const merged = mergeTimeEntryDialLocalDateTime({
        baseTimestampMs: draftEndMs,
        dateText: formatDateInput(date),
        timeText: stoppedTimeText
      });
      if (merged.error || merged.timestampMs === null) {
        setValidationError(merged.error ?? "Choose a valid end date and time.");
        return false;
      }
      const parsedDate = new Date(merged.timestampMs);
      setDraftEndMs(merged.timestampMs);
      setDraftRevision((current) => current + 1);
      bumpTimeWheelRevision();
      setStoppedDateText(formatDateInput(parsedDate));
      setValidationError(null);
      return true;
    }

    const merged = mergeTimeEntryDialLocalDateTime({
      baseTimestampMs: draftStartMs,
      dateText: formatDateInput(date),
      timeText
    });
    if (merged.error || merged.timestampMs === null) {
      setValidationError(merged.error ?? "Choose a valid start date and time.");
      return false;
    }
    const parsedDate = new Date(merged.timestampMs);
    setDraftStartMs(merged.timestampMs);
    setDraftRevision((current) => current + 1);
    bumpTimeWheelRevision();
    setDateText(formatDateInput(parsedDate));
    if (isRunningMode) setStartTimeEdited(true);
    setValidationError(null);
    return true;
  }

  const displayedStartAt = previewStartAt ?? fallbackStartAt();
  const displayedEndAt = parsedStop.date ?? displayedStartAt;
  // The date sheet (D1/D2, 14 Oct 2026): a single day, Today · Yesterday, no day after today.
  const dateSheetTodayKey = formatLocalDateKey(new Date());
  const dateSheetYesterdayKey = formatLocalDateKey(addLocalDays(parseLocalDate(dateSheetTodayKey)!, -1));
  const dateSheetMax = entryDatePickerMaxDate(new Date());
  const dateSheetDraftDate = dateDraftKey ? parseLocalDate(dateDraftKey) : null;
  const pickDateSheetDay = (key: string) => {
    setDateDraftKey(key);
    setDateSheetMonth(key);
  };
  const showDoneButton = Boolean(onSave);
  const timeWheelValueMs = timeWheel ? cardTimeMs(timeWheel.target) : Number.NaN;
  const timeWheelModel = timeWheel ? {
    colorScheme: theme.mode === "dark" ? "dark" as const : "light" as const,
    maximumMs: cardMaximumMs(timeWheel.target),
    minimumMs: null,
    minuteInterval: timeWheelMinuteInterval(timeWheelValueMs, timeWheelStepPref === 1),
    modelVersion: 1 as const,
    presentationId: timeWheel.presentationId,
    revision: timeWheelRevision,
    valueMs: timeWheelValueMs
  } : null;

  // The panel replaces the dial: the wheel gets the dial's room less the panel's own chrome, never
  // under TIME_WHEEL_MIN_HEIGHT (a wheel needs about three rows) nor over the prototype's 180.
  const timeWheelShowsSummary = layoutDensity !== "condensed";
  const timeWheelHeight = dialAreaHeight === null
    ? TIME_WHEEL_HEIGHT_BY_DENSITY[layoutDensity]
    : Math.round(Math.max(TIME_WHEEL_MIN_HEIGHT, Math.min(TIME_WHEEL_MAX_HEIGHT,
      dialAreaHeight - TIME_WHEEL_PANEL_CHROME - (timeWheelShowsSummary ? TIME_WHEEL_SUMMARY_HEIGHT : 0))));
  // With the dial away, the duration it showed: "1h 05m · 09:30–10:35" ("…–now" while running).
  const timeWheelSummary = (() => {
    if (!timeWheel || !timeWheelShowsSummary) return null;
    const startMs = parsedStart.date?.getTime();
    const endMs = hasStoppedTime ? parsedStop.date?.getTime() : dialNowMs;
    if (startMs === undefined || endMs === undefined || endMs <= startMs) return null;
    const range = `${formatTimeInput(new Date(startMs))}–${hasStoppedTime ? formatTimeInput(new Date(endMs)) : "now"}`;
    return `${formatDuration((endMs - startMs) / 1000)} · ${range}`;
  })();

  function handleTimeCardAccessibilityAction(target: "start" | "end", actionName: string) {
    if (actionName === "increment") stepCardTime(target, 1);
    else if (actionName === "decrement") stepCardTime(target, -1);
    else if (actionName === "activate" || actionName === "typeTime") typeCardTime(target);
    else if (actionName === "changeDate") {
      if (target === "end") openEndPicker();
      else openStartPicker();
    }
  }
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
              accessibilityLabel={isRunningMode ? "Edit block" : sheetTitle}
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
                onPress={handleFormBackgroundPress}
                style={sheetStyles.head}
                testID="time-entry-sheet-upper-dismiss-area"
              >
                <BlocksSheetHead
                  action={showDoneButton ? {
                    accessibilityLabel: saveLabel,
                    busy,
                    label: "Done",
                    onPress: () => {
                      void saveChanges();
                    },
                    testID: "time-entry-sheet-done"
                  } : null}
                  eyebrow={headEyebrow}
                  eyebrowTestID="time-entry-sheet-elapsed"
                  textTestID="time-entry-sheet-hero"
                  theme={theme}
                  title={headTitle}
                />
              </Pressable>

              <Pressable
                accessible={false}
                onLayout={(event) => {
                  const { height, width, x, y } = event.nativeEvent.layout;
                  scrollViewportLayoutRef.current = { height, width, x, y };
                  scheduleGeometryMeasurement();
                }}
                onPress={handleFormBackgroundPress}
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
                      {...mobileTextProps("input")}
                      accessibilityHint="Type a hashtag to add optional tag context"
                      accessibilityLabel={isRunningMode ? "Block description" : "Block description"}
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
                        <Text {...mobileTextProps("counter")} style={styles.tagAutocompleteTitle}>TAGS</Text>
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
                          <Text {...mobileTextProps("body")} style={styles.tagSuggestionEmptyText}>Type a name to search or create</Text>
                        ) : null}
                      </ScrollView>
                    </Animated.View>
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
                  <Text {...mobileTextProps("counter")} style={[sheetStyles.sectionEyebrow, { color: theme.textMuted }]}>ACTIVITY</Text>
                  <View
                    accessibilityLabel="Activity"
                    onLayout={(event) => {
                      const width = Math.floor(event.nativeEvent.layout.width);
                      setChipRowWidth((current) => (current === width ? current : width));
                    }}
                    style={sheetStyles.chipWrap}
                    testID="time-entry-activity-chips"
                  >
                    {/* Measures every candidate chip off screen, so the visible row can be fitted. */}
                    <View
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      pointerEvents="none"
                      style={sheetStyles.chipMeasure}
                    >
                      {chipCandidates.map((category) => (
                        <View key={category.id} onLayout={(event) => recordChipWidth(category.id, event.nativeEvent.layout.width)}>
                          <ActivityChip activity={category} selected={selectedCategoryId === category.id} theme={theme} onPress={() => undefined} />
                        </View>
                      ))}
                    </View>
                    {chipActivities.map((category) => (
                      <ActivityChip
                        key={category.id}
                        activity={category}
                        selected={selectedCategoryId === category.id}
                        testID={`time-entry-category-${category.id}`}
                        theme={theme}
                        onPress={() => {
                          dismissTransientEditingSurfaces();
                          // Tapping the chosen activity again clears it, as in the prototype.
                          setSelectedCategoryId((current) => (current === category.id ? null : category.id));
                          playHaptic("tick");
                        }}
                      />
                    ))}
                    <AllActivitiesChip
                      count={categories.length}
                      onLayout={(event) => {
                        const width = Math.ceil(event.nativeEvent.layout.width);
                        setChipPillWidth((current) => (current === width ? current : width));
                      }}
                      onPress={() => {
                        dismissTransientEditingSurfaces();
                        setActivityPickerOpen(true);
                      }}
                      pressedStyle={styles.buttonPressed}
                      testID="time-entry-category-all"
                      theme={theme}
                    />
                  </View>
                  {/* Tags follow Activity, as in the prototype (UIA-050). */}
                  <View
                    accessibilityElementsHidden={suggestionsObscureFormAccessibility}
                    importantForAccessibility={
                      suggestionsObscureFormAccessibility ? "no-hide-descendants" : "auto"
                    }
                    style={styles.tagEditorFooter}
                    testID="time-entry-description-obscured-footer"
                  >
                    {appliedTagNames.map((tagName, index) => (
                      <Pressable
                        accessibilityHint="Removes this tag from the draft; save the block to confirm"
                        accessibilityLabel={`Remove tag ${tagName}`}
                        accessibilityRole="button"
                        disabled={busy}
                        key={`${tagName}:${index}`}
                        onPress={() => {
                          const normalizedName = normalizeTagName(tagName).normalizedName;
                          setSelectedTagNames((current) => current.filter(
                            (name) => normalizeTagName(name).normalizedName !== normalizedName
                          ));
                          setValidationError(null);
                        }}
                        hitSlop={{ top: 6, bottom: 6 }}
                        style={({ pressed }) => [
                          sheetStyles.tagChip,
                          { backgroundColor: theme.surfaceMuted },
                          pressed && !busy ? styles.buttonPressed : null,
                          busy ? styles.buttonDisabled : null
                        ]}
                        testID={`time-entry-tag-${index}`}
                      >
                        <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[sheetStyles.tagChipText, sheetStyles.tagChipName, { color: theme.textPrimary }]}>
                          #{tagName}
                        </Text>
                        <Text {...mobileTextProps("metadata")} style={[sheetStyles.tagChipText, { color: theme.textSecondary }]}> ×</Text>
                      </Pressable>
                    ))}
                    <Pressable
                      accessibilityHint="Focuses Description and starts adding a tag"
                      accessibilityLabel="Add a tag"
                      accessibilityRole="button"
                      disabled={busy}
                      hitSlop={{ top: 6, bottom: 6 }}
                      onPress={startTagEntry}
                      onPressIn={beginTagEntryPress}
                      style={({ pressed }) => [
                        sheetStyles.tagChip,
                        sheetStyles.tagAdd,
                        { backgroundColor: theme.surfaceMuted },
                        pressed && !busy ? styles.buttonPressed : null,
                        busy ? styles.buttonDisabled : null
                      ]}
                      testID="time-entry-tag-add"
                    >
                      <DayframeIcon color={theme.textSecondary} glyph={DAYFRAME_APP_ICONS.add} size={14} />
                      <Text {...mobileTextProps("metadata")} style={[sheetStyles.tagChipText, { color: theme.textSecondary }]}>Tag</Text>
                    </Pressable>
                  </View>
                </View>

                <View pointerEvents="box-none" style={[
                  styles.activeEditSection,
                  layoutDensity === "compact" ? styles.activeEditSectionCompact : null,
                  layoutDensity === "condensed" ? styles.activeEditSectionCondensed : null
                ]}>
                  <View pointerEvents="box-none" style={[
                    styles.activeEditTimeGroups,
                    timeCardsStacked ? styles.activeEditTimeGroupsStacked : null
                  ]}>
                    <View style={[
                      styles.activeEditTimeGroup,
                      timeCardsStacked ? styles.activeEditTimeGroupStacked : null,
                      timeWheel && timeWheel.target !== "start" ? sheetStyles.timeCardStepBack : null
                    ]}>
                      {timeWheel?.target === "start" ? (
                        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colorWithAlpha(theme.textPrimary, 0.08) }]} />
                      ) : null}
                      {/* Blocks prototype time card: eyebrow over the time; the date on the right. A tap
                          opens the time wheel under the cards (A11b); VoiceOver adjusts the card itself. */}
                      <Pressable
                        accessibilityActions={TIME_CARD_ACCESSIBILITY_ACTIONS}
                        accessibilityLabel="Start"
                        accessibilityRole="adjustable"
                        accessibilityState={{ disabled: busy, expanded: timeWheel?.target === "start" }}
                        accessibilityValue={{ text: `${timeText || "No time"}, ${formatPickerDate(displayedStartAt)}` }}
                        accessible={typingTarget !== "start"}
                        disabled={busy}
                        onAccessibilityAction={(event) => handleTimeCardAccessibilityAction("start", event.nativeEvent.actionName)}
                        onPress={() => openTimeWheel("start")}
                        style={[styles.activeEditTimeCardMain, { minWidth: timeCardMinWidth }]}
                        testID="time-entry-start-card"
                      >
                        <Text {...mobileTextProps("counter")} style={[sheetStyles.sectionEyebrow, { color: theme.textMuted }]}>START</Text>
                          <TextInput
                            ref={timeInputRef}
                            {...mobileTextProps("input")}
                            accessibilityElementsHidden={typingTarget !== "start"}
                            accessibilityLabel="Start time"
                            blurOnSubmit
                            caretHidden
                            contextMenuHidden
                            editable={!busy && typingTarget === "start"}
                            importantForAccessibility={typingTarget === "start" ? "auto" : "no-hide-descendants"}
                            keyboardType="number-pad"
                            maxLength={5}
                            onBlur={() => setTypingTarget((current) => (current === "start" ? null : current))}
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
                            pointerEvents={typingTarget === "start" ? "auto" : "none"}
                            returnKeyType="done"
                            selectTextOnFocus
                            style={[styles.textInput, styles.activeEditCompactTimeInput]}
                            testID="time-entry-start-time"
                            value={timeText}
                          />
                      </Pressable>
                      <Pressable
                        accessibilityLabel="Edit start date"
                        accessibilityValue={{ text: formatPickerDate(displayedStartAt) }}
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={openStartPicker}
                        style={pressable(styles.activeEditCompactDate, styles.buttonPressed)}
                        testID="time-entry-start-date"
                      >
                        <Text {...mobileTextProps("metadata")} style={styles.activeEditCompactDateText} numberOfLines={1}>
                          {formatPickerDate(displayedStartAt)}
                        </Text>
                      </Pressable>
                    </View>
                    {hasStoppedTime ? (
                      <View style={[
                        styles.activeEditTimeGroup,
                        timeCardsStacked ? styles.activeEditTimeGroupStacked : null,
                        timeWheel && timeWheel.target !== "end" ? sheetStyles.timeCardStepBack : null
                      ]}>
                        {timeWheel?.target === "end" ? (
                          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colorWithAlpha(theme.textPrimary, 0.08) }]} />
                        ) : null}
                        <Pressable
                          accessibilityActions={TIME_CARD_ACCESSIBILITY_ACTIONS}
                          accessibilityLabel="End"
                          accessibilityRole="adjustable"
                          accessibilityState={{ disabled: busy, expanded: timeWheel?.target === "end" }}
                          accessibilityValue={{ text: `${stoppedTimeText || "No time"}, ${formatPickerDate(displayedEndAt)}` }}
                          accessible={typingTarget !== "end"}
                          disabled={busy}
                          onAccessibilityAction={(event) => handleTimeCardAccessibilityAction("end", event.nativeEvent.actionName)}
                          onPress={() => openTimeWheel("end")}
                          style={[styles.activeEditTimeCardMain, { minWidth: timeCardMinWidth }]}
                          testID="time-entry-end-card"
                        >
                          <Text {...mobileTextProps("counter")} style={[sheetStyles.sectionEyebrow, { color: theme.textMuted }]}>END</Text>
                            <TextInput
                              ref={endTimeInputRef}
                              {...mobileTextProps("input")}
                              accessibilityElementsHidden={typingTarget !== "end"}
                              accessibilityLabel="End time"
                              blurOnSubmit
                              caretHidden
                              contextMenuHidden
                              editable={!busy && typingTarget === "end"}
                              importantForAccessibility={typingTarget === "end" ? "auto" : "no-hide-descendants"}
                              keyboardType="number-pad"
                              maxLength={5}
                              onBlur={() => setTypingTarget((current) => (current === "end" ? null : current))}
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
                              pointerEvents={typingTarget === "end" ? "auto" : "none"}
                              returnKeyType="done"
                              selectTextOnFocus
                              style={[styles.textInput, styles.activeEditCompactTimeInput]}
                              testID="time-entry-end-time"
                              value={stoppedTimeText}
                            />
                        </Pressable>
                        <Pressable
                          accessibilityLabel="Edit end date"
                          accessibilityValue={{ text: formatPickerDate(displayedEndAt) }}
                          accessibilityRole="button"
                          disabled={busy}
                          onPress={openEndPicker}
                          style={pressable(styles.activeEditCompactDate, styles.buttonPressed)}
                          testID="time-entry-end-date"
                        >
                          <Text {...mobileTextProps("metadata")} style={styles.activeEditCompactDateText} numberOfLines={1}>
                            {formatPickerDate(displayedEndAt)}
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View accessible accessibilityLabel={`Now, ${formatTimeInput(new Date(dialNowMs))}`} style={[styles.activeEditTimeGroup, timeCardsStacked ? styles.activeEditTimeGroupStacked : null]}>
                        <View style={[styles.activeEditTimeCardMain, { minWidth: timeCardMinWidth }]}>
                          <Text {...mobileTextProps("counter")} style={[sheetStyles.sectionEyebrow, { color: theme.textMuted }]}>NOW</Text>
                          <Text {...mobileTextProps("numeric")} style={styles.activeEditRunningEndTime}>
                            {formatTimeInput(new Date(dialNowMs))}
                          </Text>
                        </View>
                        <View style={styles.activeEditCompactDate}>
                          <Text {...mobileTextProps("metadata")} style={styles.activeEditCompactDateText} numberOfLines={1}>
                            {formatPickerDate(new Date(dialNowMs))}
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                  {timeWheel && timeWheelModel ? (
                    // A11b: one inline wheel under the cards, a notch pointing at its card. The panel
                    // takes its own touches, so a tap on it never reads as a tap outside.
                    <Reanimated.View
                      entering={localPresenceEntering(reduceMotion, "rise")}
                      exiting={localPresenceExiting(reduceMotion)}
                      key={`time-wheel-${timeWheel.presentationId}`}
                      onStartShouldSetResponder={() => true}
                      style={[sheetStyles.timeWheelPanel, { backgroundColor: theme.surfaceMuted }]}
                      testID="time-entry-time-wheel"
                    >
                      {timeCardsStacked ? null : (
                        <View
                          pointerEvents="none"
                          style={[sheetStyles.timeWheelNotch, { backgroundColor: theme.surfaceMuted, left: timeWheel.target === "start" ? "25%" : "75%" }]}
                        />
                      )}
                      <DayframeTimeWheelView
                        model={timeWheelModel}
                        onTimeChange={(event) => handleTimeWheelChange(event.nativeEvent)}
                        style={{ alignSelf: "stretch", height: timeWheelHeight }}
                        testID="time-entry-time-wheel-native"
                      />
                      {timeWheelSummary ? (
                        <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[sheetStyles.timeWheelSummary, { color: theme.textSecondary }]} testID="time-entry-time-wheel-summary">
                          {timeWheelSummary}
                        </Text>
                      ) : null}
                      <View style={sheetStyles.timeWheelFoot}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ disabled: busy, selected: timeWheelModel.minuteInterval === 1 }}
                          disabled={busy}
                          onPress={toggleEveryMinute}
                          style={({ pressed }) => [
                            sheetStyles.timeWheelPill,
                            { backgroundColor: timeWheelModel.minuteInterval === 1 ? theme.surface : "transparent" },
                            pressed && !busy ? styles.buttonPressed : null
                          ]}
                          testID="time-entry-time-wheel-every-minute"
                        >
                          {timeWheelModel.minuteInterval === 1 ? <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.done} size={14} /> : null}
                          <Text {...mobileTextProps("control")} adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={1} style={[sheetStyles.timeWheelPillText, { color: timeWheelModel.minuteInterval === 1 ? theme.textPrimary : theme.textSecondary }]}>
                            Every minute
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityHint="Types the time with the number pad"
                          accessibilityRole="button"
                          disabled={busy}
                          onPress={() => typeCardTime(timeWheel.target)}
                          style={({ pressed }) => [sheetStyles.timeWheelPill, pressed && !busy ? styles.buttonPressed : null]}
                          testID="time-entry-time-wheel-type"
                        >
                          <Text {...mobileTextProps("control")} adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={1} style={[sheetStyles.timeWheelPillText, { color: theme.textSecondary }]}>Type time</Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel={`Done, sets ${timeWheel.target === "end" ? "End" : "Start"} to ${formatTimeInput(new Date(timeWheelModel.valueMs))}`}
                          accessibilityRole="button"
                          onPress={() => closeTimeWheel({ haptic: true })}
                          style={({ pressed }) => [
                            sheetStyles.timeWheelPill,
                            sheetStyles.timeWheelDone,
                            { backgroundColor: theme.textPrimary },
                            pressed ? styles.buttonPressed : null
                          ]}
                          testID="time-entry-time-wheel-done"
                        >
                          <Text {...mobileTextProps("control")} numberOfLines={1} style={[sheetStyles.timeWheelPillText, { color: theme.background }]}>Done</Text>
                        </Pressable>
                      </View>
                    </Reanimated.View>
                  ) : null}
                  {presentedPreviousEnd ? (
                    <Pressable
                      accessibilityHint={previousEndApplied ? "Returns the start to when this block started" : "Moves the start back to when that block ended; Done saves it"}
                      accessibilityLabel={`Start from ${formatTimeInput(new Date(previousEndMs))}, after ${presentedPreviousEnd.previousName}`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: busy, selected: previousEndApplied }}
                      disabled={busy}
                      hitSlop={{ top: 6, bottom: 6 }}
                      onPress={togglePreviousEnd}
                      style={({ pressed }) => [
                        sheetStyles.tagChip,
                        sheetStyles.previousEndChip,
                        { backgroundColor: theme.surfaceMuted },
                        pressed && !busy ? styles.buttonPressed : null,
                        busy ? styles.buttonDisabled : null
                      ]}
                      testID="time-entry-previous-end"
                    >
                      {previousEndApplied ? <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.done} size={14} /> : null}
                      <Text {...mobileTextProps("metadata")} style={[sheetStyles.tagChipText, { color: previousEndApplied ? theme.textPrimary : theme.textSecondary }]}>
                        From {formatTimeInput(new Date(previousEndMs))} · after
                      </Text>
                      <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[sheetStyles.tagChipText, sheetStyles.tagChipName, { color: previousEndApplied ? theme.textPrimary : theme.textSecondary }]}>
                        {presentedPreviousEnd.previousName}
                      </Text>
                    </Pressable>
                  ) : null}
                  {validationError ? <Text {...mobileTextProps("body")} style={styles.errorText}>{validationError}</Text> : null}
                </View>

                {/* A11b: while the wheel is open it takes the dial's place (the panel is sized to the
                    dial's measured room), so the fixed sheet never grows and its actions stay on screen
                    at every density (Codex r1/r2 on #428; the prototype's shrinking dial does not fit). */}
                {timeWheel ? null : (
                  <View
                    onLayout={(event) => setDialAreaHeight(event.nativeEvent.layout.height)}
                    pointerEvents="box-none"
                    testID="time-entry-duration-dial-area"
                  >
                    <TimeEntryDurationDial
                    activityColor={dialActivityColor}
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
                  </View>
                )}

                {showDeleteButton || canStop || canStartAgain ? (
                  <View style={sheetStyles.actions} testID="time-entry-sheet-actions">
                    {showDeleteButton ? (
                      <Pressable
                        accessibilityLabel={isRunningMode ? "Discard block" : isAddMode ? "Discard" : "Delete block"}
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => {
                          void deleteEntryFromSheet();
                        }}
                        onTouchStart={(event) => event.stopPropagation()}
                        style={({ pressed }) => [
                          sheetStyles.actionPill,
                          { backgroundColor: colorWithAlpha(theme.danger, 0.16) },
                          pressed && !busy ? styles.buttonPressed : null,
                          busy ? styles.buttonDisabled : null
                        ]}
                        testID="time-entry-sheet-delete"
                      >
                        <DayframeIcon color={theme.dangerText} glyph={DAYFRAME_APP_ICONS.delete} size={18} />
                        <Text {...mobileTextProps("control")} numberOfLines={1} style={[sheetStyles.actionText, { color: theme.dangerText }]}>
                          {isRunningMode || isAddMode ? "Discard" : "Delete"}
                        </Text>
                      </Pressable>
                    ) : null}
                    {canStop ? (
                      <Pressable
                        accessibilityLabel="Stop recording"
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={stopFromSheet}
                        onTouchStart={(event) => event.stopPropagation()}
                        style={({ pressed }) => [
                          sheetStyles.actionPill,
                          { backgroundColor: pressed && !busy ? theme.accentPressed : theme.accent },
                          busy ? styles.buttonDisabled : null
                        ]}
                        testID="time-entry-sheet-stop"
                      >
                        <PrimaryTimerGlyph color={theme.onAccent} mode="stop" />
                        <Text {...mobileTextProps("control")} numberOfLines={1} style={[sheetStyles.actionText, { color: theme.onAccent }]}>Stop</Text>
                      </Pressable>
                    ) : null}
                    {isAddMode && onSave ? (
                      // The add sheet's single primary action (UIA-052): saves the new block, the same
                      // commit as Done in the head; it closes once the block is created (no spinner,
                      // and a double tap saves once).
                      <Pressable
                        accessibilityHint="Saves this time as a new block"
                        accessibilityLabel="Add block"
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => {
                          void saveChanges();
                        }}
                        onTouchStart={(event) => event.stopPropagation()}
                        style={({ pressed }) => [
                          sheetStyles.actionPill,
                          { backgroundColor: pressed && !busy ? theme.accentPressed : theme.accent },
                          busy ? styles.buttonDisabled : null
                        ]}
                        testID="time-entry-sheet-add"
                      >
                        <DayframeIcon color={theme.onAccent} glyph={DAYFRAME_APP_ICONS.add} size={18} />
                        <Text {...mobileTextProps("control")} numberOfLines={1} style={[sheetStyles.actionText, { color: theme.onAccent }]}>Add block</Text>
                      </Pressable>
                    ) : null}
                    {canStartAgain ? (
                      <Pressable
                        accessibilityHint="Saves your changes and starts this block again"
                        accessibilityLabel="Start again"
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={startAgainFromSheet}
                        onTouchStart={(event) => event.stopPropagation()}
                        style={({ pressed }) => [
                          sheetStyles.actionPill,
                          { backgroundColor: theme.surfaceMuted },
                          pressed && !busy ? styles.buttonPressed : null,
                          busy ? styles.buttonDisabled : null
                        ]}
                        testID="time-entry-sheet-start-again"
                      >
                        <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.startAgain} size={18} />
                        <Text {...mobileTextProps("control")} numberOfLines={1} style={[sheetStyles.actionText, { color: theme.textPrimary }]}>Start again</Text>
                      </Pressable>
                    ) : null}
                  </View>
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
        {activityPickerOpen ? (
          <ActivityPickerSheet
            activities={categories}
            onClose={() => setActivityPickerOpen(false)}
            onCreate={onCreateActivity}
            onPick={(activityId) => {
              setSelectedCategoryId(activityId);
              setChipAnchorId(activityId);
            }}
            recentIds={recentActivities}
            reduceMotion={reduceMotion}
            selectedId={selectedCategoryId}
            styles={styles}
            theme={theme}
          />
        ) : null}
        <BlocksConfirmHost
          controller={discardConfirm}
          reduceMotion={reduceMotion}
          styles={styles}
          testID="entry-sheet-discard-confirm"
          theme={theme}
        />
        {datePickerOpen && dateDraftKey ? (
          <DateSheet
            inline
            presentationId={dateSheetPresentationId}
            theme={theme}
            reduceMotion={reduceMotion}
            eyebrow={datePickerTarget === "end" ? "END" : "START"}
            title="Choose a date"
            accessibilityTitle={datePickerTarget === "end" ? "Choose the end date" : "Choose the start date"}
            segments={[
              { key: "today", label: "Today", selected: dateDraftKey === dateSheetTodayKey, onPress: () => pickDateSheetDay(dateSheetTodayKey) },
              { key: "yesterday", label: "Yesterday", selected: dateDraftKey === dateSheetYesterdayKey, onPress: () => pickDateSheetDay(dateSheetYesterdayKey) }
            ]}
            caption={dateSheetDraftDate ? formatLocaleDate(dateSheetDraftDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : ""}
            month={dateSheetMonth}
            onMonthChange={setDateSheetMonth}
            start={dateDraftKey}
            end={dateDraftKey}
            today={dateSheetTodayKey}
            maxDate={formatLocalDateKey(dateSheetMax)}
            onSelectDay={(date) => setDateDraftKey(formatLocalDateKey(date))}
            notice={validationError}
            onDone={() => (dateSheetDraftDate ? selectDate(dateSheetDraftDate) : false)}
            onDismissed={(id) => {
              if (id !== dateSheetPresentationRef.current) return;
              closeDatePickerAfterTouch();
            }}
            testID="entry-date-sheet"
          />
        ) : null}
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
      <Text {...mobileTextProps("control")} style={create ? styles.tagSuggestionCreateText : styles.tagSuggestionText} numberOfLines={1}>
        {create ? "+ " : ""}{label}
      </Text>
    </Pressable>
  );
}

function formatPickerDate(date: Date) {
  if (isToday(date)) return "Today";
  return formatLocaleDate(date, {
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


function colorWithAlpha(hex: string, alpha: number) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** VoiceOver's time card (A11b): swipe up/down moves 5 minutes; activate types the time. */
const TIME_CARD_ACCESSIBILITY_ACTIONS = [
  { name: "increment" },
  { name: "decrement" },
  { name: "activate" },
  { name: "typeTime", label: "Type time" },
  { name: "changeDate", label: "Change date" }
] as const;
/** The inline wheel's height before the dial's room is measured (the first opening is after layout). */
const TIME_WHEEL_HEIGHT_BY_DENSITY = { regular: 180, compact: 140, condensed: 100 } as const;
const TIME_WHEEL_MIN_HEIGHT = 100;
const TIME_WHEEL_MAX_HEIGHT = 180;
/** The panel around the wheel: its top margin and padding, the gap and the 44-point foot. */
const TIME_WHEEL_PANEL_CHROME = 12 + 8 + 4 + 44 + 8;
const TIME_WHEEL_SUMMARY_HEIGHT = 20;

/** How many activity chips fit above the dial before the bottom actions would leave the screen. */
const ACTIVITY_CHIP_LIMIT_BY_DENSITY = { regular: 7, compact: 5, condensed: 3 } as const;
/** How many wrapped rows (chips plus All activities) the ACTIVITY section may use. */
const ACTIVITY_CHIP_ROWS_BY_DENSITY = { regular: 2, compact: 2, condensed: 1 } as const;
const ACTIVITY_CHIP_GAP = 8;

/** "WEDNESDAY 7 OCTOBER" (in the device's language and order), the eyebrow of a stopped block's sheet. */
function formatSheetDay(date: Date) {
  if (Number.isNaN(date.getTime())) return "";
  return formatLocaleDate(date, { day: "numeric", month: "long", weekday: "long" }).replace(",", "").toLocaleUpperCase();
}

// The prototype's sheet head and action row (design/blocks/ios.html .sheet-head, .sheet-actions).
const sheetStyles = StyleSheet.create({
  // The shared BlocksSheetHead (UIA-006) inside a tap target that dismisses the keyboard.
  head: { alignSelf: "stretch" },
  sectionEyebrow: { fontSize: 11, fontWeight: "600", letterSpacing: 0.9 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipMeasure: { flexDirection: "row", left: 0, opacity: 0, position: "absolute", top: 0 },
  // 32 points tall plus 6 of hit slop above and below: a 44-point target, as the old control had.
  tagChip: { alignItems: "center", borderRadius: 10, flexDirection: "row", justifyContent: "center", maxWidth: "100%", minHeight: 32, minWidth: 44, paddingHorizontal: 10 },
  tagChipText: { fontSize: 13, fontWeight: "600" },
  // A long name truncates; the × after it always stays visible.
  tagChipName: { flexShrink: 1, minWidth: 0 },
  // "+ Tag" is a filled chip with the add glyph, never an outline (UIA-050).
  tagAdd: { gap: 4 },
  // PRD D16: one line under the time cards; only the previous block's name truncates.
  previousEndChip: { alignSelf: "flex-start", gap: 4, marginTop: 8 },
  // A11b time wheel (prototype .tw-*): the other card steps back while one is being set.
  timeCardStepBack: { opacity: 0.6 },
  timeWheelPanel: { borderRadius: 18, gap: 4, marginTop: 12, padding: 8 },
  timeWheelNotch: { borderRadius: 3, height: 14, marginLeft: -7, position: "absolute", top: -7, transform: [{ rotate: "45deg" }], width: 14 },
  // One row at every text size (the panel's height is budgeted): the labels shrink rather than wrap.
  timeWheelFoot: { alignItems: "center", flexDirection: "row", gap: 6 },
  timeWheelPill: { alignItems: "center", borderRadius: 999, flexDirection: "row", flexShrink: 1, gap: 6, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
  timeWheelPillText: { fontSize: 13, fontWeight: "700" },
  timeWheelDone: { marginLeft: "auto", minWidth: 72 },
  timeWheelSummary: { fontSize: 12.5, fontVariant: ["tabular-nums"], lineHeight: 16, textAlign: "center" },
  // The chips themselves are the shared ActivityChip / AllActivitiesChip (ActivityChips.tsx).
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
  actionPill: {
    alignItems: "center",
    borderRadius: 999,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16
  },
  actionText: { flexShrink: 1, fontSize: 15, fontWeight: "700" }
});
