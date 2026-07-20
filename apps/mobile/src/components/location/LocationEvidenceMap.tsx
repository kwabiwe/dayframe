import { StyleSheet, Text, View } from "react-native";
import MapView, { Circle, Marker, Polyline, type MapPressEvent } from "react-native-maps";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";

type Props = {
  evidence: LocationReviewEvidenceDto;
  accentColor: string;
  surfaceColor: string;
  textColor: string;
  dangerColor: string;
  selectedPoint?: { latitude: number; longitude: number } | null;
  selectedPointRadiusMeters?: number;
  selectedSavedPlaceId?: string | null;
  onSelectPoint?: (point: { latitude: number; longitude: number }) => void;
  onSelectSavedPlace?: (placeId: string) => void;
};

export function LocationEvidenceMap({
  evidence,
  accentColor,
  surfaceColor,
  textColor,
  dangerColor,
  selectedPoint,
  selectedPointRadiusMeters,
  selectedSavedPlaceId,
  onSelectPoint,
  onSelectSavedPlace
}: Props) {
  const samples = evidence.map.acceptedSamples;
  const coordinates = [
    ...samples.map((sample) => ({
      latitude: sample.point.coordinates[1],
      longitude: sample.point.coordinates[0]
    })),
    ...evidence.map.nearbySavedPlaces.map((place) => ({
      latitude: place.point.coordinates[1],
      longitude: place.point.coordinates[0]
    })),
    ...(evidence.map.straightLineFallback?.coordinates.map(([longitude, latitude]) => ({ latitude, longitude })) ?? []),
    ...evidence.map.rejectedSamples.flatMap((sample) => sample.point
      ? [{ latitude: sample.point.coordinates[1], longitude: sample.point.coordinates[0] }]
      : [])
  ];
  const centre = evidence.map.centre
    ? {
        latitude: evidence.map.centre.coordinates[1],
        longitude: evidence.map.centre.coordinates[0]
      }
    : coordinates[0];

  if (!centre) {
    return (
      <View style={[styles.fallback, { backgroundColor: surfaceColor }]}>
        <Text style={[styles.fallbackText, { color: textColor }]}>{evidence.textualSummary}</Text>
        <Text style={[styles.fallbackText, { color: textColor }]}>Mapped evidence has expired or is unavailable.</Text>
      </View>
    );
  }

  const latitudeDelta = Math.max(0.004, spread(coordinates.map((point) => point.latitude)) * 1.6);
  const longitudeDelta = Math.max(0.004, spread(coordinates.map((point) => point.longitude)) * 1.6);
  const route = evidence.map.route?.coordinates.map(([longitude, latitude]) => ({ latitude, longitude })) ?? [];
  const straightLineFallback = evidence.map.straightLineFallback?.coordinates
    .map(([longitude, latitude]) => ({ latitude, longitude })) ?? [];
  const handlePress = (event: MapPressEvent) => onSelectPoint?.(event.nativeEvent.coordinate);

  return (
    <View>
      <MapView
        accessibilityLabel={`Location evidence map. ${evidence.textualSummary}`}
        initialRegion={{ ...centre, latitudeDelta, longitudeDelta }}
        onPress={onSelectPoint ? handlePress : undefined}
        pitchEnabled={false}
        rotateEnabled={false}
        style={styles.map}
      >
        {route.length >= 2 ? <Polyline coordinates={route} strokeColor={accentColor} strokeWidth={4} /> : null}
        {straightLineFallback.length >= 2 ? (
          <Polyline
            coordinates={straightLineFallback}
            lineDashPattern={[8, 6]}
            strokeColor={textColor}
            strokeWidth={3}
          />
        ) : null}
        {evidence.map.gaps.map((gap) => gap.fromPoint && gap.toPoint ? (
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
        ) : null)}
        {evidence.map.stayRadiusMeters && evidence.map.centre ? (
          <Circle
            center={centre}
            fillColor={`${accentColor}24`}
            radius={evidence.map.stayRadiusMeters}
            strokeColor={accentColor}
            strokeWidth={2}
          />
        ) : null}
        {samples.map((sample) => (
          <Circle
            key={sample.id}
            center={{ latitude: sample.point.coordinates[1], longitude: sample.point.coordinates[0] }}
            fillColor={`${accentColor}55`}
            radius={Math.max(4, Math.min(40, sample.accuracyMeters ?? 6))}
            strokeColor={`${accentColor}99`}
            strokeWidth={1}
          />
        ))}
        {evidence.map.rejectedSamples.map((sample) => sample.point ? (
          <Circle
            key={`rejected-${sample.id}`}
            center={{ latitude: sample.point.coordinates[1], longitude: sample.point.coordinates[0] }}
            fillColor={`${dangerColor}33`}
            radius={8}
            strokeColor={dangerColor}
            strokeWidth={2}
          />
        ) : null)}
        {evidence.map.anchors.map((anchor) => anchor.point ? (
          <Marker
            key={anchor.id}
            coordinate={{ latitude: anchor.point.coordinates[1], longitude: anchor.point.coordinates[0] }}
            pinColor={accentColor}
            title={anchor.label}
          />
        ) : null)}
        {evidence.map.nearbySavedPlaces.map((place) => (
          <Circle
            key={`${place.id}-radius`}
            center={{ latitude: place.point.coordinates[1], longitude: place.point.coordinates[0] }}
            fillColor={place.id === selectedSavedPlaceId ? `${accentColor}2e` : `${textColor}12`}
            radius={place.radiusMeters}
            strokeColor={place.id === selectedSavedPlaceId ? accentColor : textColor}
            strokeWidth={place.id === selectedSavedPlaceId ? 3 : 1}
          />
        ))}
        {evidence.map.nearbySavedPlaces.map((place) => (
          <Marker
            key={place.id}
            accessibilityLabel={`${place.name}, ${place.distanceMeters} metres from the detected centre`}
            coordinate={{ latitude: place.point.coordinates[1], longitude: place.point.coordinates[0] }}
            description={`${place.distanceMeters} metres away · ${place.radiusMeters} metre radius`}
            onPress={() => onSelectSavedPlace?.(place.id)}
            pinColor={place.id === selectedSavedPlaceId ? accentColor : undefined}
            title={place.name}
          />
        ))}
        {selectedPoint && selectedPointRadiusMeters ? (
          <Circle
            center={selectedPoint}
            fillColor={`${accentColor}24`}
            radius={selectedPointRadiusMeters}
            strokeColor={accentColor}
            strokeWidth={2}
          />
        ) : null}
        {selectedPoint ? <Marker coordinate={selectedPoint} pinColor={accentColor} title="Proposed saved-place centre" /> : null}
      </MapView>
      <View accessible accessibilityLabel="Map legend: solid coral is accepted evidence, outlined circles are saved places, and dashed lines are evidence gaps." style={styles.legend}>
        <Text style={[styles.legendText, { color: textColor }]}>Solid route · accepted evidence</Text>
        <Text style={[styles.legendText, { color: textColor }]}>Outlined area · saved place</Text>
        <Text style={[styles.legendText, { color: textColor }]}>Dashed line · evidence gap</Text>
      </View>
      <Text style={[styles.summary, { color: textColor }]}>{evidence.textualSummary}</Text>
      {evidence.map.rejectedSamples.length ? (
        <Text style={[styles.legendText, { color: textColor }]}>Excluded noisy or invalid samples: {evidence.map.rejectedSamples.length}</Text>
      ) : null}
    </View>
  );
}

function spread(values: number[]) {
  if (values.length < 2) return 0;
  return Math.max(...values) - Math.min(...values);
}

const styles = StyleSheet.create({
  fallback: { borderRadius: 16, minHeight: 140, padding: 18, justifyContent: "center", gap: 8 },
  fallbackText: { fontSize: 14, lineHeight: 20 },
  map: { width: "100%", height: 280, borderRadius: 16 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  legendText: { fontSize: 12, lineHeight: 18 },
  summary: { fontSize: 14, lineHeight: 20, marginTop: 12 }
});
