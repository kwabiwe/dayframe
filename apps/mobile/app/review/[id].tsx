import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";
import { DayframeBrand } from "@/components/brand";
import { LocationReviewCorrectionEditor } from "@/components/location/LocationReviewCorrectionEditor";
import { MobileBackButton } from "@/components/MobileBackButton";
import {
  AuthRequiredError,
  fetchBootstrap,
  fetchLocationReviewEvidence,
  resolveLocationReviewItem,
  type MobileBootstrap,
  type MobileReviewItem
} from "@/lib/api";
import { pressable, useMobileTheme } from "@/lib/mobileTheme";

export default function LocationReviewDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { styles, theme } = useMobileTheme();
  const [evidence, setEvidence] = useState<LocationReviewEvidenceDto | null>(null);
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [id]);

  const reviewItem = data?.reviewItems.find((item) => item.id === id);
  const adjacentReview = useMemo(
    () => evidence && data ? adjacentLocationReview(data.reviewItems, id, evidence) : undefined,
    [data, evidence, id]
  );

  async function load() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [nextEvidence, bootstrap] = await Promise.all([
        fetchLocationReviewEvidence(id),
        fetchBootstrap()
      ]);
      setEvidence(nextEvidence);
      setData(bootstrap);
    } catch (loadError) {
      if (loadError instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      setError(
        "Detailed location evidence needs a connection. Go back to confirm, dismiss or edit the saved Review suggestion."
      );
    } finally {
      setLoading(false);
    }
  }

  async function perform(
    action: Parameters<typeof resolveLocationReviewItem>[1],
    successMessage: string
  ) {
    if (!id || saving) return;
    setSaving(true);
    try {
      await resolveLocationReviewItem(id, action);
      Alert.alert("Location review", successMessage, [{ text: "Done", onPress: () => router.back() }]);
    } catch (actionError) {
      if (actionError instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert(
        "Location review",
        actionError instanceof Error ? actionError.message : "Unable to update this review."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.settingsFloatingHeader}>
        <View style={styles.settingsHeader}>
          <MobileBackButton
            accessibilityLabel="Back to Review"
            onPress={() => router.back()}
          />
          <DayframeBrand layout="compact" size="sm" tone={theme.mode === "dark" ? "light" : "dark"} />
        </View>
      </View>

      {loading ? (
        <ScrollView
          style={styles.settingsScrollView}
          contentContainerStyle={styles.settingsScrollContent}
        >
          <View style={styles.panel}>
            <ActivityIndicator color={theme.accent} />
            <Text accessibilityLiveRegion="polite" style={styles.muted}>Loading private map evidence…</Text>
          </View>
        </ScrollView>
      ) : error ? (
        <ScrollView
          style={styles.settingsScrollView}
          contentContainerStyle={styles.settingsScrollContent}
        >
          <View style={styles.panel}>
            <Text accessibilityLiveRegion="assertive" style={styles.reviewMetaLine}>{error}</Text>
            <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={() => void load()}>
              <Text style={styles.secondaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : evidence ? (
        <LocationReviewCorrectionEditor
          adjacentReview={adjacentReview}
          categories={data?.categories ?? []}
          evidence={evidence}
          key={evidence.reviewItemId}
          onResolve={perform}
          places={data?.places ?? []}
          reviewItem={reviewItem}
          saving={saving}
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
