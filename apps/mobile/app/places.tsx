import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View
} from "react-native";
import * as Location from "expo-location";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import {
  formatLocationCoordinates,
  locationAddressSummary,
  paletteColorFor
} from "@dayframe/shared";
import {
  AuthRequiredError,
  createPlace,
  deletePlace,
  fetchBootstrap,
  forgetLearnedPlace,
  ignoreLearnedPlace,
  updatePlace,
  type MobileBootstrap,
  type MobileLearnedPlace,
  type MobilePlace
} from "@/lib/api";
import { refreshGeofencesForPlaces } from "@/lib/geofence";
import {
  DEFAULT_PLACE_RADIUS_METERS,
  foregroundLocationPermissionGuidance,
  formatLocationAccuracy,
  locationAccuracyWarning,
  suggestedPlaceNameFromGeocode,
  validatePlaceForm
} from "@/lib/places";
import { pressable, useMobileTheme, type MobileStyles, type MobileTheme } from "@/lib/mobileTheme";
import { scheduleLayoutTransition, useReduceMotionPreference } from "@/lib/motion";

type Category = MobileBootstrap["categories"][number];

type PlaceFormMode =
  | {
      type: "create";
      learnedPlace?: MobileLearnedPlace;
    }
  | {
      type: "edit";
      place: MobilePlace;
    };

export default function PlacesScreen() {
  const reduceMotion = useReduceMotionPreference();
  const { styles, theme } = useMobileTheme();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [ignoringLearnedId, setIgnoringLearnedId] = useState<string | null>(null);
  const [forgettingLearnedId, setForgettingLearnedId] = useState<string | null>(null);
  const [selectedLearnedPlace, setSelectedLearnedPlace] = useState<MobileLearnedPlace | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<PlaceFormMode | null>(null);
  const [placeName, setPlaceName] = useState("");
  const [latitudeText, setLatitudeText] = useState("");
  const [longitudeText, setLongitudeText] = useState("");
  const [radiusMeters, setRadiusMeters] = useState(String(DEFAULT_PLACE_RADIUS_METERS));
  const [defaultCategoryId, setDefaultCategoryId] = useState("");
  const [defaultActivityDescription, setDefaultActivityDescription] = useState("");
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [locationPrecise, setLocationPrecise] = useState(true);
  const saveInFlight = useRef(false);

  const load = useCallback(async (options?: { refresh?: boolean; silent?: boolean }) => {
    if (options?.refresh) setRefreshing(true);
    try {
      const bootstrap = await fetchBootstrap();
      setData(bootstrap);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      if (!options?.silent) {
        Alert.alert("Places", error instanceof Error ? error.message : "Unable to load places.");
      }
    } finally {
      if (options?.refresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load({ silent: true });
    }, [load])
  );

  function beginAddPlace() {
    scheduleLayoutTransition(reduceMotion);
    setFormMode({ type: "create" });
    setPlaceName("");
    setLatitudeText("");
    setLongitudeText("");
    setRadiusMeters(String(DEFAULT_PLACE_RADIUS_METERS));
    setDefaultCategoryId("");
    setDefaultActivityDescription("");
    setLocationAccuracy(null);
    setLocationPrecise(true);
    setStatusMessage(null);
  }

  function beginSaveLearnedPlace(learnedPlace: MobileLearnedPlace) {
    scheduleLayoutTransition(reduceMotion);
    setSelectedLearnedPlace(null);
    setFormMode({ type: "create", learnedPlace });
    setPlaceName(learnedPlace.name);
    setLatitudeText(formatCoordinate(learnedPlace.latitude));
    setLongitudeText(formatCoordinate(learnedPlace.longitude));
    setRadiusMeters(String(learnedPlace.radiusMeters));
    setDefaultCategoryId("");
    setDefaultActivityDescription("");
    setLocationAccuracy(null);
    setLocationPrecise(true);
    setStatusMessage("Review the learned place before saving it.");
  }

  async function useCurrentLocation() {
    if (locating) return;
    setLocating(true);
    setStatusMessage("Checking current location...");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      const guidance = foregroundLocationPermissionGuidance(permission);
      if (guidance) {
        setStatusMessage(guidance);
        Alert.alert("Use current location", guidance);
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      });
      const { latitude, longitude, accuracy } = position.coords;
      const precise = permission.ios?.accuracy !== "reduced";
      const suggestedName = await suggestCurrentPlaceName(latitude, longitude);

      if (!formMode) setFormMode({ type: "create" });
      setLatitudeText(formatCoordinate(latitude));
      setLongitudeText(formatCoordinate(longitude));
      setLocationAccuracy(accuracy ?? null);
      setLocationPrecise(precise);
      if (!placeName.trim() && suggestedName) setPlaceName(suggestedName);
      setStatusMessage(formatLocationAccuracy(accuracy));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read current location.";
      setStatusMessage(message);
      Alert.alert("Use current location", message);
    } finally {
      setLocating(false);
    }
  }

  function beginEditPlace(place: MobilePlace) {
    scheduleLayoutTransition(reduceMotion);
    setFormMode({ type: "edit", place });
    setPlaceName(place.name);
    setLatitudeText(formatOptionalCoordinate(place.latitude));
    setLongitudeText(formatOptionalCoordinate(place.longitude));
    setRadiusMeters(String(place.radiusMeters));
    setDefaultCategoryId(place.defaultCategoryId ?? "");
    setDefaultActivityDescription(place.defaultActivityDescription ?? "");
    setLocationAccuracy(null);
    setLocationPrecise(true);
    setStatusMessage(null);
  }

  function cancelForm() {
    scheduleLayoutTransition(reduceMotion);
    setFormMode(null);
    setPlaceName("");
    setLatitudeText("");
    setLongitudeText("");
    setRadiusMeters(String(DEFAULT_PLACE_RADIUS_METERS));
    setDefaultCategoryId("");
    setDefaultActivityDescription("");
    setLocationAccuracy(null);
    setLocationPrecise(true);
  }

  async function savePlace() {
    if (!formMode || saveInFlight.current) return;
    const validation = validatePlaceForm({
      name: placeName,
      latitude: latitudeText,
      longitude: longitudeText,
      radiusMeters,
      defaultCategoryId,
      defaultActivityDescription
    });
    if (!validation.ok) {
      Alert.alert("Places", validation.message);
      return;
    }

    saveInFlight.current = true;
    setSaving(true);
    try {
      if (formMode.type === "create") {
        const learnedPlaceId = formMode.learnedPlace?.id;
        const response = await createPlace({
          learnedPlaceId,
          name: validation.value.name,
          latitude: validation.value.latitude,
          longitude: validation.value.longitude,
          radiusMeters: validation.value.radiusMeters,
          priority: 5,
          defaultCategoryId: validation.value.defaultCategoryId,
          defaultActivityDescription: validation.value.defaultActivityDescription
        });
        upsertLocalPlace(response.place);
        cancelForm();
        await refreshAfterPlaceChange({
          prefix: "Place saved.",
          upsertPlace: response.place,
          removeLearnedPlaceId: learnedPlaceId
        });
      } else {
        const response = await updatePlace(formMode.place.id, {
          name: validation.value.name,
          latitude: validation.value.latitude,
          longitude: validation.value.longitude,
          radiusMeters: validation.value.radiusMeters,
          defaultCategoryId: validation.value.defaultCategoryId,
          defaultActivityDescription: validation.value.defaultActivityDescription
        });
        upsertLocalPlace(response.place);
        cancelForm();
        await refreshAfterPlaceChange({
          prefix: "Place saved.",
          upsertPlace: response.place
        });
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Places", error instanceof Error ? error.message : "Unable to save place.");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  function confirmDeletePlace(place: MobilePlace) {
    Alert.alert(
      "Delete place",
      `Delete ${place.name}? Existing time entries keep their time data, but this place label will be removed.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void removePlace(place);
          }
        }
      ]
    );
  }

  async function removePlace(place: MobilePlace) {
    setDeletingId(place.id);
    try {
      await deletePlace(place.id);
      if (formMode?.type === "edit" && formMode.place.id === place.id) cancelForm();
      removeLocalPlace(place.id);
      await refreshAfterPlaceChange({
        prefix: "Place deleted.",
        removePlaceId: place.id
      });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Places", error instanceof Error ? error.message : "Unable to delete place.");
    } finally {
      setDeletingId(null);
    }
  }

  function confirmIgnoreLearnedCandidate(learnedPlace: MobileLearnedPlace) {
    Alert.alert(
      "Ignore learned place",
      "Ignore hides this learned location from save suggestions. It will not create or confirm any time entries.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Ignore",
          onPress: () => {
            void ignoreLearnedCandidate(learnedPlace);
          }
        }
      ]
    );
  }

  async function ignoreLearnedCandidate(learnedPlace: MobileLearnedPlace) {
    setIgnoringLearnedId(learnedPlace.id);
    try {
      await ignoreLearnedPlace(learnedPlace.id);
      removeLocalLearnedPlace(learnedPlace.id);
      await refreshAfterPlaceChange({
        prefix: "Learned place ignored.",
        removeLearnedPlaceId: learnedPlace.id
      });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Places", error instanceof Error ? error.message : "Unable to ignore learned place.");
    } finally {
      setIgnoringLearnedId(null);
    }
  }

  function confirmForgetLearnedCandidate(learnedPlace: MobileLearnedPlace) {
    Alert.alert(
      "Forget learned place",
      "Forget deletes this learned candidate. Dayframe may learn it again later if future visits provide enough evidence.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
          onPress: () => {
            void forgetLearnedCandidate(learnedPlace);
          }
        }
      ]
    );
  }

  async function forgetLearnedCandidate(learnedPlace: MobileLearnedPlace) {
    setForgettingLearnedId(learnedPlace.id);
    try {
      await forgetLearnedPlace(learnedPlace.id);
      removeLocalLearnedPlace(learnedPlace.id);
      await refreshAfterPlaceChange({
        prefix: "Learned place forgotten.",
        removeLearnedPlaceId: learnedPlace.id
      });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Places", error instanceof Error ? error.message : "Unable to forget learned place.");
    } finally {
      setForgettingLearnedId(null);
    }
  }

  function upsertLocalPlace(place: MobilePlace) {
    setData((current) => current ? reconcileBootstrapPlaces(current, { upsertPlace: place }) : current);
  }

  function removeLocalPlace(id: string) {
    setData((current) => current ? reconcileBootstrapPlaces(current, { removePlaceId: id }) : current);
  }

  function removeLocalLearnedPlace(id: string) {
    setSelectedLearnedPlace((current) => current?.id === id ? null : current);
    setData((current) => current ? reconcileBootstrapPlaces(current, { removeLearnedPlaceId: id }) : current);
  }

  async function refreshAfterPlaceChange(options: {
    prefix: string;
    upsertPlace?: MobilePlace;
    removePlaceId?: string;
    removeLearnedPlaceId?: string;
  }) {
    try {
      const bootstrap = await fetchBootstrap();
      const reconciled = reconcileBootstrapPlaces(bootstrap, options);
      setData(reconciled);
      const monitoredCount = await refreshGeofencesForPlaces(reconciled.places).catch(() => 0);
      const bootstrapHasPlace =
        !options.upsertPlace || bootstrap.places.some((place) => place.id === options.upsertPlace?.id);
      const refreshNote = bootstrapHasPlace ? "" : " Saved locally while the server list catches up.";
      setStatusMessage(
        monitoredCount > 0
          ? `${options.prefix} Monitoring ${monitoredCount} places.${refreshNote}`
          : `${options.prefix} Background place monitoring is unchanged.${refreshNote}`
      );
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      setStatusMessage(`${options.prefix} Pull to refresh if it does not appear on another device.`);
    }
  }

  const places = data?.places ?? [];
  const learnedPlaces = data?.learnedPlaces ?? [];
  const categories = data?.categories ?? [];
  const createWarning = formMode?.type === "create"
    ? locationAccuracyWarning(locationAccuracy, locationPrecise)
    : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load({ refresh: true })}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <View style={styles.contentStack}>
          <View style={styles.settingsHeader}>
            <Pressable
              accessibilityLabel="Back"
              accessibilityRole="button"
              style={pressable(styles.iconButton, styles.buttonPressed)}
              onPress={() => router.back()}
            >
              <BackGlyph color={theme.accent} />
            </Pressable>
            <Text style={styles.settingsTitle} numberOfLines={1}>Places</Text>
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Places</Text>
            <Text style={styles.muted}>Places help Dayframe recognise where time was spent.</Text>
            <Text style={styles.muted}>Visits are reviewed before becoming time entries.</Text>
            <View style={styles.buttonRow}>
              <Pressable
                accessibilityRole="button"
                disabled={locating}
                style={({ pressed }) => [
                  styles.primaryInlineButton,
                  locating ? styles.buttonDisabled : null,
                  pressed ? styles.buttonPressed : null
                ]}
                onPress={beginAddPlace}
              >
                <Text style={styles.primaryButtonText}>Add place</Text>
              </Pressable>
            </View>
            {statusMessage ? <Text style={styles.statusText}>{statusMessage}</Text> : null}
          </View>

          {formMode ? (
            <View style={styles.placeForm}>
              <Text style={styles.label}>
                {formMode.type === "create"
                  ? formMode.learnedPlace ? "Save learned place" : "New place"
                  : "Edit place"}
              </Text>
              <TextInput
                style={styles.textInput}
                value={placeName}
                onChangeText={setPlaceName}
                placeholder="Place name"
                placeholderTextColor={theme.textSecondary}
                returnKeyType="done"
              />
              <View style={styles.placeFormRow}>
                <View style={styles.placeFormField}>
                  <Text style={styles.label}>Latitude</Text>
                  <TextInput
                    style={[styles.textInput, styles.coordinateInput]}
                    value={latitudeText}
                    onChangeText={setLatitudeText}
                    keyboardType="numbers-and-punctuation"
                    placeholder="51.5074"
                    placeholderTextColor={theme.textSecondary}
                    returnKeyType="done"
                  />
                </View>
                <View style={styles.placeFormField}>
                  <Text style={styles.label}>Longitude</Text>
                  <TextInput
                    style={[styles.textInput, styles.coordinateInput]}
                    value={longitudeText}
                    onChangeText={setLongitudeText}
                    keyboardType="numbers-and-punctuation"
                    placeholder="-0.1278"
                    placeholderTextColor={theme.textSecondary}
                    returnKeyType="done"
                  />
                </View>
              </View>
              <View style={styles.buttonRow}>
                <Pressable
                  accessibilityRole="button"
                  disabled={locating}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    locating ? styles.buttonDisabled : null,
                    pressed ? styles.buttonPressed : null
                  ]}
                  onPress={useCurrentLocation}
                >
                  <Text style={styles.secondaryButtonText}>
                    {locating ? "Finding location..." : "Use current location"}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.placeFormRow}>
                <TextInput
                  style={[styles.textInput, styles.radiusInput]}
                  value={radiusMeters}
                  onChangeText={setRadiusMeters}
                  keyboardType="number-pad"
                  placeholder="100"
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="done"
                />
                <View style={styles.categoryTextStack}>
                  <Text style={styles.label}>Radius</Text>
                  <Text style={styles.diagnosticText}>Meters from this place.</Text>
                </View>
              </View>
              <View style={styles.activeEditSection}>
                <Text style={styles.label}>Default category</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryChoiceScroller}>
                  <CategoryChoice
                    label="No default"
                    selected={!defaultCategoryId}
                    onPress={() => setDefaultCategoryId("")}
                    theme={theme}
                    styles={styles}
                  />
                  {categories.map((category) => (
                    <CategoryChoice
                      key={category.id}
                      category={category}
                      label={category.name}
                      selected={defaultCategoryId === category.id}
                      onPress={() => setDefaultCategoryId(category.id)}
                      theme={theme}
                      styles={styles}
                    />
                  ))}
                </ScrollView>
              </View>
              <View style={styles.activeEditSection}>
                <Text style={styles.label}>Default activity description</Text>
                <TextInput
                  style={styles.textInput}
                  value={defaultActivityDescription}
                  onChangeText={setDefaultActivityDescription}
                  placeholder="School drop-off/pickup"
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="done"
                />
              </View>
              {locationAccuracy !== null ? (
                <Text style={styles.diagnosticText}>{formatLocationAccuracy(locationAccuracy)}</Text>
              ) : null}
              {createWarning ? <Text style={styles.warningText}>{createWarning}</Text> : null}
              <View style={styles.buttonRow}>
                <Pressable
                  accessibilityRole="button"
                  style={pressable(styles.secondaryButton, styles.buttonPressed)}
                  onPress={cancelForm}
                >
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  style={({ pressed }) => [
                    styles.primaryInlineButton,
                    saving ? styles.buttonDisabled : null,
                    pressed ? styles.buttonPressed : null
                  ]}
                  onPress={savePlace}
                >
                  <Text style={styles.primaryButtonText}>{saving ? "Saving..." : "Save"}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Your places</Text>
            {places.length > 0 ? (
              <View style={styles.placeList}>
                {places.map((place) => (
                  <PlaceRow
                    key={place.id}
                    place={place}
                    categories={categories}
                    deleting={deletingId === place.id}
                    onEdit={() => beginEditPlace(place)}
                    onDelete={() => confirmDeletePlace(place)}
                    theme={theme}
                    styles={styles}
                  />
                ))}
              </View>
            ) : (
              <Text style={styles.muted}>No places yet. Add a place with coordinates or use your current location.</Text>
            )}
            <View style={styles.settingsDivider} />
            <Text style={styles.sectionTitle}>Learned places</Text>
            {learnedPlaces.length > 0 ? (
              <View style={styles.placeList}>
                {learnedPlaces.map((learnedPlace) => (
                  <LearnedPlaceRow
                    key={learnedPlace.id}
                    learnedPlace={learnedPlace}
                    ignoring={ignoringLearnedId === learnedPlace.id}
                    onOpen={() => setSelectedLearnedPlace(learnedPlace)}
                    onSave={() => beginSaveLearnedPlace(learnedPlace)}
                    onIgnore={() => confirmIgnoreLearnedCandidate(learnedPlace)}
                    theme={theme}
                    styles={styles}
                  />
                ))}
              </View>
            ) : (
              <Text style={styles.muted}>No learned candidates yet.</Text>
            )}
          </View>
        </View>
      </ScrollView>
      <LearnedPlaceDetailSheet
        categories={categories}
        forgetting={Boolean(selectedLearnedPlace && forgettingLearnedId === selectedLearnedPlace.id)}
        ignoring={Boolean(selectedLearnedPlace && ignoringLearnedId === selectedLearnedPlace.id)}
        learnedPlace={selectedLearnedPlace}
        onClose={() => setSelectedLearnedPlace(null)}
        onEdit={(learnedPlace) => beginSaveLearnedPlace(learnedPlace)}
        onForget={(learnedPlace) => confirmForgetLearnedCandidate(learnedPlace)}
        onIgnore={(learnedPlace) => confirmIgnoreLearnedCandidate(learnedPlace)}
        onSave={(learnedPlace) => beginSaveLearnedPlace(learnedPlace)}
        styles={styles}
        theme={theme}
      />
    </SafeAreaView>
  );
}

function PlaceRow({
  place,
  categories,
  deleting,
  onEdit,
  onDelete,
  theme,
  styles
}: {
  place: MobilePlace;
  categories: Category[];
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  theme: MobileTheme;
  styles: MobileStyles;
}) {
  const defaultCategoryName =
    place.defaultCategoryName ??
    categories.find((category) => category.id === place.defaultCategoryId)?.name ??
    null;
  return (
    <View style={styles.placeRow}>
      <MapPinGlyph color={theme.accent} />
      <View style={styles.placeTextStack}>
        <Text style={styles.placeName} numberOfLines={1}>{place.name}</Text>
        {place.defaultActivityDescription ? (
          <Text style={styles.placeMeta} numberOfLines={2}>
            {place.defaultActivityDescription}
          </Text>
        ) : null}
        <Text style={styles.placeMeta} numberOfLines={2}>
          {defaultCategoryName ?? "No default category"} · {place.radiusMeters}m radius
        </Text>
      </View>
      <View style={styles.placeActions}>
        <Pressable
          accessibilityLabel={`Edit ${place.name}`}
          accessibilityRole="button"
          style={pressable(styles.categoryIconButton, styles.buttonPressed)}
          onPress={onEdit}
        >
          <PencilGlyph color={theme.accent} />
        </Pressable>
        <Pressable
          accessibilityLabel={`Delete ${place.name}`}
          accessibilityRole="button"
          disabled={deleting}
          style={({ pressed }) => [
            styles.categoryIconButton,
            deleting ? styles.buttonDisabled : null,
            pressed ? styles.buttonPressed : null
          ]}
          onPress={onDelete}
        >
          <ArchiveGlyph color={theme.danger} />
        </Pressable>
      </View>
    </View>
  );
}

function LearnedPlaceRow({
  learnedPlace,
  ignoring,
  onOpen,
  onSave,
  onIgnore,
  theme,
  styles
}: {
  learnedPlace: MobileLearnedPlace;
  ignoring: boolean;
  onOpen: () => void;
  onSave: () => void;
  onIgnore: () => void;
  theme: MobileTheme;
  styles: MobileStyles;
}) {
  return (
    <Pressable
      accessibilityLabel={`Open learned place ${learnedPlace.name}`}
      accessibilityRole="button"
      style={pressable(styles.placeRow, styles.buttonPressed)}
      onPress={onOpen}
    >
      <MapPinGlyph color={theme.textSecondary} />
      <View style={styles.placeTextStack}>
        <Text style={styles.placeName} numberOfLines={2}>{learnedPlace.name}</Text>
        <Text style={styles.placeMeta} numberOfLines={2}>
          {formatLearnedPlaceMeta(learnedPlace)}
        </Text>
      </View>
      <View style={styles.placeActions}>
        <Pressable
          accessibilityLabel={`Save ${learnedPlace.name} as a place`}
          accessibilityRole="button"
          style={pressable(styles.learnedPlaceSaveButton, styles.buttonPressed)}
          onPress={onSave}
        >
          <Text style={styles.learnedPlaceSaveButtonText}>Save</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Ignore ${learnedPlace.name}`}
          accessibilityRole="button"
          disabled={ignoring}
          style={({ pressed }) => [
            styles.categoryIconButton,
            ignoring ? styles.buttonDisabled : null,
            pressed ? styles.buttonPressed : null
          ]}
          onPress={onIgnore}
        >
          <ArchiveGlyph color={theme.textSecondary} />
        </Pressable>
      </View>
    </Pressable>
  );
}

function LearnedPlaceDetailSheet({
  categories,
  forgetting,
  ignoring,
  learnedPlace,
  onClose,
  onEdit,
  onForget,
  onIgnore,
  onSave,
  styles,
  theme
}: {
  categories: Category[];
  forgetting: boolean;
  ignoring: boolean;
  learnedPlace: MobileLearnedPlace | null;
  onClose: () => void;
  onEdit: (learnedPlace: MobileLearnedPlace) => void;
  onForget: (learnedPlace: MobileLearnedPlace) => void;
  onIgnore: (learnedPlace: MobileLearnedPlace) => void;
  onSave: (learnedPlace: MobileLearnedPlace) => void;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  if (!learnedPlace) return null;

  const address = locationAddressSummary(learnedPlace.rawPayload?.address);
  const coordinates = formatLocationCoordinates(learnedPlace.latitude, learnedPlace.longitude, 6);
  const associatedCategory = learnedPlaceCategoryLabel(learnedPlace, categories);
  const disabled = ignoring || forgetting;

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <View style={styles.sheetOverlay}>
        <Pressable accessibilityLabel="Close learned place details" style={styles.sheetBackdrop} onPress={onClose} />
        <View style={styles.activeEditSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              style={pressable(styles.sheetIconButton, styles.buttonPressed)}
              onPress={onClose}
            >
              <CloseGlyph color={theme.accent} />
            </Pressable>
            <Text style={styles.sheetTitle} numberOfLines={2}>Learned place</Text>
            <View style={styles.sheetHeaderSpacer} />
          </View>

          <ScrollView style={styles.activeEditScroller} contentContainerStyle={styles.activeEditContent}>
            <Text style={styles.sectionTitle}>{learnedPlace.name}</Text>
            <Text style={styles.muted}>
              Learned-only candidates are not saved places until you save them. Ignore hides this suggestion; Forget deletes the candidate.
            </Text>

            <View style={styles.accountList}>
              <LearnedPlaceDetailRow label="Resolved name" value={learnedPlace.name} styles={styles} />
              <LearnedPlaceDetailRow label="Address/postcode" value={address ?? "Not resolved"} styles={styles} />
              <LearnedPlaceDetailRow label="Coordinates" value={coordinates ?? "Unavailable"} styles={styles} />
              <LearnedPlaceDetailRow
                label="Detected visits"
                value={`${learnedPlace.visitCount} ${learnedPlace.visitCount === 1 ? "visit" : "visits"}`}
                styles={styles}
              />
              <LearnedPlaceDetailRow
                label="Samples"
                value={`${learnedPlace.sampleCount} ${learnedPlace.sampleCount === 1 ? "sample" : "samples"}`}
                styles={styles}
              />
              <LearnedPlaceDetailRow label="Last seen" value={formatShortDateTime(learnedPlace.lastSeenAt)} styles={styles} />
              <LearnedPlaceDetailRow label="Learned radius" value={`${learnedPlace.radiusMeters}m`} styles={styles} />
              <LearnedPlaceDetailRow label="Category/activity" value={associatedCategory} styles={styles} />
              <LearnedPlaceDetailRow label="Status" value="Learned-only candidate" styles={styles} />
            </View>

            <View style={styles.buttonRow}>
              <Pressable
                accessibilityRole="button"
                style={pressable(styles.primaryInlineButton, styles.buttonPressed)}
                onPress={() => onSave(learnedPlace)}
              >
                <Text style={styles.primaryButtonText}>Save place</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={pressable(styles.secondaryButton, styles.buttonPressed)}
                onPress={() => onEdit(learnedPlace)}
              >
                <Text style={styles.secondaryButtonText}>Edit before saving</Text>
              </Pressable>
            </View>
            <View style={styles.buttonRow}>
              <Pressable
                accessibilityRole="button"
                disabled={disabled}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  disabled ? styles.buttonDisabled : null,
                  pressed && !disabled ? styles.buttonPressed : null
                ]}
                onPress={() => onIgnore(learnedPlace)}
              >
                <Text style={styles.secondaryButtonText}>{ignoring ? "Ignoring..." : "Ignore"}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={disabled}
                style={({ pressed }) => [
                  styles.activeEditDeleteButton,
                  disabled ? styles.buttonDisabled : null,
                  pressed && !disabled ? styles.buttonPressed : null
                ]}
                onPress={() => onForget(learnedPlace)}
              >
                <Text style={styles.activeEditDeleteText}>{forgetting ? "Forgetting..." : "Forget"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function LearnedPlaceDetailRow({
  label,
  value,
  styles
}: {
  label: string;
  value: string;
  styles: MobileStyles;
}) {
  return (
    <View style={styles.accountRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.accountValue} numberOfLines={3}>{value}</Text>
    </View>
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={pressable(
        [styles.categoryChoice, selected ? styles.categoryChoiceSelected : null],
        styles.buttonPressed
      )}
      onPress={onPress}
    >
      {category ? (
        <View
          style={[
            styles.colorDot,
            { backgroundColor: paletteColorFor(category.color, category.name, theme.mode) }
          ]}
        />
      ) : null}
      <Text style={[styles.categoryChoiceText, selected ? styles.categoryChoiceTextSelected : null]}>
        {label}
      </Text>
      {selected ? <CheckGlyph color={theme.accentText} /> : null}
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

function reconcileBootstrapPlaces(
  data: MobileBootstrap,
  options: { upsertPlace?: MobilePlace; removePlaceId?: string; removeLearnedPlaceId?: string }
): MobileBootstrap {
  const withoutChangedPlace = data.places.filter((place) => {
    if (options.removePlaceId && place.id === options.removePlaceId) return false;
    if (options.upsertPlace && place.id === options.upsertPlace.id) return false;
    return true;
  });
  const places = options.upsertPlace
    ? sortPlaces([options.upsertPlace, ...withoutChangedPlace])
    : sortPlaces(withoutChangedPlace);
  const learnedPlaces = options.removeLearnedPlaceId
    ? (data.learnedPlaces ?? []).filter((learnedPlace) => learnedPlace.id !== options.removeLearnedPlaceId)
    : data.learnedPlaces;
  return { ...data, places, learnedPlaces };
}

function sortPlaces(places: MobilePlace[]) {
  return [...places].sort((left, right) => {
    const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    return left.name.localeCompare(right.name);
  });
}

function formatLearnedPlaceMeta(learnedPlace: MobileLearnedPlace) {
  const visits = learnedPlace.visitCount === 1 ? "1 visit" : `${learnedPlace.visitCount} visits`;
  const samples = learnedPlace.sampleCount === 1 ? "1 sample" : `${learnedPlace.sampleCount} samples`;
  const lastSeen = formatShortDateTime(learnedPlace.lastSeenAt);
  return `${visits} · ${samples} · ${learnedPlace.radiusMeters}m radius · Last seen ${lastSeen}`;
}

function learnedPlaceCategoryLabel(learnedPlace: MobileLearnedPlace, categories: Category[]) {
  const raw = learnedPlace.rawPayload ?? {};
  const categoryName = typeof raw.categoryName === "string" && raw.categoryName.trim()
    ? raw.categoryName.trim()
    : null;
  if (categoryName) return categoryName;
  const categoryId = typeof raw.categoryId === "string" ? raw.categoryId : null;
  const category = categoryId ? categories.find((candidate) => candidate.id === categoryId) : null;
  const description = typeof raw.activityDescription === "string" && raw.activityDescription.trim()
    ? raw.activityDescription.trim()
    : null;
  if (category && description) return `${category.name} · ${description}`;
  if (category) return category.name;
  if (description) return description;
  return "Not set until saved";
}

function formatShortDateTime(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "recently";
  return timestamp.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function formatCoordinate(value: number) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function formatOptionalCoordinate(value?: number | null) {
  return typeof value === "number" ? formatCoordinate(value) : "";
}

function BackGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M15 5 8 12l7 7" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} />
    </Svg>
  );
}

function CloseGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path d="M6 6l12 12M18 6 6 18" stroke={color} strokeLinecap="round" strokeWidth={2.4} />
    </Svg>
  );
}

function MapPinGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path d="M12 21s7-5.2 7-12a7 7 0 0 0-14 0c0 6.8 7 12 7 12Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={2} />
      <Path d="M12 12.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z" fill="none" stroke={color} strokeWidth={2} />
    </Svg>
  );
}

function PencilGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path d="M4 20h4l10.5-10.5-4-4L4 16v4Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={2} />
      <Path d="m13.5 6.5 4 4" stroke={color} strokeLinecap="round" strokeWidth={2} />
    </Svg>
  );
}

function ArchiveGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path d="M5 7h14" stroke={color} strokeLinecap="round" strokeWidth={2} />
      <Path d="M9 7V5h6v2" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
      <Path d="M8 10v9h8v-9" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={2} />
    </Svg>
  );
}

function CheckGlyph({ color }: { color: string }) {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24">
      <Path d="m5 12 4 4 10-10" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} />
    </Svg>
  );
}
