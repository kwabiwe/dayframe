import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { DAYFRAME_APP_ICONS, type DayframeGlyph, type LocationReviewEvidenceDto } from "@dayframe/shared";
import { DayframeIcon } from "../icons/DayframeIcon";
import {
  createNativeNearbyPointOfInterestProvider,
  createNativePlaceSearchProvider,
  NearbyPointOfInterestController,
  PLACE_SEARCH_MINIMUM_QUERY_LENGTH,
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

/** Five rows, fixed (the web's rule): the sheet never jumps while typing; the list scrolls inside and stays blank below five. */
export const SHEET_RESULT_ROW_HEIGHT = 52;
export const SHEET_RESULT_ROWS = 5;
/** Apple places shown, nearby or searched (the web's three). */
export const SHEET_APPLE_ROWS = 3;

export type SheetSavedRow = { key: string; title: string; detail: string; glyph: DayframeGlyph; checked: boolean; onPress: () => void };

/**
 * Under the map, one search over one list: Apple's three nearest places, then the sheet's saved places (`savedRows`, at
 * most two within about 1 km; a search finds them by name). A tap answers: a saved place sets the visit to it; an Apple
 * place, or "Save “X” as a place" in its pinned slot, saves that name and sets the visit to it, so a name is a rule only
 * once it is saved. The list keeps one height and the old rows stay until new ones arrive, with a quiet spinner in the
 * field. The visit's centre goes to MapKit only, on this iPhone; it is never logged or kept. Ranked with the visit itself
 * (`stay`: its times, accuracy, spread and past picks), as the "?"'s guess is, so the list and the guess agree (PRD D23).
 */
export function SheetNearbySearch({ centre, disabled = false, evidence = null, onGuess, onPick, onSaveTyped, reduceMotion = false, savedRows = () => [], theme }: {
  /** The visit's centre, for Apple's places; null keeps this to the saved places. */
  centre: { latitude: number; longitude: number } | null;
  disabled?: boolean;
  /**
   * The near guess for the sheet's "?" (PRD D23): the ranker's suggestion, else its top destination within 50 m,
   * or null; said once per list, the same rule as the Calendar's own guess (`useCheckVenueGuess`). `proposal` is
   * the visit (`nearbyProposalKey`) the list was ranked for, so a guess for older times is never used (Codex r1 on #620).
   */
  onGuess?: (venue: ReviewAnswerVenue | null, proposal: string) => void;
  /** The Apple place tapped, and its Apple Place ID when it has one (a nearby place; a search suggestion has none). */
  onPick: (name: string, applePlaceId: string | null) => void;
  /** "Save “X” as a place" for the text typed; absent when this visit can't be saved. */
  onSaveTyped?: (name: string) => void;
  /** The visit's evidence: its times, accuracy, spread and past picks rank the list (`venueStayFromEvidence`). */
  evidence?: Pick<LocationReviewEvidenceDto, "segment" | "map" | "venue"> | null;
  /** Reduce Motion: the spinner holds still. */
  reduceMotion?: boolean;
  /** The saved places for this text (empty for none typed). */
  savedRows?: (text: string) => readonly SheetSavedRow[];
  theme: MobileTheme;
}) {
  // Read when the list loads, so a new render never restarts the search.
  const evidenceRef = useRef(evidence);
  evidenceRef.current = evidence;
  const hasCentre = centre !== null;
  const nearbyProvider = useMemo(() => hasCentre ? createNativeNearbyPointOfInterestProvider() : null, [hasCentre]);
  const searchProvider = useMemo(() => hasCentre ? createNativePlaceSearchProvider() : null, [hasCentre]);
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
  // Text typed before the search could start (the map still loading) is searched as soon as it can be (Codex r1 on #641).
  useEffect(() => {
    if (searchController && query.trim() && latitude !== null && longitude !== null) {
      searchController.updateQuery(query, { latitude, longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 });
    }
    // Only a new controller: each keystroke asks for itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchController]);
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
  const text = query.trim();
  const typed = text.length > 0;
  const nearbyRows: AppleRow[] = [...(nearby?.places ?? [])]
    // Apple's three nearest, as the saved places are nearest first; the guess still comes from the ranking.
    .sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, SHEET_APPLE_ROWS)
    .map((place) => ({ key: place.id, title: place.title, detail: awayFrom(place.distanceMeters), placeId: place.placeId ?? null }));
  // Waiting on Apple: a search Apple has been asked for (too short a text never is).
  const searchable = Boolean(searchProvider) && text.length >= PLACE_SEARCH_MINIMUM_QUERY_LENGTH;
  const searching = searchable && (search?.query.trim() !== text || search.status === "typing" || search.status === "loading");
  const settled: AppleRow[] | null = !typed ? nearbyRows
    : searching || (searchProvider && !searchable) ? null
      : (search?.suggestions ?? []).slice(0, SHEET_APPLE_ROWS).map((suggestion) => ({ key: suggestion.id, title: suggestion.title, detail: suggestion.subtitle ?? "", placeId: null }));
  // The last answer stays until the next one arrives, so nothing jumps while typing.
  const held = useRef<AppleRow[]>([]);
  if (settled) held.current = settled;
  const appleRows = settled ?? held.current;
  const saved = savedRows(text);
  const count = appleRows.length + saved.length;
  const note = count ? null
    : typed ? (searching ? null : "No places match.")
      : !hasCentre ? null
        : !nearbyProvider ? "Nearby places need Apple Maps on this iPhone."
          : !nearby || nearby.status === "loading" ? "Looking nearby…" : "No places nearby.";
  return (
    <View style={styles.wrap} testID="location-correction-nearby">
      <View style={[styles.search, { backgroundColor: theme.surfaceMuted }]}>
        <DayframeIcon color={theme.textSecondary} glyph="search" size={16} />
        <TextInput accessibilityLabel="Search places" editable={!disabled} onChangeText={(next) => {
          setQuery(next);
          searchController?.updateQuery(next, latitude !== null && longitude !== null
            ? { latitude, longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 } : null);
        }} placeholder="Search places" placeholderTextColor={theme.textSecondary} returnKeyType="search"
          style={[styles.searchInput, { color: theme.textPrimary }]} testID="location-correction-search" value={query} />
        {searching ? (
          <ActivityIndicator accessibilityLabel="Searching" animating={!reduceMotion} color={theme.textSecondary} hidesWhenStopped={false} size="small"
            testID="location-correction-search-spinner" />
        ) : null}
      </View>
      <View style={styles.results} testID="location-correction-results">
        <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator={false} style={styles.list}>
          {note ? <Text {...mobileTextProps("metadata")} style={[styles.note, { color: theme.textSecondary }]}>{note}</Text> : null}
          {appleRows.map((row, index) => (
            <ResultRow accessibilityHint="Saves it as a place and sets this visit to it" detail={row.detail} disabled={disabled} divided={index > 0}
              glyph={DAYFRAME_APP_ICONS.places} key={row.key} onPress={() => onPick(row.title, row.placeId)} testID={`location-correction-nearby-${row.key}`}
              theme={theme} title={row.title} />
          ))}
          {saved.map((row, index) => (
            <ResultRow checked={row.checked} detail={row.detail} disabled={disabled} divided={index > 0 || appleRows.length > 0} glyph={row.glyph} key={row.key}
              onPress={row.onPress} testID={`location-correction-place-${row.key}`} theme={theme} title={row.title} />
          ))}
        </ScrollView>
        {typed && onSaveTyped ? (
          <ResultRow disabled={disabled} divided glyph="plus" onPress={() => onSaveTyped(text)} testID="location-correction-save-typed" theme={theme}
            title={`Save “${text}” as a place`} />
        ) : null}
      </View>
    </View>
  );
}

type AppleRow = { key: string; title: string; detail: string; placeId: string | null };

/** "10 m away", the one distance wording of the sheet's rows. */
function awayFrom(meters: number) {
  const distance = formatPlaceDistance(meters);
  return distance ? `${distance} away` : "";
}

/** One row of the list, Apple's or saved alike. */
function ResultRow({ accessibilityHint, checked = false, detail, disabled, divided, glyph, onPress, testID, theme, title }: {
  accessibilityHint?: string; checked?: boolean; detail?: string; disabled: boolean; divided: boolean; glyph: DayframeGlyph; onPress: () => void;
  testID: string; theme: MobileTheme; title: string;
}) {
  return (
    <Pressable accessibilityHint={accessibilityHint} accessibilityLabel={[title, detail].filter(Boolean).join(", ")} accessibilityRole="button"
      accessibilityState={{ disabled, selected: checked }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]} testID={testID}>
      <DayframeIcon color={theme.textSecondary} glyph={glyph} size={18} />
      <View style={styles.text}>
        <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[styles.title, { color: theme.textPrimary }]}>{title}</Text>
        {detail ? <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[styles.detail, { color: theme.textSecondary }]}>{detail}</Text> : null}
      </View>
      {checked ? <DayframeIcon color={theme.textPrimary} glyph="check" size={16} /> : null}
      {divided ? <InsetDivider color={theme.border} edge="top" paddedBy="src/components/sheets/BottomSheetShell.tsx:sheet" start={30} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, borderRadius: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, minHeight: 44, fontSize: 16 },
  results: { height: SHEET_RESULT_ROW_HEIGHT * SHEET_RESULT_ROWS },
  list: { flex: 1 },
  note: { paddingVertical: 8, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: SHEET_RESULT_ROW_HEIGHT, paddingVertical: 6 },
  text: { flex: 1, gap: 1 },
  title: { fontSize: 15, fontWeight: "650" as "600" },
  detail: { fontSize: 13 }
});
