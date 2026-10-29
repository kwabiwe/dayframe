import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { DAYFRAME_APP_ICONS, type LocationReviewEvidenceDto } from "@dayframe/shared";
import { DayframeIcon } from "../icons/DayframeIcon";
import {
  createNativeNearbyPointOfInterestProvider,
  createNativePlaceSearchProvider,
  NearbyPointOfInterestController,
  PlaceSearchController,
  venueStayFromEvidence,
  type NearbyPointOfInterestState,
  type PlaceSearchState
} from "../../lib/placeSearch";
import { formatPlaceDistance } from "../../lib/placeCategories";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { InsetDivider } from "../InsetDivider";
import type { ReviewAnswerVenue } from "../../lib/reviewAnswer";
import { streetOf } from "./useCheckVenueGuess";
import { nearbyProposalKey } from "../../lib/nearbyProposal";

/**
 * Step 15 (the place sheet takes over the Review details screen): under the map, the Apple
 * places nearby and a search, as the details screen had. Picking one names the visit: the sheet then offers to
 * save it under that name ("Save this place"), so a name is never a rule until you save it. The visit's centre
 * goes to MapKit only, on this iPhone; it is never logged or kept. Ranked with the visit itself (`stay`: its
 * times, accuracy, spread and past picks), as the "?"'s guess is, so the list and the guess agree (PRD D23).
 */
export function SheetNearbySearch({ centre, evidence = null, onGuess, onPick, theme }: {
  centre: { latitude: number; longitude: number } | null;
  /**
   * The near guess for the sheet's "?" (PRD D23): the ranker's suggestion, else its top destination within 50 m,
   * or null; said once per list, the same rule as the Calendar's own guess (`useCheckVenueGuess`). `proposal` is
   * the visit (`nearbyProposalKey`) the list was ranked for, so a guess for older times is never used (Codex r1 on #620).
   */
  onGuess?: (venue: ReviewAnswerVenue | null, proposal: string) => void;
  /** The name picked, and its Apple Place ID when it has one (a nearby place; a search suggestion has none). */
  onPick: (name: string, applePlaceId: string | null) => void;
  /** The visit's evidence: its times, accuracy, spread and past picks rank the list (`venueStayFromEvidence`). */
  evidence?: Pick<LocationReviewEvidenceDto, "segment" | "map" | "venue"> | null;
  theme: MobileTheme;
}) {
  // Read when the list loads, so a new render never restarts the search.
  const evidenceRef = useRef(evidence);
  evidenceRef.current = evidence;
  const nearbyProvider = useMemo(() => createNativeNearbyPointOfInterestProvider(), []);
  const searchProvider = useMemo(() => createNativePlaceSearchProvider(), []);
  // The list with the visit it was ranked for: new times or a new centre rank it again (Codex r1 on #620).
  const proposal = nearbyProposalKey(centre, evidence ?? null);
  const [ranked, setRanked] = useState<{ proposal: string; state: NearbyPointOfInterestState } | null>(null);
  const nearby = ranked && ranked.proposal === proposal ? ranked.state : null;
  const [search, setSearch] = useState<PlaceSearchState | null>(null);
  const [query, setQuery] = useState("");
  const [searchController, setSearchController] = useState<PlaceSearchController | null>(null);
  const latitude = centre?.latitude ?? null;
  const longitude = centre?.longitude ?? null;
  useEffect(() => {
    if (!nearbyProvider || latitude === null || longitude === null) return;
    const forProposal = proposal;
    const controller = new NearbyPointOfInterestController(nearbyProvider, (state) => setRanked({ proposal: forProposal, state }), () => [],
      () => evidenceRef.current ? venueStayFromEvidence(evidenceRef.current) : null);
    void controller.load({ latitude, longitude });
    return () => controller.dispose();
  }, [latitude, longitude, nearbyProvider, proposal]);
  useEffect(() => {
    if (!searchProvider) return;
    const controller = new PlaceSearchController(searchProvider, setSearch);
    setSearchController(controller);
    return () => controller.dispose();
  }, [searchProvider]);
  // The ranking's own pick, not the visible rows (Codex r1 on #620).
  const guessed = nearby?.status === "results" || nearby?.status === "no-results" ? nearby.guess ?? null : null;
  const onGuessRef = useRef(onGuess);
  onGuessRef.current = onGuess;
  const guessKey = `${proposal}#${guessed ? `${nearby?.requestId}:${guessed.id}` : ""}`;
  useEffect(() => {
    onGuessRef.current?.(guessed ? { name: guessed.title.trim(), street: streetOf(guessed.subtitle), applePlaceId: guessed.placeId ?? null } : null,
      proposal);
    // One report per list, pick and visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guessKey]);
  if (!nearbyProvider && !searchProvider) {
    return <Text {...mobileTextProps("metadata")} style={[styles.note, { color: theme.textSecondary }]}>Nearby places need Apple Maps on this iPhone.</Text>;
  }
  const typed = query.trim().length > 0;
  const rows = typed
    ? (search?.suggestions ?? []).slice(0, 6).map((suggestion) => ({ key: suggestion.id, title: suggestion.title, detail: suggestion.subtitle, placeId: null }))
    // Nearest first, as the saved places are (owner, 29 Oct 2026); the guess still comes from the ranking.
    : [...(nearby?.places ?? []).slice(0, 5)].sort((a, b) => a.distanceMeters - b.distanceMeters).map((place) => ({ key: place.id,
      title: place.title, detail: formatPlaceDistance(place.distanceMeters), placeId: place.placeId ?? null }));
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
          accessibilityRole="button" key={row.key} onPress={() => onPick(row.title, row.placeId)}
          style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
          <DayframeIcon color={theme.textSecondary} glyph={DAYFRAME_APP_ICONS.places} size={18} />
          <View style={styles.text}>
            <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[styles.title, { color: theme.textPrimary }]}>{row.title}</Text>
            {row.detail ? <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[styles.detail, { color: theme.textSecondary }]}>{row.detail}</Text> : null}
          </View>
          <InsetDivider color={theme.border} edge="top" paddedBy="src/components/sheets/BottomSheetShell.tsx:sheet" start={30} />
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
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 6 },
  text: { flex: 1, gap: 1 },
  title: { fontSize: 15, fontWeight: "650" as "600" },
  detail: { fontSize: 13 }
});
