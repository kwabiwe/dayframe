import { describe, expect, it } from "vitest";
import { rankVenues, venueKind, type VenueCandidate, type VenueStay } from "./venueRanking";

// Synthetic venues in Exampleton (design §6.5): every name, address and layout here is made up.
// Offsets are metres east and north of the stay's centre.
let next = 0;
function place(title: string, category: string | null, east: number, north: number, extra: Partial<VenueCandidate> = {}): VenueCandidate {
  next += 1;
  return {
    id: `v${next}`,
    title,
    category,
    subtitle: extra.subtitle ?? `${next} High Street, Exampleton ZZ1 1ZZ`,
    distanceMeters: Math.round(Math.hypot(east, north)),
    offsetEastMeters: east,
    offsetNorthMeters: north,
    source: "nearby",
    ...extra
  };
}

/** A weekday stay of `minutes` starting at `hour` local (London, 21 Oct 2026 is a Wednesday). */
function stay(minutes: number, hour = 11, extra: Partial<VenueStay> = {}): VenueStay {
  const start = new Date(Date.UTC(2026, 9, 21, hour - 1, 0)); // BST = UTC+1
  return {
    startedAt: start.toISOString(),
    stoppedAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
    now: new Date("2026-10-21T23:00:00Z"),
    accuracyMeters: 15,
    spreadMeters: 20,
    timeZone: "Europe/London",
    ...extra
  };
}

const titles = (ranking: ReturnType<typeof rankVenues>) => ranking.venues.map((venue) => venue.candidate.title);

describe("rankVenues: the failures reported before PR 7", () => {
  it("rolls an in-store pharmacy into its supermarket and suggests the supermarket", () => {
    const store = place("Freshway Superstore", "FoodMarket", 30, 35);
    const pharmacy = place("Freshway Pharmacy", "Pharmacy", 10, 15);
    const cafe = place("Bean & Bar", "Cafe", -35, 10);
    const ranking = rankVenues([pharmacy, cafe, store], stay(25));
    expect(ranking.suggestion?.candidate.title).toBe("Freshway Superstore");
    expect(ranking.venues[0].children.map((child) => child.title)).toEqual(["Freshway Pharmacy"]);
    expect(titles(ranking)).not.toContain("Freshway Pharmacy");
  });

  it("prefers the supermarket to a studio beside it, kind known or not", () => {
    const store = place("Freshway Superstore", "FoodMarket", 40, 30);
    for (const studio of [place("Kelp Yoga Studio", "FitnessCenter", 12, -10), place("Kelp Studio", null, 12, -10)]) {
      const ranking = rankVenues([studio, store], stay(25));
      expect(titles(ranking)[0]).toBe("Freshway Superstore");
      // Not folded: the studio shares no distinctive word with the store.
      expect(ranking.venues[0].children).toEqual([]);
    }
  });

  it("names the shopping centre the stay is in, with its shops inside it", () => {
    const shops = Array.from({ length: 30 }, (_, index) =>
      place(`Unit Shop ${index + 1}`, index % 3 === 0 ? "Store" : index % 3 === 1 ? null : "Restaurant",
        Math.round(Math.cos(index) * 50), Math.round(Math.sin(index) * 50)));
    // Apple's point for the centre can be far from where the stay is inside it.
    const centre = place("Northgate Shopping Centre", "Store", 380, 150, { source: "area" });
    const ranking = rankVenues([...shops, centre], stay(70, 14, { areasOfInterest: ["Northgate Shopping Centre"] }));
    expect(ranking.suggestion?.candidate.title).toBe("Northgate Shopping Centre");
    expect(ranking.suggestion?.kind).toBe("shopping_centre");
    expect(ranking.venues[0].children).toHaveLength(30);
  });

  it("finds the centre by its name and the addresses of its shops without an area of interest", () => {
    const centre = place("Northgate Shopping Centre", null, 60, 80);
    const inside = place("Fern Outfitters", "Store", -150, 40, { subtitle: "Unit 4, Northgate Shopping Centre, Exampleton ZZ1 2ZZ" });
    const nearby = place("Gorse Shoes", "Store", 20, 20);
    const ranking = rankVenues([inside, nearby, centre], stay(60, 15));
    expect(titles(ranking)[0]).toBe("Northgate Shopping Centre");
    expect(ranking.venues[0].children.map((child) => child.title).sort()).toEqual(["Fern Outfitters", "Gorse Shoes"]);
  });
});

describe("rankVenues: kinds, dwell and time of day", () => {
  it("leaves a busy high street without a confident suggestion", () => {
    const street = [
      place("Alder Books", null, 20, 10), place("Birch & Co", "Store", -25, 15), place("Cedar Kitchen", "Restaurant", 30, -20),
      place("Dock Nails", "Beauty", -10, -35), place("Elm Hardware", null, 40, 25), place("Fern Fashion", "Store", -45, -10)
    ];
    const ranking = rankVenues(street, stay(12, 13));
    expect(ranking.suggestion).toBeNull();
    expect(ranking.venues).toHaveLength(street.length);
  });

  it("puts the gym first for a long workout, the café next door second", () => {
    const ranking = rankVenues([place("Bean Corner", "Cafe", 8, 5), place("Peak Fitness", "FitnessCenter", 25, 30)], stay(75, 18));
    expect(titles(ranking)).toEqual(["Peak Fitness", "Bean Corner"]);
  });

  it("suggests the school for a weekday drop-off, but not at the weekend", () => {
    const venues = [place("Exampleton Primary School", "School", 50, 40), place("Corner News", "Store", 10, 10), place("School Lane (Stop K)", "PublicTransport", 5, -5)];
    expect(rankVenues(venues, stay(12, 9)).suggestion?.candidate.title).toBe("Exampleton Primary School");
    const saturday = stay(12, 9, { startedAt: "2026-10-24T08:00:00Z", stoppedAt: "2026-10-24T08:12:00Z" });
    expect(rankVenues(venues, saturday).venues[0].candidate.title).not.toBe("Exampleton Primary School");
  });

  it("never suggests a bus stop, and keeps a station a destination", () => {
    expect(venueKind({ title: "Market Street (Stop K)", category: "PublicTransport" })).toBe("bus_stop");
    expect(venueKind({ title: "Exampleton Station", category: "PublicTransport" })).toBe("station");
    const ranking = rankVenues([place("Market Street (Stop K)", "PublicTransport", 3, 2), place("Alder Books", null, 30, 20)], stay(20, 12));
    expect(titles(ranking)[0]).toBe("Alder Books");
  });

  it("folds a concourse café into the station the stay is at", () => {
    const station = place("Exampleton Station", "PublicTransport", 30, 30);
    const cafe = place("Platform Coffee", "Cafe", 50, 20);
    const ranking = rankVenues([cafe, station], stay(10, 8));
    expect(ranking.suggestion?.candidate.title).toBe("Exampleton Station");
    expect(ranking.venues[0].children.map((child) => child.title)).toEqual(["Platform Coffee"]);
  });

  it("marks a bar down in the morning", () => {
    const bar = place("The Kelp Tavern", "Nightlife", 10, 10);
    const cafe = place("Alder Café", "Cafe", 20, 20);
    expect(titles(rankVenues([bar, cafe], stay(60, 10)))[0]).toBe("Alder Café");
    expect(titles(rankVenues([bar, cafe], stay(100, 21)))[0]).toBe("The Kelp Tavern");
  });

  it("lets a venue you picked here before win a close call", () => {
    const a = place("Alder Café", "Cafe", 15, 10);
    const b = place("Birch Café", "Cafe", 12, 8);
    expect(titles(rankVenues([a, b], stay(40)))[0]).toBe("Birch Café");
    const ranking = rankVenues([a, b], stay(40, 11, { pickedBefore: (candidate) => candidate.title === "Alder Café" }));
    expect(titles(ranking)[0]).toBe("Alder Café");
  });

  it("infers a kind from the name when Apple gives none", () => {
    expect(venueKind({ title: "Kelp Superstore", category: null })).toBe("supermarket");
    expect(venueKind({ title: "Kelp Superstore", category: "Store" })).toBe("supermarket");
    expect(venueKind({ title: "Exampleton Retail Park", category: "Store" })).toBe("shopping_centre");
    expect(venueKind({ title: "Fern Café", category: null })).toBe("dining");
    expect(venueKind({ title: "Hazel & Co", category: null })).toBe("other");
  });
});

describe("rankVenues: input hygiene", () => {
  it("drops never-a-visit kinds, nameless rows and repeats, keeping the nearest branch", () => {
    const near = place("Freshway Express", "FoodMarket", 20, 0);
    const far = place("freshway express", "FoodMarket", 200, 0);
    const ranking = rankVenues([
      place("Car Park A", "Parking", 2, 2), place("Cash Machine", "ATM", 3, 3), place("  ", null, 1, 1), far, near
    ], stay(20));
    expect(ranking.venues.map((venue) => venue.candidate.id)).toEqual([near.id]);
  });

  it("folds a counter by distance alone when offsets are missing, but only when it must be inside", () => {
    const store = { ...place("Freshway Superstore", "FoodMarket", 0, 0), offsetEastMeters: null, offsetNorthMeters: null, distanceMeters: 25 };
    const close = { ...place("Freshway Pharmacy", "Pharmacy", 0, 0), offsetEastMeters: null, offsetNorthMeters: null, distanceMeters: 20 };
    const far = { ...place("Freshway Bank", "Bank", 0, 0), offsetEastMeters: null, offsetNorthMeters: null, distanceMeters: 50 };
    const ranking = rankVenues([store, close, far], stay(25));
    expect(ranking.venues[0].candidate.title).toBe("Freshway Superstore");
    expect(ranking.venues[0].children.map((child) => child.title)).toEqual(["Freshway Pharmacy"]);
    expect(titles(ranking)).toContain("Freshway Bank");
  });

  it("returns nothing for nothing, and shares that sum to one", () => {
    expect(rankVenues([], stay(10))).toEqual({ venues: [], suggestion: null, guess: null });
    const ranking = rankVenues([place("Alder Books", null, 10, 0), place("Birch Café", "Cafe", 30, 0)], stay(30));
    expect(ranking.venues.reduce((sum, venue) => sum + venue.share, 0)).toBeCloseTo(1, 10);
  });

  it("handles an open stay by measuring it to now", () => {
    const open = { ...stay(0), stoppedAt: null, now: new Date(Date.parse(stay(0).startedAt) + 70 * 60_000) };
    expect(titles(rankVenues([place("Bean Corner", "Cafe", 8, 5), place("Peak Fitness", "FitnessCenter", 25, 30)], open))[0]).toBe("Peak Fitness");
  });
});

describe("rankVenues: Codex r1 on #517", () => {
  it("never makes a car park, or a street named after a place, a container or a suggestion", () => {
    const carPark = place("Car park Lane", null, 10, 5);
    const shops = [place("Alder Books", "Store", 20, 10), place("Birch Gifts", "Store", -15, 20)];
    const ranking = rankVenues([carPark, ...shops], stay(20, 12));
    expect(ranking.venues.every((venue) => venue.children.length === 0)).toBe(true);
    expect(ranking.venues.at(-1)?.candidate.title).toBe("Car park Lane");
    expect(ranking.suggestion?.candidate.title).not.toBe("Car park Lane");
    expect(venueKind({ title: "Car park Lane", category: null })).toBe("parking");
    expect(venueKind({ title: "Park Lane", category: null })).toBe("other");
    expect(venueKind({ title: "Station Road", category: null })).toBe("other");
    expect(venueKind({ title: "Shell Service Station", category: null })).toBe("petrol");
    expect(venueKind({ title: "Exampleton Station", category: null })).toBe("station");
  });

  it("never lets a bus stop lead or be suggested, even when it is far nearer", () => {
    const stop = place("Market Street (Stop K)", "PublicTransport", 3, 4);
    const shop = place("Alder Books", "Store", 300, 180);
    const ranking = rankVenues([stop, shop], stay(25, 12, { spreadMeters: 120 }));
    expect(titles(ranking)).toEqual(["Alder Books", "Market Street (Stop K)"]);
    expect(ranking.suggestion?.candidate.title).not.toBe("Market Street (Stop K)");
  });

  it("folds the same way whatever order MapKit listed the places in", () => {
    const centre = place("Northgate Shopping Centre", null, 40, 40);
    const store = place("Freshway Superstore", "FoodMarket", 50, 30);
    const pharmacy = place("Freshway Pharmacy", "Pharmacy", 55, 25);
    const shape = (list: VenueCandidate[]) => {
      const ranking = rankVenues(list, stay(40, 11));
      return ranking.venues.map((venue) => [venue.candidate.title, venue.children.map((child) => child.title).sort()]);
    };
    const expected = shape([centre, store, pharmacy]);
    for (const order of [[pharmacy, store, centre], [store, pharmacy, centre], [pharmacy, centre, store], [store, centre, pharmacy]]) {
      expect(shape(order)).toEqual(expected);
    }
  });

  it("survives non-finite accuracy and spread and an unknown time zone", () => {
    const ranking = rankVenues([place("Alder Books", null, 10, 0), place("Birch Café", "Cafe", 30, 0)],
      stay(30, 11, { accuracyMeters: Number.NaN, spreadMeters: Number.POSITIVE_INFINITY, timeZone: "Not/AZone" }));
    expect(ranking.venues.reduce((sum, venue) => sum + venue.share, 0)).toBeCloseTo(1, 10);
  });

  it("reports which venue is the area the stay lies in", () => {
    const centre = place("Northgate Shopping Centre", null, 380, 150);
    const ranking = rankVenues([centre, place("Unit Shop", "Store", 20, 0)], stay(60, 14, { areasOfInterest: ["Northgate Shopping Centre"] }));
    expect(ranking.venues[0]).toMatchObject({ insideArea: true });
  });
});

describe("rankVenues: Codex r2 on #517", () => {
  it("never makes a stop named after a station or street a station", () => {
    expect(venueKind({ title: "Station Road (Stop K)", category: "PublicTransport" })).toBe("bus_stop");
    expect(venueKind({ title: "Station Road", category: "PublicTransport" })).toBe("bus_stop");
    expect(venueKind({ title: "Exampleton Station (Stand 4)", category: "PublicTransport" })).toBe("bus_stop");
    expect(venueKind({ title: "Exampleton Bus Station", category: "PublicTransport" })).toBe("station");
    const ranking = rankVenues([place("Station Road (Stop K)", "PublicTransport", 3, 4), place("Alder Books", "Store", 20, 15)], stay(20, 12));
    expect(titles(ranking)[0]).toBe("Alder Books");
    expect(ranking.venues.every((venue) => venue.children.length === 0)).toBe(true);
    expect(ranking.suggestion?.candidate.title).not.toBe("Station Road (Stop K)");
  });

  it("never turns a car park named after the area into the area", () => {
    const carPark = place("Northgate Shopping Centre Car Park", null, 30, 10);
    const shop = place("Unit Shop", "Store", 20, 0);
    const ranking = rankVenues([carPark, shop], stay(60, 14, { areasOfInterest: ["Northgate Shopping Centre"] }));
    expect(venueKind(carPark)).toBe("parking");
    expect(ranking.venues.find((venue) => venue.candidate.id === carPark.id)).toMatchObject({ kind: "parking", insideArea: false, children: [] });
    expect(ranking.suggestion?.candidate.id).not.toBe(carPark.id);
  });
});

describe("rankVenues: the near guess (PRD D23, owner 29 Oct 2026)", () => {
  // The owner's case, as a 10-minute weekday stay in a town centre: two shops 10 m away and one 30 m away.
  const ownersCase = () => [
    place("Holland & Barrett", "Store", 8, 6),
    place("Transylvania Sweet", "Bakery", -6, 8),
    place("Hotel Chocolat", "Store", 18, -24),
    place("Home Made Bakery", "Bakery", -12, -16),
    place("Falafel Street", "Restaurant", 24, 18)
  ];

  it("guesses one near venue where the strict suggestion finds none", () => {
    const ranking = rankVenues(ownersCase(), stay(10, 12));
    expect(ranking.suggestion).toBeNull();
    expect(ranking.guess).not.toBeNull();
    expect(ranking.guess!.candidate.distanceMeters).toBeLessThanOrEqual(50);
  });

  it("guesses nothing when no destination is within 50 m", () => {
    const far = [place("Alder Books", null, 60, 40), place("Birch Books", null, -60, 40), place("Elm Books", null, 0, -72),
      place("Market Street (Stop K)", "PublicTransport", 5, 5)];
    const ranking = rankVenues(far, stay(12, 13));
    expect(ranking.suggestion).toBeNull();
    expect(ranking.guess).toBeNull();
  });

  it("never guesses a stop or car park, however near", () => {
    const ranking = rankVenues([place("Market Street (Stop K)", "PublicTransport", 3, 3), place("Alder Books", null, 80, 0)], stay(12, 13));
    expect(ranking.guess).toBeNull();
  });

  it("keeps the strict suggestion as the guess when there is one, even beyond 50 m", () => {
    const store = place("Freshway Superstore", "FoodMarket", 45, 40);
    const ranking = rankVenues([store, place("Dock Nails", "Beauty", 20, 30)], stay(25));
    expect(ranking.suggestion?.candidate.title).toBe("Freshway Superstore");
    expect(ranking.guess).toBe(ranking.suggestion);
  });

  it("breaks a tie by distance, then by how often it was picked here, then by how well its usual length fits", () => {
    // Two of the same kind, equally scored: the nearer one.
    const nearer = place("Alder Gifts", "Store", 6, 0);
    const farther = place("Birch Gifts", "Store", 0, 9);
    expect(rankVenues([farther, nearer], stay(10, 12)).guess?.candidate.title).toBe("Alder Gifts");
    // Same distance and score: the one picked here more often.
    const a = place("Cedar Gifts", "Store", 10, 0, { placeId: "I.cedar" });
    const b = place("Dock Gifts", "Store", 0, 10, { placeId: "I.dock" });
    const counts: Record<string, number> = { "I.cedar": 1, "I.dock": 3 };
    expect(rankVenues([a, b], stay(10, 12, { pickCount: (candidate) => counts[candidate.placeId ?? ""] ?? 0 })).guess?.candidate.title).toBe("Dock Gifts");
  });
});
