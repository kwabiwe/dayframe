import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  Text,
  View
} from "react-native";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type {
  LocationReviewAction,
  LocationReviewEvidenceDto
} from "@dayframe/shared";
import { LocationReviewCorrectionEditor } from "@/components/location/LocationReviewCorrectionEditor";
import { ConnectivityStatusStrip } from "@/components/ConnectivityStatusStrip";
import { MobileBackButton } from "@/components/MobileBackButton";
import {
  AuthRequiredError,
  fetchBootstrap,
  normaliseLocationReviewRequestError,
  resolveLocationReviewItem,
  type MobileBootstrap,
  type MobileReviewItem
} from "@/lib/api";
import {
  revalidateLocationReviewEvidence
} from "@/lib/locationReviewEvidenceCache";
import { useConnectivity } from "@/lib/connectivity";
import {
  durableReviewMutationFromLocationAction,
  locationReviewActionRequiresConnection
} from "@/lib/locationReviewDraft";
import { pressable, useMobileTheme } from "@/lib/mobileTheme";
import { scheduleLocationEvidenceLoadingFeedback } from "@/lib/review";
import {
  createReviewClientMutationId,
  enqueueReviewMutation,
  getActiveReviewAccountIdentity,
  loadCachedLocationReviewEvidence,
  loadCachedReviewBootstrap,
  synchroniseReviewMutations
} from "@/lib/reviewSyncStore";

type EvidenceScreenState =
  | { status: "hydrating" }
  | {
      status: "ready";
      evidence: LocationReviewEvidenceDto;
      source: "cache" | "network";
      refreshing: boolean;
      refreshMessage: string | null;
    }
  | { status: "unavailable"; message: string };

export default function LocationReviewDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isFocused = useIsFocused();
  const { styles, theme } = useMobileTheme();
  const { isOffline, isOnline, reconnectEpoch } = useConnectivity();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [screenState, setScreenState] = useState<EvidenceScreenState>({
    status: "hydrating"
  });
  const [showHydrationFeedback, setShowHydrationFeedback] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [reloadSequence, setReloadSequence] = useState(0);
  const loadGenerationRef = useRef(0);
  const hydrationFeedbackCancelRef = useRef<(() => void) | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const routeFocusedRef = useRef(false);
  const screenStateRef = useRef<EvidenceScreenState>(screenState);
  const connectivityRef = useRef({ isOffline, isOnline, reconnectEpoch });
  const lastHandledReconnectEpoch = useRef(0);
  const reconnectControllerRef = useRef<AbortController | null>(null);
  screenStateRef.current = screenState;
  connectivityRef.current = { isOffline, isOnline, reconnectEpoch };

  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    const controller = new AbortController();
    hydrationFeedbackCancelRef.current?.();
    setShowHydrationFeedback(false);
    hydrationFeedbackCancelRef.current = scheduleLocationEvidenceLoadingFeedback(() => {
      if (!isCurrent(generation, controller.signal)) return;
      hydrationFeedbackCancelRef.current = null;
      setShowHydrationFeedback(true);
    });
    void initialise(generation, controller.signal);
    return () => {
      hydrationFeedbackCancelRef.current?.();
      hydrationFeedbackCancelRef.current = null;
      loadGenerationRef.current += 1;
      controller.abort();
    };
  }, [id, reloadSequence]);

  useEffect(() => {
    routeFocusedRef.current = isFocused;
    if (isFocused) {
      lastHandledReconnectEpoch.current = Math.max(
        lastHandledReconnectEpoch.current,
        connectivityRef.current.reconnectEpoch
      );
    } else {
      reconnectControllerRef.current?.abort();
      reconnectControllerRef.current = null;
    }
  }, [isFocused]);

  const evidence = screenState.status === "ready" ? screenState.evidence : null;
  const reviewItem = data?.reviewItems.find((item) => item.id === id);
  const adjacentReview = useMemo(
    () => evidence && data ? adjacentLocationReview(data.reviewItems, id, evidence) : undefined,
    [data, evidence, id]
  );

  async function initialise(generation: number, signal: AbortSignal) {
    if (!id) {
      finishHydrationFeedback(generation);
      return;
    }
    setScreenState({ status: "hydrating" });
    setActionMessage(null);
    try {
      const [cachedContext, cachedEvidence, cachedOwner] = await Promise.all([
        loadCachedReviewBootstrap(),
        loadCachedLocationReviewEvidence(id),
        getActiveReviewAccountIdentity()
      ]);
      if (!isCurrent(generation, signal)) return;
      if (cachedContext) setData(cachedContext.bootstrap);
      if (cachedEvidence) {
        setScreenState({
          status: "ready",
          evidence: cachedEvidence.evidence,
          source: "cache",
          refreshing: true,
          refreshMessage: null
        });
        finishHydrationFeedback(generation);
      }

      const contextRequest = refreshContext(generation, signal);
      let owner = cachedOwner;
      if (!owner) {
        const bootstrap = await contextRequest;
        owner = bootstrap
          ? {
              workspaceId: bootstrap.workspace.id,
              userId: bootstrap.user.id,
              workspaceName: bootstrap.workspace.name
            }
          : null;
      } else {
        void contextRequest.catch((error) => handleContextError(error, generation, signal));
      }
      if (!owner || !isCurrent(generation, signal)) return;

      try {
        const refreshed = await revalidateLocationReviewEvidence({
          reviewItemId: id,
          workspaceId: owner.workspaceId,
          userId: owner.userId,
          signal
        });
        if (!isCurrent(generation, signal)) return;
        setScreenState({
          status: "ready",
          evidence: refreshed.evidence,
          source: "network",
          refreshing: false,
          refreshMessage: null
        });
      } catch (loadError) {
        if (!isCurrent(generation, signal)) return;
        if (loadError instanceof AuthRequiredError) {
          router.replace("/");
          return;
        }
        if (cachedEvidence) {
          setScreenState({
            status: "ready",
            evidence: cachedEvidence.evidence,
            source: "cache",
            refreshing: false,
            refreshMessage: connectivityRef.current.isOffline
              ? "Showing evidence saved on this iPhone"
              : "Couldn’t refresh this evidence · showing the saved copy"
          });
        } else {
          setScreenState({
            status: "unavailable",
            message: normaliseLocationReviewRequestError(loadError, "evidence")
          });
        }
      }
    } catch (loadError) {
      if (!isCurrent(generation, signal)) return;
      if (loadError instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      setScreenState({
        status: "unavailable",
        message: normaliseLocationReviewRequestError(loadError, "evidence")
      });
    } finally {
      finishHydrationFeedback(generation);
    }
  }

  function finishHydrationFeedback(generation: number) {
    if (generation !== loadGenerationRef.current) return;
    hydrationFeedbackCancelRef.current?.();
    hydrationFeedbackCancelRef.current = null;
    setShowHydrationFeedback(false);
  }

  async function refreshContext(generation: number, signal: AbortSignal) {
    const bootstrap = await fetchBootstrap();
    if (!isCurrent(generation, signal)) return null;
    setData(bootstrap);
    return bootstrap;
  }

  function handleContextError(
    error: unknown,
    generation: number,
    signal: AbortSignal
  ) {
    if (!isCurrent(generation, signal)) return;
    if (error instanceof AuthRequiredError) router.replace("/");
  }

  const recoverEvidenceAfterReconnect = useCallback(() => {
    const connectivity = connectivityRef.current;
    if (
      connectivity.reconnectEpoch <= lastHandledReconnectEpoch.current ||
      !connectivity.isOnline ||
      appStateRef.current !== "active" ||
      !routeFocusedRef.current ||
      !id
    ) {
      return;
    }
    lastHandledReconnectEpoch.current = connectivity.reconnectEpoch;
    const currentState = screenStateRef.current;
    if (currentState.status === "unavailable") {
      setReloadSequence((current) => current + 1);
      return;
    }
    if (currentState.status !== "ready") return;

    const generation = loadGenerationRef.current;
    reconnectControllerRef.current?.abort();
    const controller = new AbortController();
    reconnectControllerRef.current = controller;
    void getActiveReviewAccountIdentity()
      .then(async (owner) => {
        if (!owner || !isCurrent(generation, controller.signal)) return;
        const refreshed = await revalidateLocationReviewEvidence({
          reviewItemId: id,
          workspaceId: owner.workspaceId,
          userId: owner.userId,
          signal: controller.signal
        });
        if (
          !isCurrent(generation, controller.signal) ||
          !routeFocusedRef.current
        ) {
          return;
        }
        setScreenState({
          status: "ready",
          evidence: refreshed.evidence,
          source: "network",
          refreshing: false,
          refreshMessage: null
        });
      })
      .catch((error) => {
        if (
          !isCurrent(generation, controller.signal) ||
          !routeFocusedRef.current
        ) {
          return;
        }
        if (error instanceof AuthRequiredError) {
          router.replace("/");
          return;
        }
        const mounted = screenStateRef.current;
        if (mounted.status !== "ready") return;
        setScreenState({
          ...mounted,
          refreshing: false,
          refreshMessage: connectivityRef.current.isOffline
            ? "Showing evidence saved on this iPhone"
            : "Couldn’t refresh this evidence · showing the saved copy"
        });
      })
      .finally(() => {
        if (reconnectControllerRef.current === controller) {
          reconnectControllerRef.current = null;
        }
      });
  }, [id]);

  useEffect(() => recoverEvidenceAfterReconnect(), [
    isOnline,
    reconnectEpoch,
    recoverEvidenceAfterReconnect
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
      if (nextState === "active") recoverEvidenceAfterReconnect();
    });
    return () => subscription.remove();
  }, [recoverEvidenceAfterReconnect]);

  useEffect(() => () => reconnectControllerRef.current?.abort(), []);

  async function perform(
    action: LocationReviewAction,
    _successMessage: string
  ) {
    if (!id || saving) return;
    const generation = loadGenerationRef.current;
    setActionMessage(null);
    setSaving(true);
    const durableMutation = durableReviewMutationFromLocationAction(action);
    try {
      if (durableMutation) {
        if (!data || !reviewItem) {
          setActionMessage(
            "This Review suggestion is not available in the saved account data. Go back and refresh Review."
          );
          return;
        }
        await enqueueReviewMutation({
          bootstrap: data,
          item: reviewItem,
          mutation: durableMutation,
          clientMutationId: createReviewClientMutationId()
        });
        if (generation !== loadGenerationRef.current) return;
        AccessibilityInfo.announceForAccessibility(
          "Saved on this iPhone. Waiting to sync."
        );
        void synchroniseReviewMutations().catch(() => undefined);
        router.back();
        return;
      }
      if (!locationReviewActionRequiresConnection(action)) return;
      await resolveLocationReviewItem(id, action);
      if (generation !== loadGenerationRef.current) return;
      router.back();
    } catch (actionError) {
      if (generation !== loadGenerationRef.current) return;
      if (actionError instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      setActionMessage(
        durableMutation
          ? "This Review change was not saved on this iPhone. Your edits are still here."
          : normaliseLocationReviewRequestError(actionError, "action")
      );
    } finally {
      if (generation === loadGenerationRef.current) setSaving(false);
    }
  }

  function isCurrent(generation: number, signal: AbortSignal) {
    return generation === loadGenerationRef.current && !signal.aborted;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.settingsFloatingHeader}>
        <View style={styles.settingsHeader}>
          <MobileBackButton
            accessibilityLabel="Back to Review"
            onPress={() => router.back()}
          />
          <Text style={styles.settingsTitle} numberOfLines={1}>Location evidence</Text>
        </View>
      </View>
      <ConnectivityStatusStrip style={styles.connectivityStatusStripScreen} />

      {screenState.status === "hydrating" ? (
        showHydrationFeedback ? (
          <ScrollView
            style={styles.settingsScrollView}
            contentContainerStyle={styles.settingsScrollContent}
          >
            <View style={styles.panel}>
              <ActivityIndicator color={theme.accent} />
              <Text accessibilityLiveRegion="polite" style={styles.muted}>Loading private map evidence…</Text>
            </View>
          </ScrollView>
        ) : null
      ) : screenState.status === "unavailable" ? (
        <ScrollView
          style={styles.settingsScrollView}
          contentContainerStyle={styles.settingsScrollContent}
        >
          <View style={styles.panel}>
            <Text accessibilityLiveRegion="assertive" style={styles.reviewMetaLine}>{screenState.message}</Text>
            <Pressable
              accessibilityRole="button"
              style={pressable(styles.secondaryButton, styles.buttonPressed)}
              onPress={() => setReloadSequence((current) => current + 1)}
            >
              <Text style={styles.secondaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : evidence ? (
        <LocationReviewCorrectionEditor
          adjacentReview={adjacentReview}
          categories={data?.categories ?? []}
          evidence={evidence}
          onResolve={perform}
          places={data?.places ?? []}
          reviewItem={reviewItem}
          saving={saving}
          statusMessage={actionMessage ?? screenState.refreshMessage}
        />
      ) : null}
    </SafeAreaView>
  );
}

function isLocationItem(item: MobileReviewItem) {
  return item.eventSource === "location_learning" &&
    ["geofence_exit", "unknown_stay", "learned_place_visit"].includes(item.eventType ?? "");
}

function adjacentLocationReview(
  items: MobileReviewItem[],
  currentId: string | undefined,
  evidence: LocationReviewEvidenceDto
) {
  if (evidence.segment.kind !== "stay") return undefined;
  const currentStart = Date.parse(evidence.segment.startedAt);
  const currentStop = Date.parse(evidence.segment.stoppedAt ?? "");
  if (!Number.isFinite(currentStart) || !Number.isFinite(currentStop)) return undefined;
  const maximumAdjacentGapMs = 15 * 60_000;
  return items
    .flatMap((item) => {
      if (item.id === currentId || item.status !== "open" || !isLocationItem(item)) return [];
      const start = Date.parse(item.suggestedStartedAt ?? "");
      const stop = Date.parse(item.suggestedStoppedAt ?? "");
      if (!Number.isFinite(start) || !Number.isFinite(stop)) return [];
      const gap = Math.min(Math.abs(start - currentStop), Math.abs(currentStart - stop));
      return gap <= maximumAdjacentGapMs ? [{ item, gap }] : [];
    })
    .sort((a, b) => a.gap - b.gap || a.item.id.localeCompare(b.item.id))[0]?.item;
}
