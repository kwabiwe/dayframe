import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import Reanimated from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { SheetMutationProgress } from "@/components/SheetMutationProgress";
import {
  AuthRequiredError,
  deletePlace,
  fetchBootstrap,
  forgetLearnedPlace,
  ignoreLearnedPlace,
  type MobileBootstrap,
  type MobileLearnedPlace,
  type MobilePlace
} from "@/lib/api";
import { refreshGeofencesForPlaces } from "@/lib/geofence";
import { backfillLearnedPlaceLocations } from "@/lib/locationGeocoding";
import { applyAfterSuccessfulMutation } from "@/lib/localMutation";
import {
  copyLearnedPlaceDetail,
  learnedPlaceDetailValues
} from "@/lib/learnedPlaces";
import { pressable, useMobileTheme, type MobileStyles, type MobileTheme } from "@/lib/mobileTheme";
import {
  localLayoutTransition,
  localPresenceEntering,
  localPresenceExiting,
  useReduceMotionPreference
} from "@/lib/motion";

type Category = MobileBootstrap["categories"][number];

export default function PlacesScreen() {
  const reduceMotion = useReduceMotionPreference();
  const { styles, theme } = useMobileTheme();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [ignoringLearnedId, setIgnoringLearnedId] = useState<string | null>(null);
  const [forgettingLearnedId, setForgettingLearnedId] = useState<string | null>(null);
  const [selectedLearnedPlace, setSelectedLearnedPlace] = useState<MobileLearnedPlace | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const load = useCallback(async (options?: { refresh?: boolean; silent?: boolean }) => {
    if (options?.refresh) setRefreshing(true);
    try {
      const bootstrap = await fetchBootstrap();
      setData(bootstrap);
      void backfillLearnedPlaceLocations(bootstrap.learnedPlaces ?? []).then((resolved) => {
        if (resolved.length === 0) return;
        setData((current) => current ? mergeLearnedPlaceResolutions(current, resolved) : current);
      });
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
    setStatusMessage(null);
    router.push({ pathname: "/place-editor", params: { mode: "create" } } as never);
  }

  function beginSaveLearnedPlace(learnedPlace: MobileLearnedPlace) {
    setSelectedLearnedPlace(null);
    router.push({
      pathname: "/place-editor",
      params: { mode: "learned", learnedPlaceId: learnedPlace.id }
    } as never);
  }

  function beginEditPlace(place: MobilePlace) {
    setStatusMessage(null);
    router.push({ pathname: "/place-editor", params: { mode: "edit", placeId: place.id } } as never);
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
      await applyAfterSuccessfulMutation(
        () => deletePlace(place.id),
        () => removeLocalPlace(place.id)
      );
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
      await applyAfterSuccessfulMutation(
        () => ignoreLearnedPlace(learnedPlace.id),
        () => removeLocalLearnedPlace(learnedPlace.id)
      );
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
      await applyAfterSuccessfulMutation(
        () => forgetLearnedPlace(learnedPlace.id),
        () => removeLocalLearnedPlace(learnedPlace.id)
      );
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
  const learnedPlaces = (data?.learnedPlaces ?? []).filter(
    (learnedPlace) => learnedPlace.classification === "place_candidate"
  );
  const categories = data?.categories ?? [];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.settingsFloatingHeader}>
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
      </View>
      <ScrollView
        style={styles.settingsScrollView}
        contentContainerStyle={styles.settingsScrollContent}
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
          <View style={styles.panel}>
            <Text style={styles.muted}>Save locations Dayframe should recognise.</Text>
            <View style={styles.buttonRow}>
              <Pressable
                accessibilityRole="button"
                style={pressable(styles.primaryInlineButton, styles.buttonPressed)}
                onPress={beginAddPlace}
              >
                <Text style={styles.primaryButtonText}>Add place</Text>
              </Pressable>
            </View>
            {statusMessage ? (
              <Reanimated.View
                key={statusMessage}
                entering={localPresenceEntering(reduceMotion)}
                exiting={localPresenceExiting(reduceMotion)}
                layout={localLayoutTransition(reduceMotion)}
              >
                <Text accessibilityLiveRegion="polite" style={styles.statusText}>{statusMessage}</Text>
              </Reanimated.View>
            ) : null}
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Your places</Text>
            <View style={styles.placeList}>
              {places.map((place) => (
                  <Reanimated.View
                    key={place.id}
                    entering={localPresenceEntering(reduceMotion)}
                    exiting={localPresenceExiting(reduceMotion)}
                    layout={localLayoutTransition(reduceMotion)}
                  >
                    <PlaceRow
                      place={place}
                      categories={categories}
                      deleting={deletingId === place.id}
                      onEdit={() => beginEditPlace(place)}
                      onDelete={() => confirmDeletePlace(place)}
                      theme={theme}
                      styles={styles}
                    />
                  </Reanimated.View>
              ))}
            </View>
            {places.length === 0 ? (
              <Reanimated.View entering={localPresenceEntering(reduceMotion)}>
                <Text style={styles.muted}>No places yet. Search for an address or use your current location.</Text>
              </Reanimated.View>
            ) : null}
            <View style={styles.settingsDivider} />
            <Text style={styles.sectionTitle}>Learned places</Text>
            <Text style={styles.muted}>Place suggestions require repeat visits on different days and stable location evidence.</Text>
            <View style={styles.placeList}>
              {learnedPlaces.map((learnedPlace) => (
                  <Reanimated.View
                    key={learnedPlace.id}
                    entering={localPresenceEntering(reduceMotion)}
                    exiting={localPresenceExiting(reduceMotion)}
                    layout={localLayoutTransition(reduceMotion)}
                  >
                    <LearnedPlaceRow
                      learnedPlace={learnedPlace}
                      ignoring={ignoringLearnedId === learnedPlace.id}
                      onOpen={() => setSelectedLearnedPlace(learnedPlace)}
                      onSave={() => beginSaveLearnedPlace(learnedPlace)}
                      onIgnore={() => confirmIgnoreLearnedCandidate(learnedPlace)}
                      theme={theme}
                      styles={styles}
                    />
                  </Reanimated.View>
              ))}
            </View>
            {learnedPlaces.length === 0 ? (
              <Reanimated.View entering={localPresenceEntering(reduceMotion)}>
                <Text style={styles.muted}>No learned candidates yet.</Text>
              </Reanimated.View>
            ) : null}
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
  const visitLoggingEnabled = place.loggingEnabled !== false;
  return (
    <View style={styles.placeRow}>
      <MapPinGlyph color={theme.accent} />
      <View style={styles.placeTextStack}>
        <Text style={styles.placeName} numberOfLines={1}>{place.name}</Text>
        {visitLoggingEnabled && place.defaultActivityDescription ? (
          <Text style={styles.placeMeta} numberOfLines={2}>
            {place.defaultActivityDescription}
          </Text>
        ) : null}
        <Text style={styles.placeMeta} numberOfLines={2}>
          {visitLoggingEnabled
            ? `${defaultCategoryName ?? "No default category"} · ${place.radiusMeters}m radius`
            : `Visit logging off · ${place.radiusMeters}m radius`}
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
  const displayName = learnedPlace.name;
  return (
    <Pressable
      accessibilityLabel={`Open place suggestion ${displayName}`}
      accessibilityRole="button"
      style={pressable(styles.placeRow, styles.buttonPressed)}
      onPress={onOpen}
    >
      <MapPinGlyph color={theme.textSecondary} />
      <View style={styles.placeTextStack}>
        <Text style={styles.placeName} numberOfLines={2}>{displayName}</Text>
        <Text style={styles.placeMeta} numberOfLines={2}>
          {formatLearnedPlaceMeta(learnedPlace)}
        </Text>
      </View>
      <View style={styles.placeActions}>
        <Pressable
          accessibilityLabel={`Save ${displayName} as a place`}
          accessibilityRole="button"
          style={pressable(styles.learnedPlaceSaveButton, styles.buttonPressed)}
          onPress={onSave}
        >
          <Text style={styles.learnedPlaceSaveButtonText}>Save</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Ignore ${displayName}`}
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
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const reduceMotion = useReduceMotionPreference();
  const windowDimensions = useWindowDimensions();
  const dismissDragY = useRef(new Animated.Value(0)).current;
  const copyToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyToastToken = useRef(0);

  useEffect(() => {
    copyToastToken.current += 1;
    if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
    copyToastTimer.current = null;
    setCopyToast(null);
    dismissDragY.setValue(0);
    return () => {
      if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
      copyToastTimer.current = null;
    };
  }, [dismissDragY, learnedPlace?.id]);

  if (!learnedPlace) return null;

  const details = learnedPlaceDetailValues(learnedPlace);
  const associatedCategory = learnedPlaceCategoryLabel(learnedPlace, categories);
  const disabled = ignoring || forgetting;
  const dismissResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      !disabled && gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2,
    onPanResponderMove: (_event, gesture) => {
      dismissDragY.setValue(Math.max(0, gesture.dy));
    },
    onPanResponderRelease: (_event, gesture) => {
      const shouldDismiss = gesture.dy > 96 || gesture.vy > 0.85;
      if (shouldDismiss) {
        if (reduceMotion) {
          dismissDragY.setValue(0);
          onClose();
          return;
        }
        Animated.timing(dismissDragY, {
          toValue: windowDimensions.height,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true
        }).start(({ finished }) => {
          dismissDragY.setValue(0);
          if (finished) onClose();
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
  });

  async function copyDetail(label: string, value: string | null) {
    const copied = await copyLearnedPlaceDetail(value, Clipboard.setStringAsync);
    if (!copied) return;
    const token = ++copyToastToken.current;
    if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
    setCopyToast(`${label} copied`);
    copyToastTimer.current = setTimeout(() => {
      if (copyToastToken.current !== token) return;
      setCopyToast(null);
      copyToastTimer.current = null;
    }, 2_000);
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <View style={styles.sheetOverlay}>
        <Pressable accessibilityLabel="Close learned place details" style={styles.sheetBackdrop} onPress={onClose} />
        <Animated.View
          style={[
            styles.activeEditSheet,
            { transform: [{ translateY: dismissDragY }] }
          ]}
        >
          <View {...dismissResponder.panHandlers}>
            <View style={styles.sheetHandle} />
            <View style={[styles.sheetHeader, styles.sheetHeaderCentered]}>
              <Text style={[styles.sheetTitle, styles.sheetTitleCentered]} numberOfLines={2}>Place suggestion</Text>
              <Pressable
                accessibilityLabel="Close place suggestion"
                accessibilityRole="button"
                hitSlop={8}
                style={pressable(styles.iconButton, styles.buttonPressed)}
                onPress={onClose}
              >
                <CloseGlyph color={theme.textPrimary} />
              </Pressable>
            </View>
            <SheetMutationProgress
              accessibilityLabel={forgetting ? "Forgetting place suggestion" : ignoring ? "Ignoring place suggestion" : "Working"}
              active={disabled}
              styles={styles}
            />
          </View>

          <ScrollView style={styles.activeEditScroller} contentContainerStyle={styles.activeEditContent}>
            <Text style={styles.sectionTitle}>{details.name}</Text>
            <Text style={styles.muted}>
              Repeat visits suggest this may be worth saving. It remains unsaved until you choose Save place.
            </Text>

            <View style={styles.accountList}>
              <LearnedPlaceDetailRow label="Resolved name / POI" value={details.name} styles={styles} />
              <LearnedPlaceDetailRow
                copyLabel="address"
                label="Address/postcode"
                onCopy={details.address ? () => void copyDetail("Address", details.address) : undefined}
                value={details.address ?? "Not resolved"}
                styles={styles}
                theme={theme}
              />
              <LearnedPlaceDetailRow
                copyLabel="coordinates"
                label="Coordinates"
                onCopy={details.coordinates ? () => void copyDetail("Coordinates", details.coordinates) : undefined}
                value={details.coordinates ?? "Unavailable"}
                styles={styles}
                theme={theme}
              />
              <View style={styles.learnedPlaceMetricGrid}>
                <LearnedPlaceDetailRow compact label="Visits" value={`${learnedPlace.visitCount}`} styles={styles} />
                <LearnedPlaceDetailRow compact label="Samples" value={`${learnedPlace.sampleCount}`} styles={styles} />
                <LearnedPlaceDetailRow compact label="Days" value={`${learnedPlace.distinctDayCount}`} styles={styles} />
                <LearnedPlaceDetailRow compact label="Radius" value={`${learnedPlace.radiusMeters}m`} styles={styles} />
              </View>
              <LearnedPlaceDetailRow
                label="Dwell evidence"
                value={`${formatDwell(learnedPlace.totalDwellSeconds)} total · ${formatDwell(learnedPlace.longestDwellSeconds)} longest stay`}
                styles={styles}
              />
              <LearnedPlaceDetailRow label="Last seen" value={formatShortDateTime(learnedPlace.lastSeenAt)} styles={styles} />
              <LearnedPlaceDetailRow label="Category/activity" value={associatedCategory} styles={styles} />
              <LearnedPlaceDetailRow label="Status" value="Place suggestion · Not saved" styles={styles} />
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
          {copyToast ? (
            <Reanimated.View
              key={copyToast}
              accessibilityLiveRegion="polite"
              entering={localPresenceEntering(reduceMotion)}
              exiting={localPresenceExiting(reduceMotion)}
              style={styles.copyToastOverlay}
            >
              <View style={styles.copyToast}>
                <Text style={styles.copyToastText}>{copyToast}</Text>
              </View>
            </Reanimated.View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

function LearnedPlaceDetailRow({
  compact,
  copyLabel,
  label,
  onCopy,
  value,
  styles,
  theme
}: {
  compact?: boolean;
  copyLabel?: string;
  label: string;
  onCopy?: () => void;
  value: string;
  styles: MobileStyles;
  theme?: MobileTheme;
}) {
  return (
    <View style={[styles.accountRow, compact ? styles.learnedPlaceMetricCell : null]}>
      <View style={styles.learnedPlaceDetailHeader}>
        <Text style={styles.label}>{label}</Text>
        {onCopy && theme ? (
          <Pressable
            accessibilityLabel={`Copy ${copyLabel ?? label}`}
            accessibilityRole="button"
            hitSlop={6}
            style={pressable(styles.learnedPlaceCopyButton, styles.buttonPressed)}
            onPress={onCopy}
          >
            <CopyGlyph color={theme.accent} />
            <Text style={styles.learnedPlaceCopyText}>Copy</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.accountValue} numberOfLines={3}>{value}</Text>
    </View>
  );
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

function mergeLearnedPlaceResolutions(
  data: MobileBootstrap,
  resolved: Array<Pick<
    MobileLearnedPlace,
    "id" | "name" | "address" | "poiName" | "formattedAddress" | "geocodedAt"
  >>
): MobileBootstrap {
  const byId = new Map(resolved.map((learnedPlace) => [learnedPlace.id, learnedPlace]));
  return {
    ...data,
    learnedPlaces: (data.learnedPlaces ?? []).map((learnedPlace) => {
      const resolution = byId.get(learnedPlace.id);
      return resolution ? { ...learnedPlace, ...resolution } : learnedPlace;
    })
  };
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
  const days = learnedPlace.distinctDayCount === 1 ? "1 day" : `${learnedPlace.distinctDayCount} days`;
  const samples = learnedPlace.sampleCount === 1 ? "1 sample" : `${learnedPlace.sampleCount} samples`;
  const lastSeen = formatShortDateTime(learnedPlace.lastSeenAt);
  return `${visits} across ${days} · ${samples} · Last seen ${lastSeen}`;
}

function formatDwell(seconds: number) {
  const minutes = Math.max(0, Math.round(Number(seconds) / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
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

function CopyGlyph({ color }: { color: string }) {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24">
      <Path d="M9 9h10v10H9z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={2} />
      <Path d="M15 9V5H5v10h4" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={2} />
    </Svg>
  );
}

function CloseGlyph({ color }: { color: string }) {
  return (
    <Svg accessibilityElementsHidden width={20} height={20} viewBox="0 0 24 24">
      <Path d="m6 6 12 12M18 6 6 18" fill="none" stroke={color} strokeLinecap="round" strokeWidth={2.2} />
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
