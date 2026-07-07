import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
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
import { paletteColorFor } from "@dayframe/shared";
import {
  AuthRequiredError,
  createPlace,
  deletePlace,
  fetchBootstrap,
  updatePlace,
  type MobileBootstrap,
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

type Category = MobileBootstrap["categories"][number];

type PlaceFormMode =
  | {
      type: "create";
      latitude: number;
      longitude: number;
      accuracy: number | null;
      precise: boolean;
    }
  | {
      type: "edit";
      place: MobilePlace;
    };

export default function PlacesScreen() {
  const { styles, theme } = useMobileTheme();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<PlaceFormMode | null>(null);
  const [placeName, setPlaceName] = useState("");
  const [radiusMeters, setRadiusMeters] = useState(String(DEFAULT_PLACE_RADIUS_METERS));
  const [defaultCategoryId, setDefaultCategoryId] = useState("");
  const saveInFlight = useRef(false);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
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
      if (!options?.silent) setLoading(false);
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

  async function addCurrentPlace() {
    if (locating) return;
    setLocating(true);
    setStatusMessage("Checking current location...");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      const guidance = foregroundLocationPermissionGuidance(permission);
      if (guidance) {
        setStatusMessage(guidance);
        Alert.alert("Add current place", guidance);
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      });
      const { latitude, longitude, accuracy } = position.coords;
      const precise = permission.ios?.accuracy !== "reduced";
      const suggestedName = await suggestCurrentPlaceName(latitude, longitude);

      setFormMode({
        type: "create",
        latitude,
        longitude,
        accuracy: accuracy ?? null,
        precise
      });
      setPlaceName(suggestedName);
      setRadiusMeters(String(DEFAULT_PLACE_RADIUS_METERS));
      setDefaultCategoryId("");
      setStatusMessage(formatLocationAccuracy(accuracy));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read current location.";
      setStatusMessage(message);
      Alert.alert("Add current place", message);
    } finally {
      setLocating(false);
    }
  }

  function beginEditPlace(place: MobilePlace) {
    setFormMode({ type: "edit", place });
    setPlaceName(place.name);
    setRadiusMeters(String(place.radiusMeters));
    setDefaultCategoryId(place.defaultCategoryId ?? "");
    setStatusMessage(null);
  }

  function cancelForm() {
    setFormMode(null);
    setPlaceName("");
    setRadiusMeters(String(DEFAULT_PLACE_RADIUS_METERS));
    setDefaultCategoryId("");
  }

  async function savePlace() {
    if (!formMode || saveInFlight.current) return;
    const validation = validatePlaceForm({
      name: placeName,
      radiusMeters,
      defaultCategoryId
    });
    if (!validation.ok) {
      Alert.alert("Places", validation.message);
      return;
    }

    saveInFlight.current = true;
    setSaving(true);
    try {
      if (formMode.type === "create") {
        await createPlace({
          name: validation.value.name,
          latitude: formMode.latitude,
          longitude: formMode.longitude,
          radiusMeters: validation.value.radiusMeters,
          priority: 5,
          defaultCategoryId: validation.value.defaultCategoryId
        });
      } else {
        await updatePlace(formMode.place.id, {
          name: validation.value.name,
          radiusMeters: validation.value.radiusMeters,
          defaultCategoryId: validation.value.defaultCategoryId
        });
      }

      cancelForm();
      await refreshAfterPlaceChange("Place saved.");
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
      await refreshAfterPlaceChange("Place deleted.");
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

  async function refreshAfterPlaceChange(prefix: string) {
    const bootstrap = await fetchBootstrap();
    setData(bootstrap);
    const monitoredCount = await refreshGeofencesForPlaces(bootstrap.places).catch(() => 0);
    setStatusMessage(
      monitoredCount > 0
        ? `${prefix} Monitoring ${monitoredCount} places.`
        : `${prefix} Background place monitoring is unchanged.`
    );
  }

  const places = data?.places ?? [];
  const categories = data?.categories ?? [];
  const createWarning =
    formMode?.type === "create" ? locationAccuracyWarning(formMode.accuracy, formMode.precise) : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => load()}
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
            <Image
              source={require("../assets/dayframe_logo_banner.png")}
              style={styles.logoImage}
              resizeMode="contain"
            />
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
                onPress={addCurrentPlace}
              >
                <Text style={styles.primaryButtonText}>
                  {locating ? "Finding location..." : "Add current place"}
                </Text>
              </Pressable>
            </View>
            {statusMessage ? <Text style={styles.statusText}>{statusMessage}</Text> : null}
          </View>

          {formMode ? (
            <View style={styles.placeForm}>
              <Text style={styles.label}>{formMode.type === "create" ? "New place" : "Edit place"}</Text>
              <TextInput
                style={styles.textInput}
                value={placeName}
                onChangeText={setPlaceName}
                placeholder="Place name"
                placeholderTextColor={theme.textSecondary}
                returnKeyType="done"
              />
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
                    themeAccent={theme.accent}
                    styles={styles}
                  />
                  {categories.map((category) => (
                    <CategoryChoice
                      key={category.id}
                      category={category}
                      label={category.name}
                      selected={defaultCategoryId === category.id}
                      onPress={() => setDefaultCategoryId(category.id)}
                      themeAccent={theme.accent}
                      styles={styles}
                    />
                  ))}
                </ScrollView>
              </View>
              {formMode.type === "create" ? (
                <Text style={styles.diagnosticText}>{formatLocationAccuracy(formMode.accuracy)}</Text>
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
              <Text style={styles.muted}>No places yet. Add your current place when you are somewhere useful.</Text>
            )}
          </View>
        </View>
      </ScrollView>
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
  const defaultCategory = categories.find((category) => category.id === place.defaultCategoryId);
  return (
    <View style={styles.placeRow}>
      <MapPinGlyph color={theme.accent} />
      <View style={styles.placeTextStack}>
        <Text style={styles.placeName} numberOfLines={1}>{place.name}</Text>
        <Text style={styles.placeMeta} numberOfLines={2}>
          {defaultCategory ? defaultCategory.name : "No default category"} · {place.radiusMeters}m radius
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

function CategoryChoice({
  category,
  label,
  selected,
  onPress,
  themeAccent,
  styles
}: {
  category?: Category;
  label: string;
  selected: boolean;
  onPress: () => void;
  themeAccent: string;
  styles: MobileStyles;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      style={pressable(
        [styles.categoryChoice, selected ? styles.categoryChoiceSelected : null],
        styles.buttonPressed
      )}
      onPress={onPress}
    >
      {category ? (
        <View style={[styles.colorDot, { backgroundColor: paletteColorFor(category.color, category.name) }]} />
      ) : null}
      <Text style={[styles.categoryChoiceText, selected ? styles.categoryChoiceTextSelected : null]}>
        {label}
      </Text>
      {selected ? <CheckGlyph color={themeAccent} /> : null}
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

function BackGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M15 5 8 12l7 7" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} />
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
