import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
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
import { MOBILE_TEXT_CAP, mobileTextProps } from "../../lib/mobileTypography";
import { InsetDivider } from "../InsetDivider";
import type { ReviewAnswerVenue } from "../../lib/reviewAnswer";
import { streetOf } from "./useCheckVenueGuess";
import { nearbyProposalKey } from "../../lib/nearbyProposal";

/** Reserve enough room for Nearby and two saved choices, and scroll when there are more. */
export const SHEET_RESULT_ROW_HEIGHT = 52;
export const SHEET_RESULT_ROWS = 5;
/** Apple places shown, nearby or searched (the web's three). */
export const SHEET_APPLE_ROWS = 3;
/** The list's least height: a result and "Save “X” as a place". */
export const SHEET_RESULT_MIN_ROWS = 2;
const ROW_PADDING = 6;
const TITLE_LINE = 18;
const DETAIL_LINE = 16;

export type SheetSavedRow = { key: string; title: string; detail: string; glyph: DayframeGlyph; checked: boolean; onPress: () => void };

/**
 * Under the map, one search over one list: Apple's three nearest places, then the sheet's saved places (`savedRows`, at
 * most two within about 1 km; a search lists the saved places it finds first, then Apple's). A tap answers: a saved place
 * sets the visit to it; an Apple place, or "Save “X” as a place" in its pinned slot, saves that name and sets the visit
 * to it, so a name is a rule only once it is saved. The near guess is ticked and a tap on it is Yes. Placeholder rows
 * hold the Nearby slots while Apple answers. Results scroll inside a viewport sized at presentation; the old rows stay until new ones
 * arrive, with a quiet spinner in the field. The visit's centre goes to MapKit only, on this iPhone; it is never logged or kept. Ranked with the visit itself
 * (`stay`: its times, accuracy, spread and past picks), as the "?"'s guess is, so the list and the guess agree (PRD D23).
 */
export function SheetNearbySearch({ awaitingCentre = false, centre, disabled = false, evidence = null, excludeSavedMatches = false, guess = null, onGuess, onGuessPick, onPick, onSaveTyped, reduceMotion = false, savedRows = () => [], theme }: {
  /** The visit's centre is still loading, and Apple will be asked once it arrives. */
  awaitingCentre?: boolean;
  /** The visit's centre, for Apple's places; null keeps this to the saved places. */
  centre: { latitude: number; longitude: number } | null;
  disabled?: boolean;
  /** Skip duplicate Apple and typed rows when the visit already offers the same saved place. */
  excludeSavedMatches?: boolean;
  /**
   * The near guess for the sheet's "?" (PRD D23): the ranker's suggestion, else its top destination within 50 m,
   * or null; said once per list, the same rule as the Calendar's own guess (`useCheckVenueGuess`). `proposal` is
   * the visit (`nearbyProposalKey`) the list was ranked for, so a guess for older times is never used (Codex r1 on #620).
   */
  onGuess?: (venue: ReviewAnswerVenue | null, proposal: string) => void;
  /** The sheet's near guess: its row is ticked, and always among the rows. */
  guess?: ReviewAnswerVenue | null;
  /** A tap on the guess's row: Yes. */
  onGuessPick?: () => void;
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
  const [reserveNearby] = useState(() => awaitingCentre || hasCentre || guess !== null || onSaveTyped !== undefined);
  const { fontScale } = useWindowDimensions();
  // Each one-line title and detail scales with its existing text cap. Round separately so the
  // reserved Nearby slots and the actual rows fit the same geometry at larger text sizes.
  const rowHeight = Math.max(SHEET_RESULT_ROW_HEIGHT, ROW_PADDING * 2 + 1
    + Math.ceil(TITLE_LINE * Math.min(fontScale, MOBILE_TEXT_CAP.itemTitle))
    + Math.ceil(DETAIL_LINE * Math.min(fontScale, MOBILE_TEXT_CAP.metadata)));
  const viewportRows = reserveNearby ? SHEET_RESULT_ROWS : SHEET_RESULT_MIN_ROWS;
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
  const saved = savedRows(text);
  const savedNames = new Set(excludeSavedMatches ? saved.map(({ title }) => title.trim().toLowerCase()) : []);
  const alreadySaved = (name: string) => savedNames.has(name.trim().toLowerCase());
  // Apple's three nearest, as the saved places are nearest first. The guess comes from the ranking, so it may be
  // further out, or the caller's own: it takes the last row, as itself if the list doesn't have it yet.
  const nearest = (nearby?.places ?? []).filter((place) => !alreadySaved(place.title)).sort((a, b) => a.distanceMeters - b.distanceMeters);
  const isGuess = (place: { title: string; placeId?: string | null }) => Boolean(guess)
    && (guess!.applePlaceId ? place.placeId === guess!.applePlaceId : place.title.trim() === guess!.name);
  const guessPlace = nearest.find(isGuess);
  const nearbyRows: AppleRow[] = (guess && !nearest.slice(0, SHEET_APPLE_ROWS).some(isGuess)
    ? [...nearest.slice(0, SHEET_APPLE_ROWS - 1), ...(guessPlace ? [guessPlace] : [])] : nearest.slice(0, SHEET_APPLE_ROWS))
    .map((place) => ({ key: place.id, title: place.title, detail: awayFrom(place.distanceMeters), placeId: place.placeId ?? null, guessed: isGuess(place) }));
  if (guess && !guessPlace) nearbyRows.push({ key: "guess", title: guess.name, detail: guess.street ?? "", placeId: guess.applePlaceId ?? null, guessed: true });
  // Waiting on Apple: a search Apple has been asked for (too short a text never is).
  const searchable = Boolean(searchProvider) && text.length >= PLACE_SEARCH_MINIMUM_QUERY_LENGTH;
  const searching = searchable && (search?.query.trim() !== text || search.status === "typing" || search.status === "loading");
  const settled: AppleRow[] | null = !typed ? nearbyRows
    : searching || (searchProvider && !searchable) ? null
      : (search?.suggestions ?? []).filter((suggestion) => !alreadySaved(suggestion.title)).slice(0, SHEET_APPLE_ROWS).map((suggestion) => ({ key: suggestion.id, title: suggestion.title, detail: suggestion.subtitle ?? "", placeId: null, guessed: false }));
  // The last answer stays until the next one arrives, so nothing jumps while typing.
  const held = useRef<AppleRow[]>([]);
  if (settled) held.current = settled;
  // Ticked by the guess as of now: a held row's own flag could answer for a place it no longer stands for.
  const appleRows = (settled ?? held.current).filter((row) => !alreadySaved(row.title)).map((row) => ({ ...row, guessed: isGuess(row) }));
  const loading = !typed && (awaitingCentre || (Boolean(nearbyProvider) && (!nearby || nearby.status === "loading")));
  const note = appleRows.length || loading ? null
    : typed ? (saved.length || searching ? null : "No places match.")
      : !hasCentre ? (reserveNearby ? "Nearby places are unavailable." : null)
        : !nearbyProvider ? "Nearby places need Apple Maps on this iPhone."
          : nearby?.status === "error" ? "Nearby places couldn't load." : "No places nearby.";
  const placeholders = loading ? Math.max(0, SHEET_APPLE_ROWS - appleRows.length) : 0;
  const appleList = appleRows.map((row, index) => (
    <ResultRow accessibilityHint={row.guessed ? "Says yes to this place" : "Saves it as a place and sets this visit to it"} checked={row.guessed} detail={row.detail}
      disabled={disabled} divided={index > 0 || (typed && saved.length > 0)} glyph={DAYFRAME_APP_ICONS.places} key={row.key}
      onPress={() => row.guessed && onGuessPick ? onGuessPick() : onPick(row.title, row.placeId)} testID={`location-correction-nearby-${row.key}`}
      rowHeight={rowHeight} theme={theme} title={row.title} />
  ));
  const savedList = saved.map((row, index) => (
    <ResultRow checked={row.checked} detail={row.detail} disabled={disabled} divided={index > 0 || (!typed && appleRows.length > 0)} glyph={row.glyph} key={row.key}
      onPress={row.onPress} rowHeight={rowHeight} testID={`location-correction-place-${row.key}`} theme={theme} title={row.title} />
  ));
  return (
    <View style={styles.wrap} testID="location-correction-nearby">
      <View style={[styles.search, { backgroundColor: theme.surfaceMuted }]}>
        <DayframeIcon color={theme.textSecondary} glyph="search" size={16} />
        {/* VoiceOver already reads the placeholder when the field is empty. */}
        <TextInput accessibilityLabel={query.length > 0 ? "Search places" : undefined} editable={!disabled} onChangeText={(next) => {
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
      <View style={{ height: viewportRows * rowHeight }} testID="location-correction-results">
        <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={styles.list}>
          {typed ? savedList : null}
          <View style={!typed && reserveNearby ? { minHeight: SHEET_APPLE_ROWS * rowHeight } : undefined}
            testID="location-correction-apple-results">
            {note ? <Text {...mobileTextProps("metadata")} style={[styles.note, { color: theme.textSecondary }]}>{note}</Text> : null}
            {appleList}
            {Array.from({ length: placeholders }, (_, index) => <PlaceholderRow key={index} rowHeight={rowHeight} theme={theme} />)}
          </View>
          {!typed ? savedList : null}
        </ScrollView>
        {typed && onSaveTyped && !alreadySaved(text) ? (
          <ResultRow disabled={disabled} divided glyph="plus" onPress={() => onSaveTyped(text)} rowHeight={rowHeight} testID="location-correction-save-typed" theme={theme}
            title={`Save “${text}” as a place`} />
        ) : null}
      </View>
    </View>
  );
}

type AppleRow = { key: string; title: string; detail: string; placeId: string | null; guessed: boolean };

/** A row still to come: quiet and still, the row's own size, hidden from VoiceOver. */
function PlaceholderRow({ rowHeight, theme }: { rowHeight: number; theme: MobileTheme }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.row, { minHeight: rowHeight }]} testID="location-correction-placeholder">
      <View style={[styles.placeholderGlyph, { backgroundColor: theme.surfaceMuted }]} />
      <View style={styles.text}>
        <View style={[styles.placeholderTitle, { backgroundColor: theme.surfaceMuted }]} />
        <View style={[styles.placeholderDetail, { backgroundColor: theme.surfaceMuted }]} />
      </View>
    </View>
  );
}

/** "10 m away", the one distance wording of the sheet's rows. */
function awayFrom(meters: number) {
  const distance = formatPlaceDistance(meters);
  return distance ? `${distance} away` : "";
}

/** One row of the list, Apple's or saved alike. */
function ResultRow({ accessibilityHint, checked = false, detail, disabled, divided, glyph, onPress, rowHeight, testID, theme, title }: {
  accessibilityHint?: string; checked?: boolean; detail?: string; disabled: boolean; divided: boolean; glyph: DayframeGlyph; onPress: () => void;
  rowHeight: number; testID: string; theme: MobileTheme; title: string;
}) {
  return (
    <Pressable accessibilityHint={accessibilityHint} accessibilityLabel={[title, detail].filter(Boolean).join(", ")} accessibilityRole="button"
      accessibilityState={{ disabled, selected: checked }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.row, { minHeight: rowHeight, opacity: pressed ? 0.7 : 1 }]} testID={testID}>
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
  list: { flex: 1 },
  note: { paddingVertical: 8, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: ROW_PADDING },
  text: { flex: 1, gap: 1 },
  placeholderGlyph: { width: 18, height: 18, borderRadius: 9 },
  placeholderTitle: { width: "55%", height: 12, borderRadius: 6, marginBottom: 6 },
  placeholderDetail: { width: "30%", height: 10, borderRadius: 5 },
  title: { fontSize: 15, lineHeight: TITLE_LINE, fontWeight: "650" as "600" },
  detail: { fontSize: 13, lineHeight: DETAIL_LINE }
});
