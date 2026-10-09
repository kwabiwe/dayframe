import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import Reanimated from "react-native-reanimated";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle as SvgCircle, Path } from "react-native-svg";
import MapView, { Circle, Marker, type MapPressEvent } from "react-native-maps";
import {
  DAYFRAME_APP_ICONS,
  DAYFRAME_BLOCKS,
  PlaceRoleSchema,
  blockColorsFor,
  leavingRoleHolder,
  placeDisplayName,
  placeRoleLabel,
  placeRoleRequest,
  placeRoleSlots,
  previousRolePlaceName
} from "@dayframe/shared";
import {
  AuthRequiredError,
  createPlace,
  deletePlace,
  fetchBootstrap,
  updatePlace,
  type MobileBootstrap,
  type MobileLearnedPlace,
  type MobilePlace
} from "@/lib/api";
import { ActivityPickerSheet } from "@/components/ActivityPickerSheet";
import { DayframeIcon } from "@/components/icons/DayframeIcon";
import {
  SettingsBlockGroup,
  SettingsBlockRow,
  SettingsPillButton,
  SettingsSwitch
} from "@/components/settings/SettingsBlocks";
import { refreshGeofencesForPlaces } from "@/lib/geofence";
import { mobileAccountKey, mobileAccountOwnersEqual, readActiveMobileAccount, type MobileAccountOwner } from "@/lib/mobileAccount";
import { applyPlaceRoleLocally, notePlaceDeleted } from "@/lib/placesPage";
import {
  foregroundLocationPermissionGuidance,
  formatLocationAccuracy,
  locationAccuracyWarning,
  suggestedPlaceNameFromGeocode,
  validatePlaceForm,
  withRole,
  DEFAULT_PLACE_RADIUS_METERS,
  MAX_PLACE_RADIUS_METERS,
  MIN_PLACE_RADIUS_METERS
} from "@/lib/places";
import {
  createNativePlaceSearchProvider,
  friendlyPlaceSearchError,
  PlaceSearchController,
  resolvePlaceSearchBias,
  selectPlaceSearchBias,
  type PlaceSearchBias,
  type PlaceSearchState,
  type ResolvedPlaceSearchResult
} from "@/lib/placeSearch";
import {
  canonicalPlaceCoordinateText,
  resolvedPlaceSelectionDraft,
  shouldClearResolvedPlace
} from "@/lib/placeEditorState";
import { useMobileTheme } from "@/lib/mobileTheme";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "@/lib/mobileTypography";
import {
  localLayoutTransition,
  localPresenceEntering,
  localPresenceExiting,
  useReduceMotionPreference
} from "@/lib/motion";

type EditorMode = "create" | "edit" | "learned";

const emptySearchState: PlaceSearchState = {
  requestId: null,
  query: "",
  status: "idle",
  suggestions: [],
  message: null
};

export default function PlaceEditorScreen() {
  const params = useLocalSearchParams<{
    mode?: string;
    placeId?: string;
    learnedPlaceId?: string;
    /** "home" or "work": a new place goes straight into that slot (Places › Home and Work). */
    role?: string;
  }>();
  const mode: EditorMode = params.mode === "edit"
    ? "edit"
    : params.mode === "learned"
      ? "learned"
      : "create";
  const reduceMotion = useReduceMotionPreference();
  const { styles, theme } = useMobileTheme();
  const provider = useMemo(() => createNativePlaceSearchProvider(), []);
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [loadedEntity, setLoadedEntity] = useState<MobilePlace | MobileLearnedPlace | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [resolvingSuggestion, setResolvingSuggestion] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [activityPickerOpen, setActivityPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchState, setSearchState] = useState<PlaceSearchState>(emptySearchState);
  const [selectedResult, setSelectedResult] = useState<ResolvedPlaceSearchResult | null>(null);
  const [placeName, setPlaceName] = useState("");
  const [latitudeText, setLatitudeText] = useState("");
  const [longitudeText, setLongitudeText] = useState("");
  const [radiusMeters, setRadiusMeters] = useState(String(DEFAULT_PLACE_RADIUS_METERS));
  const [loggingEnabled, setLoggingEnabled] = useState(true);
  const [defaultCategoryId, setDefaultCategoryId] = useState("");
  const [defaultActivityDescription, setDefaultActivityDescription] = useState("");
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [locationPrecise, setLocationPrecise] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [previousRoleName, setPreviousRoleName] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const saveInFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);
  const nameTouched = useRef(mode !== "create");
  const initialCoordinate = useRef<{ latitude: number; longitude: number } | null>(null);
  const fallbackSearchBias = useRef<PlaceSearchBias | null>(null);
  const controllerRef = useRef<PlaceSearchController | null>(null);

  useEffect(() => {
    if (!provider) return;
    const controller = new PlaceSearchController(provider, setSearchState);
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [provider]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const bootstrap = await fetchBootstrap();
      setData(bootstrap);
      let existingCoordinate: { latitude: number; longitude: number } | null = null;
      if (mode === "edit") {
        const place = bootstrap.places.find((candidate) => candidate.id === params.placeId);
        if (!place) throw new Error("This saved place is no longer available.");
        setLoadedEntity(place);
        setPlaceName(place.name);
        setLatitudeText(formatOptionalCoordinate(place.latitude));
        setLongitudeText(formatOptionalCoordinate(place.longitude));
        setRadiusMeters(String(place.radiusMeters));
        setLoggingEnabled(place.loggingEnabled !== false);
        setDefaultCategoryId(place.defaultCategoryId ?? "");
        setDefaultActivityDescription(place.defaultActivityDescription ?? "");
        existingCoordinate = coordinateFromPlace(place);
        initialCoordinate.current = existingCoordinate;
      } else if (mode === "learned") {
        const learnedPlace = (bootstrap.learnedPlaces ?? []).find(
          (candidate) => candidate.id === params.learnedPlaceId
        );
        if (!learnedPlace) throw new Error("This learned place is no longer available.");
        setLoadedEntity(learnedPlace);
        setPlaceName(learnedPlace.name);
        setLatitudeText(formatCoordinate(learnedPlace.latitude));
        setLongitudeText(formatCoordinate(learnedPlace.longitude));
        setRadiusMeters(String(learnedPlace.radiusMeters));
        existingCoordinate = {
          latitude: learnedPlace.latitude,
          longitude: learnedPlace.longitude
        };
        initialCoordinate.current = existingCoordinate;
      }
      void resolvePlaceSearchBias({
        existingCoordinate,
        savedPlaceCoordinates: bootstrap.places
          .map(coordinateFromPlace)
          .filter((coordinate): coordinate is { latitude: number; longitude: number } => Boolean(coordinate))
      }).then((bias) => {
        fallbackSearchBias.current = bias;
      });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Places", error instanceof Error ? error.message : "Unable to load this place.", [
        { text: "Back", onPress: () => router.back() }
      ]);
    } finally {
      setLoading(false);
    }
  }, [mode, params.learnedPlaceId, params.placeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const formCoordinate = parseFormCoordinate(latitudeText, longitudeText);
  const numericRadius = Number(radiusMeters);
  const categories = data?.categories ?? [];
  const validation = validatePlaceForm({
    name: placeName,
    latitude: latitudeText,
    longitude: longitudeText,
    radiusMeters,
    defaultCategoryId: loggingEnabled ? defaultCategoryId : "",
    defaultActivityDescription: loggingEnabled ? defaultActivityDescription : ""
  });
  // A new place added from Places › Home and Work goes straight into that slot; the place the
  // role leaves can be renamed, as on the web (Blocks 7a).
  const parsedRole = PlaceRoleSchema.safeParse(params.role);
  const newRole = mode === "create" && parsedRole.success ? parsedRole.data : null;
  const roleSlot = newRole && data ? placeRoleSlots(data.places.map(withRole)).find((slot) => slot.role === newRole) ?? null : null;
  const roleHolder = roleSlot ? leavingRoleHolder(roleSlot, null) : null;
  const title = mode === "edit"
    ? "Edit place"
    : mode === "learned"
      ? "Save this place"
      : newRole ? `Add ${placeRoleLabel(newRole)}` : "New place";
  const accuracyWarning = locationAccuracyWarning(locationAccuracy, locationPrecise);

  function changeSearchQuery(value: string) {
    setSearchQuery(value);
    setStatusMessage(null);
    if (shouldClearResolvedPlace(value, selectedResult)) {
      setSelectedResult(null);
    }
    const selectedCoordinate = parseFormCoordinate(latitudeText, longitudeText);
    const directBias = selectPlaceSearchBias({
      selectedCoordinate,
      existingCoordinate: initialCoordinate.current
    });
    controllerRef.current?.updateQuery(value, directBias ?? fallbackSearchBias.current);
  }

  async function chooseSuggestion(suggestion: PlaceSearchState["suggestions"][number]) {
    if (!controllerRef.current || resolvingSuggestion) return;
    setResolvingSuggestion(true);
    setStatusMessage(null);
    try {
      const result = await controllerRef.current.resolve(suggestion);
      const selection = resolvedPlaceSelectionDraft(
        result,
        placeName,
        nameTouched.current
      );
      setSelectedResult(selection.selectedResult);
      setSearchQuery(selection.searchQuery);
      setLatitudeText(selection.latitudeText);
      setLongitudeText(selection.longitudeText);
      setPlaceName(selection.placeName);
      setStatusMessage(`${result.title} selected.`);
    } catch (error) {
      const message = friendlyPlaceSearchError(error);
      if (message) setStatusMessage(message);
    } finally {
      setResolvingSuggestion(false);
    }
  }

  function clearSearch() {
    setSearchQuery("");
    setSelectedResult(null);
    setSearchState(emptySearchState);
    void controllerRef.current?.cancel();
  }

  async function useCurrentLocation() {
    if (locating) return;
    setLocating(true);
    // The Use current location row says "Finding you…" and then the accuracy.
    setStatusMessage(null);
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      const guidance = foregroundLocationPermissionGuidance(permission);
      if (guidance) {
        setStatusMessage(guidance);
        Alert.alert("Current location", guidance);
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude, accuracy } = position.coords;
      applyCoordinate(latitude, longitude);
      setSelectedResult(null);
      setLocationAccuracy(accuracy ?? null);
      setLocationPrecise(permission.ios?.accuracy !== "reduced");
      if (!nameTouched.current) {
        const suggestion = await suggestCurrentPlaceName(latitude, longitude);
        if (suggestion) setPlaceName(suggestion);
      }
    } catch {
      const message = "Current location is unavailable. Try again, or enter coordinates.";
      setStatusMessage(message);
      Alert.alert("Current location", message);
    } finally {
      setLocating(false);
    }
  }

  function applyCoordinate(latitude: number, longitude: number) {
    const coordinate = canonicalPlaceCoordinateText(latitude, longitude);
    setLatitudeText(coordinate.latitudeText);
    setLongitudeText(coordinate.longitudeText);
  }

  async function savePlace() {
    if (!validation.ok || saveInFlight.current) {
      if (!validation.ok) Alert.alert("Places", validation.message);
      return;
    }
    Keyboard.dismiss();
    saveInFlight.current = true;
    setSaving(true);
    const owner = await readActiveMobileAccount();
    let accepted: MobilePlace;
    let roleChange: Parameters<typeof applyPlaceRoleLocally>[1] | null = null;
    try {
      if (mode === "edit" && loadedEntity) {
        accepted = (await updatePlace(loadedEntity.id, {
          name: validation.value.name,
          latitude: validation.value.latitude,
          longitude: validation.value.longitude,
          radiusMeters: validation.value.radiusMeters,
          loggingEnabled,
          defaultCategoryId: loggingEnabled ? validation.value.defaultCategoryId : null,
          defaultActivityDescription: loggingEnabled ? validation.value.defaultActivityDescription : null
        })).place;
      } else {
        const newRoleRequest = newRole ? {
          role: newRole,
          previousPlaceName: placeRoleRequest({
            role: newRole,
            targetId: null,
            holder: roleHolder,
            previousPlaceName: previousRoleName ?? previousRolePlaceName(newRole)
          }).previousPlaceName
        } : undefined;
        accepted = (await createPlace({
          learnedPlaceId: mode === "learned" ? params.learnedPlaceId : undefined,
          name: validation.value.name,
          latitude: validation.value.latitude,
          longitude: validation.value.longitude,
          radiusMeters: validation.value.radiusMeters,
          priority: 5,
          loggingEnabled,
          defaultCategoryId: loggingEnabled ? validation.value.defaultCategoryId : null,
          defaultActivityDescription: loggingEnabled ? validation.value.defaultActivityDescription : null
        }, newRoleRequest)).place;
        if (newRoleRequest) roleChange = { role: newRoleRequest.role, placeId: accepted.id, previousPlaceName: newRoleRequest.previousPlaceName ?? null };
      }
    } catch (error) {
      saveInFlight.current = false;
      // Signed out (the session was rejected): go to sign-in from this editor even though the
      // account is no longer active. Only another account taking over leaves it untouched.
      if (error instanceof AuthRequiredError) {
        if (mounted.current) router.replace("/");
        return;
      }
      if (!(await editorStillFor(owner))) return;
      setSaving(false);
      Alert.alert("Places", error instanceof Error ? error.message : "Unable to save place.");
      return;
    }
    // Accepted. Save stays locked (a retry would create the place again), and a refresh that
    // fails here does not undo it: Places refreshes when it is shown.
    // If the fresh read fails, monitoring uses this editor's snapshot with the accepted place
    // (and the role it took) applied, never the places as they were before the save.
    // The role is applied against the snapshot as it was before the assignment (the accepted place
    // added without it), so implicit holders named like the role are renamed as the server did.
    const snapshot = data
      ? [...data.places.filter((place) => place.id !== accepted.id), roleChange ? { ...accepted, role: null } : accepted]
      : [];
    if (!(await refreshGeofencesAfterChange(roleChange ? applyPlaceRoleLocally(snapshot, roleChange) : snapshot))) return;
    if (await editorStillFor(owner)) router.back();
  }

  /** True while this editor is still open for the account that started the change. */
  async function editorStillFor(owner: MobileAccountOwner | null) {
    return mounted.current && mobileAccountOwnersEqual(owner, await readActiveMobileAccount());
  }

  /** Best effort after an accepted change: a fresh read, else this editor's own snapshot. */
  /** Returns false when the read found the session signed out (the editor goes to sign-in). */
  async function refreshGeofencesAfterChange(fallbackPlaces: MobilePlace[]) {
    let refreshed: MobileBootstrap | null = null;
    try {
      refreshed = await fetchBootstrap();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        // The change was accepted; the session ended after it. Save/Delete stay locked.
        if (mounted.current) router.replace("/");
        return false;
      }
    }
    const source = refreshed ?? data;
    if (!source) return true;
    const places = refreshed ? refreshed.places : fallbackPlaces;
    await refreshGeofencesForPlaces(places, { userId: source.user.id, workspaceId: source.workspace.id }).catch(() => 0);
    return true;
  }

  function confirmDeletePlace() {
    if (mode !== "edit" || !loadedEntity || saveInFlight.current) return;
    const place = loadedEntity as MobilePlace;
    Alert.alert(
      "Delete place",
      `Delete ${placeDisplayName(withRole(place))}? Past entries keep their time but lose this place.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void removePlace(place) }
      ]
    );
  }

  async function removePlace(place: MobilePlace) {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setDeleting(true);
    const owner = await readActiveMobileAccount();
    try {
      await deletePlace(place.id);
    } catch (error) {
      saveInFlight.current = false;
      // Signed out (the session was rejected): go to sign-in from this editor even though the
      // account is no longer active. Only another account taking over leaves it untouched.
      if (error instanceof AuthRequiredError) {
        if (mounted.current) router.replace("/");
        return;
      }
      if (!(await editorStillFor(owner))) return;
      setDeleting(false);
      Alert.alert("Places", error instanceof Error ? error.message : "Unable to delete place.");
      return;
    }
    // Accepted: Places drops the row when it is shown again, even if its own refresh fails.
    if (owner) notePlaceDeleted(mobileAccountKey(owner), place.id);
    if (!(await refreshGeofencesAfterChange((data?.places ?? []).filter((candidate) => candidate.id !== place.id)))) return;
    if (await editorStillFor(owner)) router.back();
  }


  const defaultActivity = categories.find((category) => category.id === defaultCategoryId) ?? null;
  // A saved default the picker can't list (an archived activity) still shows by its saved name and
  // can still be removed.
  const savedDefaultName = mode === "edit" && defaultCategoryId && !defaultActivity
    && (loadedEntity as MobilePlace | null)?.defaultCategoryId === defaultCategoryId
    ? (loadedEntity as MobilePlace).defaultCategoryName ?? "An archived activity"
    : null;
  const defaultActivityLabel = defaultActivity?.name ?? savedDefaultName ?? (defaultCategoryId ? "An archived activity" : null);
  // The map draws the place in the colour of the activity its visits log as (neutral without one),
  // as the Review deck's place cards do; coral stays for Save.
  const mapColor = defaultActivity && loggingEnabled
    ? blockColorsFor(defaultActivity.color ?? defaultActivity.id, theme.mode, defaultActivity.name).fill
    : theme.textSecondary;
  const eyebrow = mode === "edit"
    ? (loadedEntity as MobilePlace | null)?.role ? placeRoleLabel((loadedEntity as MobilePlace).role!).toUpperCase() : "SAVED PLACE"
    : mode === "learned" ? "SUGGESTED PLACE" : "NEW";
  const coordinateProblem = !validation.ok && /Latitude|Longitude/.test(validation.message) ? validation.message : null;
  const radiusProblem = !validation.ok && /Radius/.test(validation.message) ? validation.message : null;
  const busy = saving || deleting;
  const canSave = validation.ok && !busy && !loading;

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* A sheet-like head on the pushed route: Cancel, the title and the coral Save. It stays put. */}
      <View style={[editorStyles.head, { borderBottomColor: theme.border }]}>
        <Pressable
          accessibilityLabel="Cancel place editing"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [editorStyles.headButton, pressed ? styles.buttonPressed : null]}
          testID="place-editor-cancel"
        >
          <Text {...mobileTextProps("control")} style={[editorStyles.cancelText, { color: theme.textSecondary }]}>Cancel</Text>
        </Pressable>
        <View style={editorStyles.headTitle}>
          <Text {...mobileTextProps("counter")} numberOfLines={1} style={[editorStyles.eyebrow, { color: theme.textMuted }]}>{eyebrow}</Text>
          <Text {...mobileTextProps("screenHeading")} accessibilityRole="header" numberOfLines={1} style={[editorStyles.title, { color: theme.textPrimary }]}>
            {title}
          </Text>
        </View>
        <Pressable
          accessibilityHint={validation.ok ? undefined : validation.message}
          accessibilityLabel={saving ? "Saving place" : "Save place"}
          accessibilityRole="button"
          accessibilityState={{ busy: saving, disabled: !canSave }}
          disabled={!canSave}
          onPress={() => void savePlace()}
          style={({ pressed }) => [
            editorStyles.savePill,
            { backgroundColor: theme.accent, opacity: canSave || saving ? 1 : 0.45 },
            pressed ? styles.buttonPressed : null
          ]}
          testID="place-editor-save"
        >
          <Text {...mobileTextProps("control")} style={[editorStyles.saveText, { color: theme.onAccent }]}>{saving ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>

      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.settingsScrollContent, editorStyles.scrollContent]}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={styles.settingsScrollView}
      >
        {loading ? (
          <Text {...mobileTextProps("body")} accessibilityLiveRegion="polite" style={{ color: theme.textSecondary }}>Loading place…</Text>
        ) : (
          <View style={editorStyles.stack}>
            {/* The map card: the centre and radius, tap to fine-tune. Updates in place. */}
            <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
              {formCoordinate ? (
                <View style={editorStyles.mapCard}>
                  <MapView
                    accessibilityLabel={`Map of this place with a ${Number.isFinite(numericRadius) ? numericRadius : 0} metre circle. Tap to move the centre.`}
                    onPress={(event: MapPressEvent) => {
                      applyCoordinate(
                        event.nativeEvent.coordinate.latitude,
                        event.nativeEvent.coordinate.longitude
                      );
                    }}
                    pitchEnabled={false}
                    region={{ ...formCoordinate, latitudeDelta: 0.006, longitudeDelta: 0.006 }}
                    rotateEnabled={false}
                    style={editorStyles.map}
                    testID="place-editor-map"
                  >
                    {Number.isFinite(numericRadius) && numericRadius > 0 ? (
                      <Circle
                        center={formCoordinate}
                        fillColor={`${mapColor}2E`}
                        radius={numericRadius}
                        strokeColor={mapColor}
                        strokeWidth={2}
                      />
                    ) : null}
                    <Marker coordinate={formCoordinate} pinColor={mapColor} title="Place centre" />
                  </MapView>
                  <Text {...mobileTextProps("metadata")} style={[editorStyles.mapFoot, { color: theme.textMuted }]}>
                    Tap the map to fine-tune the centre.
                  </Text>
                </View>
              ) : (
                <View style={[editorStyles.mapPlaceholder, { backgroundColor: theme.surfaceInset }]} testID="place-editor-map-empty">
                  <DayframeIcon color={theme.textMuted} glyph={DAYFRAME_APP_ICONS.places} size={26} />
                  <Text {...mobileTextProps("body")} style={[editorStyles.mapPlaceholderText, { color: theme.textSecondary }]}>
                    Search for a place or use your current location.
                  </Text>
                </View>
              )}
            </Reanimated.View>

            <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
              <SettingsBlockGroup theme={theme} title="Where">
                <View style={editorStyles.searchRow}>
                  <DayframeIcon color={theme.textMuted} glyph={DAYFRAME_APP_ICONS.search} size={18} />
                  <TextInput
                    {...mobileTextProps("input")}
                    accessibilityLabel="Address or place"
                    autoCapitalize="words"
                    autoCorrect={false}
                    clearButtonMode="never"
                    onChangeText={changeSearchQuery}
                    placeholder="Search address or place"
                    placeholderTextColor={theme.textMuted}
                    returnKeyType="search"
                    style={[editorStyles.searchInput, { color: theme.textPrimary }]}
                    testID="place-editor-search"
                    value={searchQuery}
                  />
                  {searchQuery ? (
                    <Pressable
                      accessibilityLabel="Clear place search"
                      accessibilityRole="button"
                      onPress={clearSearch}
                      style={({ pressed }) => [editorStyles.iconTarget, pressed ? styles.buttonPressed : null]}
                    >
                      <DayframeIcon color={theme.textMuted} glyph={DAYFRAME_APP_ICONS.close} size={17} />
                    </Pressable>
                  ) : null}
                </View>

                {searchState.suggestions.length > 0 ? (
                  <Reanimated.View
                    accessibilityLabel={`${searchState.suggestions.length} place search results`}
                    accessibilityLiveRegion="polite"
                    entering={localPresenceEntering(reduceMotion)}
                    exiting={localPresenceExiting(reduceMotion)}
                    layout={localLayoutTransition(reduceMotion)}
                  >
                    <ScrollView
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled
                      style={editorStyles.suggestionScroller}
                    >
                      {searchState.suggestions.map((suggestion) => (
                        <Pressable
                          accessibilityLabel={[suggestion.title, suggestion.subtitle].filter(Boolean).join(", ")}
                          accessibilityRole="button"
                          disabled={resolvingSuggestion}
                          key={suggestion.id}
                          onPress={() => void chooseSuggestion(suggestion)}
                          style={({ pressed }) => [
                            editorStyles.resultRow,
                            { borderTopColor: theme.border },
                            pressed ? { backgroundColor: theme.surfaceMuted } : null
                          ]}
                        >
                          <DayframeIcon color={theme.textMuted} glyph={DAYFRAME_APP_ICONS.places} size={18} />
                          <View style={editorStyles.resultText}>
                            <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[editorStyles.resultTitle, { color: theme.textPrimary }]}>
                              {suggestion.title}
                            </Text>
                            {suggestion.subtitle ? (
                              <Text {...mobileTextProps("metadata")} numberOfLines={2} style={{ color: theme.textMuted }}>{suggestion.subtitle}</Text>
                            ) : null}
                          </View>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </Reanimated.View>
                ) : null}

                {selectedResult ? (
                  <Reanimated.View
                    entering={localPresenceEntering(reduceMotion)}
                    exiting={localPresenceExiting(reduceMotion)}
                    layout={localLayoutTransition(reduceMotion)}
                    style={[editorStyles.resultRow, { borderTopColor: theme.border }]}
                  >
                    <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.done} size={18} />
                    <View style={editorStyles.resultText}>
                      <Text {...mobileTextProps("itemTitle")} style={[editorStyles.resultTitle, { color: theme.textPrimary }]}>{selectedResult.title}</Text>
                      {selectedResult.formattedAddress || selectedResult.subtitle ? (
                        <Text {...mobileTextProps("metadata")} numberOfLines={2} style={{ color: theme.textMuted }}>
                          {selectedResult.formattedAddress || selectedResult.subtitle}
                        </Text>
                      ) : null}
                    </View>
                    <SettingsPillButton accessibilityLabel="Change selected place" label="Change" onPress={clearSearch} theme={theme} />
                  </Reanimated.View>
                ) : null}

                <Pressable
                  accessibilityHint="Centres this place where you are now"
                  accessibilityLabel="Use current location"
                  accessibilityValue={locationAccuracy !== null && !locating ? { text: formatLocationAccuracy(locationAccuracy) } : undefined}
                  accessibilityRole="button"
                  accessibilityState={{ busy: locating, disabled: locating }}
                  disabled={locating}
                  onPress={() => void useCurrentLocation()}
                  style={({ pressed }) => [
                    editorStyles.resultRow,
                    { borderTopColor: theme.border },
                    pressed ? { backgroundColor: theme.surfaceMuted } : null
                  ]}
                  testID="place-editor-current-location"
                >
                  <TargetGlyph color={theme.textPrimary} />
                  <View style={editorStyles.resultText}>
                    <Text {...mobileTextProps("itemTitle")} style={[editorStyles.resultTitle, { color: theme.textPrimary }]}>
                      {locating ? "Finding you…" : "Use current location"}
                    </Text>
                    {locationAccuracy !== null && !locating ? (
                      <Text {...mobileTextProps("metadata")} style={{ color: theme.textMuted }}>{formatLocationAccuracy(locationAccuracy)}</Text>
                    ) : null}
                  </View>
                </Pressable>
              </SettingsBlockGroup>
              {!provider ? (
                <Text {...mobileTextProps("metadata")} accessibilityLiveRegion="polite" style={[editorStyles.note, { color: theme.textSecondary }]}>
                  Place search is unavailable in this build. Use Current location or Advanced coordinates.
                </Text>
              ) : null}
              {provider && searchState.status === "loading" ? (
                <Text {...mobileTextProps("metadata")} accessibilityLiveRegion="polite" style={[editorStyles.note, { color: theme.textMuted }]}>Searching…</Text>
              ) : null}
              {provider && searchState.status === "typing" && searchQuery.trim().length === 1 ? (
                <Text {...mobileTextProps("metadata")} style={[editorStyles.note, { color: theme.textMuted }]}>Type one more character to search.</Text>
              ) : null}
              {provider && searchState.message ? (
                <Text {...mobileTextProps("metadata")} accessibilityLiveRegion="polite" style={[editorStyles.note, { color: theme.textSecondary }]}>{searchState.message}</Text>
              ) : null}
              {accuracyWarning ? (
                <Text {...mobileTextProps("metadata")} style={[editorStyles.note, { color: theme.warningText }]}>{accuracyWarning}</Text>
              ) : null}
            </Reanimated.View>

            <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
              <SettingsBlockGroup theme={theme} title="Name">
                <TextInput
                  {...mobileTextProps("input")}
                  accessibilityLabel="Name in Dayframe"
                  maxLength={120}
                  onChangeText={(value) => {
                    nameTouched.current = true;
                    setPlaceName(value);
                  }}
                  placeholder="Home, Gym, Mum's house…"
                  placeholderTextColor={theme.textMuted}
                  returnKeyType="done"
                  style={[editorStyles.fieldInput, { color: theme.textPrimary }]}
                  testID="place-editor-name"
                  value={placeName}
                />
              </SettingsBlockGroup>
            </Reanimated.View>

            {newRole && roleHolder ? (
              <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
                <SettingsBlockGroup
                  foot={`${placeRoleLabel(newRole)} moves to this new place. The old one keeps its entries under this name.`}
                  theme={theme}
                  title={`Old ${placeRoleLabel(newRole).toLowerCase()}`}
                >
                  <TextInput
                    {...mobileTextProps("input")}
                    accessibilityHint="Its past entries keep this name. Leave it blank to keep the current name."
                    accessibilityLabel={`Rename the old ${placeRoleLabel(newRole).toLowerCase()}`}
                    maxLength={120}
                    onChangeText={setPreviousRoleName}
                    placeholder={roleHolder.name}
                    placeholderTextColor={theme.textMuted}
                    returnKeyType="done"
                    style={[editorStyles.fieldInput, { color: theme.textPrimary }]}
                    testID="place-editor-previous-role-name"
                    value={previousRoleName ?? previousRolePlaceName(newRole)}
                  />
                </SettingsBlockGroup>
              </Reanimated.View>
            ) : null}

            <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
              <SettingsBlockGroup theme={theme} title="Size">
                <View style={editorStyles.fieldRow}>
                  <Text {...mobileTextProps("itemTitle")} style={[editorStyles.fieldLabel, { color: theme.textPrimary }]}>Radius</Text>
                  <TextInput
                    {...mobileTextProps("input")}
                    accessibilityHint={`Between ${MIN_PLACE_RADIUS_METERS} and ${MAX_PLACE_RADIUS_METERS} metres`}
                    accessibilityLabel="Place radius in metres"
                    keyboardType="number-pad"
                    maxLength={4}
                    onChangeText={setRadiusMeters}
                    placeholder={String(DEFAULT_PLACE_RADIUS_METERS)}
                    placeholderTextColor={theme.textMuted}
                    style={[editorStyles.radiusInput, { backgroundColor: theme.surfaceInset, color: theme.textPrimary }]}
                    testID="place-editor-radius"
                    value={radiusMeters}
                  />
                  <Text {...mobileTextProps("body")} style={{ color: theme.textSecondary }}>m</Text>
                </View>
              </SettingsBlockGroup>
              {radiusProblem ? (
                <Text {...mobileTextProps("metadata")} accessibilityLiveRegion="polite" style={[editorStyles.note, { color: theme.dangerText }]}>{radiusProblem}</Text>
              ) : null}
            </Reanimated.View>

            <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
              <SettingsBlockGroup
                foot={loggingEnabled ? "Show detected visits in Review." : "Visits here are not suggested."}
                theme={theme}
                title="Visits"
              >
                <SettingsBlockRow
                  control={
                    <SettingsSwitch
                      label="Suggest visits here"
                      onValueChange={(enabled) => {
                        setLoggingEnabled(enabled);
                        if (!enabled) {
                          setDefaultCategoryId("");
                          setDefaultActivityDescription("");
                        }
                      }}
                      theme={theme}
                      value={loggingEnabled}
                    />
                  }
                  divider={false}
                  testID="place-editor-suggest"
                  theme={theme}
                  title="Suggest visits here"
                />
                {loggingEnabled ? (
                  <Reanimated.View
                    entering={localPresenceEntering(reduceMotion)}
                    exiting={localPresenceExiting(reduceMotion)}
                  >
                    <SettingsBlockRow
                      accessibilityHint="Chooses the activity a visit here is suggested as"
                      onPress={() => {
                        Keyboard.dismiss();
                        setActivityPickerOpen(true);
                      }}
                      testID="place-editor-logs-as"
                      theme={theme}
                      title="Logs as"
                      value={defaultActivityLabel ?? "No default activity"}
                    />
                    {defaultCategoryId ? (
                      <Reanimated.View
                        entering={localPresenceEntering(reduceMotion)}
                        exiting={localPresenceExiting(reduceMotion)}
                        layout={localLayoutTransition(reduceMotion)}
                      >
                        <SettingsBlockRow
                          control={
                            <SettingsPillButton
                              accessibilityLabel="Remove the default activity"
                              label="Remove"
                              onPress={() => setDefaultCategoryId("")}
                              theme={theme}
                            />
                          }
                          testID="place-editor-clear-activity"
                          theme={theme}
                          title="Default activity"
                        />
                      </Reanimated.View>
                    ) : null}
                    <Reanimated.View layout={localLayoutTransition(reduceMotion)} style={[editorStyles.fieldRow, { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                      <Text {...mobileTextProps("itemTitle")} style={[editorStyles.fieldLabel, { color: theme.textPrimary }]}>Entry name</Text>
                      <TextInput
                        {...mobileTextProps("input")}
                        accessibilityHint="What a logged visit here is called. Optional."
                        accessibilityLabel="Default task description"
                        maxLength={240}
                        onChangeText={setDefaultActivityDescription}
                        placeholder="Optional"
                        placeholderTextColor={theme.textMuted}
                        returnKeyType="done"
                        style={[editorStyles.inlineInput, { color: theme.textPrimary }]}
                        testID="place-editor-description"
                        value={defaultActivityDescription}
                      />
                    </Reanimated.View>
                  </Reanimated.View>
                ) : null}
              </SettingsBlockGroup>
            </Reanimated.View>

            <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
              <SettingsBlockGroup theme={theme} title="Advanced">
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: advancedExpanded }}
                  onPress={() => {
                    setAdvancedExpanded((expanded) => !expanded);
                  }}
                  style={({ pressed }) => [editorStyles.fieldRow, pressed ? { backgroundColor: theme.surfaceMuted } : null]}
                  testID="place-editor-advanced"
                >
                  <Text {...mobileTextProps("itemTitle")} style={[editorStyles.fieldLabel, { color: theme.textPrimary }]}>Advanced coordinates</Text>
                  <ChevronGlyph color={theme.textMuted} expanded={advancedExpanded} />
                </Pressable>
                {advancedExpanded ? (
                  <Reanimated.View
                    entering={localPresenceEntering(reduceMotion)}
                    exiting={localPresenceExiting(reduceMotion)}
                  >
                    <View style={[editorStyles.fieldRow, { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                      <Text {...mobileTextProps("itemTitle")} style={[editorStyles.fieldLabel, { color: theme.textPrimary }]}>Latitude</Text>
                      <TextInput
                        {...mobileTextProps("input")}
                        accessibilityLabel="Latitude"
                        keyboardType="numbers-and-punctuation"
                        onChangeText={setLatitudeText}
                        placeholder="51.5074"
                        placeholderTextColor={theme.textMuted}
                        style={[editorStyles.inlineInput, { color: theme.textPrimary }]}
                        testID="place-editor-latitude"
                        value={latitudeText}
                      />
                    </View>
                    <View style={[editorStyles.fieldRow, { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                      <Text {...mobileTextProps("itemTitle")} style={[editorStyles.fieldLabel, { color: theme.textPrimary }]}>Longitude</Text>
                      <TextInput
                        {...mobileTextProps("input")}
                        accessibilityLabel="Longitude"
                        keyboardType="numbers-and-punctuation"
                        onChangeText={setLongitudeText}
                        placeholder="-0.1278"
                        placeholderTextColor={theme.textMuted}
                        style={[editorStyles.inlineInput, { color: theme.textPrimary }]}
                        testID="place-editor-longitude"
                        value={longitudeText}
                      />
                    </View>
                  </Reanimated.View>
                ) : null}
              </SettingsBlockGroup>
              {coordinateProblem && (advancedExpanded || latitudeText || longitudeText) ? (
                <Text {...mobileTextProps("metadata")} accessibilityLiveRegion="polite" style={[editorStyles.note, { color: theme.dangerText }]}>{coordinateProblem}</Text>
              ) : null}
            </Reanimated.View>

            {statusMessage ? (
              <Reanimated.Text
                {...mobileTextProps("metadata")}
                accessibilityLiveRegion="polite"
                entering={localPresenceEntering(reduceMotion)}
                exiting={localPresenceExiting(reduceMotion)}
                layout={localLayoutTransition(reduceMotion)}
                style={[editorStyles.note, { color: theme.textSecondary }]}
              >
                {statusMessage}
              </Reanimated.Text>
            ) : null}

            {mode === "edit" && loadedEntity ? (
              <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy: deleting, disabled: busy }}
                  disabled={busy}
                  onPress={confirmDeletePlace}
                  style={({ pressed }) => [
                    editorStyles.deleteButton,
                    { backgroundColor: theme.surface, opacity: busy && !deleting ? 0.45 : 1 },
                    pressed ? { backgroundColor: theme.surfaceMuted } : null
                  ]}
                  testID="place-editor-delete"
                >
                  <Text {...mobileTextProps("control")} style={[editorStyles.deleteText, { color: theme.dangerText }]}>{deleting ? "Deleting…" : "Delete place"}</Text>
                </Pressable>
              </Reanimated.View>
            ) : null}
          </View>
        )}
      </ScrollView>
      {activityPickerOpen ? (
        <ActivityPickerSheet
          activities={categories}
          onClose={() => setActivityPickerOpen(false)}
          onPick={(activityId) => setDefaultCategoryId(activityId)}
          recentIds={[]}
          reduceMotion={reduceMotion}
          selectedId={defaultCategoryId || null}
          styles={styles}
          theme={theme}
        />
      ) : null}
    </SafeAreaView>
  );
}

async function suggestCurrentPlaceName(latitude: number, longitude: number) {
  try {
    const [firstResult] = await Location.reverseGeocodeAsync({ latitude, longitude });
    return suggestedPlaceNameFromGeocode(firstResult);
  } catch {
    return "";
  }
}

function coordinateFromPlace(place: MobilePlace) {
  return typeof place.latitude === "number" && typeof place.longitude === "number"
    ? { latitude: place.latitude, longitude: place.longitude }
    : null;
}

function parseFormCoordinate(latitudeText: string, longitudeText: string) {
  if (!latitudeText.trim() || !longitudeText.trim()) return null;
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function formatCoordinate(value: number) {
  return canonicalPlaceCoordinateText(value, 0).latitudeText;
}

function formatOptionalCoordinate(value?: number | null) {
  return typeof value === "number" ? formatCoordinate(value) : "";
}

const editorStyles = StyleSheet.create({
  head: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 6
  },
  headButton: { alignItems: "flex-start", justifyContent: "center", minHeight: 44, minWidth: 64, paddingHorizontal: 6 },
  headTitle: { alignItems: "center", flex: 1, minWidth: 0 },
  cancelText: { fontSize: 15, fontWeight: "600" },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.9 },
  title: { fontFamily: MOBILE_DISPLAY_FONT.bold, fontSize: 20 },
  savePill: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, justifyContent: "center", minHeight: 44, minWidth: 64, paddingHorizontal: 16 },
  saveText: { fontSize: 15, fontWeight: "700" },
  scrollContent: { paddingBottom: 40, paddingTop: 14 },
  stack: { gap: 22 },
  mapCard: { gap: 8 },
  map: { borderRadius: 22, height: 200, overflow: "hidden", width: "100%" },
  mapFoot: { marginHorizontal: 4 },
  mapPlaceholder: { alignItems: "center", borderRadius: 22, gap: 10, justifyContent: "center", minHeight: 140, padding: 20 },
  mapPlaceholderText: { textAlign: "center" },
  searchRow: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 52, paddingLeft: 16, paddingRight: 4 },
  searchInput: { flex: 1, fontSize: 16, minHeight: 48, minWidth: 0, paddingVertical: 10 },
  iconTarget: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  suggestionScroller: { maxHeight: 294 },
  resultRow: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 8
  },
  resultText: { flex: 1, gap: 2, minWidth: 0 },
  resultTitle: { fontSize: 15, fontWeight: "600" },
  note: { marginHorizontal: 4, marginTop: 8 },
  fieldRow: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 52, paddingHorizontal: 16, paddingVertical: 6 },
  fieldLabel: { flex: 1, fontSize: 15, fontWeight: "600" },
  fieldInput: { fontSize: 16, minHeight: 52, paddingHorizontal: 16, paddingVertical: 12 },
  inlineInput: { flex: 1.4, fontSize: 16, minHeight: 44, minWidth: 0, textAlign: "right" },
  radiusInput: { borderRadius: 12, fontSize: 16, fontVariant: ["tabular-nums"], minHeight: 44, textAlign: "center", width: 84 },
  deleteButton: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, justifyContent: "center", minHeight: 50 },
  deleteText: { fontSize: 15, fontWeight: "700" }
});

function TargetGlyph({ color }: { color: string }) {
  return <Svg width={18} height={18} viewBox="0 0 24 24"><SvgCircle cx={12} cy={12} fill="none" r={6} stroke={color} strokeWidth={2} /><SvgCircle cx={12} cy={12} fill={color} r={2} /><Path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke={color} strokeLinecap="round" strokeWidth={2} /></Svg>;
}

function ChevronGlyph({ color, expanded }: { color: string; expanded: boolean }) {
  return <Svg width={18} height={18} viewBox="0 0 24 24"><Path d={expanded ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} /></Svg>;
}
