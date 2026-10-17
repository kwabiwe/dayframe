/**
 * Learned names (PRD D19, A8): what a Stay or Move is called is kept against its pattern and time of
 * day and suggested next time. Keys are location data (place IDs or 150 m cells); never log them.
 */
export type NameBand = "morning" | "afternoon" | "evening" | "weekend";

/** The time-of-day band of an item's start in the user's time zone: weekends, else morning 04–12, afternoon 12–17, evening. */
export function nameBand(startedAt: string, timeZone: string): NameBand {
  const date = new Date(startedAt);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
  }
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  if (weekday === "Sat" || weekday === "Sun") return "weekend";
  if (hour >= 4 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

const CELL_METRES = 150;
const METRES_PER_DEGREE = 111_320;

/** A 150 m grid cell for a point, stable across replays: rows by latitude, columns scaled at the row's latitude. */
export function locationCellKey(latitude: number, longitude: number) {
  const row = Math.floor((latitude * METRES_PER_DEGREE) / CELL_METRES);
  const rowLatitude = ((row + 0.5) * CELL_METRES) / METRES_PER_DEGREE;
  const metresPerLongitudeDegree = METRES_PER_DEGREE * Math.max(0.01, Math.cos((rowLatitude * Math.PI) / 180));
  const column = Math.floor((longitude * metresPerLongitudeDegree) / CELL_METRES);
  return `${row}.${column}`;
}

/** A Stay's key: its saved place, else its accepted learned place, else its centre's cell. */
export function stayPatternKey(stay: {
  placeId?: string | null; learnedPlaceId?: string | null; centreLatitude?: number | null; centreLongitude?: number | null;
}) {
  if (stay.placeId) return `p:${stay.placeId}`;
  if (stay.learnedPlaceId) return `l:${stay.learnedPlaceId}`;
  if (stay.centreLatitude != null && stay.centreLongitude != null &&
    Number.isFinite(stay.centreLatitude) && Number.isFinite(stay.centreLongitude)) {
    return `c:${locationCellKey(stay.centreLatitude, stay.centreLongitude)}`;
  }
  return null;
}

/** A Move's key: its two ends and mode; a round trip's origin, turnaround cell and mode. */
export function movePatternKey(input: {
  fromKey: string | null; toKey: string | null; travelMode?: string | null; roundTrip: boolean; turnaroundCell?: string | null;
}) {
  if (!input.fromKey) return null;
  const mode = input.travelMode || "any";
  if (input.roundTrip) return `r:${input.fromKey}:${input.turnaroundCell ?? "none"}:${mode}`;
  return input.toKey ? `m:${input.fromKey}>${input.toKey}:${mode}` : null;
}
