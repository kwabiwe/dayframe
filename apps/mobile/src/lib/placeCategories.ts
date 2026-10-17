import type { DayframeGlyph } from "@dayframe/shared";

// A nearby place's kind (Apple's point-of-interest category, without its "MKPOICategory" prefix)
// as Location evidence shows it: "Gym · 40 m" with a matching glyph (owner, 17 Oct 2026). Unknown
// kinds read in plain words; a place without one is just "Place".
const PLACE_CATEGORIES: Readonly<Record<string, { label: string; glyph: DayframeGlyph }>> = {
  Airport: { label: "Airport", glyph: "plane" },
  AmusementPark: { label: "Theme park", glyph: "party-popper" },
  Aquarium: { label: "Aquarium", glyph: "swimmer" },
  ATM: { label: "Cash machine", glyph: "wallet" },
  Bakery: { label: "Bakery", glyph: "coffee" },
  Bank: { label: "Bank", glyph: "wallet" },
  Beach: { label: "Beach", glyph: "sun" },
  Brewery: { label: "Brewery", glyph: "utensils" },
  Cafe: { label: "Café", glyph: "coffee" },
  Campground: { label: "Campsite", glyph: "tent" },
  ConventionCenter: { label: "Conference centre", glyph: "building-2" },
  CarRental: { label: "Car hire", glyph: "car" },
  EVCharger: { label: "Charge point", glyph: "zap" },
  FireStation: { label: "Fire station", glyph: "flame" },
  FitnessCenter: { label: "Gym", glyph: "dumbbell" },
  FoodMarket: { label: "Supermarket", glyph: "shopping-cart" },
  GasStation: { label: "Petrol station", glyph: "car" },
  Hospital: { label: "Hospital", glyph: "stethoscope" },
  Hotel: { label: "Hotel", glyph: "building-2" },
  Laundry: { label: "Laundry", glyph: "shirt" },
  Library: { label: "Library", glyph: "library" },
  Marina: { label: "Marina", glyph: "ship" },
  MovieTheater: { label: "Cinema", glyph: "tv" },
  Museum: { label: "Museum", glyph: "palette" },
  NationalPark: { label: "National park", glyph: "mountain" },
  Nightlife: { label: "Bar", glyph: "music" },
  Park: { label: "Park", glyph: "sprout" },
  Parking: { label: "Car park", glyph: "car" },
  Pharmacy: { label: "Pharmacy", glyph: "pill" },
  Police: { label: "Police", glyph: "shield" },
  PostOffice: { label: "Post office", glyph: "mail" },
  PublicTransport: { label: "Station", glyph: "train-front" },
  Restaurant: { label: "Restaurant", glyph: "utensils" },
  Restroom: { label: "Toilets", glyph: "map-pin" },
  RVPark: { label: "Caravan park", glyph: "tent" },
  School: { label: "School", glyph: "graduation-cap" },
  Stadium: { label: "Stadium", glyph: "users" },
  Store: { label: "Shop", glyph: "shopping-bag" },
  Theater: { label: "Theatre", glyph: "music" },
  University: { label: "University", glyph: "graduation-cap" },
  Winery: { label: "Winery", glyph: "utensils" },
  Zoo: { label: "Zoo", glyph: "paw-print" }
};

/** The label and glyph for a nearby place's kind: "FitnessCenter" → Gym. */
export function nearbyPlaceCategory(key: string | null | undefined): { label: string; glyph: DayframeGlyph } {
  if (!key) return { label: "Place", glyph: "map-pin" };
  const known = PLACE_CATEGORIES[key];
  if (known) return known;
  // An Apple category this build does not name yet: its words in sentence case, an acronym kept
  // ("SkatingRink" → Skating rink, "EVRepair" → EV repair; Codex r1 on #479).
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .map((word, index) => /^[A-Z]{2,}$/.test(word) ? word : index === 0 ? word : word.toLowerCase());
  const label = words.join(" ");
  return { label: label.charAt(0).toUpperCase() + label.slice(1), glyph: "map-pin" };
}

/** "40 m", "1.2 km": a distance from the visit, rounded for reading. */
export function formatPlaceDistance(meters: number) {
  if (!Number.isFinite(meters) || meters < 0) return "";
  return meters < 1000 ? `${Math.max(10, Math.round(meters / 10) * 10)} m` : `${(meters / 1000).toFixed(1)} km`;
}
