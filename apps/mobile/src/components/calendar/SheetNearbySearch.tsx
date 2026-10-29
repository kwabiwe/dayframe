import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { DAYFRAME_APP_ICONS } from "@dayframe/shared";
import { DayframeIcon } from "../icons/DayframeIcon";
import {
  createNativeNearbyPointOfInterestProvider,
  createNativePlaceSearchProvider,
  NearbyPointOfInterestController,
  PlaceSearchController,
  type NearbyPointOfInterestState,
  type PlaceSearchState
} from "../../lib/placeSearch";
import { formatPlaceDistance } from "../../lib/placeCategories";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";

/**
 * Step 15 (the place sheet takes over the Review details screen): under the map, the Apple
 * places nearby and a search, as the details screen had. Picking one names the visit: the sheet then offers to
 * save it under that name ("Save this place"), so a name is never a rule until you save it. The visit's centre
 * goes to MapKit only, on this iPhone; it is never logged or kept.
 */
export function SheetNearbySearch({ centre, onPick, theme }: {
  centre: { latitude: number; longitude: number } | null;
  onPick: (name: string) => void;
  theme: MobileTheme;
}) {
  const nearbyProvider = useMemo(() => createNativeNearbyPointOfInterestProvider(), []);
  const searchProvider = useMemo(() => createNativePlaceSearchProvider(), []);
  const [nearby, setNearby] = useState<NearbyPointOfInterestState | null>(null);
  const [search, setSearch] = useState<PlaceSearchState | null>(null);
  const [query, setQuery] = useState("");
  const [searchController, setSearchController] = useState<PlaceSearchController | null>(null);
  const latitude = centre?.latitude ?? null;
  const longitude = centre?.longitude ?? null;
  useEffect(() => {
    if (!nearbyProvider || latitude === null || longitude === null) return;
    const controller = new NearbyPointOfInterestController(nearbyProvider, setNearby);
    void controller.load({ latitude, longitude });
    return () => controller.dispose();
  }, [latitude, longitude, nearbyProvider]);
  useEffect(() => {
    if (!searchProvider) return;
    const controller = new PlaceSearchController(searchProvider, setSearch);
    setSearchController(controller);
    return () => controller.dispose();
  }, [searchProvider]);
  if (!nearbyProvider && !searchProvider) {
    return <Text {...mobileTextProps("metadata")} style={[styles.note, { color: theme.textSecondary }]}>Nearby places need Apple Maps on this iPhone.</Text>;
  }
  const typed = query.trim().length > 0;
  const rows = typed
    ? (search?.suggestions ?? []).slice(0, 6).map((suggestion) => ({ key: suggestion.id, title: suggestion.title, detail: suggestion.subtitle }))
    : (nearby?.places ?? []).slice(0, 5).map((place) => ({ key: place.id, title: place.title, detail: formatPlaceDistance(place.distanceMeters) }));
  const status = typed ? search?.status : nearby?.status;
  return (
    <View style={styles.wrap} testID="location-correction-nearby">
      <View style={[styles.search, { backgroundColor: theme.surfaceMuted }]}>
        <DayframeIcon color={theme.textSecondary} glyph="search" size={16} />
        <TextInput accessibilityLabel="Search places" onChangeText={(text) => {
          setQuery(text);
          searchController?.updateQuery(text, latitude !== null && longitude !== null
            ? { latitude, longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 } : null);
        }} placeholder="Search places" placeholderTextColor={theme.textSecondary} returnKeyType="search"
          style={[styles.searchInput, { color: theme.textPrimary }]} value={query} />
      </View>
      {status === "loading" && !rows.length ? (
        <Text {...mobileTextProps("metadata")} style={[styles.note, { color: theme.textSecondary }]}>Looking nearby…</Text>
      ) : !rows.length ? (
        <Text {...mobileTextProps("metadata")} style={[styles.note, { color: theme.textSecondary }]}>{typed ? "No places match." : "No places nearby."}</Text>
      ) : rows.map((row) => (
        <Pressable accessibilityHint="Names this visit; you can then save it as a place" accessibilityLabel={[row.title, row.detail].filter(Boolean).join(", ")}
          accessibilityRole="button" key={row.key} onPress={() => onPick(row.title)}
          style={({ pressed }) => [styles.row, { borderTopColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
          <DayframeIcon color={theme.textSecondary} glyph={DAYFRAME_APP_ICONS.places} size={18} />
          <View style={styles.text}>
            <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[styles.title, { color: theme.textPrimary }]}>{row.title}</Text>
            {row.detail ? <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[styles.detail, { color: theme.textSecondary }]}>{row.detail}</Text> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, borderRadius: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, minHeight: 44, fontSize: 16 },
  note: { paddingVertical: 8, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 6 },
  text: { flex: 1, gap: 1 },
  title: { fontSize: 15, fontWeight: "650" as "600" },
  detail: { fontSize: 13 }
});
