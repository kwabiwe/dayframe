import { formatDuration } from "@dayframe/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import Reanimated from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  DAYFRAME_APP_ICONS,
  DAYFRAME_BLOCKS,
  placeDisplayName,
  placeRoleLabel,
  placeRoleSlots,
  type PlaceRole
} from "@dayframe/shared";
import { BlocksNavHeader, usePreviousScreenLabel } from "@/components/BlocksNavHeader";
import { BlocksConfirmHost, useBlocksConfirm, type BlocksConfirmController } from "@/components/blocks/BlocksConfirmSheet";
import { BlocksEmptyState } from "@/components/blocks/BlocksEmptyState";
import { DayframeIcon } from "@/components/icons/DayframeIcon";
import { ArchivedPlacesGroup } from "@/components/places/ArchivedPlacesGroup";
import { PlaceRoleSheet, type PlaceRoleSaveRequest, type PlaceRoleSheetMode } from "@/components/places/PlaceRoleSheet";
import { StoppedTripsGroup } from "@/components/places/StoppedTripsGroup";
import { SettingsBlockGroup, SettingsBlockRow, SettingsPillButton } from "@/components/settings/SettingsBlocks";
import { applyPlaceRoleLocally, learnedPlaceSubtitle, placeRowSubtitle, placesPageState, subscribeDeletedPlaces, takeDeletedPlaces } from "@/lib/placesPage";
import { mobileAccountKey, mobileAccountOwnersEqual, readActiveMobileAccount } from "@/lib/mobileAccount";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "@/lib/mobileTypography";
import {
  SwipeDismissSheet,
  type SwipeDismissSheetHandle
} from "@/components/SwipeDismissSheet";
import {
  AuthRequiredError,
  fetchArchivedPlaces,
  fetchBootstrap,
  forgetLearnedPlace,
  ignoreLearnedPlace,
  setPlaceArchived,
  setPlaceRole,
  type MobileArchivedPlace,
  type MobileBootstrap,
  type MobileLearnedPlace,
  type MobilePlace
} from "@/lib/api";
import { createArchivedReadGate } from "@/lib/activitiesPage";
import { friendlyMobileErrorMessage, mobileFailureKind } from "@/lib/friendlyError";
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
import { formatLocaleDate } from "../src/lib/localeDateFormat";

type Category = MobileBootstrap["categories"][number];

export default function PlacesScreen() {
  const backLabel = usePreviousScreenLabel() ?? "Settings";
  const reduceMotion = useReduceMotionPreference();
  const { styles, theme } = useMobileTheme();
  // Ignore/Forget are asked from the learned-place sheet, which presents this controller's sheet
  // over its own modal (UIA-005).
  const confirmSheet = useBlocksConfirm();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [refreshing, setRefreshing] = useState(false);
  const [ignoringLearnedId, setIgnoringLearnedId] = useState<string | null>(null);
  const [forgettingLearnedId, setForgettingLearnedId] = useState<string | null>(null);
  const [selectedLearnedPlace, setSelectedLearnedPlace] = useState<MobileLearnedPlace | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // The newest page read failed before any list was shown (staging feedback B2): an in-page state
  // with Try again instead of a system alert, and never "Nothing saved yet" for a list not read.
  const [loadFailure, setLoadFailure] = useState<{ offline: boolean } | null>(null);
  // The status line a failed pull-to-refresh showed, cleared by the next read that lands.
  const refreshFailureMessage = useRef<string | null>(null);
  // Home and Work (Blocks 7a): which slot's sheet is open, and whether it sets or clears.
  const [roleSheet, setRoleSheet] = useState<{ role: PlaceRole; mode: PlaceRoleSheetMode } | null>(null);
  // One Home/Work change at a time across the page (a second sheet can't open mid-save).
  const roleSaving = useRef(false);
  // Bumped by every accepted change: a read that started before it is out of date and dropped.
  const changeEpoch = useRef(0);
  // Only the newest page read applies (mount and focus can both be out at once).
  const readSequence = useRef(0);
  // Places › Archived (location v3 PR 15b, PRD D19 A10): read with the page, for the account that
  // read it, and shown only when there are some. A failed read leaves it as it was (or hidden).
  const [archived, setArchived] = useState<{ accountKey: string; places: MobileArchivedPlace[] } | null>(null);
  const [restoringArchivedId, setRestoringArchivedId] = useState<string | null>(null);
  const [archivedProblem, setArchivedProblem] = useState<string | null>(null);
  // Only the newest archived read applies, and none that was out while a restore or an archive landed.
  const archivedReads = useRef(createArchivedReadGate()).current;
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const loadArchived = useCallback(async () => {
    const read = archivedReads.begin();
    const owner = await readActiveMobileAccount();
    if (!owner) return;
    try {
      const places = await fetchArchivedPlaces();
      if (!mounted.current || !archivedReads.current(read)) return;
      if (!mobileAccountOwnersEqual(owner, await readActiveMobileAccount()) || !archivedReads.current(read)) return;
      setArchived({ accountKey: mobileAccountKey(owner), places });
    } catch {
      // Signed out or offline: the page read says so; this section never breaks the page.
    }
  }, [archivedReads]);

  // `refresh` is the person's own pull-to-refresh; every other read (opening, focus, Try again)
  // fails quietly over the list already shown.
  const load = useCallback(async (options?: { refresh?: boolean }) => {
    if (options?.refresh) setRefreshing(true);
    // Archived reads alongside, on its own: its failure never touches the page.
    void loadArchived();
    const epoch = changeEpoch.current;
    const read = ++readSequence.current;
    try {
      const fetched = await fetchBootstrap();
      if (!mounted.current || epoch !== changeEpoch.current || read !== readSequence.current) return;
      // Deletes accepted while this read was out (possibly before the page had any data) still apply.
      const bootstrap = takeDeletedPlaces(mobileAccountKey({ userId: fetched.user.id, workspaceId: fetched.workspace.id }))
        .reduce((next, id) => reconcileBootstrapPlaces(next, { removePlaceId: id }), fetched);
      setData(bootstrap);
      setLoadFailure(null);
      const failedRefresh = refreshFailureMessage.current;
      refreshFailureMessage.current = null;
      if (failedRefresh) setStatusMessage((current) => (current === failedRefresh ? null : current));
      void backfillLearnedPlaceLocations(bootstrap.learnedPlaces ?? []).then((resolved) => {
        if (resolved.length === 0) return;
        setData((current) => current ? mergeLearnedPlaceResolutions(current, resolved) : current);
      });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      if (!mounted.current || read !== readSequence.current) return;
      if (!dataRef.current) {
        setLoadFailure({ offline: mobileFailureKind(error) === "offline" });
      } else if (options?.refresh) {
        // The list already shown stays; only an asked-for refresh says why it didn't update.
        const message = friendlyMobileErrorMessage(error, "Couldn't refresh your places. Try again.");
        refreshFailureMessage.current = message;
        setStatusMessage(message);
      }
    } finally {
      if (options?.refresh) setRefreshing(false);
    }
  }, [loadArchived]);

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
    // An archived place (handed over the same way) shows under Archived from a read after it landed.
    archivedReads.changed();
    void loadArchived();
  }, [archivedReads, loadArchived]);

  useEffect(() => subscribeDeletedPlaces(() => {
    void applyDeletedPlaces();
  }), [applyDeletedPlaces]);

  useFocusEffect(
    useCallback(() => {
      void applyDeletedPlaces().finally(() => {
        void load();
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
    confirmSheet.confirm({
      eyebrow: "Place suggestion",
      title: "Ignore learned place?",
      message: "Ignore hides this learned location from save suggestions. It will not create or confirm any blocks.",
      confirmLabel: "Ignore",
      tone: "neutral",
      onConfirm: () => {
        void ignoreLearnedCandidate(learnedPlace).then((succeeded) => {
          if (succeeded) onSuccess?.();
        });
      }
    });
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
      Alert.alert("Places", friendlyMobileErrorMessage(error, "Couldn't ignore this suggestion. Try again."));
      return false;
    } finally {
      setIgnoringLearnedId(null);
    }
  }

  function confirmForgetLearnedCandidate(
    learnedPlace: MobileLearnedPlace,
    onSuccess?: () => void
  ) {
    confirmSheet.confirm({
      eyebrow: "Place suggestion",
      title: "Forget learned place?",
      message: "Forget deletes this learned candidate. Dayframe may learn it again later if future visits provide enough evidence.",
      confirmLabel: "Forget",
      confirmHint: "This can't be undone.",
      onConfirm: () => {
        void forgetLearnedCandidate(learnedPlace).then((succeeded) => {
          if (succeeded) onSuccess?.();
        });
      }
    });
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
      Alert.alert("Places", friendlyMobileErrorMessage(error, "Couldn't forget this suggestion. Try again."));
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
    /** Applied in the same render as the refreshed list (or once it fails): a restored row leaving Archived. */
    alsoApply?: () => void;
  }) {
    const epoch = changeEpoch.current;
    try {
      const bootstrap = await fetchBootstrap();
      if (!mounted.current) return;
      options.alsoApply?.();
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
      if (mounted.current) options.alsoApply?.();
      const current = dataRef.current;
      // Only while nothing else changed since: a later delete or change already set monitoring.
      if (options.fallbackPlaces && current && epoch === changeEpoch.current) {
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

  const pageState = placesPageState(Boolean(data), Boolean(loadFailure));

  function openRole(role: PlaceRole, mode: PlaceRoleSheetMode) {
    // Only from a list that was read: an unknown list never sends Set straight to adding a place.
    if (roleSaving.current || !dataRef.current) return;
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

  async function saveRole(request: PlaceRoleSaveRequest) {
    if (roleSaving.current) return "Another change is still saving. Try again in a moment.";
    roleSaving.current = true;
    try {
      const owner = await readActiveMobileAccount();
      let previousArchived = false;
      try {
        previousArchived = (await setPlaceRole(request)).previousArchived === true;
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          router.replace("/");
          return null;
        }
        return friendlyMobileErrorMessage(error, "Couldn't update this place. Try again.");
      }
      // Accepted: shown at once (only for the account that asked, while Places is open), and any
      // read that started before this answer is dropped.
      if (!mounted.current || !mobileAccountOwnersEqual(owner, await readActiveMobileAccount())) return null;
      changeEpoch.current += 1;
      const shown = dataRef.current;
      // "Replace the old place": the server archived the old holder, so it leaves Saved places too.
      const nextPlaces = shown ? applyPlaceRoleLocally(shown.places, { ...request, archivePrevious: previousArchived }) : undefined;
      if (shown && nextPlaces) {
        const next = { ...shown, places: nextPlaces };
        dataRef.current = next;
        setData(next);
      }
      if (previousArchived) archivedReads.changed();
      const label = placeRoleLabel(request.role);
      const prefix = !request.placeId
        ? `${label} cleared.`
        : previousArchived ? `${label} updated. The old ${label.toLowerCase()} is archived.` : `${label} updated.`;
      await refreshAfterPlaceChange({ prefix, fallbackPlaces: nextPlaces });
      if (previousArchived) void loadArchived();
      return null;
    } finally {
      roleSaving.current = false;
    }
  }

  /** Places › Archived › Restore: the place comes back under Saved places, without a Home/Work role. */
  async function restoreArchivedPlace(place: { id: string; name: string }) {
    if (restoringArchivedId) return;
    setRestoringArchivedId(place.id);
    setArchivedProblem(null);
    const owner = await readActiveMobileAccount();
    try {
      await setPlaceArchived(place.id, false);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      if (!mounted.current) return;
      setRestoringArchivedId(null);
      // The row stays where it was, with the reason under the group (no system alert: UIA-005).
      const message = friendlyMobileErrorMessage(error, `Couldn't restore ${place.name}. Try again.`);
      setArchivedProblem(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    if (!mounted.current) return;
    if (!mobileAccountOwnersEqual(owner, await readActiveMobileAccount())) {
      setRestoringArchivedId(null);
      return;
    }
    // Accepted: any read of either list that started before this answer is dropped. The row leaves
    // Archived in the same render that the refreshed list brings the place back under Saved places.
    archivedReads.changed();
    changeEpoch.current += 1;
    AccessibilityInfo.announceForAccessibility(`${place.name} restored.`);
    await refreshAfterPlaceChange({
      prefix: `${place.name} restored.`,
      alsoApply: () => {
        setArchived((current) => current
          ? { ...current, places: current.places.filter((item) => item.id !== place.id) }
          : current);
        setRestoringArchivedId(null);
      }
    });
    void loadArchived();
  }

  const shownAccountKey = data ? mobileAccountKey({ userId: data.user.id, workspaceId: data.workspace.id }) : null;
  const archivedPlaces = archived && archived.accountKey === shownAccountKey ? archived.places : [];

  return (
    <SafeAreaView style={styles.safeArea}>
      <BlocksNavHeader backLabel={backLabel} onBack={() => router.back()} title="Saved places" />
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

          {pageState === "pending" ? (
            // Before the first read settles: a quiet line in the groups' place (no spinner, and
            // never "Not set" or "Nothing saved yet" for places not yet known).
            <Text
              {...mobileTextProps("body")}
              accessibilityLiveRegion="polite"
              style={[styles.placesStatus, styles.placesPending]}
              testID="places-pending"
            >
              Loading your places…
            </Text>
          ) : pageState === "failed" && loadFailure ? (
            <BlocksEmptyState
              actionAccessibilityLabel="Try loading your places again"
              actionLabel="Try again"
              actionTestID="places-unavailable-retry"
              glyph={loadFailure.offline ? DAYFRAME_APP_ICONS.syncOffline : DAYFRAME_APP_ICONS.places}
              message={
                loadFailure.offline
                  ? "Connect to the internet to see your saved places."
                  : "Dayframe couldn't load your places. Try again in a moment."
              }
              onAction={() => void load()}
              testID="places-unavailable"
              theme={theme}
              title={loadFailure.offline ? "You're offline" : "Places didn't load"}
            />
          ) : (
          <>
          <SettingsBlockGroup foot="Trips are named after these." theme={theme} title="Home and Work">
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
            foot={places.length === 0 ? "No places yet. Add one by searching for an address or using where you are." : "Tap a place to change, archive or delete it."}
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

          <ArchivedPlacesGroup
            onRestore={(place) => void restoreArchivedPlace(place)}
            places={archivedPlaces}
            problem={archivedProblem}
            reduceMotion={reduceMotion}
            restoringId={restoringArchivedId}
            styles={styles}
            theme={theme}
          />

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
          <StoppedTripsGroup reduceMotion={reduceMotion} styles={styles} theme={theme} />
          </>
          )}
        </View>
      </ScrollView>
      <LearnedPlaceDetailSheet
        categories={categories}
        confirmSheet={confirmSheet}
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
  confirmSheet,
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
  confirmSheet: BlocksConfirmController;
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
          {/* Blocks head (UIA-031): the eyebrow over the place's name, and a circular close. */}
          <View style={learnedSheetStyles.head}>
            <View style={learnedSheetStyles.headTitle}>
              <Text {...mobileTextProps("counter")} style={[learnedSheetStyles.eyebrow, { color: theme.textMuted }]}>PLACE SUGGESTION</Text>
              <Text {...mobileTextProps("screenHeading")} accessibilityRole="header" numberOfLines={2} style={[learnedSheetStyles.title, { color: theme.textPrimary }]}>
                {details.name}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Close place suggestion"
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => dismissWith()}
              style={({ pressed }) => [learnedSheetStyles.close, { backgroundColor: theme.surfaceMuted }, pressed ? styles.buttonPressed : null]}
            >
              <DayframeIcon color={theme.textPrimary} glyph="x" size={18} />
            </Pressable>
          </View>

          <ScrollView style={styles.activeEditScroller} contentContainerStyle={[styles.activeEditContent, learnedSheetStyles.body]}>
            <Text {...mobileTextProps("body")} style={{ color: theme.textSecondary }}>
              You keep coming back here, so it may be worth saving. Nothing changes until you save it.
            </Text>

            <SettingsBlockGroup theme={theme} title="Where">
              <SettingsBlockRow
                control={details.address ? (
                  <SettingsPillButton accessibilityLabel="Copy address" label="Copy" onPress={() => void copyDetail("Address", details.address)} theme={theme} />
                ) : undefined}
                divider={false}
                subtitle={details.address ?? "Not found yet"}
                theme={theme}
                title="Address"
              />
              <SettingsBlockRow
                control={details.coordinates ? (
                  <SettingsPillButton accessibilityLabel="Copy coordinates" label="Copy" onPress={() => void copyDetail("Coordinates", details.coordinates)} theme={theme} />
                ) : undefined}
                subtitle={details.coordinates ?? "Not available"}
                theme={theme}
                title="Coordinates"
              />
              <SettingsBlockRow subtitle={`${learnedPlace.radiusMeters} m around the centre`} theme={theme} title="Size" />
            </SettingsBlockGroup>

            <SettingsBlockGroup theme={theme} title="Your visits">
              <SettingsBlockRow
                divider={false}
                subtitle={`${learnedPlace.visitCount} ${learnedPlace.visitCount === 1 ? "visit" : "visits"} on ${learnedPlace.distinctDayCount} ${learnedPlace.distinctDayCount === 1 ? "day" : "days"}`}
                theme={theme}
                title="Visits seen"
              />
              <SettingsBlockRow
                subtitle={`${formatDwell(learnedPlace.totalDwellSeconds)} in all · longest ${formatDwell(learnedPlace.longestDwellSeconds)}`}
                theme={theme}
                title="Time spent here"
              />
              <SettingsBlockRow subtitle={formatShortDateTime(learnedPlace.lastSeenAt)} theme={theme} title="Last seen" />
              <SettingsBlockRow subtitle={associatedCategory} theme={theme} title="Activity" />
            </SettingsBlockGroup>

            <View style={learnedSheetStyles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => dismissWith(() => onSave(learnedPlace))}
                style={({ pressed }) => [learnedSheetStyles.pill, { backgroundColor: theme.accent, opacity: disabled ? 0.45 : 1 }, pressed ? styles.buttonPressed : null]}
              >
                <Text {...mobileTextProps("control")} style={[learnedSheetStyles.pillText, { color: theme.onAccent }]}>Save place</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => dismissWith(() => onEdit(learnedPlace))}
                style={({ pressed }) => [learnedSheetStyles.pill, { backgroundColor: theme.surfaceMuted, opacity: disabled ? 0.45 : 1 }, pressed ? styles.buttonPressed : null]}
              >
                <Text {...mobileTextProps("control")} style={[learnedSheetStyles.pillText, { color: theme.textPrimary }]}>Edit before saving</Text>
              </Pressable>
              <View style={learnedSheetStyles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy: ignoring, disabled }}
                  disabled={disabled}
                  onPress={() => onIgnore(learnedPlace, () => dismissWith())}
                  style={({ pressed }) => [learnedSheetStyles.pill, learnedSheetStyles.half, { backgroundColor: theme.surfaceMuted, opacity: disabled && !ignoring ? 0.45 : 1 }, pressed ? styles.buttonPressed : null]}
                >
                  <Text {...mobileTextProps("control")} style={[learnedSheetStyles.pillText, { color: theme.textPrimary }]}>{ignoring ? "Ignoring…" : "Ignore"}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy: forgetting, disabled }}
                  disabled={disabled}
                  onPress={() => onForget(learnedPlace, () => dismissWith())}
                  style={({ pressed }) => [learnedSheetStyles.pill, learnedSheetStyles.half, { backgroundColor: theme.surfaceMuted, opacity: disabled && !forgetting ? 0.45 : 1 }, pressed ? styles.buttonPressed : null]}
                >
                  <Text {...mobileTextProps("control")} style={[learnedSheetStyles.pillText, { color: theme.dangerText }]}>{forgetting ? "Forgetting…" : "Forget"}</Text>
                </Pressable>
              </View>
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
      {/* Ignore / Forget confirmations, presented over this sheet's modal. */}
      <BlocksConfirmHost controller={confirmSheet} reduceMotion={reduceMotion} styles={styles} theme={theme} />
    </Modal>
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
  return formatDuration(Number(seconds));
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
  return formatLocaleDate(timestamp, {
    month: "short",
    day: "numeric"
  });
}

const learnedSheetStyles = StyleSheet.create({
  head: { alignItems: "center", flexDirection: "row", gap: 12, paddingBottom: 8, paddingHorizontal: 4, paddingTop: 6 },
  headTitle: { flex: 1, gap: 2, minWidth: 0 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.9 },
  title: { fontFamily: MOBILE_DISPLAY_FONT.bold, fontSize: 22 },
  close: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, height: 44, justifyContent: "center", width: 44 },
  body: { gap: 16 },
  actions: { gap: 10 },
  actionRow: { flexDirection: "row", gap: 10 },
  pill: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, justifyContent: "center", minHeight: 48, paddingHorizontal: 18 },
  half: { flex: 1 },
  pillText: { fontSize: 16, fontWeight: "700" }
});
