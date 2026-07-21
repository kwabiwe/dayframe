import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";
import { DayframeBrand } from "@/components/brand";
import { LocationEvidenceMap } from "@/components/location/LocationEvidenceMap";
import {
  AuthRequiredError,
  fetchBootstrap,
  fetchLocationReviewEvidence,
  resolveLocationReviewItem,
  type MobileReviewItem
} from "@/lib/api";
import { pressable, useMobileTheme } from "@/lib/mobileTheme";

export default function LocationReviewDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { styles, theme } = useMobileTheme();
  const [evidence, setEvidence] = useState<LocationReviewEvidenceDto | null>(null);
  const [reviewItems, setReviewItems] = useState<MobileReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placeName, setPlaceName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPoint, setSelectedPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [editingCentre, setEditingCentre] = useState(false);
  const [selectedSavedPlaceId, setSelectedSavedPlaceId] = useState<string | null>(null);
  const [selectedSplitAt, setSelectedSplitAt] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [id]);

  const adjacentReview = useMemo(
    () => evidence ? adjacentLocationReview(reviewItems, id, evidence) : undefined,
    [evidence, id, reviewItems]
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
      setDescription(nextEvidence.display.title);
      setReviewItems(bootstrap.reviewItems);
      if (nextEvidence.map.centre) {
        setSelectedPoint({
          longitude: nextEvidence.map.centre.coordinates[0],
          latitude: nextEvidence.map.centre.coordinates[1]
        });
      }
    } catch (loadError) {
      if (loadError instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "Unable to load location evidence.");
    } finally {
      setLoading(false);
    }
  }

  async function perform(action: Parameters<typeof resolveLocationReviewItem>[1], successMessage: string) {
    if (!id) return;
    setSaving(true);
    try {
      await resolveLocationReviewItem(id, action);
      Alert.alert("Location review", successMessage, [{ text: "Done", onPress: () => router.back() }]);
    } catch (actionError) {
      if (actionError instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Location review", actionError instanceof Error ? actionError.message : "Unable to update this review.");
    } finally {
      setSaving(false);
    }
  }

  function savePlace() {
    if (!selectedPoint || !placeName.trim()) {
      Alert.alert("Save place", "Choose a point on the map and enter a place name.");
      return;
    }
    void perform({
      action: "save_place_and_confirm",
      name: placeName.trim(),
      latitude: selectedPoint.latitude,
      longitude: selectedPoint.longitude,
      radiusMeters: 80
    }, "The place was saved and this visit was recorded.");
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.settingsFloatingHeader}>
        <View style={styles.settingsHeader}>
          <Pressable
            accessibilityLabel="Back to Review"
            accessibilityRole="button"
            style={pressable(styles.iconButton, styles.buttonPressed)}
            onPress={() => router.back()}
          >
            <Text style={{ color: theme.accent, fontSize: 24 }}>‹</Text>
          </Pressable>
          <DayframeBrand layout="compact" size="sm" tone={theme.mode === "dark" ? "light" : "dark"} />
        </View>
      </View>

      <ScrollView style={styles.settingsScrollView} contentContainerStyle={styles.settingsScrollContent}>
        <View style={styles.contentStack}>
          <View style={styles.panel}>
            <Text style={styles.label}>Location evidence</Text>
            <Text style={styles.sectionTitle}>{evidence?.display.title ?? "Review detected time"}</Text>
            <Text style={styles.muted}>Inspect the evidence and uncertainty before Dayframe records time.</Text>
          </View>

          {loading ? (
            <View style={styles.panel}>
              <ActivityIndicator color={theme.accent} />
              <Text accessibilityLiveRegion="polite" style={styles.muted}>Loading private map evidence…</Text>
            </View>
          ) : error ? (
            <View style={styles.panel}>
              <Text accessibilityLiveRegion="assertive" style={styles.reviewMetaLine}>{error}</Text>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={() => void load()}>
                <Text style={styles.secondaryButtonText}>Try again</Text>
              </Pressable>
            </View>
          ) : evidence ? (
            <>
              <View style={styles.panel}>
                <LocationEvidenceMap
                  evidence={evidence}
                  accentColor={theme.accent}
                  surfaceColor={theme.surfaceMuted}
                  textColor={theme.textSecondary}
                  dangerColor={theme.danger}
                  selectedPoint={selectedPoint}
                  selectedPointRadiusMeters={evidence.segment.kind === "stay" ? 80 : undefined}
                  selectedSavedPlaceId={selectedSavedPlaceId}
                  onSelectPoint={editingCentre ? setSelectedPoint : undefined}
                  onSelectSavedPlace={setSelectedSavedPlaceId}
                />
                {evidence.evidenceExpired ? (
                  <Text style={styles.muted}>Raw evidence has expired; the derived visit remains available.</Text>
                ) : evidence.evidenceExpiresAt ? (
                  <Text style={styles.muted}>Raw evidence is retained until {formatDateTime(evidence.evidenceExpiresAt)}.</Text>
                ) : null}
              </View>

              <View style={styles.panel}>
                <Text style={styles.sectionTitle}>Time and uncertainty</Text>
                <Text style={styles.reviewMetaLine}>
                  {formatDateTime(evidence.segment.startedAt)}–{evidence.segment.stoppedAt ? formatDateTime(evidence.segment.stoppedAt) : "ongoing"}
                </Text>
                <Text style={styles.muted}>{uncertaintySummary(evidence)}</Text>
                {evidence.map.gaps.map((gap) => (
                  <Text key={`${gap.startedAt}-${gap.stoppedAt}`} style={styles.reviewMetaLine}>
                    Evidence gap · {Math.round(gap.durationSeconds / 60)} minutes
                  </Text>
                ))}
                {evidence.suggestedSplitPoints.map((split) => (
                  <Pressable
                    key={split.at}
                    accessibilityRole="button"
                    disabled={saving}
                    style={pressable(styles.secondaryButton, styles.buttonPressed)}
                    onPress={() => setSelectedSplitAt(split.at)}
                  >
                    <Text style={styles.secondaryButtonText}>Preview split near {formatTime(split.at)}</Text>
                  </Pressable>
                ))}
                {selectedSplitAt ? (
                  <View style={styles.activeEditSection}>
                    <Text style={styles.reviewMetaLine}>Before: {formatTime(evidence.segment.startedAt)}–{formatTime(selectedSplitAt)}</Text>
                    <Text style={styles.reviewMetaLine}>After: {formatTime(selectedSplitAt)}–{evidence.segment.stoppedAt ? formatTime(evidence.segment.stoppedAt) : "ongoing"}</Text>
                    <Pressable
                      accessibilityRole="button"
                      disabled={saving}
                      style={pressable(styles.primaryButton, styles.buttonPressed)}
                      onPress={() => void perform(
                        { action: "split", splitAt: selectedSplitAt },
                        "The visit was split into two review items."
                      )}
                    >
                      <Text style={styles.primaryButtonText}>Commit this split</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>

              {evidence.map.nearbySavedPlaces.length ? (
                <View style={styles.panel}>
                  <Text style={styles.sectionTitle}>Correct the place</Text>
                  <Text style={styles.muted}>Choosing a saved place teaches future matching without enlarging its radius.</Text>
                  {evidence.map.nearbySavedPlaces.map((place) => (
                    <Pressable
                      key={place.id}
                      accessibilityRole="button"
                      disabled={saving}
                      style={pressable(styles.secondaryButton, styles.buttonPressed)}
                      onPress={() => setSelectedSavedPlaceId(place.id)}
                    >
                      <Text style={styles.secondaryButtonText}>{place.name} · {place.distanceMeters} m</Text>
                    </Pressable>
                  ))}
                  {selectedSavedPlaceId ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={saving}
                      style={pressable(styles.primaryButton, styles.buttonPressed)}
                      onPress={() => void perform(
                        { action: "change_place_and_confirm", placeId: selectedSavedPlaceId, learnedPlaceId: null },
                        "The visit was recorded with the selected saved place."
                      )}
                    >
                      <Text style={styles.primaryButtonText}>Use place and record</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {evidence.segment.kind === "stay" ? (
                <View style={styles.panel}>
                  <Text style={styles.sectionTitle}>Save this place</Text>
                  <Text style={styles.muted}>The proposed 80 metre radius is shown on the map and will not expand from a noisy sample.</Text>
                  <Pressable
                    accessibilityRole="button"
                    style={pressable(styles.secondaryButton, styles.buttonPressed)}
                    onPress={() => setEditingCentre((current) => !current)}
                  >
                    <Text style={styles.secondaryButtonText}>{editingCentre ? "Finish moving centre" : "Move proposed centre"}</Text>
                  </Pressable>
                  {editingCentre ? <Text style={styles.muted}>Tap the map to move the proposed centre. Nothing is saved until you confirm below.</Text> : null}
                  <TextInput
                    accessibilityLabel="New saved place name"
                    placeholder="Place name"
                    placeholderTextColor={theme.textSecondary}
                    style={styles.textInput}
                    value={placeName}
                    onChangeText={setPlaceName}
                  />
                  <Pressable
                    accessibilityRole="button"
                    disabled={saving || !selectedPoint || !placeName.trim()}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      pressed ? styles.buttonPressed : null,
                      saving || !selectedPoint || !placeName.trim() ? styles.buttonDisabled : null
                    ]}
                    onPress={savePlace}
                  >
                    <Text style={styles.primaryButtonText}>Save place and record</Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.panel}>
                <Text style={styles.sectionTitle}>Resolve</Text>
                <TextInput
                  accessibilityLabel="Time entry description"
                  maxLength={500}
                  placeholder="Description"
                  placeholderTextColor={theme.textSecondary}
                  style={styles.textInput}
                  value={description}
                  onChangeText={setDescription}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  style={({ pressed }) => [styles.primaryButton, pressed ? styles.buttonPressed : null, saving ? styles.buttonDisabled : null]}
                  onPress={() => void perform({ action: "edit_and_confirm", edit: { description } }, "This location suggestion was confirmed.")}
                >
                  <Text style={styles.primaryButtonText}>{saving ? "Saving…" : "Confirm edits"}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  style={pressable(styles.secondaryButton, styles.buttonPressed)}
                  onPress={() => void perform({ action: "record_once", edit: { description } }, "This time was recorded without saving a place.")}
                >
                  <Text style={styles.secondaryButtonText}>Record once</Text>
                </Pressable>
                {adjacentReview && evidence.segment.kind === "stay" ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={saving}
                    style={pressable(styles.secondaryButton, styles.buttonPressed)}
                    onPress={() => void perform({
                      action: "merge",
                      adjacentReviewItemId: adjacentReview.id,
                      acknowledgeContradictoryEvidence: false
                    }, "The adjacent visits were merged into one review item.")}
                  >
                    <Text style={styles.secondaryButtonText}>Merge with adjacent visit</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  style={pressable(styles.secondaryButton, styles.buttonPressed)}
                  onPress={() => void perform({ action: "ignore_once_location" }, "This suggestion was ignored. Raw evidence will still follow its retention window.")}
                >
                  <Text style={styles.secondaryButtonText}>Ignore suggestion</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
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

function uncertaintySummary(evidence: LocationReviewEvidenceDto) {
  const start = evidence.segment.startUncertainty;
  const stop = evidence.segment.stopUncertainty;
  if (evidence.segment.continuityStatus === "uncertain_gap") {
    return "A gap limits boundary precision. Dayframe has kept the supported bounds instead of inventing an exact departure.";
  }
  if (start?.lower !== start?.upper || stop?.lower !== stop?.upper) {
    return "Times are estimated between the nearest supporting evidence points.";
  }
  return "Arrival and departure are supported by nearby evidence anchors.";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
