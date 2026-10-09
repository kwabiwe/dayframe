import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
  PlaceRoleSchema,
  leavingRoleHolder,
  paletteColorFor,
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
  DEFAULT_PLACE_RADIUS_METERS
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
import { pressable, useMobileTheme, type MobileStyles, type MobileTheme } from "@/lib/mobileTheme";
import {
  localLayoutTransition,
  localPresenceEntering,
  localPresenceExiting,
  useReduceMotionPreference
} from "@/lib/motion";

type Category = MobileBootstrap["categories"][number];
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
  const editorStyles = useMemo(() => createEditorStyles(theme), [theme]);
  const provider = useMemo(() => createNativePlaceSearchProvider(), []);
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [loadedEntity, setLoadedEntity] = useState<MobilePlace | MobileLearnedPlace | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [resolvingSuggestion, setResolvingSuggestion] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
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
        setStatusMessage("Review the learned place before saving it.");
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
      ? "Save learned place"
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
    setStatusMessage("Checking current location...");
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
      setStatusMessage(formatLocationAccuracy(accuracy));
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
      if (!(await editorStillFor(owner))) return;
      setSaving(false);
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
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
    await refreshGeofencesAfterChange(roleChange ? applyPlaceRoleLocally(snapshot, roleChange) : snapshot);
    if (await editorStillFor(owner)) router.back();
  }

  /** True while this editor is still open for the account that started the change. */
  async function editorStillFor(owner: MobileAccountOwner | null) {
    return mounted.current && mobileAccountOwnersEqual(owner, await readActiveMobileAccount());
  }

  /** Best effort after an accepted change: a fresh read, else this editor's own snapshot. */
  async function refreshGeofencesAfterChange(fallbackPlaces: MobilePlace[]) {
    const refreshed = await fetchBootstrap().catch(() => null);
    const source = refreshed ?? data;
    if (!source) return;
    const places = refreshed ? refreshed.places : fallbackPlaces;
    await refreshGeofencesForPlaces(places, { userId: source.user.id, workspaceId: source.workspace.id }).catch(() => 0);
  }

  function confirmDeletePlace() {
    if (mode !== "edit" || !loadedEntity || saveInFlight.current) return;
    const place = loadedEntity as MobilePlace;
    Alert.alert(
      "Delete place",
      `Delete ${placeDisplayName(withRole(place))}? Existing time entries keep their time data, but this place label will be removed.`,
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
      if (!(await editorStillFor(owner))) return;
      setDeleting(false);
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Places", error instanceof Error ? error.message : "Unable to delete place.");
      return;
    }
    // Accepted: Places drops the row when it is shown again, even if its own refresh fails.
    if (owner) notePlaceDeleted(mobileAccountKey(owner), place.id);
    await refreshGeofencesAfterChange((data?.places ?? []).filter((candidate) => candidate.id !== place.id));
    if (await editorStillFor(owner)) router.back();
  }


  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.settingsFloatingHeader}>
        <View style={styles.settingsHeader}>
          <Pressable
            accessibilityLabel="Cancel place editing"
            accessibilityRole="button"
            style={pressable(styles.iconButton, styles.buttonPressed)}
            onPress={() => router.back()}
          >
            <BackGlyph color={theme.accent} />
          </Pressable>
          <Text style={styles.settingsTitle} numberOfLines={1}>{title}</Text>
        </View>
      </View>

      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.settingsScrollContent, editorStyles.scrollContent]}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={styles.settingsScrollView}
      >
        {loading ? (
          <Text accessibilityLiveRegion="polite" style={styles.muted}>Loading place…</Text>
        ) : (
          <View style={styles.contentStack}>
            <View style={styles.panel}>
              <Text style={styles.label}>Address or place</Text>
              <View style={editorStyles.searchField}>
                <SearchGlyph color={theme.textSecondary} />
                <TextInput
                  accessibilityLabel="Address or place"
                  autoCapitalize="words"
                  autoCorrect={false}
                  clearButtonMode="never"
                  onChangeText={changeSearchQuery}
                  placeholder="Search address or place"
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="search"
                  style={editorStyles.searchInput}
                  value={searchQuery}
                />
                {searchQuery ? (
                  <Pressable
                    accessibilityLabel="Clear place search"
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={clearSearch}
                    style={pressable(editorStyles.clearButton, styles.buttonPressed)}
                  >
                    <CloseGlyph color={theme.textSecondary} />
                  </Pressable>
                ) : null}
              </View>

              {!provider ? (
                <Text accessibilityLiveRegion="polite" style={styles.statusText}>
                  Place search is unavailable in this build. Use Current location or Advanced coordinates.
                </Text>
              ) : null}
              {provider && searchState.status === "loading" ? (
                <Text accessibilityLiveRegion="polite" style={styles.diagnosticText}>Searching…</Text>
              ) : null}
              {provider && searchState.status === "typing" && searchQuery.trim().length === 1 ? (
                <Text style={styles.diagnosticText}>Type one more character to search.</Text>
              ) : null}
              {provider && searchState.message ? (
                <Text accessibilityLiveRegion="polite" style={styles.statusText}>{searchState.message}</Text>
              ) : null}

              {searchState.suggestions.length > 0 ? (
                <Reanimated.View
                  accessibilityLabel={`${searchState.suggestions.length} place search results`}
                  accessibilityLiveRegion="polite"
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  layout={localLayoutTransition(reduceMotion)}
                  style={editorStyles.suggestionList}
                >
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                    style={editorStyles.suggestionScroller}
                  >
                    {searchState.suggestions.map((suggestion, index) => (
                      <Pressable
                        accessibilityLabel={[suggestion.title, suggestion.subtitle].filter(Boolean).join(", ")}
                        accessibilityRole="button"
                        disabled={resolvingSuggestion}
                        key={suggestion.id}
                        onPress={() => void chooseSuggestion(suggestion)}
                        style={({ pressed }) => [
                          editorStyles.suggestionRow,
                          index > 0 ? editorStyles.suggestionDivider : null,
                          pressed ? styles.buttonPressed : null
                        ]}
                      >
                        <MapPinGlyph color={theme.accent} />
                        <View style={editorStyles.suggestionText}>
                          <Text numberOfLines={1} style={editorStyles.suggestionTitle}>{suggestion.title}</Text>
                          {suggestion.subtitle ? (
                            <Text numberOfLines={2} style={editorStyles.suggestionSubtitle}>{suggestion.subtitle}</Text>
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
                  style={editorStyles.selectedResult}
                >
                  <MapPinGlyph color={theme.accent} />
                  <View style={editorStyles.suggestionText}>
                    <Text style={editorStyles.suggestionTitle}>{selectedResult.title}</Text>
                    {selectedResult.formattedAddress || selectedResult.subtitle ? (
                      <Text style={editorStyles.suggestionSubtitle} numberOfLines={2}>
                        {selectedResult.formattedAddress || selectedResult.subtitle}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityLabel="Change selected place"
                    accessibilityRole="button"
                    onPress={clearSearch}
                    style={pressable(editorStyles.changeButton, styles.buttonPressed)}
                  >
                    <Text style={editorStyles.changeButtonText}>Change</Text>
                  </Pressable>
                </Reanimated.View>
              ) : null}
            </View>

            <View style={styles.panel}>
              <Text style={styles.label}>Name in Dayframe</Text>
              <TextInput
                accessibilityLabel="Name in Dayframe"
                onChangeText={(value) => {
                  nameTouched.current = true;
                  setPlaceName(value);
                }}
                placeholder="Home, Gym, Mum's house…"
                placeholderTextColor={theme.textSecondary}
                returnKeyType="done"
                style={styles.textInput}
                value={placeName}
              />

              {formCoordinate ? (
                <View style={editorStyles.mapSection}>
                  <MapView
                    accessibilityLabel={`Saved place centre and ${Number.isFinite(numericRadius) ? numericRadius : 0} metre radius preview`}
                    onPress={(event: MapPressEvent) => {
                      applyCoordinate(
                        event.nativeEvent.coordinate.latitude,
                        event.nativeEvent.coordinate.longitude
                      );
                    }}
                    pitchEnabled={false}
                    region={{ ...formCoordinate, latitudeDelta: 0.006, longitudeDelta: 0.006 }}
                    rotateEnabled={false}
                    style={editorStyles.mapPreview}
                  >
                    {Number.isFinite(numericRadius) && numericRadius > 0 ? (
                      <Circle
                        center={formCoordinate}
                        fillColor={`${theme.accent}24`}
                        radius={numericRadius}
                        strokeColor={theme.accent}
                        strokeWidth={2}
                      />
                    ) : null}
                    <Marker coordinate={formCoordinate} pinColor={theme.accent} title="Saved place centre" />
                  </MapView>
                  <Text style={styles.muted}>Tap the map to fine-tune the centre.</Text>
                </View>
              ) : (
                <Text style={styles.muted}>
                  Choose a search result, use Current location, or enter coordinates.
                </Text>
              )}

              <View style={editorStyles.locationRadiusRow}>
                <Pressable
                  accessibilityLabel="Use current location"
                  accessibilityRole="button"
                  disabled={locating}
                  onPress={() => void useCurrentLocation()}
                  style={({ pressed }) => [
                    editorStyles.currentLocationAction,
                    locating ? styles.buttonDisabled : null,
                    pressed ? styles.buttonPressed : null
                  ]}
                >
                  <View style={editorStyles.currentLocationIcon}>
                    <TargetGlyph color={theme.accent} />
                  </View>
                  <Text style={editorStyles.currentLocationLabel}>
                    {locating ? "Finding…" : "Current location"}
                  </Text>
                </Pressable>
                <View style={editorStyles.radiusGroup}>
                  <Text style={styles.label}>Radius</Text>
                  <View style={editorStyles.radiusInputRow}>
                    <TextInput
                      accessibilityLabel="Place radius in metres"
                      keyboardType="number-pad"
                      onChangeText={setRadiusMeters}
                      placeholder="100"
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.textInput, editorStyles.radiusInput]}
                      value={radiusMeters}
                    />
                    <Text style={styles.muted}>m</Text>
                  </View>
                </View>
              </View>

              {locationAccuracy !== null ? (
                <Text style={styles.diagnosticText}>{formatLocationAccuracy(locationAccuracy)}</Text>
              ) : null}
              {accuracyWarning ? <Text style={styles.warningText}>{accuracyWarning}</Text> : null}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: advancedExpanded }}
                onPress={() => {
                  setAdvancedExpanded((expanded) => !expanded);
                }}
                style={pressable(editorStyles.disclosureButton, styles.buttonPressed)}
              >
                <Text style={editorStyles.disclosureText}>Advanced coordinates</Text>
                <ChevronGlyph color={theme.textSecondary} expanded={advancedExpanded} />
              </Pressable>
              {advancedExpanded ? (
                <Reanimated.View
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  layout={localLayoutTransition(reduceMotion)}
                  style={editorStyles.coordinateFields}
                >
                  <View style={editorStyles.coordinateField}>
                    <Text style={styles.label}>Latitude</Text>
                    <TextInput
                      accessibilityLabel="Latitude"
                      keyboardType="numbers-and-punctuation"
                      onChangeText={setLatitudeText}
                      placeholder="51.5074"
                      placeholderTextColor={theme.textSecondary}
                      style={styles.textInput}
                      value={latitudeText}
                    />
                  </View>
                  <View style={editorStyles.coordinateField}>
                    <Text style={styles.label}>Longitude</Text>
                    <TextInput
                      accessibilityLabel="Longitude"
                      keyboardType="numbers-and-punctuation"
                      onChangeText={setLongitudeText}
                      placeholder="-0.1278"
                      placeholderTextColor={theme.textSecondary}
                      style={styles.textInput}
                      value={longitudeText}
                    />
                  </View>
                  {!validation.ok && /Latitude|Longitude/.test(validation.message) ? (
                    <Text accessibilityLiveRegion="polite" style={styles.warningText}>{validation.message}</Text>
                  ) : null}
                </Reanimated.View>
              ) : null}
            </View>

            {newRole && roleHolder ? (
              <View style={styles.panel}>
                <Text style={styles.label}>Rename the old {placeRoleLabel(newRole).toLowerCase()}</Text>
                <TextInput
                  accessibilityHint="Its past entries keep this name. Leave it blank to keep the current name."
                  accessibilityLabel={`Rename the old ${placeRoleLabel(newRole).toLowerCase()}`}
                  maxLength={120}
                  onChangeText={setPreviousRoleName}
                  placeholder={roleHolder.name}
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="done"
                  style={styles.textInput}
                  testID="place-editor-previous-role-name"
                  value={previousRoleName ?? previousRolePlaceName(newRole)}
                />
                <Text style={styles.categoryMeta}>
                  {placeRoleLabel(newRole)} moves to this new place. The old one keeps its entries under this name, so they don&apos;t read as an address.
                </Text>
              </View>
            ) : null}

            <View style={styles.panel}>
              <View style={styles.healthPreferenceHeader}>
                <View style={styles.healthPreferenceText}>
                  <Text style={styles.categoryName}>Suggest visits here</Text>
                  <Text style={styles.categoryMeta}>
                    {loggingEnabled
                      ? "Show detected visits in Review."
                      : "Do not suggest visits for this place."}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Suggest visits here"
                  ios_backgroundColor={theme.borderStrong}
                  onValueChange={(enabled) => {
                    setLoggingEnabled(enabled);
                    if (!enabled) {
                      setDefaultCategoryId("");
                      setDefaultActivityDescription("");
                    }
                  }}
                  thumbColor={loggingEnabled ? theme.onAccent : theme.surfaceRaised}
                  trackColor={{ false: theme.borderStrong, true: theme.accent }}
                  value={loggingEnabled}
                />
              </View>
              {loggingEnabled ? (
                <Reanimated.View
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  layout={localLayoutTransition(reduceMotion)}
                  style={editorStyles.suggestionPreferences}
                >
                  <Text style={styles.label}>Default activity</Text>
                  <ScrollView
                    alwaysBounceVertical={false}
                    bounces={false}
                    directionalLockEnabled
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.categoryChoiceScroller}
                  >
                    <CategoryChoice
                      label="No default"
                      selected={!defaultCategoryId}
                      onPress={() => setDefaultCategoryId("")}
                      theme={theme}
                      styles={styles}
                    />
                    {categories.map((category) => (
                      <CategoryChoice
                        category={category}
                        key={category.id}
                        label={category.name}
                        selected={defaultCategoryId === category.id}
                        onPress={() => setDefaultCategoryId(category.id)}
                        theme={theme}
                        styles={styles}
                      />
                    ))}
                  </ScrollView>
                  <Text style={styles.label}>Default task description</Text>
                  <TextInput
                    accessibilityLabel="Default task description"
                    onChangeText={setDefaultActivityDescription}
                    placeholder="School drop-off/pickup"
                    placeholderTextColor={theme.textSecondary}
                    returnKeyType="done"
                    style={styles.textInput}
                    value={defaultActivityDescription}
                  />
                </Reanimated.View>
              ) : null}
            </View>

            {statusMessage ? (
              <Text accessibilityLiveRegion="polite" style={styles.statusText}>{statusMessage}</Text>
            ) : null}
            <View style={editorStyles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.back()}
                style={pressable(styles.secondaryButton, styles.buttonPressed)}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: saving || !validation.ok }}
                disabled={saving || !validation.ok}
                onPress={() => void savePlace()}
                style={({ pressed }) => [
                  styles.primaryInlineButton,
                  saving || !validation.ok ? styles.buttonDisabled : null,
                  pressed ? styles.buttonPressed : null
                ]}
              >
                <Text style={styles.primaryButtonText}>{saving ? "Saving…" : "Save"}</Text>
              </Pressable>
            </View>
            {mode === "edit" && loadedEntity ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ busy: deleting, disabled: saving || deleting }}
                disabled={saving || deleting}
                onPress={confirmDeletePlace}
                style={({ pressed }) => [editorStyles.deleteButton, { backgroundColor: theme.surfaceMuted }, pressed ? styles.buttonPressed : null]}
                testID="place-editor-delete"
              >
                <Text style={[editorStyles.deleteText, { color: theme.dangerText }]}>{deleting ? "Deleting…" : "Delete place"}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function CategoryChoice({
  category,
  label,
  selected,
  onPress,
  theme,
  styles
}: {
  category?: Category;
  label: string;
  selected: boolean;
  onPress: () => void;
  theme: MobileTheme;
  styles: MobileStyles;
}) {
  const chipColor = category
    ? paletteColorFor(category.color, category.name, theme.mode)
    : theme.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={{ top: 6, bottom: 6 }}
      onPress={onPress}
      style={pressable(
        [
          styles.categoryChoice,
          category ? { borderColor: chipColor } : null,
          selected ? styles.categoryChoiceSelected : null,
          selected ? { borderColor: chipColor } : null
        ],
        styles.buttonPressed
      )}
    >
      {category ? <View style={[styles.colorDot, { backgroundColor: chipColor, borderColor: chipColor }]} /> : null}
      <Text style={[
        styles.categoryChoiceText,
        selected ? styles.categoryChoiceTextSelected : null,
        selected ? { color: chipColor } : null
      ]}>
        {label}
      </Text>
      {selected ? <CheckGlyph color={chipColor} /> : null}
    </Pressable>
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

function createEditorStyles(theme: MobileTheme) {
  return StyleSheet.create({
    scrollContent: { paddingBottom: 34 },
    searchField: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderRadius: 14,
      backgroundColor: theme.surfaceMuted,
      paddingLeft: 12,
      paddingRight: 6
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      color: theme.textPrimary,
      fontFamily: "System",
      fontSize: 15,
      paddingVertical: 9
    },
    clearButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center"
    },
    suggestionList: {
      borderRadius: 14,
      backgroundColor: theme.surfaceMuted,
      overflow: "hidden"
    },
    suggestionScroller: { maxHeight: 294 },
    suggestionRow: {
      minHeight: 49,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    suggestionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
    suggestionText: { flex: 1, minWidth: 0, gap: 2 },
    suggestionTitle: { color: theme.textPrimary, fontSize: 14, fontWeight: "700", lineHeight: 18 },
    suggestionSubtitle: { color: theme.textSecondary, fontSize: 12, lineHeight: 16 },
    selectedResult: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderRadius: 14,
      backgroundColor: theme.accentSoft,
      padding: 10
    },
    changeButton: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 8
    },
    changeButtonText: { color: theme.accentText, fontSize: 12, fontWeight: "700" },
    mapSection: { gap: 7 },
    mapPreview: { width: "100%", height: 180, borderRadius: 16 },
    locationRadiusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 28 },
    currentLocationAction: { minHeight: 64, minWidth: 118, flexDirection: "row", alignItems: "center", gap: 8 },
    currentLocationIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft
    },
    currentLocationLabel: { color: theme.textPrimary, fontSize: 12, fontWeight: "700", flexShrink: 1 },
    radiusGroup: { flex: 1, minWidth: 0, gap: 5, alignSelf: "center", alignItems: "center" },
    radiusInputRow: { flexDirection: "row", alignItems: "center", gap: 7 },
    radiusInput: { width: 90, textAlign: "center" },
    disclosureButton: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between"
    },
    disclosureText: { color: theme.textPrimary, fontSize: 14, fontWeight: "700" },
    coordinateFields: { gap: 9 },
    coordinateField: { gap: 5 },
    suggestionPreferences: { gap: 9 },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 9, paddingBottom: 6 },
    deleteButton: { alignItems: "center", borderRadius: 999, justifyContent: "center", marginTop: 8, minHeight: 48 },
    deleteText: { fontSize: 15, fontWeight: "700" }
  });
}

function BackGlyph({ color }: { color: string }) {
  return <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M15 5 8 12l7 7" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} /></Svg>;
}

function SearchGlyph({ color }: { color: string }) {
  return <Svg width={18} height={18} viewBox="0 0 24 24"><SvgCircle cx={11} cy={11} fill="none" r={6} stroke={color} strokeWidth={2} /><Path d="m16 16 4 4" stroke={color} strokeLinecap="round" strokeWidth={2} /></Svg>;
}

function CloseGlyph({ color }: { color: string }) {
  return <Svg width={17} height={17} viewBox="0 0 24 24"><Path d="m7 7 10 10M17 7 7 17" stroke={color} strokeLinecap="round" strokeWidth={2} /></Svg>;
}

function MapPinGlyph({ color }: { color: string }) {
  return <Svg width={18} height={18} viewBox="0 0 24 24"><Path d="M12 21s7-5.2 7-12a7 7 0 0 0-14 0c0 6.8 7 12 7 12Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={2} /><Path d="M12 12.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z" fill="none" stroke={color} strokeWidth={2} /></Svg>;
}

function TargetGlyph({ color }: { color: string }) {
  return <Svg width={21} height={21} viewBox="0 0 24 24"><SvgCircle cx={12} cy={12} fill="none" r={6} stroke={color} strokeWidth={2} /><SvgCircle cx={12} cy={12} fill={color} r={2} /><Path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke={color} strokeLinecap="round" strokeWidth={2} /></Svg>;
}

function ChevronGlyph({ color, expanded }: { color: string; expanded: boolean }) {
  return <Svg width={18} height={18} viewBox="0 0 24 24"><Path d={expanded ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} /></Svg>;
}

function CheckGlyph({ color }: { color: string }) {
  return <Svg width={15} height={15} viewBox="0 0 24 24"><Path d="m5 12 4 4 10-10" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} /></Svg>;
}
