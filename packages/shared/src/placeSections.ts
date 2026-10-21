import { placeDisplayName, type PlaceRole } from "./placeRoles";

// Places search, sections and last visit (location v3 PR 16c, design §11.1), shared by the
// Places screens on web and iPhone. A short list stays one list; from PLACE_SECTIONS_MIN_PLACES
// saved places the screen adds search and two shortlists above All (A–Z): Frequent (most visits
// in the last 30 days) and Recent (by last visit). Home and Work have their own slots above, so
// the shortlists leave them out; All lists every place.

export const PLACE_SECTIONS_MIN_PLACES = 9;
export const PLACE_SHORTLIST_SIZE = 5;
/** One visit is not a habit: Frequent needs at least this many visits in 30 days. */
export const PLACE_FREQUENT_MIN_VISITS = 2;

/** The person's visits to one saved place, from their current stays there (server read). */
export type PlaceVisitStats = {
  placeId: string;
  /** When the latest stay at the place ended (or started, while it is still open). */
  lastVisitAt: string | null;
  /** Stays at the place that started in the last 30 days. */
  visitsLast30Days: number;
};

type ListPlace = { id: string; name: string; role?: PlaceRole | null };

export type PlaceListSectionKey = "results" | "frequent" | "recent" | "all";

export type PlaceListSection<T> = { key: PlaceListSectionKey; title: string; places: T[] };

export type PlaceListLayout<T> = {
  /** Whether the screen offers search (it does from PLACE_SECTIONS_MIN_PLACES places). */
  searchable: boolean;
  /** Sections in order, never empty ones (no places at all gives no sections). */
  sections: PlaceListSection<T>[];
};

const collator = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/** Lower case without accents, so "cafe" finds "Café". */
export function normalisePlaceSearch(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Whether a place's shown name or its saved name contains the search text. */
export function placeMatchesSearch(place: ListPlace, search: string) {
  const needle = normalisePlaceSearch(search);
  if (!needle) return true;
  return [placeDisplayName({ name: place.name, role: place.role ?? null }), place.name]
    .some((name) => normalisePlaceSearch(name).includes(needle));
}

/** A–Z by the name the interface shows. */
export function comparePlacesByName(a: ListPlace, b: ListPlace) {
  return collator.compare(placeDisplayName({ name: a.name, role: a.role ?? null }), placeDisplayName({ name: b.name, role: b.role ?? null }))
    || a.id.localeCompare(b.id);
}

/**
 * Lay out Places: one list, or (from PLACE_SECTIONS_MIN_PLACES places) Frequent, Recent and All.
 * A search replaces the sections with one Results list: names that start with the text first,
 * then the rest, each A–Z. `visits` may lack a place (no visits, or not read yet).
 */
export function placeListLayout<T extends ListPlace>(
  places: readonly T[],
  visits: ReadonlyMap<string, PlaceVisitStats>,
  search = ""
): PlaceListLayout<T> {
  const searchable = places.length >= PLACE_SECTIONS_MIN_PLACES;
  const needle = searchable ? normalisePlaceSearch(search) : "";
  if (needle) {
    const startsWith = (place: T) =>
      [placeDisplayName({ name: place.name, role: place.role ?? null }), place.name]
        .some((name) => normalisePlaceSearch(name).startsWith(needle));
    const matches = places.filter((place) => placeMatchesSearch(place, needle))
      .sort((a, b) => Number(startsWith(b)) - Number(startsWith(a)) || comparePlacesByName(a, b));
    return { searchable, sections: matches.length ? [{ key: "results", title: "Results", places: matches }] : [] };
  }
  const all = [...places].sort(comparePlacesByName);
  if (!all.length) return { searchable, sections: [] };
  if (!searchable) return { searchable, sections: [{ key: "all", title: "Your places", places: all }] };

  const shortlistable = all.filter((place) => !place.role);
  const visitCount = (place: T) => visits.get(place.id)?.visitsLast30Days ?? 0;
  const lastVisit = (place: T) => visitTime(visits.get(place.id)?.lastVisitAt);
  const frequent = shortlistable
    .filter((place) => visitCount(place) >= PLACE_FREQUENT_MIN_VISITS)
    .sort((a, b) => visitCount(b) - visitCount(a) || lastVisit(b) - lastVisit(a) || comparePlacesByName(a, b))
    .slice(0, PLACE_SHORTLIST_SIZE);
  const inFrequent = new Set(frequent.map((place) => place.id));
  const recent = shortlistable
    .filter((place) => !inFrequent.has(place.id) && lastVisit(place) > Number.NEGATIVE_INFINITY)
    .sort((a, b) => lastVisit(b) - lastVisit(a) || comparePlacesByName(a, b))
    .slice(0, PLACE_SHORTLIST_SIZE);
  const sections: PlaceListSection<T>[] = [];
  if (frequent.length) sections.push({ key: "frequent", title: "Frequent", places: frequent });
  if (recent.length) sections.push({ key: "recent", title: "Recent", places: recent });
  sections.push({ key: "all", title: "All places", places: all });
  return { searchable, sections };
}

function visitTime(value: string | null | undefined) {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/** Index visit stats by place id. */
export function placeVisitsById(rows: readonly PlaceVisitStats[] | null | undefined) {
  return new Map((rows ?? []).map((row) => [row.placeId, row]));
}

/**
 * "Last visit today", "Last visit yesterday", "Last visit Monday" (within the past week),
 * "Last visit 14 Oct", or with the year when it isn't this year; null without a visit.
 * Days follow `timeZone` (the device's own when omitted).
 */
export function placeLastVisitLabel(lastVisitAt: string | null | undefined, now: Date, timeZone?: string | null) {
  const time = visitTime(lastVisitAt);
  if (time === Number.NEGATIVE_INFINITY) return null;
  const at = new Date(Math.min(time, now.getTime()));
  const zone = timeZone || undefined;
  const days = dayNumber(now, zone) - dayNumber(at, zone);
  if (days <= 0) return "Last visit today";
  if (days === 1) return "Last visit yesterday";
  if (days < 7) return `Last visit ${new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: zone }).format(at)}`;
  const sameYear = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: zone }).format(at)
    === new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: zone }).format(now);
  const date = new Intl.DateTimeFormat("en-GB", sameYear
    ? { day: "numeric", month: "short", timeZone: zone }
    : { day: "numeric", month: "short", year: "numeric", timeZone: zone }).format(at);
  return `Last visit ${date}`;
}

/** "3 visits in 30 days"; null under two (Frequent's own threshold). */
export function placeRecentVisitsLabel(stats: PlaceVisitStats | undefined) {
  const count = stats?.visitsLast30Days ?? 0;
  return count >= PLACE_FREQUENT_MIN_VISITS ? `${count} visits in 30 days` : null;
}

/** Days since the epoch of the calendar date `date` falls on in `timeZone`. */
function dayNumber(date: Date, timeZone: string | undefined) {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Math.round(Date.UTC(value("year"), value("month") - 1, value("day")) / 86_400_000);
}
