import { formatDuration } from "@dayframe/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import Reanimated from "react-native-reanimated";
import Svg, { Circle as SvgCircle, Path, Rect } from "react-native-svg";
import {
  DAYFRAME_BLOCKS,
  placeDisplayName,
  travelModeLabel,
  tripStopRows,
  tripStopsHeading,
  type LocationReviewAction,
  type LocationReviewEvidenceDto
} from "@dayframe/shared";
import {
  type MobileBootstrap,
  type MobileReviewItem
} from "@/lib/api";
import {
  buildLocationReviewEdit,
  buildLocationReviewResolutionAction,
  formatLocationReviewDateInput,
  formatLocationReviewEditableTime,
  formatLocationReviewTimeInput,
  locationReviewEndpointMs,
  initialLocationReviewDescription,
  keyboardRevealScrollOffset,
  locationReviewJourneyCopy,
  parseLocationReviewWindow,
  type LocationActivityGlyphName,
  type LocationReviewNewPlace
} from "@/lib/locationReviewDraft";
import {
  createNativeNearbyPointOfInterestProvider,
  createNativePlaceSearchProvider,
  friendlyPlaceSearchError,
  visibleNearbyPlaces,
  NearbyPointOfInterestController,
  PlaceSearchController,
  selectPlaceSearchBias,
  type NearbyPointOfInterestState,
  type PlaceSearchState
} from "@/lib/placeSearch";
import { pressable, useMobileTheme, type MobileTheme } from "@/lib/mobileTheme";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "@/lib/mobileTypography";
import { SettingsBlockGroup, SettingsBlockRow, SettingsPillButton, SettingsSwitch } from "../settings/SettingsBlocks";
import { ActivityChip, ActivityChipRow, AllActivitiesChip } from "../ActivityChips";
import { ActivityPickerSheet } from "../ActivityPickerSheet";
import { activityChips } from "../../lib/activityChoice";
import {
  localLayoutTransition,
  localPresenceEntering,
  localPresenceExiting,
  useReduceMotionPreference
} from "@/lib/motion";
import { LocationEvidenceMap } from "./LocationEvidenceMap";
import type { DayframeTimeWheelChange } from "../../../modules/dayframe-time-wheel";
import { TimeWheelPanel } from "../TimeWheelPanel";
import { playHaptic } from "../../lib/haptics";
import { timeWheelAccessibilityStep, timeWheelMinuteInterval } from "../../lib/timeWheel";
import { DayframeIcon } from "../icons/DayframeIcon";
import { formatLocaleDate } from "../../lib/localeDateFormat";

type Category = MobileBootstrap["categories"][number];
type Place = MobileBootstrap["places"][number];

const emptySearchState: PlaceSearchState = {
  requestId: null,
  query: "",
  status: "idle",
  suggestions: [],
  message: null
};

const emptyNearbyState: NearbyPointOfInterestState = {
  requestId: null,
  status: "idle",
  places: [],
  message: null
};

export function LocationReviewCorrectionEditor({
  adjacentReview,
  categories,
  evidence,
  isFocused,
  onCreateActivity,
  onResolve,
  places,
  recentActivityIds = [],
  reviewItem,
  saving,
  statusMessage
}: {
  adjacentReview: MobileReviewItem | undefined;
  categories: Category[];
  evidence: LocationReviewEvidenceDto;
  isFocused: boolean;
  /** All activities' Create: resolves to the new activity's id, or a message to show. */
  onCreateActivity?: (name: string) => Promise<{ id: string } | { error: string }>;
  onResolve: (action: LocationReviewAction, successMessage: string) => Promise<void>;
  places: Place[];
  /** Activities used most recently first, for the chips and the picker's Recent. */
  recentActivityIds?: readonly string[];
  reviewItem: MobileReviewItem | undefined;
  saving: boolean;
  statusMessage?: string | null;
}) {
  const { fontScale } = useWindowDimensions();
  const reduceMotion = useReduceMotionPreference();
  const { styles, theme } = useMobileTheme();
  const editorStyles = useMemo(() => createEditorStyles(theme), [theme]);
  const provider = useMemo(() => createNativePlaceSearchProvider(), []);
  const nearbyProvider = useMemo(() => createNativeNearbyPointOfInterestProvider(), []);
  const controllerRef = useRef<PlaceSearchController | null>(null);
  const nearbyControllerRef = useRef<NearbyPointOfInterestController | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const searchInputRef = useRef<TextInput>(null);
  const activityInputRef = useRef<TextInput>(null);
  const activeRevealControlRef = useRef<TextInput | null>(null);
  const scrollOffsetRef = useRef(0);
  const keyboardTopRef = useRef<number | null>(null);
  const revealGenerationRef = useRef(0);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const startAt = useMemo(() => new Date(evidence.segment.startedAt), [evidence.segment.startedAt]);
  // Stops recorded inside a trip; their time is part of the trip, not travel.
  const stopsHeading = evidence.segment.kind === "commute" ? tripStopsHeading(evidence.stops, evidence.segment.timeAway) : null;
  // Formatted on every render, like the trip's own time range, so a locale or
  // time-zone change never leaves a stop outside its trip.
  const stopRows = tripStopRows(evidence.stops, formatTime);
  const stopAt = useMemo(
    () => evidence.segment.stoppedAt ? new Date(evidence.segment.stoppedAt) : null,
    [evidence.segment.stoppedAt]
  );
  const approximateArrival = evidence.segment.approximateArrival;
  const durationLabel = approximateArrival ? "Estimated duration" : "Duration";
  const baselinePlaceId = evidence.display.placeId ?? reviewItem?.suggestedPlaceId ?? null;
  const baselineCategoryId = reviewItem?.suggestedCategoryId ?? null;
  const journeyCopy = locationReviewJourneyCopy(evidence.segment);
  const isJourney = journeyCopy?.journey === true;
  const [description, setDescription] = useState(() => initialLocationReviewDescription({
    placeName: evidence.display.placeName,
    segmentKind: evidence.segment.kind,
    title: evidence.display.title
  }));
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(baselineCategoryId);
  const [categoryTouched, setCategoryTouched] = useState(false);
  // The chips keep their order while the person taps them (the entry sheet's anchor): only a pick
  // from All activities moves the chosen activity to the front.
  const [chipAnchorId, setChipAnchorId] = useState<string | null>(baselineCategoryId);
  const [activityPickerOpen, setActivityPickerOpen] = useState(false);
  const [selectedSavedPlaceId, setSelectedSavedPlaceId] = useState<string | null>(baselinePlaceId);
  const [newPlace, setNewPlace] = useState<LocationReviewNewPlace | null>(null);
  const [selectedPoint, setSelectedPoint] = useState(() => pointFromEvidence(evidence));
  const [editingCentre, setEditingCentre] = useState(false);
  const [manualPlaceName, setManualPlaceName] = useState("");
  // The pin's name field and Use this pin stay open from the first tap until the pin is used,
  // whatever the field holds, so finishing the pin or retyping the name never hides them.
  const [pinEditorOpen, setPinEditorOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchState, setSearchState] = useState<PlaceSearchState>(emptySearchState);
  const [nearbyState, setNearbyState] = useState<NearbyPointOfInterestState>(emptyNearbyState);
  const [saveForFuture, setSaveForFuture] = useState(false);
  const [resolvingSuggestion, setResolvingSuggestion] = useState(false);
  // Each nearby or search pick takes a token; any later place or search interaction takes a new
  // one, so a pick that resolves late never overwrites newer input (Codex r1 on #358).
  const placePickTokenRef = useRef(0);
  const [selectedSplitAt, setSelectedSplitAt] = useState<string | null>(null);
  const [startTimeText, setStartTimeText] = useState(() => formatLocationReviewTimeInput(startAt));
  const [stopTimeText, setStopTimeText] = useState(() => stopAt ? formatLocationReviewTimeInput(stopAt) : "");
  const [validationError, setValidationError] = useState<string | null>(null);
  // A11b time wheel (date pickers PR 5): the entry sheet's inline wheel under Start / End. It writes
  // the times live; ownership and revision live in refs changed in the same tick as the action, so
  // a spin queued behind a close, a retarget or an outside change is stale (as in the entry sheet).
  const [timeWheel, setTimeWheelState] = useState<{ presentationId: number; target: "start" | "end" } | null>(null);
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
  const [timeWheelStepPref, setTimeWheelStepPref] = useState<1 | 5>(5);
  // Type time (and VoiceOver's activate) types into the field; otherwise it isn't editable.
  const [typingTarget, setTypingTarget] = useState<"start" | "end" | null>(null);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  // The exact instants the wheel or VoiceOver chose, kept while the fields still show them.
  const [startDraftMs, setStartDraftMs] = useState<number | null>(null);
  const [stopDraftMs, setStopDraftMs] = useState<number | null>(null);
  const startTimeInputRef = useRef<TextInput>(null);
  const stopTimeInputRef = useRef<TextInput>(null);
  const savingRef = useRef(saving);
  savingRef.current = saving;

  const revealFocusedControl = useCallback((control = activeRevealControlRef.current) => {
    const keyboardTop = keyboardTopRef.current;
    if (!control || keyboardTop === null) return;
    const generation = ++revealGenerationRef.current;
    requestAnimationFrame(() => {
      if (generation !== revealGenerationRef.current || control !== activeRevealControlRef.current) return;
      control.measureInWindow((_x, controlTop, _width, controlHeight) => {
        if (generation !== revealGenerationRef.current || control !== activeRevealControlRef.current) return;
        const nextOffset = keyboardRevealScrollOffset({
          controlHeight,
          controlTop,
          currentOffset: scrollOffsetRef.current,
          keyboardTop
        });
        if (nextOffset <= scrollOffsetRef.current + 0.5) return;
        scrollViewRef.current?.scrollTo({
          y: nextOffset,
          animated: !reduceMotionRef.current
        });
      });
    });
  }, []);

  const focusRevealControl = useCallback((control: TextInput | null) => {
    activeRevealControlRef.current = control;
    revealFocusedControl(control);
  }, [revealFocusedControl]);

  const blurRevealControl = useCallback((control: TextInput | null) => {
    if (activeRevealControlRef.current !== control) return;
    activeRevealControlRef.current = null;
    revealGenerationRef.current += 1;
  }, []);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((enabled) => {
        if (mounted) setScreenReaderEnabled(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", (enabled) => {
      setScreenReaderEnabled(enabled);
      // VoiceOver gets the adjustable field, never the wheel.
      if (enabled) setTimeWheel(null);
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // Leaving the screen (another route in front) closes the wheel; a later spin is stale.
  useEffect(() => {
    if (isFocused || !timeWheelRef.current) return;
    setTimeWheel(null);
    bumpTimeWheelRevision();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  // A save captures the times: the wheel closes and its later spins are stale.
  useEffect(() => {
    if (!saving || !timeWheelRef.current) return;
    setTimeWheel(null);
    bumpTimeWheelRevision();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving]);

  useEffect(() => {
    const updateKeyboardFrame = (event: { endCoordinates: { screenY: number } }) => {
      keyboardTopRef.current = event.endCoordinates.screenY;
      revealFocusedControl();
    };
    const keyboardChanged = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
      updateKeyboardFrame
    );
    const keyboardShown = Platform.OS === "ios"
      ? Keyboard.addListener("keyboardDidShow", updateKeyboardFrame)
      : null;
    const keyboardHidden = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => {
        keyboardTopRef.current = null;
        revealGenerationRef.current += 1;
      }
    );
    return () => {
      keyboardChanged.remove();
      keyboardShown?.remove();
      keyboardHidden.remove();
      activeRevealControlRef.current = null;
      revealGenerationRef.current += 1;
    };
  }, [revealFocusedControl]);

  useEffect(() => {
    if (!provider || !isFocused) return;
    const controller = new PlaceSearchController(provider, setSearchState);
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [isFocused, provider]);

  const baselinePlace = placeForSelection(baselinePlaceId, evidence.map.nearbySavedPlaces, places);
  const baselinePlaceName = evidence.display.placeName || baselinePlace?.name || "Saved place";
  // Saved places already listed under Where; a nearby place with the same name is not repeated.
  const listedSavedPlaceNames = useMemo(
    () => [
      ...(baselinePlaceId ? [baselinePlaceName] : []),
      ...evidence.map.nearbySavedPlaces.map((place) => place.name)
    ],
    [baselinePlaceId, baselinePlaceName, evidence.map.nearbySavedPlaces]
  );
  const listedSavedPlaceNamesRef = useRef(listedSavedPlaceNames);
  listedSavedPlaceNamesRef.current = listedSavedPlaceNames;

  // D3: every stay (a saved match included) lists the nearest few Apple places around the visit
  // under the empty search field. The search runs once per visit centre while the screen is focused;
  // the coordinate goes to MapKit only and is never logged or kept.
  const visitCentre = pointFromEvidence(evidence);
  const visitLatitude = evidence.segment.kind === "stay" ? visitCentre?.latitude ?? null : null;
  const visitLongitude = evidence.segment.kind === "stay" ? visitCentre?.longitude ?? null : null;
  useEffect(() => {
    if (!isFocused || !nearbyProvider || visitLatitude === null || visitLongitude === null) return;
    const controller = new NearbyPointOfInterestController(
      nearbyProvider,
      setNearbyState,
      () => listedSavedPlaceNamesRef.current
    );
    nearbyControllerRef.current = controller;
    void controller.load({ latitude: visitLatitude, longitude: visitLongitude });
    return () => {
      controller.dispose();
      nearbyControllerRef.current = null;
      setNearbyState(emptyNearbyState);
    };
  }, [isFocused, nearbyProvider, visitLatitude, visitLongitude]);

  // The chosen new place is the selected row above, so the list under the field does not repeat it.
  const nearbyChoices = visibleNearbyPlaces(
    nearbyState.places,
    newPlace ? [...listedSavedPlaceNames, newPlace.name] : listedSavedPlaceNames
  );
  const chipActivities = useMemo(
    () => activityChips(categories, chipAnchorId, recentActivityIds),
    [categories, chipAnchorId, recentActivityIds]
  );
  // A journey with no suggested activity is filed as Commute unless the person picks one.
  const automaticCommute = isJourney && baselineCategoryId === null && !categoryTouched;

  const editableWindow = stopAt
    ? parseLocationReviewWindow({
        baselineStartedAt: evidence.segment.startedAt,
        baselineStoppedAt: evidence.segment.stoppedAt ?? "",
        startDateText: formatLocationReviewDateInput(startAt),
        startDraftMs,
        startTimeText,
        stopDateText: formatLocationReviewDateInput(stopAt),
        stopDraftMs,
        stopTimeText
      })
    : null;
  const editableDuration = editableWindow?.value
    ? formatLocationReviewDuration(editableWindow.value.startedAt, editableWindow.value.stoppedAt)
    : "—";

  // The time a field shows, on its own day (the evidence's), merged as typing is; null while the
  // text isn't a valid time.
  function fieldInstant(target: "start" | "end") {
    const base = target === "end" ? stopAt : startAt;
    if (!base) return null;
    return locationReviewEndpointMs({
      baselineMs: base.getTime(),
      draftMs: target === "end" ? stopDraftMs : startDraftMs,
      timeText: target === "end" ? stopTimeText : startTimeText
    });
  }
  const fieldTimeMs = (target: "start" | "end") =>
    fieldInstant(target) ?? (target === "end" ? stopAt?.getTime() ?? startAt.getTime() : startAt.getTime());

  function applyFieldTime(target: "start" | "end", valueMs: number) {
    const text = formatLocationReviewTimeInput(new Date(valueMs));
    if (target === "end") {
      setStopTimeText(text);
      setStopDraftMs(valueMs);
    } else {
      setStartTimeText(text);
      setStartDraftMs(valueMs);
    }
    setValidationError(null);
  }

  function openTimeWheel(target: "start" | "end") {
    if (saving) return;
    if (screenReaderEnabled) {
      typeFieldTime(target);
      return;
    }
    const open = timeWheelRef.current;
    if (open?.target === target) {
      closeTimeWheel({ haptic: true });
      return;
    }
    // A half-typed field takes the time the wheel will show, so the wheel's selection is the draft.
    if (fieldInstant(target) === null) applyFieldTime(target, fieldTimeMs(target));
    if (open) {
      setTimeWheel({ presentationId: open.presentationId, target });
      bumpTimeWheelRevision();
      return;
    }
    Keyboard.dismiss();
    timeWheelPresentationRef.current += 1;
    setTimeWheel({ presentationId: timeWheelPresentationRef.current, target });
  }

  function closeTimeWheel({ haptic }: { haptic: boolean }) {
    if (!timeWheelRef.current) return;
    setTimeWheel(null);
    if (haptic) playHaptic("timeSet");
  }

  function handleTimeWheelChange(change: DayframeTimeWheelChange) {
    const wheel = timeWheelRef.current;
    if (!wheel || change.presentationId !== wheel.presentationId) return;
    if (change.revision !== timeWheelRevisionRef.current) return;
    if (savingRef.current || !Number.isFinite(change.valueMs)) return;
    applyFieldTime(wheel.target, change.valueMs);
  }

  function toggleEveryMinute() {
    const wheel = timeWheelRef.current;
    if (!wheel || saving) return;
    const valueMs = fieldTimeMs(wheel.target);
    playHaptic("tick");
    if (timeWheelMinuteInterval(valueMs, timeWheelStepPref === 1) === 5) {
      setTimeWheelStepPref(1);
      return;
    }
    setTimeWheelStepPref(5);
    // Back to 5-minute steps is an explicit choice: an off-step time rounds visibly in its hour.
    const at = new Date(valueMs);
    const minute = at.getMinutes();
    if (minute % 5 === 0) return;
    const rounded = Math.min(55, Math.round(minute / 5) * 5);
    applyFieldTime(wheel.target, valueMs - at.getSeconds() * 1000 - at.getMilliseconds() + (rounded - minute) * 60_000);
    bumpTimeWheelRevision();
  }

  function typeFieldTime(target: "start" | "end") {
    if (saving) return;
    closeTimeWheel({ haptic: false });
    setTypingTarget(target);
    requestAnimationFrame(() => (target === "end" ? stopTimeInputRef : startTimeInputRef).current?.focus());
  }

  function stepFieldTime(target: "start" | "end", direction: 1 | -1) {
    if (saving) return;
    const next = timeWheelAccessibilityStep(fieldTimeMs(target), direction);
    if (next === null) return;
    applyFieldTime(target, next);
    bumpTimeWheelRevision();
  }

  function handleTimeFieldAccessibilityAction(target: "start" | "end", actionName: string) {
    if (actionName === "increment") stepFieldTime(target, 1);
    else if (actionName === "decrement") stepFieldTime(target, -1);
    else if (actionName === "activate" || actionName === "typeTime") typeFieldTime(target);
  }

  /**
   * The single entry point every user-initiated place or search change calls first (search
   * typing and clearing, a saved choice, Remove, the map pin: opening it, moving it, naming it,
   * using it, and the record actions). It supersedes any nearby or search pick still resolving,
   * so a pick that lands late never overwrites newer input (Codex r1–r2 on #358).
   */
  function supersedePlacePick() {
    // Any place or search change also sets and closes an open time wheel (Codex r1 on #432).
    setTimeWheel(null);
    placePickTokenRef.current += 1;
    setResolvingSuggestion(false);
  }

  /** Map pin handlers: each is a user place edit, so each supersedes a pending pick. */
  function togglePinEditor() {
    supersedePlacePick();
    setPinEditorOpen(true);
    setEditingCentre((current) => !current);
  }

  function moveMapPin(point: { latitude: number; longitude: number }) {
    supersedePlacePick();
    setSelectedPoint(point);
  }

  function renameMapPin(name: string) {
    supersedePlacePick();
    setManualPlaceName(name);
  }

  function changeSearchQuery(value: string) {
    // Typing never drops a place already chosen; it stays the selected row until another is picked.
    supersedePlacePick();
    setSearchQuery(value);
    const bias = selectPlaceSearchBias({
      selectedCoordinate: selectedPoint,
      existingCoordinate: pointFromEvidence(evidence),
      savedPlaceCoordinates: places.flatMap((place) =>
        typeof place.latitude === "number" && typeof place.longitude === "number"
          ? [{ latitude: place.latitude, longitude: place.longitude }]
          : []
      )
    });
    controllerRef.current?.updateQuery(value, bias);
  }

  async function chooseSuggestion(suggestion: PlaceSearchState["suggestions"][number]) {
    const controller = controllerRef.current;
    if (!controller) return;
    const token = ++placePickTokenRef.current;
    setResolvingSuggestion(true);
    try {
      const result = await controller.resolve(suggestion);
      if (token !== placePickTokenRef.current) return;
      const name = result.name?.trim() || result.title.trim();
      const resolved = {
        name,
        formattedAddress: result.formattedAddress || result.subtitle,
        latitude: result.latitude,
        longitude: result.longitude
      };
      setNewPlace(resolved);
      setSaveForFuture(false);
      setSelectedSavedPlaceId(null);
      setSelectedPoint({ latitude: result.latitude, longitude: result.longitude });
      // The chosen place is now the selected row above; the field empties so nearby places return.
      setSearchQuery("");
      setSearchState(emptySearchState);
      setEditingCentre(false);
    } catch (error) {
      if (token !== placePickTokenRef.current) return;
      const message = friendlyPlaceSearchError(error);
      if (message) Alert.alert("Place search", message);
    } finally {
      if (token === placePickTokenRef.current) setResolvingSuggestion(false);
    }
  }

  async function chooseNearbyPlace(place: NearbyPointOfInterestState["places"][number]) {
    const controller = nearbyControllerRef.current;
    if (!controller) return;
    // A pick sets and closes an open time wheel, as any other place change does (Codex r2 on #432).
    setTimeWheel(null);
    const token = ++placePickTokenRef.current;
    setResolvingSuggestion(true);
    try {
      // The coordinate crosses from MapKit only now, for the one place picked.
      const result = await controller.resolve(place);
      if (token !== placePickTokenRef.current) return;
      setNewPlace({
        name: result.name?.trim() || result.title.trim(),
        formattedAddress: result.formattedAddress || result.subtitle,
        latitude: result.latitude,
        longitude: result.longitude
      });
      setSaveForFuture(false);
      setSelectedSavedPlaceId(null);
      setSelectedPoint({ latitude: result.latitude, longitude: result.longitude });
      setSearchQuery("");
      setSearchState(emptySearchState);
      void controllerRef.current?.cancel();
      setEditingCentre(false);
    } catch (error) {
      if (token !== placePickTokenRef.current) return;
      // Said inline under Nearby (never a system alert): the list was replaced while picking.
      const message = friendlyPlaceSearchError(error);
      if (message) setNearbyState((current) => ({ ...current, message }));
    } finally {
      if (token === placePickTokenRef.current) setResolvingSuggestion(false);
    }
  }

  function clearPlaceSearch() {
    supersedePlacePick();
    setSearchQuery("");
    setSearchState(emptySearchState);
    void controllerRef.current?.cancel();
  }

  function chooseSavedPlace(placeId: string | null) {
    setSelectedSavedPlaceId(placeId);
    setNewPlace(null);
    setSaveForFuture(false);
    setEditingCentre(false);
    clearPlaceSearch();
    const place = evidence.map.nearbySavedPlaces.find((candidate) => candidate.id === placeId);
    const point = place
      ? { longitude: place.point.coordinates[0], latitude: place.point.coordinates[1] }
      : pointFromEvidence(evidence);
    if (point) setSelectedPoint(point);
  }

  /** A saved place row: picks it, or (tapped again) goes back to the matched place. */
  function toggleSavedPlace(placeId: string) {
    const selected = !newPlace && selectedSavedPlaceId === placeId;
    chooseSavedPlace(selected && placeId !== baselinePlaceId ? baselinePlaceId : placeId);
  }

  /** Activity chips: a tap picks; a tap on the chosen chip clears it (a journey goes back to Commute automatically). */
  function toggleActivity(categoryId: string) {
    if (selectedCategoryId === categoryId) {
      setSelectedCategoryId(null);
      setCategoryTouched(!(isJourney && baselineCategoryId === null));
      return;
    }
    setSelectedCategoryId(categoryId);
    setCategoryTouched(true);
  }

  function useManualMapPin() {
    if (!selectedPoint || !manualPlaceName.trim()) {
      Alert.alert("Use map pin", "Move the pin if needed and enter a place name first.");
      return;
    }
    supersedePlacePick();
    setNewPlace({
      name: manualPlaceName.trim(),
      formattedAddress: null,
      latitude: selectedPoint.latitude,
      longitude: selectedPoint.longitude
    });
    setSaveForFuture(false);
    setSearchQuery("");
    setSearchState(emptySearchState);
    void controllerRef.current?.cancel();
    setSelectedSavedPlaceId(null);
    setEditingCentre(false);
    // The name stays, so reopening the pin to adjust it keeps what was used.
    setPinEditorOpen(false);
  }

  function parsedEdit() {
    if (!evidence.segment.stoppedAt || !stopAt) {
      setValidationError("This suggestion does not have a complete time range.");
      return null;
    }
    const parsed = parseLocationReviewWindow({
      baselineStartedAt: evidence.segment.startedAt,
      baselineStoppedAt: evidence.segment.stoppedAt,
      startDateText: formatLocationReviewDateInput(startAt),
      startDraftMs,
      startTimeText,
      stopDateText: formatLocationReviewDateInput(stopAt),
      stopDraftMs,
      stopTimeText
    });
    if (!parsed.value) {
      setValidationError(parsed.error);
      return null;
    }
    setValidationError(null);
    return buildLocationReviewEdit({
      categoryTouched,
      description,
      selectedCategoryId,
      window: parsed.value
    });
  }

  async function recordSuggestion() {
    if (saving) return;
    supersedePlacePick();
    Keyboard.dismiss();
    const edit = parsedEdit();
    if (!edit) return;
    const action: LocationReviewAction = newPlace && !saveForFuture
      ? { action: "record_poi_once", name: newPlace.name, edit }
      : buildLocationReviewResolutionAction({
          baselinePlaceId,
          edit,
          newPlace,
          selectedSavedPlaceId
        });
    await onResolve(
      action,
      journeyCopy
        ? journeyCopy.recorded
        : newPlace && saveForFuture
          ? "The place was saved and this visit was recorded."
          : newPlace
            ? "The visit was recorded with this place name."
          : "The visit was recorded."
    );
  }

  async function recordWithoutPlace() {
    if (saving) return;
    supersedePlacePick();
    Keyboard.dismiss();
    const edit = parsedEdit();
    if (!edit) return;
    await onResolve(
      buildLocationReviewResolutionAction({
        baselinePlaceId,
        edit,
        newPlace: null,
        selectedSavedPlaceId: null
      }),
      "The visit was recorded without a place."
    );
  }

  async function recordOnce() {
    if (saving) return;
    supersedePlacePick();
    const edit = parsedEdit();
    if (!edit) return;
    await onResolve(
      {
        action: "record_once",
        edit: {
          ...edit,
          ...(newPlace ? {} : { placeId: selectedSavedPlaceId })
        }
      },
      "This time was recorded once without saving a new place."
    );
  }

  const primaryLabel = saving
    ? "Saving…"
    : journeyCopy
      ? journeyCopy.primaryLabel
      : newPlace
        ? saveForFuture ? "Save place and record" : "Use once and record"
        : selectedSavedPlaceId !== baselinePlaceId
          ? "Use place and record"
          : "Record visit";
  const placeRowCount = (newPlace ? 1 : 0) +
    (baselinePlaceId ? 1 : 0) +
    evidence.map.nearbySavedPlaces.filter((place) => place.id !== baselinePlaceId).length;
  // Nearby shows under an empty (or one-letter) field once a search has started, unless every
  // result is already on screen above.
  const showNearby = searchQuery.trim().length < 2 && nearbyState.status !== "idle" &&
    (nearbyState.status !== "results" || nearbyChoices.length > 0);

  return (
    <>
      <ScrollView
        ref={scrollViewRef}
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => revealFocusedControl()}
        onScroll={(event) => {
          scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }}
        onScrollBeginDrag={() => {
          revealGenerationRef.current += 1;
        }}
        scrollEventThrottle={16}
        style={styles.settingsScrollView}
        contentContainerStyle={[styles.settingsScrollContent, editorStyles.scrollContent]}
      >
        <View style={styles.contentStack}>
          {/* Blocks 5e: one heading (the screen title says "Location evidence"), on the canvas. */}
          <Reanimated.View layout={localLayoutTransition(reduceMotion)} style={editorStyles.hero}>
            <Text {...mobileTextProps("screenHeading")} accessibilityRole="header" style={editorStyles.heroTitle}>{locationActivityLabel(evidence)}</Text>
            <Text {...mobileTextProps("metadata")} style={styles.reviewMetaLine}>{formatEvidenceTimeRange(evidence)}</Text>
            {stopsHeading ? (
              // Refreshed evidence can add or remove stops after the screen
              // settles: they enter, leave and reflow with the screen's local motion.
              <Reanimated.View
                entering={localPresenceEntering(reduceMotion)}
                exiting={localPresenceExiting(reduceMotion)}
                layout={localLayoutTransition(reduceMotion)}
                style={editorStyles.tripStops}
              >
                <Text {...mobileTextProps("metadata")} accessibilityRole="header" style={editorStyles.fieldLabel}>{stopsHeading}</Text>
                {stopRows.map((row, index) => (
                  <Reanimated.View
                    key={row.key}
                    entering={localPresenceEntering(reduceMotion)}
                    exiting={localPresenceExiting(reduceMotion)}
                    layout={localLayoutTransition(reduceMotion)}
                  >
                    {index > 0 ? <View style={editorStyles.tripStopDivider} /> : null}
                    <Text
                      {...mobileTextProps("body")}
                      accessibilityLabel={`Stop ${index + 1} of ${stopRows.length}: ${row.accessibilityLabel}`}
                      style={editorStyles.tripStopRow}
                    >
                      {row.label}
                    </Text>
                  </Reanimated.View>
                ))}
              </Reanimated.View>
            ) : null}
          </Reanimated.View>

          {statusMessage?.trim() ? (
            <Reanimated.View
              entering={localPresenceEntering(reduceMotion)}
              exiting={localPresenceExiting(reduceMotion)}
              layout={localLayoutTransition(reduceMotion)}
              style={styles.queueDiagnosticCard}
            >
              <Text {...mobileTextProps("body")} accessibilityLiveRegion="polite" style={styles.reviewMetaLine}>{statusMessage}</Text>
            </Reanimated.View>
          ) : null}
          {/* The map is its own rounded surface: no framing card around it, so no empty band of
              card shows above Where when the page is scrolled (staging feedback, 12 October). */}
          <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
            <LocationEvidenceMap
              appearance={theme.mode === "dark" ? "dark" : "light"}
              evidence={evidence}
              // Neutral map marks (UIA-027), as the place editor draws a place without an activity.
              accentColor={theme.textPrimary}
              surfaceColor={theme.surfaceMuted}
              textColor={theme.textSecondary}
              dangerColor={theme.danger}
              selectedPoint={evidence.segment.kind === "stay" ? selectedPoint : undefined}
              selectedPointRadiusMeters={evidence.segment.kind === "stay" ? 80 : undefined}
              selectedSavedPlaceId={selectedSavedPlaceId}
              showDetails={false}
              onSelectPoint={evidence.segment.kind === "stay" && editingCentre ? moveMapPin : undefined}
              onSelectSavedPlace={evidence.segment.kind === "stay" ? chooseSavedPlace : undefined}
            />
          </Reanimated.View>

          {evidence.segment.kind === "stay" ? (
            <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
              <SettingsBlockGroup theme={theme} title="Where were you?">
                <View style={editorStyles.section}>
                  {/* Always mounted, so a row leaving (the last one included) can fade out in place; empty,
                      it cancels the section gap so nothing is reserved. */}
                  <Reanimated.View
                    accessibilityRole="radiogroup"
                    layout={localLayoutTransition(reduceMotion)}
                    style={[editorStyles.placeChoices, placeRowCount === 0 ? editorStyles.placeChoicesEmpty : null]}
                  >
                    {newPlace ? (
                      <Reanimated.View
                        entering={localPresenceEntering(reduceMotion)}
                        exiting={localPresenceExiting(reduceMotion)}
                        key="new-place"
                        layout={localLayoutTransition(reduceMotion)}
                      >
                        <PlaceChoice
                          detail={newPlace.formattedAddress || "Pinned on the map"}
                          name={newPlace.name}
                          onPress={() => undefined}
                          onRemove={saving ? undefined : () => chooseSavedPlace(baselinePlaceId)}
                          selected
                          theme={theme}
                        />
                      </Reanimated.View>
                    ) : null}
                    {baselinePlaceId ? (
                      <Reanimated.View key={`saved-${baselinePlaceId}`} layout={localLayoutTransition(reduceMotion)}>
                        <PlaceChoice
                          detail="Matched place"
                          name={baselinePlaceName}
                          onPress={() => toggleSavedPlace(baselinePlaceId)}
                          selected={!newPlace && selectedSavedPlaceId === baselinePlaceId}
                          theme={theme}
                        />
                      </Reanimated.View>
                    ) : null}
                    {evidence.map.nearbySavedPlaces.filter((place) => place.id !== baselinePlaceId).map((place) => (
                      <Reanimated.View key={`saved-${place.id}`} layout={localLayoutTransition(reduceMotion)}>
                        <PlaceChoice
                          detail={`Saved place · ${formatNearbyDistance(place.distanceMeters)}`}
                          name={place.name}
                          onPress={() => toggleSavedPlace(place.id)}
                          selected={!newPlace && selectedSavedPlaceId === place.id}
                          theme={theme}
                        />
                      </Reanimated.View>
                    ))}
                  </Reanimated.View>

                  {newPlace ? (
                    <Reanimated.View
                      entering={localPresenceEntering(reduceMotion)}
                      exiting={localPresenceExiting(reduceMotion)}
                      layout={localLayoutTransition(reduceMotion)}
                      style={editorStyles.toggleRow}
                    >
                      <View style={editorStyles.answerText}>
                        <Text {...mobileTextProps("control")} style={editorStyles.toggleTitle}>Save for future visits</Text>
                        <Text {...mobileTextProps("body")} style={editorStyles.answerMeta}>
                          {saveForFuture ? "Saved as a place Dayframe can recognise next time." : "Used for this visit only."}
                        </Text>
                      </View>
                      <SettingsSwitch
                        disabled={saving}
                        label="Save for future visits"
                        onValueChange={setSaveForFuture}
                        theme={theme}
                        value={saveForFuture}
                      />
                    </Reanimated.View>
                  ) : null}

                  <Reanimated.View layout={localLayoutTransition(reduceMotion)} style={editorStyles.searchField}>
                    <DayframeIcon color={theme.textSecondary} glyph="search" size={18} />
                    <TextInput
                      ref={searchInputRef}
                      {...mobileTextProps("input")}
                      accessibilityHint="Nearby places are listed below while the field is empty"
                      accessibilityLabel="Search places"
                      autoCapitalize="words"
                      autoCorrect={false}
                      editable={Boolean(provider) && !saving}
                      onChangeText={changeSearchQuery}
                      onBlur={() => blurRevealControl(searchInputRef.current)}
                      onFocus={() => {
                        setTimeWheel(null);
                        focusRevealControl(searchInputRef.current);
                      }}
                      placeholder={provider ? "Search for a place or address" : "Place search unavailable in this build"}
                      placeholderTextColor={theme.textSecondary}
                      returnKeyType="search"
                      style={editorStyles.searchInput}
                      value={searchQuery}
                    />
                    {searchQuery ? (
                      <Pressable
                        accessibilityLabel="Clear place search"
                        accessibilityRole="button"
                        disabled={saving}
                        onPress={clearPlaceSearch}
                        style={pressable(editorStyles.iconButton, styles.buttonPressed)}
                      >
                        <DayframeIcon color={theme.textSecondary} glyph="x" size={17} />
                      </Pressable>
                    ) : null}
                  </Reanimated.View>

                  {showNearby ? (
                    // Under the empty field: the nearest few places around the visit (D3). A query of
                    // two characters replaces them with search results; clearing brings them back.
                    <Reanimated.View
                      entering={localPresenceEntering(reduceMotion, "rise")}
                      exiting={localPresenceExiting(reduceMotion)}
                      layout={localLayoutTransition(reduceMotion)}
                      style={editorStyles.resultSection}
                      testID="location-evidence-nearby"
                    >
                      <Text {...mobileTextProps("metadata")} style={editorStyles.fieldLabel}>Nearby</Text>
                      {nearbyState.status === "loading" ? (
                        <Text {...mobileTextProps("body")} accessibilityLiveRegion="polite" style={editorStyles.helperText}>Finding places nearby…</Text>
                      ) : null}
                      {nearbyState.message ? (
                        <Text {...mobileTextProps("body")} accessibilityLiveRegion="polite" style={editorStyles.helperText}>{nearbyState.message}</Text>
                      ) : null}
                      {nearbyChoices.length > 0 ? (
                        <View accessibilityLabel={`${nearbyChoices.length} places nearby`} style={editorStyles.suggestionList}>
                          {nearbyChoices.map((place, index) => (
                            <ResultRow
                              detail={[formatNearbyDistance(place.distanceMeters), place.subtitle].filter(Boolean).join(" · ")}
                              disabled={resolvingSuggestion || saving}
                              divider={index > 0}
                              key={place.id}
                              onPress={() => void chooseNearbyPlace(place)}
                              testID={`location-evidence-nearby-${index}`}
                              theme={theme}
                              title={place.title}
                            />
                          ))}
                        </View>
                      ) : null}
                    </Reanimated.View>
                  ) : null}

                  {searchState.status === "loading" ? (
                    <Text {...mobileTextProps("body")} accessibilityLiveRegion="polite" style={editorStyles.helperText}>Searching…</Text>
                  ) : null}
                  {searchState.status === "typing" && searchQuery.trim().length === 1 ? (
                    <Text {...mobileTextProps("body")} style={editorStyles.helperText}>Type one more character to search.</Text>
                  ) : null}
                  {searchState.message ? (
                    <Text {...mobileTextProps("body")} accessibilityLiveRegion="polite" style={editorStyles.helperText}>{searchState.message}</Text>
                  ) : null}
                  {searchState.suggestions.length > 0 ? (
                    <Reanimated.View
                      accessibilityLabel={`${searchState.suggestions.length} place search results`}
                      entering={localPresenceEntering(reduceMotion, "rise")}
                      exiting={localPresenceExiting(reduceMotion)}
                      layout={localLayoutTransition(reduceMotion)}
                      style={editorStyles.suggestionList}
                    >
                      {searchState.suggestions.map((suggestion, index) => (
                        <ResultRow
                          detail={suggestion.subtitle}
                          disabled={resolvingSuggestion || saving}
                          divider={index > 0}
                          key={suggestion.id}
                          onPress={() => void chooseSuggestion(suggestion)}
                          theme={theme}
                          title={suggestion.title}
                        />
                      ))}
                    </Reanimated.View>
                  ) : null}
                </View>
              </SettingsBlockGroup>
            </Reanimated.View>
          ) : null}

          <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
            <SettingsBlockGroup theme={theme} title="What did you do?">
            <View style={editorStyles.section}>
              <TextInput
                ref={activityInputRef}
                {...mobileTextProps("input")}
                accessibilityLabel="Name"
                editable={!saving}
                maxLength={500}
                onChangeText={setDescription}
                onBlur={() => blurRevealControl(activityInputRef.current)}
                onFocus={() => {
                  setTimeWheel(null);
                  focusRevealControl(activityInputRef.current);
                }}
                placeholder={journeyCopy?.placeholder ?? "Add a name (optional)"}
                placeholderTextColor={theme.textSecondary}
                style={styles.textInput}
                value={description}
              />
              {/* D1: the entry sheet's Blocks chips (chosen, pinned, recent; wrapped, never a
                  sideways scroller), then All activities with search and Create. */}
              <ActivityChipRow testID="location-evidence-activity-chips">
                {chipActivities.map((category) => (
                  <ActivityChip
                    activity={category}
                    key={category.id}
                    onPress={() => toggleActivity(category.id)}
                    selected={selectedCategoryId === category.id}
                    testID={`location-evidence-activity-${category.id}`}
                    theme={theme}
                  />
                ))}
                <AllActivitiesChip
                  count={categories.length}
                  disabled={saving}
                  onPress={() => {
                    Keyboard.dismiss();
                    setTimeWheel(null);
                    setActivityPickerOpen(true);
                  }}
                  pressedStyle={styles.buttonPressed}
                  testID="location-evidence-activity-all"
                  theme={theme}
                />
              </ActivityChipRow>
              {automaticCommute ? (
                <Reanimated.View
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  layout={localLayoutTransition(reduceMotion)}
                >
                  <Text {...mobileTextProps("body")} style={editorStyles.helperText}>
                    Commute automatically, unless you choose an activity.
                  </Text>
                </Reanimated.View>
              ) : null}
            </View>
            </SettingsBlockGroup>
          </Reanimated.View>

          <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
            <SettingsBlockGroup theme={theme} title="When?">
            <View style={editorStyles.section}>
              <View style={[editorStyles.timeGroups, fontScale >= 1.45 ? editorStyles.timeGroupsStacked : null]}>
                <View style={editorStyles.timeGroup}>
                  <Text {...mobileTextProps("metadata")} style={editorStyles.fieldLabel}>Start</Text>
                  {/* A11b: a tap opens the time wheel under the row; VoiceOver adjusts the field itself. */}
                  <Pressable
                    accessibilityActions={TIME_FIELD_ACCESSIBILITY_ACTIONS}
                    accessibilityLabel="Start"
                    accessibilityRole="adjustable"
                    accessibilityState={{ disabled: saving, expanded: timeWheel?.target === "start" }}
                    accessibilityValue={{ text: startTimeText || "No time" }}
                    accessible={typingTarget !== "start"}
                    disabled={saving}
                    onAccessibilityAction={(event) => handleTimeFieldAccessibilityAction("start", event.nativeEvent.actionName)}
                    onPress={() => openTimeWheel("start")}
                    style={[
                      editorStyles.timeField,
                      timeWheel?.target === "start" ? editorStyles.timeFieldActive : null,
                      timeWheel && timeWheel.target !== "start" ? editorStyles.timeFieldStepBack : null
                    ]}
                    testID="location-review-start-time"
                  >
                    <TextInput
                      ref={startTimeInputRef}
                      {...mobileTextProps("input")}
                      accessibilityElementsHidden={typingTarget !== "start"}
                      accessibilityLabel="Start time"
                      caretHidden
                      contextMenuHidden
                      editable={!saving && typingTarget === "start"}
                      importantForAccessibility={typingTarget === "start" ? "auto" : "no-hide-descendants"}
                      keyboardType="number-pad"
                      maxLength={5}
                      onBlur={() => {
                        setTypingTarget((current) => (current === "start" ? null : current));
                        blurRevealControl(startTimeInputRef.current);
                      }}
                      onChangeText={(value) => {
                        setStartTimeText(formatLocationReviewEditableTime(value));
                        setValidationError(null);
                      }}
                      onFocus={() => focusRevealControl(startTimeInputRef.current)}
                      placeholder="09:00"
                      placeholderTextColor={theme.textSecondary}
                      pointerEvents={typingTarget === "start" ? "auto" : "none"}
                      selectTextOnFocus
                      style={editorStyles.timeInput}
                      value={startTimeText}
                    />
                  </Pressable>
                </View>
                <View style={editorStyles.timeGroup}>
                  <Text {...mobileTextProps("metadata")} style={editorStyles.fieldLabel}>End</Text>
                  {stopAt ? (
                    <Pressable
                      accessibilityActions={TIME_FIELD_ACCESSIBILITY_ACTIONS}
                      accessibilityLabel="End"
                      accessibilityRole="adjustable"
                      accessibilityState={{ disabled: saving, expanded: timeWheel?.target === "end" }}
                      accessibilityValue={{ text: stopTimeText || "No time" }}
                      accessible={typingTarget !== "end"}
                      disabled={saving}
                      onAccessibilityAction={(event) => handleTimeFieldAccessibilityAction("end", event.nativeEvent.actionName)}
                      onPress={() => openTimeWheel("end")}
                      style={[
                        editorStyles.timeField,
                        timeWheel?.target === "end" ? editorStyles.timeFieldActive : null,
                        timeWheel && timeWheel.target !== "end" ? editorStyles.timeFieldStepBack : null
                      ]}
                      testID="location-review-end-time"
                    >
                      <TextInput
                        ref={stopTimeInputRef}
                        {...mobileTextProps("input")}
                        accessibilityElementsHidden={typingTarget !== "end"}
                        accessibilityLabel="End time"
                        caretHidden
                        contextMenuHidden
                        editable={!saving && typingTarget === "end"}
                        importantForAccessibility={typingTarget === "end" ? "auto" : "no-hide-descendants"}
                        keyboardType="number-pad"
                        maxLength={5}
                        onBlur={() => {
                          setTypingTarget((current) => (current === "end" ? null : current));
                          blurRevealControl(stopTimeInputRef.current);
                        }}
                        onChangeText={(value) => {
                          setStopTimeText(formatLocationReviewEditableTime(value));
                          setValidationError(null);
                        }}
                        onFocus={() => focusRevealControl(stopTimeInputRef.current)}
                        placeholder="17:30"
                        placeholderTextColor={theme.textSecondary}
                        pointerEvents={typingTarget === "end" ? "auto" : "none"}
                        selectTextOnFocus
                        style={editorStyles.timeInput}
                        value={stopTimeText}
                      />
                    </Pressable>
                  ) : (
                    <View style={editorStyles.answerRow}>
                      <Text {...mobileTextProps("metadata")} style={editorStyles.answerMeta}>Ongoing</Text>
                    </View>
                  )}
                </View>
                <View style={editorStyles.timeGroup}>
                  <Text {...mobileTextProps("metadata")} style={editorStyles.fieldLabel}>
                    {durationLabel}
                  </Text>
                  <View
                    accessible
                    accessibilityLabel={`${durationLabel} ${editableDuration}`}
                    style={editorStyles.timeField}
                  >
                    <Text {...mobileTextProps("numeric")} style={editorStyles.durationValue}>{editableDuration}</Text>
                  </View>
                </View>
              </View>
              {timeWheel ? (
                <TimeWheelPanel
                  busy={saving}
                  key={`location-time-wheel-${timeWheel.presentationId}`}
                  model={{
                    colorScheme: theme.mode === "dark" ? "dark" : "light",
                    maximumMs: null,
                    minimumMs: null,
                    minuteInterval: timeWheelMinuteInterval(fieldTimeMs(timeWheel.target), timeWheelStepPref === 1),
                    modelVersion: 1,
                    presentationId: timeWheel.presentationId,
                    revision: timeWheelRevision,
                    valueMs: fieldTimeMs(timeWheel.target)
                  }}
                  // Start, End and Duration share the row in thirds; stacked at large text.
                  notch={fontScale >= 1.45 ? null : timeWheel.target === "start" ? "16.5%" : "50%"}
                  onDone={() => closeTimeWheel({ haptic: true })}
                  onTimeChange={handleTimeWheelChange}
                  onToggleEveryMinute={toggleEveryMinute}
                  onTypeTime={() => typeFieldTime(timeWheel.target)}
                  pressedStyle={styles.buttonPressed}
                  reduceMotion={reduceMotion}
                  targetLabel={timeWheel.target === "end" ? "End" : "Start"}
                  testIDPrefix="location-review-time-wheel"
                  theme={theme}
                  wheelHeight={180}
                />
              ) : null}
              {validationError ? (
                <Text {...mobileTextProps("body")} accessibilityLiveRegion="assertive" style={editorStyles.errorText}>{validationError}</Text>
              ) : null}
            </View>
            </SettingsBlockGroup>
          </Reanimated.View>

          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void recordSuggestion()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && !saving ? styles.buttonPressed : null,
              saving ? styles.buttonDisabled : null
            ]}
          >
            <Text {...mobileTextProps("control")} style={styles.primaryButtonText}>{primaryLabel}</Text>
          </Pressable>

          {/* More options is a plain list of the other ways to resolve this moment (D7). */}
          <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
            <SettingsBlockGroup theme={theme} title="More options">
              {evidence.segment.kind === "stay" ? (
                <>
                  <SettingsBlockRow
                    accessibilityHint={editingCentre ? "Stops moving the pin" : "Lets you tap the map to place a pin"}
                    disabled={saving}
                    divider={false}
                    onPress={togglePinEditor}
                    subtitle={editingCentre ? "Tap the map to move the pin, then name it below" : "Name a spot on the map yourself"}
                    testID="location-evidence-map-pin"
                    theme={theme}
                    title={editingCentre ? "Finish moving pin" : "Use a map pin instead"}
                  />
                  {pinEditorOpen ? (
                    <Reanimated.View
                      entering={localPresenceEntering(reduceMotion)}
                      exiting={localPresenceExiting(reduceMotion)}
                      layout={localLayoutTransition(reduceMotion)}
                      style={editorStyles.inlineRow}
                    >
                      <TextInput
                        accessibilityLabel="New saved place name"
                        {...mobileTextProps("input")}
                        editable={!saving}
                        onChangeText={renameMapPin}
                        onFocus={() => setTimeWheel(null)}
                        placeholder="Place name"
                        placeholderTextColor={theme.textSecondary}
                        style={editorStyles.inlineInput}
                        value={manualPlaceName}
                      />
                      <SettingsPillButton
                        disabled={saving || !selectedPoint || !manualPlaceName.trim()}
                        label="Use this pin"
                        onPress={useManualMapPin}
                        theme={theme}
                      />
                    </Reanimated.View>
                  ) : null}
                </>
              ) : null}

              {/* Each row moves with the shared layout transition when a row above opens or closes. */}
              {evidence.suggestedSplitPoints.map((split, index) => (
                <Reanimated.View key={split.at} layout={localLayoutTransition(reduceMotion)}>
                <SettingsBlockRow
                  disabled={saving}
                  divider={evidence.segment.kind === "stay" || index > 0}
                  onPress={() => setSelectedSplitAt(split.at)}
                  subtitle="Makes two moments to review"
                  theme={theme}
                  title={`Split near ${formatTime(split.at)}`}
                />
                </Reanimated.View>
              ))}
              {selectedSplitAt ? (
                <Reanimated.View
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  layout={localLayoutTransition(reduceMotion)}
                >
                  <SettingsBlockRow
                    control={
                      <SettingsPillButton
                        accessibilityLabel={`Confirm split near ${formatTime(selectedSplitAt)}`}
                        disabled={saving}
                        label="Confirm split"
                        onPress={() => void onResolve(
                          { action: "split", splitAt: selectedSplitAt },
                          "The detected time was split into two review items."
                        )}
                        theme={theme}
                      />
                    }
                    subtitle={`After: ${formatTime(selectedSplitAt)}–${evidence.segment.stoppedAt ? formatTime(evidence.segment.stoppedAt) : "ongoing"}`}
                    theme={theme}
                    title={`Before: ${formatTime(evidence.segment.startedAt)}–${formatTime(selectedSplitAt)}`}
                  />
                </Reanimated.View>
              ) : null}

              {adjacentReview && evidence.segment.kind === "stay" ? (
                <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
                <SettingsBlockRow
                  disabled={saving}
                  onPress={() => void onResolve({
                    action: "merge",
                    adjacentReviewItemId: adjacentReview.id,
                    acknowledgeContradictoryEvidence: false
                  }, "The adjacent visits were merged into one review item.")}
                  subtitle="Joins it with the visit just before or after"
                  theme={theme}
                  title="Merge with adjacent visit"
                />
                </Reanimated.View>
              ) : null}

              {baselinePlaceId && evidence.segment.kind === "stay" ? (
                <Reanimated.View
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  layout={localLayoutTransition(reduceMotion)}
                >
                <SettingsBlockRow
                  disabled={saving}
                  onPress={() => void recordWithoutPlace()}
                  subtitle={`Logs this time, not at ${baselinePlaceName}`}
                  testID="location-evidence-record-without-place"
                  theme={theme}
                  title="Record without a place"
                />
                </Reanimated.View>
              ) : null}

              <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
              <SettingsBlockRow
                disabled={saving}
                divider={evidence.segment.kind === "stay" || evidence.suggestedSplitPoints.length > 0 || Boolean(adjacentReview)}
                onPress={() => void recordOnce()}
                subtitle="Logs this time without changing or saving a place"
                testID="location-evidence-record-once"
                theme={theme}
                title="Record once"
              />
              </Reanimated.View>
              <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
              <SettingsBlockRow
                danger
                disabled={saving}
                onPress={() => void onResolve({ action: "ignore_once_location" }, "This suggestion was ignored.")}
                subtitle="Nothing is logged"
                testID="location-evidence-skip"
                theme={theme}
                title="Skip this suggestion"
              />
              </Reanimated.View>
            </SettingsBlockGroup>
          </Reanimated.View>
        </View>
      </ScrollView>
      {activityPickerOpen ? (
        <ActivityPickerSheet
          activities={categories}
          onClose={() => setActivityPickerOpen(false)}
          onCreate={onCreateActivity}
          onPick={(categoryId) => {
            setSelectedCategoryId(categoryId);
            setCategoryTouched(true);
            setChipAnchorId(categoryId);
          }}
          recentIds={recentActivityIds}
          reduceMotion={reduceMotion}
          selectedId={selectedCategoryId}
          styles={styles}
          theme={theme}
        />
      ) : null}
    </>
  );
}

function PlaceChoice({
  detail,
  name,
  onPress,
  onRemove,
  selected,
  theme
}: {
  detail: string;
  name: string;
  onPress: () => void;
  /** A chosen new place can be removed, which goes back to the matched place (or none). */
  onRemove?: () => void;
  selected: boolean;
  theme: MobileTheme;
}) {
  return (
    <View
      style={[
        placeChoiceStyles.row,
        // Neutral selection (UIA-027): the chosen row is raised and checked, never coral.
        { backgroundColor: selected ? theme.surfaceMuted : theme.surfaceInset }
      ]}
    >
      <Pressable
        accessibilityLabel={`${name}, ${detail}`}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected, selected }}
        onPress={onPress}
        style={({ pressed }) => [placeChoiceStyles.main, pressed ? { opacity: 0.72 } : null]}
      >
        <View style={placeChoiceStyles.text}>
          <Text {...mobileTextProps("itemTitle")} style={[placeChoiceStyles.name, { color: theme.textPrimary }]}>{name}</Text>
          <Text {...mobileTextProps("metadata")} numberOfLines={2} style={[placeChoiceStyles.detail, { color: theme.textSecondary }]}>{detail}</Text>
        </View>
        {selected ? <DayframeIcon color={theme.textPrimary} glyph="check" size={17} strokeWidth={2.2} /> : null}
      </Pressable>
      {onRemove ? (
        <Pressable
          accessibilityLabel={`Remove ${name}`}
          accessibilityRole="button"
          hitSlop={4}
          onPress={onRemove}
          style={({ pressed }) => [placeChoiceStyles.remove, pressed ? { opacity: 0.72 } : null]}
          testID="location-evidence-remove-place"
        >
          <DayframeIcon color={theme.textSecondary} glyph="x" size={16} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** One row of the nearby or search list: a place glyph, the title and a detail line. */
function ResultRow({
  detail,
  disabled,
  divider,
  onPress,
  testID,
  theme,
  title
}: {
  detail: string | null;
  disabled: boolean;
  divider: boolean;
  onPress: () => void;
  testID?: string;
  theme: MobileTheme;
  title: string;
}) {
  return (
    <Pressable
      accessibilityLabel={[title, detail].filter(Boolean).join(", ")}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        resultRowStyles.row,
        divider ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth } : null,
        pressed ? { opacity: 0.72 } : null
      ]}
      testID={testID}
    >
      <ActivityGlyph name="place" color={theme.textPrimary} />
      <View style={resultRowStyles.text}>
        <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[resultRowStyles.title, { color: theme.textPrimary }]}>{title}</Text>
        {detail ? (
          <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[resultRowStyles.detail, { color: theme.textSecondary }]}>{detail}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** "40 m away", "1.2 km away": distances from the visit, rounded for reading. */
function formatNearbyDistance(meters: number) {
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m away`;
  return `${(meters / 1000).toFixed(1)} km away`;
}

function ActivityGlyph({ name, color }: { name: LocationActivityGlyphName; color: string }) {
  if (name === "home") {
    return <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="m4 11 8-7 8 7v9h-6v-6h-4v6H4Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={1.9} /></Svg>;
  }
  if (name === "work") {
    return <Svg width={20} height={20} viewBox="0 0 24 24"><Rect x={4} y={7} width={16} height={12} rx={2} fill="none" stroke={color} strokeWidth={1.9} /><Path d="M9 7V5h6v2M4 12h16" fill="none" stroke={color} strokeWidth={1.9} /></Svg>;
  }
  if (name === "walk") {
    return <Svg width={20} height={20} viewBox="0 0 24 24"><SvgCircle cx={13} cy={4.5} r={2} fill="none" stroke={color} strokeWidth={1.8} /><Path d="m11 8-2 5 3 2 1 5M11 10l4 2 2-3M9 13l-3 6" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} /></Svg>;
  }
  if (name === "exercise") {
    return <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M5 9v6M8 7v10M16 7v10M19 9v6M8 12h8" fill="none" stroke={color} strokeLinecap="round" strokeWidth={2} /></Svg>;
  }
  if (name === "sleep") {
    return <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M18 16.5A8 8 0 0 1 8 6a7 7 0 1 0 10 10.5Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={1.9} /></Svg>;
  }
  if (name === "shopping") {
    return <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M6 8h12l1 12H5L6 8Zm3 0a3 3 0 0 1 6 0" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={1.9} /></Svg>;
  }
  if (name === "food") {
    return <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M7 3v7M4.5 3v4.5A2.5 2.5 0 0 0 7 10v11M9.5 3v4.5A2.5 2.5 0 0 1 7 10M16 3v18M16 3c4 2 4 8 0 10" fill="none" stroke={color} strokeLinecap="round" strokeWidth={1.8} /></Svg>;
  }
  if (name === "commute") {
    return <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M5 17h14M7 17l1-7h8l1 7M9 10l1-3h4l1 3M8 14h.01M16 14h.01" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} /></Svg>;
  }
  return <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={1.9} /><SvgCircle cx={12} cy={10} r={2} fill="none" stroke={color} strokeWidth={1.8} /></Svg>;
}

function pointFromEvidence(evidence: LocationReviewEvidenceDto) {
  return evidence.map.centre ? {
    longitude: evidence.map.centre.coordinates[0],
    latitude: evidence.map.centre.coordinates[1]
  } : null;
}

function placeForSelection(
  id: string | null,
  nearby: LocationReviewEvidenceDto["map"]["nearbySavedPlaces"],
  places: Place[]
) {
  if (!id) return null;
  const nearbyPlace = nearby.find((place) => place.id === id);
  if (nearbyPlace) return nearbyPlace;
  // Bootstrap places carry the saved name; show a Home or Work place by its role label.
  const saved = places.find((place) => place.id === id);
  return saved ? { ...saved, name: placeDisplayName({ name: saved.name, role: saved.role ?? null }) } : null;
}

function locationActivityLabel(evidence: LocationReviewEvidenceDto) {
  if (evidence.segment.kind !== "commute") return evidence.display.title;
  if (evidence.segment.timeAway) return evidence.display.title || "Time away";
  const mode = travelModeLabel(evidence.segment.travelMode);
  return mode ? `Commute · ${mode}` : "Commute";
}

function formatEvidenceTimeRange(evidence: LocationReviewEvidenceDto) {
  const startedAt = new Date(evidence.segment.startedAt);
  const stoppedAt = evidence.segment.stoppedAt ? new Date(evidence.segment.stoppedAt) : null;
  const date = formatLocaleDate(startedAt, { day: "numeric", month: "short" });
  const start = formatTime(evidence.segment.startedAt);
  const stop = stoppedAt && evidence.segment.stoppedAt ? formatTime(evidence.segment.stoppedAt) : "ongoing";
  const durationSeconds = stoppedAt ? Math.max(0, (stoppedAt.getTime() - startedAt.getTime()) / 1000) : null;
  const approximateArrival = evidence.segment.approximateArrival;
  const prefix = approximateArrival ? "Approximate arrival · " : "";
  const duration = durationSeconds === null ? "" : ` · ${formatDuration(durationSeconds)}${approximateArrival ? " estimated" : ""}`;
  return `${prefix}${date} · ${start}–${stop}${duration}`;
}

function formatTime(value: string) {
  return formatLocaleDate(new Date(value), { hour: "2-digit", minute: "2-digit" });
}

function formatLocationReviewDuration(startedAt: string, stoppedAt: string) {
  return formatDuration(Math.max(0, (Date.parse(stoppedAt) - Date.parse(startedAt)) / 1000));
}

function createEditorStyles(theme: MobileTheme) {
  return StyleSheet.create({
    scrollContent: { paddingBottom: 34 },
    hero: { gap: 4, paddingHorizontal: 4 },
    heroTitle: { color: theme.textPrimary, fontFamily: MOBILE_DISPLAY_FONT.bold, fontSize: 30, letterSpacing: -0.6, lineHeight: 34 },
    section: { padding: 16, gap: 12 },
    inlineRow: {
      alignItems: "center",
      borderTopColor: theme.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 8
    },
    inlineInput: {
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      color: theme.textPrimary,
      flex: 1,
      fontSize: 15,
      minHeight: 44,
      paddingHorizontal: 12
    },
    tripStops: { marginTop: 8, gap: 6 },
    tripStopDivider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginBottom: 6 },
    tripStopRow: { color: theme.textPrimary, fontSize: 15, lineHeight: 20 },
    answerRow: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      borderRadius: 14,
      backgroundColor: theme.surfaceMuted,
      padding: 11
    },
    answerText: { flex: 1, minWidth: 0, gap: 2 },
    answerMeta: { color: theme.textSecondary, fontSize: 12, lineHeight: 17 },
    helperText: { color: theme.textSecondary, fontSize: 12, lineHeight: 17 },
    fieldLabel: { color: theme.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: "700" },
    placeChoices: { gap: 7 },
    // The section's 12-point gap, taken back while there is no place row.
    placeChoicesEmpty: { marginBottom: -12 },
    resultSection: { gap: 8 },
    searchField: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderRadius: 14,
      backgroundColor: theme.surfaceMuted,
      paddingLeft: 12,
      paddingRight: 4
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      color: theme.textPrimary,
      fontSize: 15,
      paddingVertical: 9
    },
    iconButton: { width: 44, height: 44, borderRadius: DAYFRAME_BLOCKS.radius.pill, alignItems: "center", justifyContent: "center" },
    suggestionList: { borderRadius: 14, backgroundColor: theme.surfaceMuted, overflow: "hidden" },
    toggleRow: {
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderRadius: 14,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    toggleTitle: { color: theme.textPrimary, fontSize: 14, lineHeight: 18, fontWeight: "700" },
    timeGroups: { flexDirection: "row", gap: 10 },
    timeGroupsStacked: { flexDirection: "column" },
    timeGroup: { flex: 1, minWidth: 0, gap: 6 },
    timeField: {
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 14,
      backgroundColor: theme.surfaceMuted,
      overflow: "hidden"
    },
    // A11b: the field the wheel is setting gets a soft neutral tint (never coral); the other steps back.
    timeFieldActive: { backgroundColor: colorWithAlpha(theme.textPrimary, 0.1, theme.surfaceMuted) },
    timeFieldStepBack: { opacity: 0.6 },
    timeInput: {
      width: "100%",
      minHeight: 48,
      color: theme.textPrimary,
      fontSize: 14,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
      textAlign: "center",
      paddingHorizontal: 8
    },
    durationValue: {
      color: theme.textPrimary,
      fontSize: 14,
      fontWeight: "600",
      fontVariant: ["tabular-nums"]
    },
    errorText: { color: theme.danger, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  });
}

/** VoiceOver's time field (A11b): swipe up/down moves 5 minutes; activate types the time. */
const TIME_FIELD_ACCESSIBILITY_ACTIONS = [
  { name: "increment" },
  { name: "decrement" },
  { name: "activate" },
  { name: "typeTime", label: "Type time" }
] as const;

/** `color` at `alpha` over the opaque `under`, as one opaque colour (both #RRGGBB). */
function colorWithAlpha(color: string, alpha: number, under: string) {
  const channels = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(color) || !/^#[0-9a-f]{6}$/i.test(under)) return under;
  const top = channels(color);
  const base = channels(under);
  return `#${top.map((value, index) => Math.round(value * alpha + base[index] * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
}

const placeChoiceStyles = StyleSheet.create({
  row: { minHeight: 54, flexDirection: "row", alignItems: "center", borderRadius: 14 },
  main: { flex: 1, minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 14, lineHeight: 18, fontWeight: "700" },
  detail: { fontSize: 12, lineHeight: 16 },
  remove: { width: 44, height: 44, marginRight: 4, borderRadius: DAYFRAME_BLOCKS.radius.pill, alignItems: "center", justifyContent: "center" }
});

const resultRowStyles = StyleSheet.create({
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 14, fontWeight: "700", lineHeight: 18 },
  detail: { fontSize: 12, lineHeight: 16 }
});
