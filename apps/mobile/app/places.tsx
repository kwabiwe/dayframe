import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View
} from "react-native";
import Reanimated from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import {
  DAYFRAME_APP_ICONS,
  placeDisplayName,
  placeRoleLabel,
  placeRoleSlots,
  type PlaceRole,
  type placeRoleRequest
} from "@dayframe/shared";
import { DayframeIcon } from "@/components/icons/DayframeIcon";
import { PlaceRoleSheet, type PlaceRoleSheetMode } from "@/components/places/PlaceRoleSheet";
import { SettingsBlockGroup, SettingsPillButton } from "@/components/settings/SettingsBlocks";
import { applyPlaceRoleLocally, learnedPlaceSubtitle, placeRowSubtitle, subscribeDeletedPlaces, takeDeletedPlaces } from "@/lib/placesPage";
import { mobileAccountKey, mobileAccountOwnersEqual, readActiveMobileAccount } from "@/lib/mobileAccount";
import { mobileTextProps } from "@/lib/mobileTypography";
import { SheetMutationProgress } from "@/components/SheetMutationProgress";
import {
  SwipeDismissSheet,
  type SwipeDismissSheetHandle
} from "@/components/SwipeDismissSheet";
import {
  AuthRequiredError,
  fetchBootstrap,
  forgetLearnedPlace,
  ignoreLearnedPlace,
  setPlaceRole,
  type MobileBootstrap,
  type MobileLearnedPlace,
  type MobilePlace
} from "@/lib/api";
import { refreshGeofencesForPlaces } from "@/lib/geofence";
import { backfillLearnedPlaceLocations } from "@/lib/locationGeocoding";
import { applyAfterSuccessfulMutation } from "@/lib/localMutation";
import { withRole } from "@/lib/places";
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
  const dataRef = useRef(data);
  dataRef.current = data;
  const [refreshing, setRefreshing] = useState(false);
  const [ignoringLearnedId, setIgnoringLearnedId] = useState<string | null>(null);
  const [forgettingLearnedId, setForgettingLearnedId] = useState<string | null>(null);
  const [selectedLearnedPlace, setSelectedLearnedPlace] = useState<MobileLearnedPlace | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // Home and Work (Blocks 7a): which slot's sheet is open, and whether it sets or clears.
  const [roleSheet, setRoleSheet] = useState<{ role: PlaceRole; mode: PlaceRoleSheetMode } | null>(null);
  // One Home/Work change at a time across the page (a second sheet can't open mid-save).
  const roleSaving = useRef(false);
  // Bumped by every accepted change: a read that started before it is out of date and dropped.
  const changeEpoch = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const load = useCallback(async (options?: { refresh?: boolean; silent?: boolean }) => {
    if (options?.refresh) setRefreshing(true);
    const epoch = changeEpoch.current;
    try {
      const fetched = await fetchBootstrap();
      if (!mounted.current || epoch !== changeEpoch.current) return;
      // Deletes accepted while this read was out (possibly before the page had any data) still apply.
      const bootstrap = takeDeletedPlaces(mobileAccountKey({ userId: fetched.user.id, workspaceId: fetched.workspace.id }))
        .reduce((next, id) => reconcileBootstrapPlaces(next, { removePlaceId: id }), fetched);
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

  // A place the editor deleted leaves the list at once, even if a refresh then fails: on focus,
  // and when the delete finishes after the person already came back to this page.
  const applyDeletedPlaces = useCallback(async () => {
    const owner = await readActiveMobileAccount();
    const current = dataRef.current;
    // Nothing shown yet: leave the deletes for the opening read to apply (it is not dropped).
    if (!mounted.current || !owner || !current
      || !mobileAccountOwnersEqual(owner, { userId: current.user.id, workspaceId: current.workspace.id })) return;
    const deleted = takeDeletedPlaces(mobileAccountKey(owner));
    if (deleted.length === 0) return;
    changeEpoch.current += 1;
    setData((current) => current && mobileAccountOwnersEqual(owner, { userId: current.user.id, workspaceId: current.workspace.id })
      ? deleted.reduce((next, id) => reconcileBootstrapPlaces(next, { removePlaceId: id }), current)
      : current);
  }, []);

  useEffect(() => subscribeDeletedPlaces(() => {
    void applyDeletedPlaces();
  }), [applyDeletedPlaces]);

  useFocusEffect(
    useCallback(() => {
      void applyDeletedPlaces().finally(() => {
        void load({ silent: true });
      });
    }, [applyDeletedPlaces, load])
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

  function confirmIgnoreLearnedCandidate(
    learnedPlace: MobileLearnedPlace,
    onSuccess?: () => void
  ) {
    Alert.alert(
      "Ignore learned place",
      "Ignore hides this learned location from save suggestions. It will not create or confirm any time entries.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Ignore",
          onPress: () => {
            void ignoreLearnedCandidate(learnedPlace).then((succeeded) => {
              if (succeeded) onSuccess?.();
            });
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
      return true;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Places", error instanceof Error ? error.message : "Unable to ignore learned place.");
      return false;
    } finally {
      setIgnoringLearnedId(null);
    }
  }

  function confirmForgetLearnedCandidate(
    learnedPlace: MobileLearnedPlace,
    onSuccess?: () => void
  ) {
    Alert.alert(
      "Forget learned place",
      "Forget deletes this learned candidate. Dayframe may learn it again later if future visits provide enough evidence.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
          onPress: () => {
            void forgetLearnedCandidate(learnedPlace).then((succeeded) => {
              if (succeeded) onSuccess?.();
            });
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
      return true;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Places", error instanceof Error ? error.message : "Unable to forget learned place.");
      return false;
    } finally {
      setForgettingLearnedId(null);
    }
  }

  function removeLocalLearnedPlace(id: string) {
    changeEpoch.current += 1;
    setData((current) => current ? reconcileBootstrapPlaces(current, { removeLearnedPlaceId: id }) : current);
  }

  async function refreshAfterPlaceChange(options: {
    prefix: string;
    upsertPlace?: MobilePlace;
    removePlaceId?: string;
    removeLearnedPlaceId?: string;
    /** Places as this page now shows them, for monitoring when the fresh read fails. */
    fallbackPlaces?: MobilePlace[];
  }) {
    const epoch = changeEpoch.current;
    try {
      const bootstrap = await fetchBootstrap();
      if (!mounted.current) return;
      if (epoch !== changeEpoch.current) {
        setStatusMessage(options.prefix);
        return;
      }
      const reconciled = reconcileBootstrapPlaces(bootstrap, options);
      setData(reconciled);
      await refreshGeofencesForPlaces(reconciled.places, { userId: reconciled.user.id, workspaceId: reconciled.workspace.id }).catch(() => 0);
      const bootstrapHasPlace =
        !options.upsertPlace || bootstrap.places.some((place) => place.id === options.upsertPlace?.id);
      setStatusMessage(bootstrapHasPlace ? options.prefix : `${options.prefix} It may take a moment to show everywhere.`);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      const current = dataRef.current;
      if (options.fallbackPlaces && current) {
        await refreshGeofencesForPlaces(options.fallbackPlaces, { userId: current.user.id, workspaceId: current.workspace.id }).catch(() => 0);
      }
      setStatusMessage(`${options.prefix} Pull to refresh if it doesn't show on another device.`);
    }
  }

  const places = data?.places ?? [];
  const learnedPlaces = (data?.learnedPlaces ?? []).filter(
    (learnedPlace) => learnedPlace.classification === "place_candidate"
  );
  const categories = data?.categories ?? [];
  const rolePlaces = places.map(withRole);
  const slots = placeRoleSlots(rolePlaces);
  const editingSlot = roleSheet ? slots.find((slot) => slot.role === roleSheet.role) ?? null : null;

  function openRole(role: PlaceRole, mode: PlaceRoleSheetMode) {
    if (roleSaving.current) return;
    setStatusMessage(null);
    // Nothing saved to choose from yet: go straight to adding the place into the slot.
    if (mode === "choose" && places.length === 0) {
      beginAddRolePlace(role);
      return;
    }
    setRoleSheet({ role, mode });
  }

  function beginAddRolePlace(role: PlaceRole) {
    router.push({ pathname: "/place-editor", params: { mode: "create", role } } as never);
  }

  async function saveRole(request: ReturnType<typeof placeRoleRequest>) {
    if (roleSaving.current) return "Another change is still saving. Try again in a moment.";
    roleSaving.current = true;
    try {
      const owner = await readActiveMobileAccount();
      try {
        await setPlaceRole(request);
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          router.replace("/");
          return null;
        }
        return error instanceof Error ? error.message : "Couldn't update this place. Try again.";
      }
      // Accepted: shown at once (only for the account that asked, while Places is open), and any
      // read that started before this answer is dropped.
      if (!mounted.current || !mobileAccountOwnersEqual(owner, await readActiveMobileAccount())) return null;
      changeEpoch.current += 1;
      const shown = dataRef.current;
      const nextPlaces = shown ? applyPlaceRoleLocally(shown.places, request) : undefined;
      if (shown && nextPlaces) {
        const next = { ...shown, places: nextPlaces };
        dataRef.current = next;
        setData(next);
      }
      const label = placeRoleLabel(request.role);
      await refreshAfterPlaceChange({ prefix: request.placeId ? `${label} updated.` : `${label} cleared.`, fallbackPlaces: nextPlaces });
      return null;
    } finally {
      roleSaving.current = false;
    }
  }

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
        <View style={styles.settingsBlocksStack}>
          <Pressable
            accessibilityRole="button"
            onPress={beginAddPlace}
            style={({ pressed }) => [styles.settingsNewActivity, pressed ? styles.buttonPressed : null]}
            testID="places-add"
          >
            <DayframeIcon color={theme.onAccent} glyph={DAYFRAME_APP_ICONS.add} size={18} />
            <Text {...mobileTextProps("control")} style={styles.settingsNewActivityText}>Add place</Text>
          </Pressable>
          {statusMessage ? (
            <Reanimated.View
              key={statusMessage}
              entering={localPresenceEntering(reduceMotion)}
              exiting={localPresenceExiting(reduceMotion)}
              layout={localLayoutTransition(reduceMotion)}
            >
              <Text {...mobileTextProps("metadata")} accessibilityLiveRegion="polite" style={styles.placesStatus}>{statusMessage}</Text>
            </Reanimated.View>
          ) : null}

          <SettingsBlockGroup foot="Trips and time away are named after these." theme={theme} title="Home and Work">
            {slots.map((slot, index) => (
              <View key={slot.role} style={[styles.placesRow, index > 0 ? styles.settingsActivityRowDivider : null]} testID={`places-role-${slot.role}`}>
                <View style={styles.placesRowMain}>
                  <View style={styles.placesBlock}>
                    <DayframeIcon color={theme.textPrimary} glyph={slot.role === "home" ? DAYFRAME_APP_ICONS.placeHome : DAYFRAME_APP_ICONS.placeWork} size={18} />
                  </View>
                  <View style={styles.settingsActivityText}>
                    <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={styles.settingsActivityName}>{slot.label}</Text>
                    <Text {...mobileTextProps("metadata")} numberOfLines={2} style={styles.settingsActivityMeta}>
                      {slot.place ? slot.secondary ?? `${slot.place.radiusMeters} m radius` : "Not set"}
                    </Text>
                  </View>
                </View>
                <View style={styles.placesRowActions}>
                  {slot.place ? (
                    <>
                      <SettingsPillButton accessibilityLabel={`Change ${slot.label}`} label="Change" onPress={() => openRole(slot.role, "choose")} theme={theme} />
                      <SettingsPillButton accessibilityLabel={`Clear ${slot.label}`} label="Clear" onPress={() => openRole(slot.role, "clear")} theme={theme} />
                    </>
                  ) : (
                    <SettingsPillButton accessibilityLabel={`Set ${slot.label}`} label="Set" onPress={() => openRole(slot.role, "choose")} theme={theme} />
                  )}
                </View>
              </View>
            ))}
          </SettingsBlockGroup>

          <SettingsBlockGroup
            foot={places.length === 0 ? "No places yet. Add one by searching for an address or using where you are." : "Tap a place to change it or delete it."}
            theme={theme}
            title="Saved places"
          >
            {places.length === 0 ? (
              <View style={styles.placesEmpty}>
                <Text {...mobileTextProps("metadata")} style={styles.settingsActivityMeta}>Nothing saved yet</Text>
              </View>
            ) : null}
            {places.map((place, index) => {
              const rolePlace = withRole(place);
              const name = placeDisplayName(rolePlace);
              const subtitle = placeRowSubtitle(rolePlace, categories);
              return (
                <Reanimated.View
                  key={place.id}
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  layout={localLayoutTransition(reduceMotion)}
                >
                  <Pressable
                    accessibilityHint="Edits this place"
                    accessibilityLabel={`${name}, ${subtitle.replace(/\n/g, ", ")}`}
                    accessibilityRole="button"
                    onPress={() => beginEditPlace(place)}
                    style={({ pressed }) => [
                      styles.placesRow,
                      index > 0 ? styles.settingsActivityRowDivider : null,
                      pressed ? styles.placesRowPressed : null
                    ]}
                    testID={`places-row-${place.id}`}
                  >
                    <View style={styles.placesRowMain}>
                      <View style={styles.placesBlock}>
                        <DayframeIcon
                          color={theme.textPrimary}
                          glyph={rolePlace.role === "home" ? DAYFRAME_APP_ICONS.placeHome : rolePlace.role === "work" ? DAYFRAME_APP_ICONS.placeWork : DAYFRAME_APP_ICONS.places}
                          size={18}
                        />
                      </View>
                      <View style={styles.settingsActivityText}>
                        <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={styles.settingsActivityName}>{name}</Text>
                        <Text {...mobileTextProps("metadata")} numberOfLines={3} style={styles.settingsActivityMeta}>{subtitle}</Text>
                      </View>
                    </View>
                    <DayframeIcon color={theme.textMuted} glyph={DAYFRAME_APP_ICONS.next} size={18} />
                  </Pressable>
                </Reanimated.View>
              );
            })}
          </SettingsBlockGroup>

          {learnedPlaces.length > 0 ? (
            <SettingsBlockGroup foot="Dayframe suggests a place after repeat visits on different days. Nothing is saved until you choose Save." theme={theme} title="Suggested places">
              {learnedPlaces.map((learnedPlace, index) => (
                <Reanimated.View
                  key={learnedPlace.id}
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  layout={localLayoutTransition(reduceMotion)}
                >
                  <View style={[styles.placesRow, index > 0 ? styles.settingsActivityRowDivider : null]}>
                    <Pressable
                      accessibilityHint="Shows details, Ignore and Forget"
                      accessibilityLabel={`Suggested place ${learnedPlace.name}, ${learnedPlaceSubtitle(learnedPlace)}`}
                      accessibilityRole="button"
                      onPress={() => setSelectedLearnedPlace(learnedPlace)}
                      style={({ pressed }) => [styles.placesRowMain, pressed ? styles.placesRowPressed : null]}
                      testID={`places-learned-${learnedPlace.id}`}
                    >
                      <View style={[styles.placesBlock, styles.placesBlockSuggested]}>
                        <DayframeIcon color={theme.textSecondary} glyph={DAYFRAME_APP_ICONS.places} size={18} />
                      </View>
                      <View style={styles.settingsActivityText}>
                        <Text {...mobileTextProps("itemTitle")} numberOfLines={2} style={styles.settingsActivityName}>{learnedPlace.name}</Text>
                        <Text {...mobileTextProps("metadata")} numberOfLines={2} style={styles.settingsActivityMeta}>{learnedPlaceSubtitle(learnedPlace)}</Text>
                      </View>
                    </Pressable>
                    <View style={styles.placesRowActions}>
                      <SettingsPillButton
                        accessibilityLabel={`Save ${learnedPlace.name} as a place`}
                        disabled={ignoringLearnedId === learnedPlace.id || forgettingLearnedId === learnedPlace.id}
                        label="Save"
                        onPress={() => beginSaveLearnedPlace(learnedPlace)}
                        theme={theme}
                      />
                    </View>
                  </View>
                </Reanimated.View>
              ))}
            </SettingsBlockGroup>
          ) : null}
        </View>
      </ScrollView>
      <LearnedPlaceDetailSheet
        categories={categories}
        forgetting={Boolean(selectedLearnedPlace && forgettingLearnedId === selectedLearnedPlace.id)}
        ignoring={Boolean(selectedLearnedPlace && ignoringLearnedId === selectedLearnedPlace.id)}
        learnedPlace={selectedLearnedPlace}
        onClose={() => setSelectedLearnedPlace(null)}
        onEdit={(learnedPlace) => beginSaveLearnedPlace(learnedPlace)}
        onForget={(learnedPlace, onSuccess) => confirmForgetLearnedCandidate(learnedPlace, onSuccess)}
        onIgnore={(learnedPlace, onSuccess) => confirmIgnoreLearnedCandidate(learnedPlace, onSuccess)}
        onSave={(learnedPlace) => beginSaveLearnedPlace(learnedPlace)}
        styles={styles}
        theme={theme}
      />
      {roleSheet && editingSlot ? (
        <PlaceRoleSheet
          key={`${roleSheet.role}-${roleSheet.mode}`}
          mode={roleSheet.mode}
          onAddNew={beginAddRolePlace}
          onClose={() => setRoleSheet(null)}
          onSave={saveRole}
          places={rolePlaces}
          reduceMotion={reduceMotion}
          slot={editingSlot}
          styles={styles}
          theme={theme}
        />
      ) : null}
    </SafeAreaView>
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
  onForget: (learnedPlace: MobileLearnedPlace, onSuccess: () => void) => void;
  onIgnore: (learnedPlace: MobileLearnedPlace, onSuccess: () => void) => void;
  onSave: (learnedPlace: MobileLearnedPlace) => void;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const reduceMotion = useReduceMotionPreference();
  const sheetRef = useRef<SwipeDismissSheetHandle>(null);
  const dismissalActionRef = useRef<() => void>(onClose);
  const copyToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyToastToken = useRef(0);

  useEffect(() => {
    dismissalActionRef.current = onClose;
    copyToastToken.current += 1;
    if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
    copyToastTimer.current = null;
    setCopyToast(null);
    return () => {
      if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
      copyToastTimer.current = null;
    };
  }, [learnedPlace?.id]);

  if (!learnedPlace) return null;

  const details = learnedPlaceDetailValues(learnedPlace);
  const associatedCategory = learnedPlaceCategoryLabel(learnedPlace, categories);
  const disabled = ignoring || forgetting;
  function dismissWith(action: () => void = onClose) {
    dismissalActionRef.current = action;
    sheetRef.current?.dismiss();
  }
  function finishDismissal() {
    const action = dismissalActionRef.current;
    dismissalActionRef.current = onClose;
    action();
  }
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
    <Modal animationType="none" onRequestClose={() => dismissWith()} transparent visible>
      <View style={styles.sheetOverlay}>
        <SwipeDismissSheet
          ref={sheetRef}
          accessibilityLabel="Place suggestion"
          backdropAccessibilityLabel="Close learned place details"
          backdropStyle={styles.sheetBackdrop}
          disabled={disabled}
          handleStyle={styles.sheetHandle}
          onDismiss={finishDismissal}
          reduceMotion={reduceMotion}
          style={styles.activeEditSheet}
          visible
        >
          <View>
            <View style={[styles.sheetHeader, styles.sheetHeaderCentered]}>
              <Text style={[styles.sheetTitle, styles.sheetTitleCentered]} numberOfLines={2}>Place suggestion</Text>
              <Pressable
                accessibilityLabel="Close place suggestion"
                accessibilityRole="button"
                hitSlop={8}
                style={pressable(styles.iconButton, styles.buttonPressed)}
                onPress={() => dismissWith()}
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
              <LearnedPlaceDetailRow label="Activity" value={associatedCategory} styles={styles} />
              <LearnedPlaceDetailRow label="Status" value="Place suggestion · Not saved" styles={styles} />
            </View>

            <View style={styles.buttonRow}>
              <Pressable
                accessibilityRole="button"
                style={pressable(styles.primaryInlineButton, styles.buttonPressed)}
                onPress={() => dismissWith(() => onSave(learnedPlace))}
              >
                <Text style={styles.primaryButtonText}>Save place</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={pressable(styles.secondaryButton, styles.buttonPressed)}
                onPress={() => dismissWith(() => onEdit(learnedPlace))}
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
                onPress={() => onIgnore(learnedPlace, () => dismissWith())}
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
                onPress={() => onForget(learnedPlace, () => dismissWith())}
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
        </SwipeDismissSheet>
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

