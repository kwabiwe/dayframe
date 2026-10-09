import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import Reanimated from "react-native-reanimated";
import Svg, { Circle as SvgCircle, Path, Rect } from "react-native-svg";
import {
  paletteColorFor,
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
import { SettingsBlockGroup, SettingsBlockRow, SettingsPillButton } from "../settings/SettingsBlocks";
import {
  localLayoutTransition,
  localPresenceEntering,
  localPresenceExiting,
  useReduceMotionPreference
} from "@/lib/motion";
import { LocationEvidenceMap } from "./LocationEvidenceMap";

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
  onResolve,
  places,
  reviewItem,
  saving,
  statusMessage
}: {
  adjacentReview: MobileReviewItem | undefined;
  categories: Category[];
  evidence: LocationReviewEvidenceDto;
  isFocused: boolean;
  onResolve: (action: LocationReviewAction, successMessage: string) => Promise<void>;
  places: Place[];
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
  const [selectedSavedPlaceId, setSelectedSavedPlaceId] = useState<string | null>(baselinePlaceId);
  const [newPlace, setNewPlace] = useState<LocationReviewNewPlace | null>(null);
  const [selectedPoint, setSelectedPoint] = useState(() => pointFromEvidence(evidence));
  const [editingCentre, setEditingCentre] = useState(false);
  const [manualPlaceName, setManualPlaceName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchState, setSearchState] = useState<PlaceSearchState>(emptySearchState);
  const [nearbyState, setNearbyState] = useState<NearbyPointOfInterestState>(emptyNearbyState);
  const [saveForFuture, setSaveForFuture] = useState(false);
  const [resolvingSuggestion, setResolvingSuggestion] = useState(false);
  const [selectedSplitAt, setSelectedSplitAt] = useState<string | null>(null);
  const [startTimeText, setStartTimeText] = useState(() => formatLocationReviewTimeInput(startAt));
  const [stopTimeText, setStopTimeText] = useState(() => stopAt ? formatLocationReviewTimeInput(stopAt) : "");
  const [validationError, setValidationError] = useState<string | null>(null);

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

  useEffect(() => {
    const centre = pointFromEvidence(evidence);
    if (!isFocused || !nearbyProvider || evidence.segment.kind !== "stay" || baselinePlaceId || !centre) return;
    const controller = new NearbyPointOfInterestController(nearbyProvider, setNearbyState);
    nearbyControllerRef.current = controller;
    void controller.load(centre);
    return () => {
      controller.dispose();
      nearbyControllerRef.current = null;
    };
  }, [baselinePlaceId, evidence, isFocused, nearbyProvider]);

  const baselinePlace = placeForSelection(baselinePlaceId, evidence.map.nearbySavedPlaces, places);
  const nearbyChoices = visibleNearbyPlaces(nearbyState.places, baselinePlace);

  const selectedPlace = placeForSelection(
    selectedSavedPlaceId,
    evidence.map.nearbySavedPlaces,
    places
  );
  const placeAnswer = newPlace?.name || selectedPlace?.name || (
    selectedSavedPlaceId === baselinePlaceId ? evidence.display.placeName : null
  );
  const placeDetail = newPlace?.formattedAddress || (
    selectedSavedPlaceId === baselinePlaceId ? evidence.display.addressSummary : null
  );
  const editableWindow = stopAt
    ? parseLocationReviewWindow({
        baselineStartedAt: evidence.segment.startedAt,
        baselineStoppedAt: evidence.segment.stoppedAt ?? "",
        startDateText: formatLocationReviewDateInput(startAt),
        startTimeText,
        stopDateText: formatLocationReviewDateInput(stopAt),
        stopTimeText
      })
    : null;
  const editableDuration = editableWindow?.value
    ? formatLocationReviewDuration(editableWindow.value.startedAt, editableWindow.value.stoppedAt)
    : "—";

  function changeSearchQuery(value: string) {
    setSearchQuery(value);
    if (newPlace) setNewPlace(null);
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
    if (!controllerRef.current || resolvingSuggestion) return;
    setResolvingSuggestion(true);
    try {
      const result = await controllerRef.current.resolve(suggestion);
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
      setSearchQuery(result.title);
      setEditingCentre(false);
    } catch (error) {
      const message = friendlyPlaceSearchError(error);
      if (message) Alert.alert("Place search", message);
    } finally {
      setResolvingSuggestion(false);
    }
  }

  function chooseNearbyPlace(place: NearbyPointOfInterestState["places"][number]) {
    setNewPlace({
      name: place.name.trim(),
      formattedAddress: place.formattedAddress,
      latitude: place.latitude,
      longitude: place.longitude
    });
    setSaveForFuture(false);
    setSelectedSavedPlaceId(null);
    setSelectedPoint({ latitude: place.latitude, longitude: place.longitude });
    setSearchQuery("");
    setSearchState(emptySearchState);
    void controllerRef.current?.cancel();
    setEditingCentre(false);
  }

  function clearPlaceSearch() {
    setSearchQuery("");
    setNewPlace(null);
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
    if (place) {
      setSelectedPoint({
        longitude: place.point.coordinates[0],
        latitude: place.point.coordinates[1]
      });
    }
  }

  function useManualMapPin() {
    if (!selectedPoint || !manualPlaceName.trim()) {
      Alert.alert("Use map pin", "Move the pin if needed and enter a place name first.");
      return;
    }
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
    setManualPlaceName("");
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
      startTimeText,
      stopDateText: formatLocationReviewDateInput(stopAt),
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

  async function recordOnce() {
    if (saving) return;
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

          {statusMessage ? (
            <Reanimated.View
              entering={localPresenceEntering(reduceMotion)}
              exiting={localPresenceExiting(reduceMotion)}
              layout={localLayoutTransition(reduceMotion)}
              style={styles.queueDiagnosticCard}
            >
              <Text {...mobileTextProps("body")} accessibilityLiveRegion="polite" style={styles.reviewMetaLine}>{statusMessage}</Text>
            </Reanimated.View>
          ) : null}
          <Reanimated.View layout={localLayoutTransition(reduceMotion)} style={styles.panel}>
            <LocationEvidenceMap
              evidence={evidence}
              accentColor={theme.accent}
              surfaceColor={theme.surfaceMuted}
              textColor={theme.textSecondary}
              dangerColor={theme.danger}
              selectedPoint={evidence.segment.kind === "stay" ? selectedPoint : undefined}
              selectedPointRadiusMeters={evidence.segment.kind === "stay" ? 80 : undefined}
              selectedSavedPlaceId={selectedSavedPlaceId}
              showDetails={false}
              onSelectPoint={evidence.segment.kind === "stay" && editingCentre ? setSelectedPoint : undefined}
              onSelectSavedPlace={evidence.segment.kind === "stay" ? chooseSavedPlace : undefined}
            />
          </Reanimated.View>

          {evidence.segment.kind === "stay" ? (
            <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
              <SettingsBlockGroup theme={theme} title="Where were you?">
                <View style={editorStyles.section}>
                  {placeAnswer ? (
                    <View style={editorStyles.answerRow}>
                      <View style={editorStyles.answerIcon}>
                        <ActivityGlyph name="place" color={theme.accentText} />
                      </View>
                      <View style={editorStyles.answerText}>
                        <Text {...mobileTextProps("itemTitle")} style={editorStyles.answerTitle}>{placeAnswer}</Text>
                        {placeDetail ? <Text {...mobileTextProps("body")} style={editorStyles.answerMeta}>{placeDetail}</Text> : null}
                        {newPlace ? (
                          <Text {...mobileTextProps("body")} style={editorStyles.answerMeta}>
                            {saveForFuture
                              ? "This place will be saved for future visits."
                              : "This name will be used for this visit only."}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  ) : null}

                  {evidence.map.nearbySavedPlaces.length > 0 || baselinePlaceId ? (
                    <View style={editorStyles.placeChoices}>
                      {baselinePlaceId ? (
                        <PlaceChoice
                          detail="Current match"
                          name={evidence.display.placeName || "Current saved place"}
                          onPress={() => chooseSavedPlace(baselinePlaceId)}
                          selected={!newPlace && selectedSavedPlaceId === baselinePlaceId}
                          theme={theme}
                        />
                      ) : null}
                      {evidence.map.nearbySavedPlaces.filter((place) => place.id !== baselinePlaceId).map((place) => (
                        <PlaceChoice
                          detail={`${place.distanceMeters} m away`}
                          key={place.id}
                          name={place.name}
                          onPress={() => chooseSavedPlace(place.id)}
                          selected={!newPlace && selectedSavedPlaceId === place.id}
                          theme={theme}
                        />
                      ))}
                      <PlaceChoice
                        detail="Record without a saved-place match"
                        name="Record without choosing a place"
                        onPress={() => chooseSavedPlace(null)}
                        selected={!newPlace && selectedSavedPlaceId === null}
                        theme={theme}
                      />
                    </View>
                  ) : null}

                  {searchQuery.trim().length < 2 && nearbyState.status !== "idle" ? (
                    <Reanimated.View
                      entering={localPresenceEntering(reduceMotion, "rise")}
                      exiting={localPresenceExiting(reduceMotion)}
                      layout={localLayoutTransition(reduceMotion)}
                      style={editorStyles.resultSection}
                    >
                      <Text {...mobileTextProps("metadata")} style={editorStyles.fieldLabel}>Nearby places</Text>
                      {nearbyState.status === "loading" ? (
                        <Text {...mobileTextProps("body")} accessibilityLiveRegion="polite" style={editorStyles.helperText}>Finding nearby places…</Text>
                      ) : null}
                      {nearbyState.message ? (
                        <Text {...mobileTextProps("body")} accessibilityLiveRegion="polite" style={editorStyles.helperText}>{nearbyState.message}</Text>
                      ) : null}
                      {nearbyChoices.length > 0 ? (
                        <View accessibilityLabel={`${nearbyChoices.length} nearby places`} style={editorStyles.placeChoices}>
                          {nearbyChoices.map((place) => (
                            <PlaceChoice
                              detail={`${place.distanceMeters} m away`}
                              key={`${place.name}:${place.latitude}:${place.longitude}`}
                              name={place.name}
                              onPress={() => chooseNearbyPlace(place)}
                              selected={Boolean(
                                newPlace &&
                                newPlace.name === place.name &&
                                newPlace.latitude === place.latitude &&
                                newPlace.longitude === place.longitude
                              )}
                              theme={theme}
                            />
                          ))}
                        </View>
                      ) : null}
                    </Reanimated.View>
                  ) : null}

                  <Text {...mobileTextProps("metadata")} style={editorStyles.fieldLabel}>Search other places</Text>
                  <View style={editorStyles.searchField}>
                    <SearchGlyph color={theme.textSecondary} />
                    <TextInput
                      ref={searchInputRef}
                      {...mobileTextProps("input")}
                      accessibilityLabel="Search other places"
                      autoCapitalize="words"
                      autoCorrect={false}
                      editable={Boolean(provider) && !saving}
                      onChangeText={changeSearchQuery}
                      onBlur={() => blurRevealControl(searchInputRef.current)}
                      onFocus={() => focusRevealControl(searchInputRef.current)}
                      placeholder={provider ? "Search address or place" : "Place search unavailable in this build"}
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
                        <CloseGlyph color={theme.textSecondary} />
                      </Pressable>
                    ) : null}
                  </View>
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
                        <Pressable
                          accessibilityLabel={[suggestion.title, suggestion.subtitle].filter(Boolean).join(", ")}
                          accessibilityRole="button"
                          disabled={resolvingSuggestion || saving}
                          key={suggestion.id}
                          onPress={() => void chooseSuggestion(suggestion)}
                          style={({ pressed }) => [
                            editorStyles.suggestionRow,
                            index > 0 ? editorStyles.dividerTop : null,
                            pressed ? styles.buttonPressed : null
                          ]}
                        >
                          <ActivityGlyph name="place" color={theme.accentText} />
                          <View style={editorStyles.answerText}>
                            <Text {...mobileTextProps("itemTitle")} style={editorStyles.suggestionTitle}>{suggestion.title}</Text>
                            {suggestion.subtitle ? (
                              <Text {...mobileTextProps("metadata")} style={editorStyles.suggestionSubtitle} numberOfLines={2}>{suggestion.subtitle}</Text>
                            ) : null}
                          </View>
                        </Pressable>
                      ))}
                    </Reanimated.View>
                  ) : null}
                  {newPlace ? (
                    <View style={editorStyles.toggleRow}>
                      <View style={editorStyles.answerText}>
                        <Text {...mobileTextProps("control")} style={editorStyles.toggleTitle}>Save for future visits</Text>
                        <Text {...mobileTextProps("body")} style={editorStyles.answerMeta}>Creates a saved place that Dayframe can learn from later.</Text>
                      </View>
                      <Switch
                        accessibilityLabel="Save for future visits"
                        disabled={saving}
                        onValueChange={setSaveForFuture}
                        trackColor={{ false: theme.border, true: theme.accentSoft }}
                        thumbColor={saveForFuture ? theme.accent : theme.textSecondary}
                        value={saveForFuture}
                      />
                    </View>
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
                accessibilityLabel="Activity"
                editable={!saving}
                maxLength={500}
                onChangeText={setDescription}
                onBlur={() => blurRevealControl(activityInputRef.current)}
                onFocus={() => focusRevealControl(activityInputRef.current)}
                placeholder={journeyCopy?.placeholder ?? "Add activity (optional)"}
                placeholderTextColor={theme.textSecondary}
                style={styles.textInput}
                value={description}
              />
              <Text {...mobileTextProps("metadata")} style={editorStyles.fieldLabel}>Activity</Text>
              <ScrollView
                contentContainerStyle={editorStyles.categoryScroller}
                horizontal
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
              >
                {isJourney && baselineCategoryId === null ? (
                  <CategoryChoice
                    category={null}
                    label="Commute automatically"
                    onPress={() => {
                      setSelectedCategoryId(null);
                      setCategoryTouched(false);
                    }}
                    selected={!categoryTouched}
                    theme={theme}
                  />
                ) : null}
                <CategoryChoice
                  category={null}
                  onPress={() => {
                    setSelectedCategoryId(null);
                    setCategoryTouched(true);
                  }}
                  selected={selectedCategoryId === null && (
                    categoryTouched || !isJourney || baselineCategoryId !== null
                  )}
                  theme={theme}
                />
                {categories.map((category) => (
                  <CategoryChoice
                    category={category}
                    key={category.id}
                    onPress={() => {
                      setSelectedCategoryId(category.id);
                      setCategoryTouched(true);
                    }}
                    selected={selectedCategoryId === category.id}
                    theme={theme}
                  />
                ))}
              </ScrollView>
            </View>
            </SettingsBlockGroup>
          </Reanimated.View>

          <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
            <SettingsBlockGroup theme={theme} title="When?">
            <View style={editorStyles.section}>
              <View style={[editorStyles.timeGroups, fontScale >= 1.45 ? editorStyles.timeGroupsStacked : null]}>
                <View style={editorStyles.timeGroup}>
                  <Text {...mobileTextProps("metadata")} style={editorStyles.fieldLabel}>Start</Text>
                  <View style={editorStyles.timeField}>
                    <TextInput
                      {...mobileTextProps("input")}
                      accessibilityLabel="Start time"
                      caretHidden
                      contextMenuHidden
                      editable={!saving}
                      keyboardType="number-pad"
                      maxLength={5}
                      onChangeText={(value) => {
                        setStartTimeText(formatLocationReviewEditableTime(value));
                        setValidationError(null);
                      }}
                      placeholder="09:00"
                      placeholderTextColor={theme.textSecondary}
                      selectTextOnFocus
                      style={editorStyles.timeInput}
                      value={startTimeText}
                    />
                  </View>
                </View>
                <View style={editorStyles.timeGroup}>
                  <Text {...mobileTextProps("metadata")} style={editorStyles.fieldLabel}>End</Text>
                  {stopAt ? (
                    <View style={editorStyles.timeField}>
                      <TextInput
                        {...mobileTextProps("input")}
                        accessibilityLabel="End time"
                        caretHidden
                        contextMenuHidden
                        editable={!saving}
                        keyboardType="number-pad"
                        maxLength={5}
                        onChangeText={(value) => {
                          setStopTimeText(formatLocationReviewEditableTime(value));
                          setValidationError(null);
                        }}
                        placeholder="17:30"
                        placeholderTextColor={theme.textSecondary}
                        selectTextOnFocus
                        style={editorStyles.timeInput}
                        value={stopTimeText}
                      />
                    </View>
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
                    onPress={() => setEditingCentre((current) => !current)}
                    subtitle={editingCentre ? "Tap the map to move the pin, then name it below" : "Name a spot on the map yourself"}
                    testID="location-evidence-map-pin"
                    theme={theme}
                    title={editingCentre ? "Finish moving pin" : "Use a map pin instead"}
                  />
                  {/* Stays while a name is drafted, so finishing the pin never hides Use this pin. */}
                  {editingCentre || manualPlaceName.trim() ? (
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
                        onChangeText={setManualPlaceName}
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

              <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
              <SettingsBlockRow
                disabled={saving}
                divider={evidence.segment.kind === "stay" || evidence.suggestedSplitPoints.length > 0 || Boolean(adjacentReview)}
                onPress={() => void recordOnce()}
                subtitle="Logs this time without saving a new place"
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
    </>
  );
}

function PlaceChoice({
  detail,
  name,
  onPress,
  selected,
  theme
}: {
  detail: string;
  name: string;
  onPress: () => void;
  selected: boolean;
  theme: MobileTheme;
}) {
  return (
    <Pressable
      accessibilityLabel={`${name}, ${detail}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        placeChoiceStyles.row,
        { backgroundColor: selected ? theme.accentSoft : theme.surfaceMuted },
        pressed ? { opacity: 0.72 } : null
      ]}
    >
      <View style={placeChoiceStyles.text}>
        <Text {...mobileTextProps("itemTitle")} style={[placeChoiceStyles.name, { color: theme.textPrimary }]}>{name}</Text>
        <Text {...mobileTextProps("metadata")} style={[placeChoiceStyles.detail, { color: theme.textSecondary }]}>{detail}</Text>
      </View>
      {selected ? <CheckGlyph color={theme.accentText} /> : null}
    </Pressable>
  );
}

function CategoryChoice({
  category,
  label: labelOverride,
  onPress,
  selected,
  theme
}: {
  category: Category | null;
  label?: string;
  onPress: () => void;
  selected: boolean;
  theme: MobileTheme;
}) {
  const label = labelOverride ?? category?.name ?? "No activity";
  const color = category
    ? paletteColorFor(category.color, category.name, theme.mode)
    : theme.textSecondary;
  return (
    <Pressable
      accessibilityLabel={`Activity ${label}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        categoryChoiceStyles.touch,
        pressed ? { opacity: 0.72 } : null
      ]}
    >
      <View
        style={[
          categoryChoiceStyles.visual,
          { backgroundColor: selected ? theme.accentSoft : theme.surfaceMuted }
        ]}
      >
        <View style={[categoryChoiceStyles.dot, { backgroundColor: color }]} />
        <Text {...mobileTextProps("control")} style={[categoryChoiceStyles.text, { color: selected ? theme.accentText : theme.textPrimary }]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
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

function SearchGlyph({ color }: { color: string }) {
  return <Svg width={18} height={18} viewBox="0 0 24 24"><SvgCircle cx={11} cy={11} r={6} fill="none" stroke={color} strokeWidth={2} /><Path d="m16 16 4 4" stroke={color} strokeLinecap="round" strokeWidth={2} /></Svg>;
}

function CloseGlyph({ color }: { color: string }) {
  return <Svg width={17} height={17} viewBox="0 0 24 24"><Path d="m7 7 10 10M17 7 7 17" stroke={color} strokeLinecap="round" strokeWidth={2} /></Svg>;
}

function CheckGlyph({ color }: { color: string }) {
  return <Svg width={17} height={17} viewBox="0 0 24 24"><Path d="m5 12 4 4L19 6" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} /></Svg>;
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
  const date = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(startedAt);
  const start = formatTime(evidence.segment.startedAt);
  const stop = stoppedAt && evidence.segment.stoppedAt ? formatTime(evidence.segment.stoppedAt) : "ongoing";
  const durationMinutes = stoppedAt
    ? Math.max(0, Math.round((stoppedAt.getTime() - startedAt.getTime()) / 60_000))
    : null;
  const approximateArrival = evidence.segment.approximateArrival;
  const prefix = approximateArrival ? "Approximate arrival · " : "";
  const duration = durationMinutes === null ? "" : ` · ${durationMinutes}m${approximateArrival ? " estimated" : ""}`;
  return `${prefix}${date} · ${start}–${stop}${duration}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatLocationReviewDuration(startedAt: string, stoppedAt: string) {
  const durationMinutes = Math.max(
    0,
    Math.round((Date.parse(stoppedAt) - Date.parse(startedAt)) / 60_000)
  );
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
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
    answerIcon: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft
    },
    answerText: { flex: 1, minWidth: 0, gap: 2 },
    answerTitle: { color: theme.textPrimary, fontSize: 16, lineHeight: 21, fontWeight: "700" },
    answerMeta: { color: theme.textSecondary, fontSize: 12, lineHeight: 17 },
    helperText: { color: theme.textSecondary, fontSize: 12, lineHeight: 17 },
    fieldLabel: { color: theme.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: "700" },
    placeChoices: { gap: 7 },
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
    iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
    suggestionList: { borderRadius: 14, backgroundColor: theme.surfaceMuted, overflow: "hidden" },
    suggestionRow: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 9
    },
    dividerTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
    suggestionTitle: { color: theme.textPrimary, fontSize: 14, fontWeight: "700", lineHeight: 18 },
    suggestionSubtitle: { color: theme.textSecondary, fontSize: 12, lineHeight: 16 },
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
    categoryScroller: { gap: 8, paddingRight: 4 },
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

const placeChoiceStyles = StyleSheet.create({
  row: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 14, lineHeight: 18, fontWeight: "700" },
  detail: { fontSize: 12, lineHeight: 16 }
});

const categoryChoiceStyles = StyleSheet.create({
  touch: { minHeight: 44, justifyContent: "center" },
  visual: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 12, lineHeight: 16, fontWeight: "600" }
});
