// Venue resolver v2 (location v3 PR 7, design §6): ranks the Apple places around an unknown Stay
// so the place you were at, at the scale you'd say it ("the supermarket", "the shopping centre",
// "school"), comes first instead of the nearest shop. Runs on the iPhone over what MapKit returned
// for the stay (on iOS 27 the nearest ~50 places whatever the radius); nothing here is stored.
//
// P(venue | stay) ∝ spatial × category × dwell × time × history, with parents and children:
// a shop inside a shopping centre, or a counter inside a supermarket, rolls up to its parent and
// never outranks it. Starting values live in VENUE_KINDS (design §6.1), tuned against fixtures.

/** One nearby Apple place as the native search hands it over (no coordinates). */
export type VenueCandidate = {
  id: string;
  title: string;
  /** Apple's address line, used for "Unit 4, Northgate Shopping Centre"-style containment. */
  subtitle?: string | null;
  distanceMeters: number;
  /** Apple's category without "MKPOICategory" (e.g. "FoodMarket"); missing for 25–55% of places. */
  category?: string | null;
  /** Where the place lies from the stay's centre, in metres (east, north); absent from older builds. */
  offsetEastMeters?: number | null;
  offsetNorthMeters?: number | null;
  /** "area": found by searching for an area of interest's own name. */
  source?: "nearby" | "contextual" | "area" | null;
  /** Apple's Place ID, when iOS gives one: how "picked here before" recognises a venue. */
  placeId?: string | null;
};

export type VenueStay = {
  startedAt: string;
  /** Null while the stay is still open; `now` is its end then. */
  stoppedAt: string | null;
  now: Date;
  /** Typical accuracy of the stay's readings, in metres. */
  accuracyMeters?: number | null;
  /** How far the stay's readings spread from its centre, in metres. */
  spreadMeters?: number | null;
  /** The stay's local time zone (the phone's when omitted). */
  timeZone?: string | null;
  /** Names Apple gives the areas the stay's centre lies in (CLPlacemark.areasOfInterest). */
  areasOfInterest?: readonly string[];
  /** A venue you picked or saved near here before counts four times (design §6.1). */
  pickedBefore?: (candidate: VenueCandidate) => boolean;
};

export type VenueKind =
  | "shopping_centre" | "park" | "campus" | "hospital" | "stadium" | "school" | "station"
  | "bus_stop" | "supermarket" | "large_store" | "gym" | "activity" | "entertainment"
  | "dining" | "nightlife" | "hotel" | "religious" | "library" | "beauty" | "service"
  | "small_shop" | "petrol" | "motoring" | "parking" | "other";

type VenueKindSpec = {
  /** How far the venue reaches from its point: a stay this close counts as inside. */
  footprintMeters: number;
  /** How likely a stay is a destination of this kind at all. */
  prior: number;
  /** Typical stay, in minutes; null when the kind says nothing about length. */
  medianMinutes: number | null;
  /** Shops and counters inside it roll up to it when it covers the stay. */
  container?: boolean;
};

/** Starting values (design §6.1). Kinds without an Apple category or a name hint are "other". */
export const VENUE_KINDS: Readonly<Record<VenueKind, VenueKindSpec>> = {
  shopping_centre: { footprintMeters: 200, prior: 1, medianMinutes: 60, container: true },
  park: { footprintMeters: 150, prior: 1, medianMinutes: 45, container: true },
  campus: { footprintMeters: 150, prior: 1, medianMinutes: 120, container: true },
  hospital: { footprintMeters: 150, prior: 1, medianMinutes: 90, container: true },
  stadium: { footprintMeters: 150, prior: 0.9, medianMinutes: 150, container: true },
  station: { footprintMeters: 80, prior: 1, medianMinutes: 10, container: true },
  school: { footprintMeters: 80, prior: 1, medianMinutes: 12 },
  supermarket: { footprintMeters: 60, prior: 1, medianMinutes: 25 },
  large_store: { footprintMeters: 60, prior: 0.9, medianMinutes: 30 },
  gym: { footprintMeters: 40, prior: 1, medianMinutes: 70 },
  activity: { footprintMeters: 60, prior: 0.9, medianMinutes: 75 },
  entertainment: { footprintMeters: 60, prior: 0.7, medianMinutes: 120 },
  dining: { footprintMeters: 20, prior: 0.7, medianMinutes: 45 },
  nightlife: { footprintMeters: 20, prior: 0.7, medianMinutes: 100 },
  hotel: { footprintMeters: 40, prior: 0.6, medianMinutes: 480 },
  religious: { footprintMeters: 40, prior: 0.7, medianMinutes: 60 },
  library: { footprintMeters: 30, prior: 0.8, medianMinutes: 60 },
  beauty: { footprintMeters: 15, prior: 0.5, medianMinutes: 50 },
  service: { footprintMeters: 15, prior: 0.4, medianMinutes: 10 },
  small_shop: { footprintMeters: 15, prior: 0.5, medianMinutes: 10 },
  petrol: { footprintMeters: 25, prior: 0.2, medianMinutes: 6 },
  motoring: { footprintMeters: 25, prior: 0.3, medianMinutes: 40 },
  bus_stop: { footprintMeters: 10, prior: 0.1, medianMinutes: 5 },
  // A car park known only by its name (Apple's Parking category is dropped before ranking).
  parking: { footprintMeters: 10, prior: 0.05, medianMinutes: null },
  // No kind from Apple and no hint in the name: a neutral prior, and length says nothing.
  other: { footprintMeters: 20, prior: 0.6, medianMinutes: null }
};

/** Apple categories that are never somewhere a person spends a visit (dropped, as on the phone). */
export const VENUE_EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set(["Parking", "ATM", "EVCharger", "Restroom"]);

const CATEGORY_KINDS: Readonly<Record<string, VenueKind>> = {
  Park: "park", NationalPark: "park", Beach: "park", Campground: "park", Marina: "park",
  University: "campus", ConventionCenter: "campus", Airport: "campus",
  Hospital: "hospital", Stadium: "stadium", School: "school",
  FoodMarket: "supermarket", Store: "small_shop",
  FitnessCenter: "gym",
  AmusementPark: "activity", Bowling: "activity", GoKart: "activity", Golf: "activity", MiniGolf: "activity",
  RockClimbing: "activity", Skating: "activity", Skiing: "activity", Swimming: "activity", Tennis: "activity",
  Soccer: "activity", Baseball: "activity", Basketball: "activity", Volleyball: "activity", Hiking: "activity",
  Kayaking: "activity", Surfing: "activity", SkatePark: "activity", Playground: "activity", Fishing: "activity",
  MovieTheater: "entertainment", Theater: "entertainment", Museum: "entertainment", Aquarium: "entertainment",
  Zoo: "entertainment", MusicVenue: "entertainment", Planetarium: "entertainment", Castle: "entertainment",
  Fortress: "entertainment", Landmark: "entertainment", NationalMonument: "entertainment", FairGround: "entertainment",
  Restaurant: "dining", Cafe: "dining", Bakery: "dining", Brewery: "dining", Winery: "dining", Distillery: "dining",
  FoodTruck: "dining",
  Nightlife: "nightlife", Hotel: "hotel", ReligiousSite: "religious", Library: "library",
  Beauty: "beauty", Spa: "beauty",
  Pharmacy: "service", Bank: "service", PostOffice: "service", Laundry: "service", AnimalService: "service",
  Police: "service", FireStation: "service",
  GasStation: "petrol", AutomotiveRepair: "motoring", CarRental: "motoring", RVPark: "motoring"
};

/** "Market Street (Stop K)", "Stand 4", "Bus stop": a stop, whatever street or station it is named after. */
const STOP_MARKER = /\b(bus stop|stop [a-z0-9]{1,2}|stand [a-z0-9]{1,2}|bus shelter|bus station stop)\b/;

// Words that say what a place is when Apple gives no kind (or a vague one). Whole words only,
// most specific first ("Shell Service Station" is petrol, not a station; "Car park" is not a park).
const NAME_KINDS: readonly [RegExp, VenueKind][] = [
  [/\b(car park|parking|multi storey|multistorey)\b/, "parking"],
  [/\b(petrol|filling station|service station|services)\b/, "petrol"],
  [/\b(shopping (centre|center)|mall|retail park|outlet (centre|village)|arcade)\b/, "shopping_centre"],
  [/\b(superstore|supermarket|hypermarket|food hall)\b/, "supermarket"],
  [/\b(megastore|department store|warehouse|home centre|garden centre|retail warehouse)\b/, "large_store"],
  [STOP_MARKER, "bus_stop"],
  [/\b(railway station|train station|station|underground|interchange|metro)\b/, "station"],
  [/\b(school|academy|nursery|primary|infant|junior school)\b/, "school"],
  [/\b(university|campus|college)\b/, "campus"],
  [/\b(hospital|infirmary|medical centre)\b/, "hospital"],
  [/\b(gym|fitness|leisure centre|sports centre|swimming pool)\b/, "gym"],
  [/\b(park|gardens|common|recreation ground|playing fields)\b/, "park"],
  [/\b(cafe|café|coffee|restaurant|bakery|kitchen|bistro|pizza|diner|tea room)\b/, "dining"],
  [/\b(pub|bar|tavern|inn|club)\b/, "nightlife"],
  [/\b(pharmacy|chemist|bank|post office|launderette|dry cleaner)\b/, "service"],
  [/\b(salon|barber|barbers|hairdresser|nails|beauty|spa)\b/, "beauty"],
  [/\b(church|chapel|mosque|temple|synagogue|gurdwara|cathedral)\b/, "religious"],
  [/\b(library)\b/, "library"]
];

// A street named after a place ("Park Lane", "Station Road", "School Street") is not that place,
// so its name says nothing about its kind.
const STREET_NAME = /\b(road|rd|street|st|lane|ln|avenue|ave|way|close|drive|crescent|terrace|grove|row|walk|hill|place|square|parade|mews)$/;


/** What kind of venue a candidate is: its Apple category, refined or filled in by its name. */
export function venueKind(candidate: Pick<VenueCandidate, "title" | "category">): VenueKind {
  const words = (text: string) => searchText(text).replace(/[^\p{L}\p{N}&' ]+/gu, " ").replace(/\s+/g, " ").trim();
  const name = words(candidate.title);
  // The name without its bracketed part ("Station Road (Stop K)" → "station road").
  const base = words(candidate.title.replace(/\([^)]*\)/g, " "));
  const streetNamed = STREET_NAME.test(base);
  const fromName = STOP_MARKER.test(name)
    ? "bus_stop"
    : streetNamed && !/\b(car park|parking)\b/.test(name)
      ? null
      : NAME_KINDS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
  const fromCategory = candidate.category ? CATEGORY_KINDS[candidate.category] ?? null : null;
  if (candidate.category === "PublicTransport") {
    // Apple files bus stops and stations alike; a stop is not a destination, and neither is a
    // stop named after its street (Codex r2 on #517).
    return fromName === "station" ? "station" : "bus_stop";
  }
  // A vague Apple kind ("Store", none) gives way to a clear name ("… Superstore", "… Shopping Centre").
  if (!fromCategory || fromCategory === "small_shop") return fromName ?? fromCategory ?? "other";
  // A supermarket or shop named as a centre is the centre.
  if (fromName === "shopping_centre") return "shopping_centre";
  return fromCategory;
}

export type RankedVenue = {
  candidate: VenueCandidate;
  kind: VenueKind;
  /** Named like an area of interest the stay lies in (so it is where the stay is, however far its pin). */
  insideArea: boolean;
  /** This venue's share of the evidence, children included (0–1, top-level venues sum to 1). */
  share: number;
  /** Places inside it, most likely first (a shop in a centre, a counter in a supermarket). */
  children: VenueCandidate[];
};

export type VenueRanking = {
  /** Top-level venues, most likely first. */
  venues: RankedVenue[];
  /** The venue to suggest, or null when no venue is clear (the street is the title then). */
  suggestion: RankedVenue | null;
};

/** The top venue becomes the suggestion when it holds at least half the evidence and 1.8× the next. */
export const VENUE_SUGGESTION_MIN_SHARE = 0.5;
export const VENUE_SUGGESTION_MIN_LEAD = 1.8;
/** The "spatial" spread never narrows below this (design §6.1). */
const MIN_SIGMA_METERS = 30;
const DWELL_LOG_SPREAD = 0.8;
const DWELL_FLOOR = 0.2;
/** A place of unknown kind: its length says nothing, so a middling dwell (not a free pass). */
const UNKNOWN_KIND_DWELL = 0.7;
const CLOSED_HOURS_FACTOR = 0.4;
const HISTORY_FACTOR = 4;
/** Never the place someone went: listed after every destination and never suggested. */
const NON_DESTINATIONS: ReadonlySet<VenueKind> = new Set(["bus_stop", "parking"]);
/** Small counters that fold into a store sharing a distinctive word with them. */
const COUNTER_KINDS: ReadonlySet<VenueKind> = new Set(["service", "dining", "beauty", "small_shop"]);
const STORE_KINDS: ReadonlySet<VenueKind> = new Set(["supermarket", "large_store"]);
// Words too common to tie a counter to a store ("Bean & Bar Cafe" and "Bar Superstore").
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  "and", "the", "cafe", "café", "coffee", "bar", "shop", "store", "superstore", "supermarket", "extra", "express",
  "local", "metro", "market", "centre", "center", "shopping", "pharmacy", "bank", "post", "office", "kitchen",
  "restaurant", "bakery", "street", "road", "lane", "park", "retail", "limited", "ltd", "group", "company",
  "services", "service", "food", "foods", "store", "stores", "branch", "plus", "mini", "petrol", "station"
]);

/**
 * Rank the places around a stay. Excluded kinds and nameless rows are dropped; children are folded
 * into their parents; shares are normalised over the top-level venues.
 */
export function rankVenues(candidates: readonly VenueCandidate[], stay: VenueStay): VenueRanking {
  const usable = dedupe(candidates.filter((candidate) =>
    candidate.title.trim().length > 0 &&
    Number.isFinite(candidate.distanceMeters) && candidate.distanceMeters >= 0 &&
    !(candidate.category && VENUE_EXCLUDED_CATEGORIES.has(candidate.category))));
  if (!usable.length) return { venues: [], suggestion: null };

  const kinds = new Map(usable.map((candidate) => [candidate.id, venueKind(candidate)]));
  const areas = stay.areasOfInterest ?? [];
  // A place named like an area the stay lies in is a container that covers the stay, whatever
  // Apple calls it (a shopping centre filed as "Store"), unless it is a car park or stop named
  // after the area ("Northgate Shopping Centre Car Park", Codex r2 on #517).
  const insideArea = (candidate: VenueCandidate) =>
    !NON_DESTINATIONS.has(kinds.get(candidate.id)!) && venueNamedLikeArea(candidate.title, areas);
  for (const candidate of usable) {
    if (insideArea(candidate) && !VENUE_KINDS[kinds.get(candidate.id)!].container) kinds.set(candidate.id, "shopping_centre");
  }

  const sigma = Math.max(MIN_SIGMA_METERS, Math.hypot(finiteOrZero(stay.accuracyMeters), finiteOrZero(stay.spreadMeters)));
  const minutes = stayMinutes(stay);
  const local = localTime(stay);
  const own = new Map<string, number>();
  for (const candidate of usable) {
    const kind = kinds.get(candidate.id)!;
    const spec = VENUE_KINDS[kind];
    const covers = insideArea(candidate) || (spec.container === true && candidate.distanceMeters <= spec.footprintMeters);
    const effective = covers ? 0 : Math.max(0, candidate.distanceMeters - spec.footprintMeters);
    const spatial = Math.exp(-(effective ** 2) / (2 * sigma ** 2));
    const dwell = minutes == null
      ? 1
      : spec.medianMinutes == null
        ? UNKNOWN_KIND_DWELL
        : Math.max(DWELL_FLOOR, Math.exp(-((Math.log(Math.max(minutes, 1)) - Math.log(spec.medianMinutes)) ** 2) / (2 * DWELL_LOG_SPREAD ** 2)));
    const time = local && clearlyClosed(kind, local) ? CLOSED_HOURS_FACTOR : 1;
    const history = stay.pickedBefore?.(candidate) ? HISTORY_FACTOR : 1;
    own.set(candidate.id, spatial * spec.prior * dwell * time * history);
  }

  const parentOf = assignParents(usable, kinds, insideArea);
  const children = new Map<string, VenueCandidate[]>();
  for (const candidate of usable) {
    const parent = parentOf.get(candidate.id);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), candidate]);
  }
  const score = (candidate: VenueCandidate) =>
    own.get(candidate.id)! + (children.get(candidate.id) ?? []).reduce((sum, child) => sum + own.get(child.id)!, 0);
  const tops = usable.filter((candidate) => !parentOf.has(candidate.id));
  const total = tops.reduce((sum, candidate) => sum + score(candidate), 0);
  const venues = tops
    .map((candidate): RankedVenue => ({
      candidate,
      kind: kinds.get(candidate.id)!,
      insideArea: insideArea(candidate),
      share: total > 0 ? score(candidate) / total : 0,
      children: (children.get(candidate.id) ?? []).sort((a, b) => own.get(b.id)! - own.get(a.id)! || byDistanceThenName(a, b))
    }))
    // Destinations first (a bus stop or car park never leads, Codex r1 on #517), then by share.
    .sort((a, b) => Number(NON_DESTINATIONS.has(a.kind)) - Number(NON_DESTINATIONS.has(b.kind)) ||
      b.share - a.share || byDistanceThenName(a.candidate, b.candidate));
  const [first, second] = venues;
  const suggestion = first && !NON_DESTINATIONS.has(first.kind) && first.share >= VENUE_SUGGESTION_MIN_SHARE &&
    (!second || first.share >= VENUE_SUGGESTION_MIN_LEAD * second.share) ? first : null;
  return { venues, suggestion };
}

/**
 * Which top-level venue each child belongs to (design §6.2). A container that covers the stay
 * (an area of interest, or a centre, campus, station or park within its footprint) takes every
 * smaller place within its footprint and any place whose address names it; a supermarket or
 * large store takes small counters sharing a distinctive word with it inside its footprint.
 * One level only: a parent is never itself a child.
 */
function assignParents(
  candidates: readonly VenueCandidate[],
  kinds: ReadonlyMap<string, VenueKind>,
  insideArea: (candidate: VenueCandidate) => boolean
) {
  const parentOf = new Map<string, string>();
  const spec = (candidate: VenueCandidate) => VENUE_KINDS[kinds.get(candidate.id)!];
  const containers = candidates
    .filter((candidate) => insideArea(candidate) || (spec(candidate).container === true && candidate.distanceMeters <= spec(candidate).footprintMeters))
    // The area the stay is in first, then the biggest, then the nearest.
    .sort((a, b) => Number(insideArea(b)) - Number(insideArea(a)) ||
      spec(b).footprintMeters - spec(a).footprintMeters || byDistanceThenName(a, b));
  const stores = candidates.filter((candidate) => STORE_KINDS.has(kinds.get(candidate.id)!));
  const parents = new Set<string>();

  // Biggest first, then nearest: a place is offered as a parent before it could be folded into a
  // smaller one, so the result never depends on the order MapKit listed them in.
  const ordered = [...candidates].sort((a, b) => spec(b).footprintMeters - spec(a).footprintMeters || byDistanceThenName(a, b));
  for (const candidate of ordered) {
    const own = spec(candidate);
    const container = containers.find((parent) => parent.id !== candidate.id && !parentOf.has(parent.id) &&
      own.footprintMeters < spec(parent).footprintMeters &&
      (addressNames(candidate, parent) || within(candidate, parent, spec(parent).footprintMeters) ||
        // The stay lies in the area, so places around the stay are in it too, however far
        // Apple's point for the area is (a centre's pin can sit at one end of it).
        (insideArea(parent) && candidate.distanceMeters <= spec(parent).footprintMeters)));
    if (container && !parents.has(candidate.id)) {
      parentOf.set(candidate.id, container.id);
      parents.add(container.id);
      continue;
    }
    if (!COUNTER_KINDS.has(kinds.get(candidate.id)!)) continue;
    const words = distinctiveWords(candidate.title);
    const store = stores
      .filter((parent) => parent.id !== candidate.id && !parentOf.has(parent.id) &&
        within(candidate, parent, spec(parent).footprintMeters) &&
        distinctiveWords(parent.title).some((word) => words.includes(word)))
      .sort(byDistanceThenName)[0];
    if (store && !parents.has(candidate.id)) {
      parentOf.set(candidate.id, store.id);
      parents.add(store.id);
    }
  }
  return parentOf;
}

/** Whether `child` lies within `radius` of `parent`: from their offsets, else as seen from the stay. */
function within(child: VenueCandidate, parent: VenueCandidate, radius: number) {
  if (isOffset(child) && isOffset(parent)) {
    return Math.hypot(child.offsetEastMeters! - parent.offsetEastMeters!, child.offsetNorthMeters! - parent.offsetNorthMeters!) <= radius;
  }
  // Without offsets the two can be at most the sum of their distances apart; only claim it when
  // both are close enough that the parent's footprint must cover the child.
  return child.distanceMeters + parent.distanceMeters <= radius;
}

function isOffset(candidate: VenueCandidate) {
  return Number.isFinite(candidate.offsetEastMeters) && Number.isFinite(candidate.offsetNorthMeters);
}

/** "Unit 4, Northgate Shopping Centre, …" names its centre. */
function addressNames(child: VenueCandidate, parent: VenueCandidate) {
  const address = searchText(child.subtitle ?? "");
  const name = searchText(parent.title);
  return name.length >= 6 && address.includes(name);
}

function distinctiveWords(title: string) {
  return [...new Set(searchText(title).split(/[^\p{L}\p{N}]+/u))]
    .filter((word) => word.length >= 4 && !GENERIC_WORDS.has(word));
}

/** Whether a place is named like one of the areas of interest a stay lies in. */
export function venueNamedLikeArea(title: string, areasOfInterest: readonly string[]) {
  const name = searchText(title);
  return areasOfInterest.some((area) => namesMatch(name, searchText(area)));
}

/** Same name ignoring case, accents and spacing, or one containing the other as whole words. */
function namesMatch(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.length >= 6 && new RegExp(`(^|\\s)${escapeRegExp(short)}(\\s|$)`).test(long);
}

/** One row per name: the nearest of same-named places (two branches of a chain). */
function dedupe(candidates: readonly VenueCandidate[]) {
  const best = new Map<string, VenueCandidate>();
  for (const candidate of candidates) {
    const key = searchText(candidate.title);
    const existing = best.get(key);
    if (!existing || byDistanceThenName(candidate, existing) < 0) best.set(key, candidate);
  }
  return [...best.values()];
}

function byDistanceThenName(a: VenueCandidate, b: VenueCandidate) {
  return a.distanceMeters - b.distanceMeters || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

function finiteOrZero(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function stayMinutes(stay: VenueStay) {
  const start = Date.parse(stay.startedAt);
  const end = stay.stoppedAt ? Date.parse(stay.stoppedAt) : stay.now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return (end - start) / 60_000;
}

/** The stay's middle as local weekday and hour. */
function localTime(stay: VenueStay) {
  const start = Date.parse(stay.startedAt);
  const end = stay.stoppedAt ? Date.parse(stay.stoppedAt) : stay.now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const middle = new Date(start + Math.max(0, end - start) / 2);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = weekdayHourFormatter(stay.timeZone || undefined).formatToParts(middle);
  } catch {
    // An unknown time zone: the phone's own.
    parts = weekdayHourFormatter(undefined).formatToParts(middle);
  }
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  return Number.isFinite(hour) ? { hour, weekend: weekday === "Sat" || weekday === "Sun" } : null;
}

// One formatter per time zone, built once (performance.md: no per-call Intl formatters).
const weekdayHourFormatters = new Map<string, Intl.DateTimeFormat>();
function weekdayHourFormatter(timeZone: string | undefined) {
  const key = timeZone ?? "";
  let formatter = weekdayHourFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "numeric", hourCycle: "h23", timeZone });
    weekdayHourFormatters.set(key, formatter);
  }
  return formatter;
}

/** Only the clear cases (design §6.1): a bar in the daytime, a school at the weekend or at night. */
function clearlyClosed(kind: VenueKind, local: { hour: number; weekend: boolean }) {
  if (kind === "nightlife") return local.hour >= 6 && local.hour < 16;
  if (kind === "school") return local.weekend || local.hour < 6 || local.hour >= 20;
  if (kind === "service" || kind === "library") return local.hour < 6 || local.hour >= 22;
  return false;
}

function searchText(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
