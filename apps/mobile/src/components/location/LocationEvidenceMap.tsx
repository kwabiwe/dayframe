import { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Circle, Marker, Polyline, type MapPressEvent, type Region } from "react-native-maps";
import { evidencePlainSummary, formatClockTime, type ClockFormat, type LocationReviewEvidenceDto } from "@dayframe/shared";

type Props = {
  /** The map follows Dayframe's theme, so neutral overlays read on it (not the system's). */
  appearance?: "light" | "dark";
  /** A Review item's or a timeline item's evidence (step 12): only what the map draws and says. */
  evidence: Pick<LocationReviewEvidenceDto, "map" | "segment" | "stops" | "evidenceExpired" | "rawEvidenceAvailable">;
  /** The viewer's clock, for the map's words ("25 readings · No readings 18:06–19:21"). */
  clockFormat: ClockFormat;
  accentColor: string;
  surfaceColor: string;
  textColor: string;
  dangerColor: string;
  selectedPoint?: { latitude: number; longitude: number } | null;
  selectedPointRadiusMeters?: number;
  selectedSavedPlaceId?: string | null;
  showDetails?: boolean;
  /**
   * Owner items L, M (28 Oct 2026): only the visit's own area (no saved places' circles or pins), and the
   * readings line inside the map card. The Calendar's correction sheet always draws it so; the Review details
   * editor keeps the full map.
   */
  visitOnly?: boolean;
  /** Reduce Motion: a refit to show the chosen place jumps instead of gliding. */
  reduceMotion?: boolean;
  /** Changes once per place chosen from a list; each change shows `selectedPoint` with the stay. */
  revealChoiceToken?: number;
  onSelectPoint?: (point: { latitude: number; longitude: number }) => void;
  onSelectSavedPlace?: (placeId: string) => void;
};

export function LocationEvidenceMap({
  appearance,
  clockFormat,
  evidence,
  accentColor,
  surfaceColor,
  textColor,
  dangerColor,
  selectedPoint,
  selectedPointRadiusMeters,
  selectedSavedPlaceId,
  showDetails = true,
  visitOnly = false,
  reduceMotion = false,
  revealChoiceToken,
  onSelectPoint,
  onSelectSavedPlace
}: Props) {
  const mapRef = useRef<MapView>(null);
  // The opening token is already shown by the opening view; a replayed effect sees it as handled.
  const handledRevealRef = useRef(revealChoiceToken);
  const samples = evidence.map.acceptedSamples;
  // Plain words, not the server's diagnostic summary (owner feedback, 27 Oct 2026).
  const summary = evidencePlainSummary(evidence, (iso) => formatClockTime(iso, clockFormat));
  const shouldShowSavedPlaces = !visitOnly && (showDetails || evidence.segment.kind === "stay");
  // Time away has no route line, so its readings are the evidence to inspect.
  const shouldShowSamples = showDetails || evidence.segment.timeAway === true;
  const coordinates = [
    ...samples.map((sample) => ({
      latitude: sample.point.coordinates[1],
      longitude: sample.point.coordinates[0]
    })),
    ...(shouldShowSavedPlaces ? evidence.map.nearbySavedPlaces : []).map((place) => ({
      latitude: place.point.coordinates[1],
      longitude: place.point.coordinates[0]
    })),
    ...(evidence.map.straightLineFallback?.coordinates.map(([longitude, latitude]) => ({ latitude, longitude })) ?? []),
    ...(showDetails ? evidence.map.rejectedSamples : []).flatMap((sample) => sample.point
      ? [{ latitude: sample.point.coordinates[1], longitude: sample.point.coordinates[0] }]
      : [])
  ];
  // What the opening view frames: everything above and the drawn route, whose ends are the stays either side
  // and can lie beyond the readings (Codex r2 on #599).
  const framed = [
    ...coordinates,
    ...(evidence.map.route?.coordinates.map(([longitude, latitude]) => ({ latitude, longitude })) ?? [])
  ];
  // A stay centres on its place; anything else on the middle of what it shows, not its first reading, so a whole
  // trip fits (step 12 Simulator check).
  const centre = evidence.map.centre
    ? {
        latitude: evidence.map.centre.coordinates[1],
        longitude: evidence.map.centre.coordinates[0]
      }
    : framed.length
      ? {
          latitude: midpoint(framed.map((point) => point.latitude)),
          longitude: midpoint(framed.map((point) => point.longitude))
        }
      : undefined;
  const latitudeDelta = Math.max(0.004, spread(framed.map((point) => point.latitude)) * 1.6);
  const longitudeDelta = Math.max(0.004, spread(framed.map((point) => point.longitude)) * 1.6);
  const initialRegion = centre ? { ...centre, latitudeDelta, longitudeDelta } : null;
  const stayRadiusMeters = evidence.map.centre ? evidence.map.stayRadiusMeters ?? 0 : 0;

  // A place chosen from a list (Nearby, Search, the saved rows, back to the match) is shown with
  // the stay's area: the camera returns to the stay's opening view when the pin and its circle fit
  // in it, and otherwise fits both. Each choice makes one camera call (MapKit retargets a newer one
  // from where the camera is); a map tap moves the pin, not the camera, and makes no choice.
  useEffect(() => {
    if (revealChoiceToken === undefined || revealChoiceToken === handledRevealRef.current) return;
    handledRevealRef.current = revealChoiceToken;
    if (!centre || !initialRegion || !selectedPoint) return;
    const radius = selectedPointRadiusMeters ?? 0;
    if (regionContains(initialRegion, selectedPoint, radius)) {
      mapRef.current?.animateToRegion(initialRegion, reduceMotion ? 0 : CAMERA_DURATION_MS);
      return;
    }
    mapRef.current?.fitToCoordinates(
      [...circleExtent(centre, stayRadiusMeters), ...circleExtent(selectedPoint, radius)],
      { animated: !reduceMotion, edgePadding: { top: 40, right: 40, bottom: 40, left: 40 } }
    );
    // Only a new choice moves the camera; the point is the one chosen with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealChoiceToken]);

  if (!centre || !initialRegion) {
    return (
      <View style={[styles.fallback, { backgroundColor: surfaceColor }]}>
        <Text style={[styles.fallbackText, { color: textColor }]}>{summary}</Text>
        <Text style={[styles.fallbackText, { color: textColor }]}>Mapped evidence has expired or is unavailable.</Text>
      </View>
    );
  }

  const route = evidence.map.route?.coordinates.map(([longitude, latitude]) => ({ latitude, longitude })) ?? [];
  const straightLineFallback = evidence.map.straightLineFallback?.coordinates
    .map(([longitude, latitude]) => ({ latitude, longitude })) ?? [];
  const commuteLine = route.length >= 2 ? route : straightLineFallback;
  const commuteStart = evidence.segment.kind === "commute" ? commuteLine[0] : undefined;
  const commuteEnd = evidence.segment.kind === "commute"
    ? commuteLine[commuteLine.length - 1]
    : undefined;
  const usesApproximateFallback = evidence.segment.kind === "commute" && route.length < 2 && straightLineFallback.length >= 2;
  const handlePress = (event: MapPressEvent) => onSelectPoint?.(event.nativeEvent.coordinate);

  return (
    <View>
      <MapView
        // The plain words are always heard, whether or not the details show (Codex r1 on #599).
        accessibilityLabel={`${showDetails
          ? "Location evidence map."
          : evidence.segment.timeAway
            ? "Map of readings while you were away."
            : evidence.segment.kind === "commute"
            ? `Approximate commute map with Start and End markers${usesApproximateFallback ? ". Detailed path unavailable" : ""}.`
            : "Map showing the detected visit location."} ${summary}`}
        initialRegion={initialRegion}
        ref={mapRef}
        userInterfaceStyle={appearance}
        onPress={onSelectPoint ? handlePress : undefined}
        pitchEnabled={false}
        rotateEnabled={false}
        style={styles.map}
      >
        {route.length >= 2 ? <Polyline coordinates={route} strokeColor={accentColor} strokeWidth={4} /> : null}
        {route.length < 2 && straightLineFallback.length >= 2 ? (
          <Polyline
            coordinates={straightLineFallback}
            lineDashPattern={[8, 6]}
            strokeColor={textColor}
            strokeWidth={3}
          />
        ) : null}
        {showDetails ? evidence.map.gaps.map((gap) => gap.fromPoint && gap.toPoint ? (
          <Polyline
            key={`${gap.startedAt}-${gap.stoppedAt}`}
            coordinates={[
              { latitude: gap.fromPoint.coordinates[1], longitude: gap.fromPoint.coordinates[0] },
              { latitude: gap.toPoint.coordinates[1], longitude: gap.toPoint.coordinates[0] }
            ]}
            lineDashPattern={[8, 6]}
            strokeColor={textColor}
            strokeWidth={3}
          />
        ) : null) : null}
        {evidence.map.stayRadiusMeters && evidence.map.centre ? (
          <Circle
            center={centre}
            fillColor={`${accentColor}24`}
            radius={evidence.map.stayRadiusMeters}
            strokeColor={accentColor}
            strokeWidth={2}
          />
        ) : null}
        {shouldShowSamples ? samples.map((sample) => (
          <Circle
            key={sample.id}
            center={{ latitude: sample.point.coordinates[1], longitude: sample.point.coordinates[0] }}
            fillColor={`${accentColor}55`}
            radius={Math.max(4, Math.min(40, sample.accuracyMeters ?? 6))}
            strokeColor={`${accentColor}99`}
            strokeWidth={1}
          />
        )) : null}
        {showDetails ? evidence.map.rejectedSamples.map((sample) => sample.point ? (
          <Circle
            key={`rejected-${sample.id}`}
            center={{ latitude: sample.point.coordinates[1], longitude: sample.point.coordinates[0] }}
            fillColor={`${dangerColor}33`}
            radius={8}
            strokeColor={dangerColor}
            strokeWidth={2}
          />
        ) : null) : null}
        {showDetails ? evidence.map.anchors.map((anchor) => anchor.point ? (
          <Marker
            key={anchor.id}
            coordinate={{ latitude: anchor.point.coordinates[1], longitude: anchor.point.coordinates[0] }}
            pinColor={accentColor}
            title={anchor.label}
          />
        ) : null) : null}
        {!showDetails && commuteStart ? (
          <Marker
            accessibilityLabel="Commute start"
            coordinate={commuteStart}
            pinColor={accentColor}
            title="Start"
          />
        ) : null}
        {!showDetails && commuteEnd ? (
          <Marker
            accessibilityLabel="Commute end"
            coordinate={commuteEnd}
            pinColor={accentColor}
            title="End"
          />
        ) : null}
        {shouldShowSavedPlaces ? evidence.map.nearbySavedPlaces.map((place) => (
          <Circle
            key={`${place.id}-radius`}
            center={{ latitude: place.point.coordinates[1], longitude: place.point.coordinates[0] }}
            fillColor={place.id === selectedSavedPlaceId ? `${accentColor}2e` : `${textColor}12`}
            radius={place.radiusMeters}
            strokeColor={place.id === selectedSavedPlaceId ? accentColor : textColor}
            strokeWidth={place.id === selectedSavedPlaceId ? 3 : 1}
          />
        )) : null}
        {shouldShowSavedPlaces ? evidence.map.nearbySavedPlaces.map((place) => (
          <Marker
            key={place.id}
            accessibilityLabel={`${place.name}, ${place.distanceMeters} metres from the detected centre`}
            coordinate={{ latitude: place.point.coordinates[1], longitude: place.point.coordinates[0] }}
            description={`${place.distanceMeters} metres away · ${place.radiusMeters} metre radius`}
            onPress={() => onSelectSavedPlace?.(place.id)}
            pinColor={place.id === selectedSavedPlaceId ? accentColor : undefined}
            title={place.name}
          />
        )) : null}
        {selectedPoint && selectedPointRadiusMeters ? (
          <Circle
            center={selectedPoint}
            fillColor={`${accentColor}24`}
            radius={selectedPointRadiusMeters}
            strokeColor={accentColor}
            strokeWidth={2}
          />
        ) : null}
        {selectedPoint ? (
          <Marker
            accessibilityLabel={onSelectPoint ? "Proposed place centre" : "Detected visit location"}
            coordinate={selectedPoint}
            pinColor={accentColor}
            title={onSelectPoint ? "Proposed place centre" : "Detected location"}
          />
        ) : null}
      </MapView>
      {usesApproximateFallback ? (
        <Text accessibilityLiveRegion="polite" style={[styles.routeCaption, { color: textColor }]}>Approximate route · detailed path unavailable</Text>
      ) : null}
      {/* The map's plain words, always (owner feedback, 27 Oct 2026; Codex r1 on #599); the map already says them. */}
      <Text importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
        style={[styles.routeCaption, { color: textColor }, visitOnly ? [styles.insideCaption, { backgroundColor: surfaceColor }] : null]}
        testID="location-evidence-summary">{summary}</Text>
      {showDetails ? (
        <>
          <View accessible accessibilityLabel="Map legend: solid coral is accepted evidence, outlined circles are saved places, and dashed lines are evidence gaps." style={styles.legend}>
            <Text style={[styles.legendText, { color: textColor }]}>Solid route · accepted evidence</Text>
            <Text style={[styles.legendText, { color: textColor }]}>Outlined area · saved place</Text>
            <Text style={[styles.legendText, { color: textColor }]}>Dashed line · evidence gap</Text>
          </View>
          {evidence.map.rejectedSamples.length ? (
            <Text style={[styles.legendText, { color: textColor }]}>Excluded noisy or invalid samples: {evidence.map.rejectedSamples.length}</Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const METRES_PER_DEGREE = 111_320;
const CAMERA_DURATION_MS = 350;

/** The four compass points of a circle, so a fit keeps the whole area on screen. */
function circleExtent(point: { latitude: number; longitude: number }, radiusMeters: number) {
  if (radiusMeters <= 0) return [point];
  const latitudeOffset = radiusMeters / METRES_PER_DEGREE;
  const longitudeOffset = radiusMeters / (METRES_PER_DEGREE * Math.max(0.01, Math.cos((point.latitude * Math.PI) / 180)));
  return [
    { latitude: point.latitude + latitudeOffset, longitude: point.longitude },
    { latitude: point.latitude - latitudeOffset, longitude: point.longitude },
    { latitude: point.latitude, longitude: point.longitude + longitudeOffset },
    { latitude: point.latitude, longitude: point.longitude - longitudeOffset }
  ];
}

/** Whether the point and its area sit inside the visible region, with a small margin. */
function regionContains(region: Region, point: { latitude: number; longitude: number }, radiusMeters: number) {
  return circleExtent(point, radiusMeters).every((corner) =>
    Math.abs(corner.latitude - region.latitude) <= region.latitudeDelta * 0.45
    && Math.abs(corner.longitude - region.longitude) <= region.longitudeDelta * 0.45);
}

function midpoint(values: number[]) {
  return (Math.min(...values) + Math.max(...values)) / 2;
}

function spread(values: number[]) {
  if (values.length < 2) return 0;
  return Math.max(...values) - Math.min(...values);
}

const styles = StyleSheet.create({
  // Owner item M: the readings line sits inside the map card, on its own small plate.
  insideCaption: { position: "absolute", left: 10, bottom: 8, marginTop: 0, overflow: "hidden", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  fallback: { borderRadius: 16, minHeight: 140, padding: 18, justifyContent: "center", gap: 8 },
  fallbackText: { fontSize: 14, lineHeight: 20 },
  map: { width: "100%", height: 280, borderRadius: 16 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  legendText: { fontSize: 12, lineHeight: 18 },
  routeCaption: { fontSize: 12, lineHeight: 18, marginTop: 10 },
  summary: { fontSize: 14, lineHeight: 20, marginTop: 12 }
});
