import * as Location from "expo-location";
import {
  isCoordinateBasedLocationName,
  locationAddressSummary,
  type LocationDisplayAddress
} from "@dayframe/shared";
import {
  resolveLearnedPlaceLocation,
  type MobileLearnedPlace
} from "./api";

export type ReverseGeocodingProvider = {
  id: string;
  reverseGeocode(latitude: number, longitude: number): Promise<LocationDisplayAddress | null>;
};

export const expoLocationGeocodingProvider: ReverseGeocodingProvider = {
  id: "expo_location",
  async reverseGeocode(latitude, longitude) {
    if (typeof Location.reverseGeocodeAsync !== "function") return null;
    try {
      const [address] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (!address) return null;
      return normalizeLocationAddress(address);
    } catch {
      return null;
    }
  }
};

const attemptedLearnedPlaceIds = new Set<string>();

export async function reverseGeocodeLocation(
  latitude: number,
  longitude: number,
  provider: ReverseGeocodingProvider = expoLocationGeocodingProvider
) {
  return provider.reverseGeocode(latitude, longitude);
}

export function learnedPlaceNeedsLocationResolution(
  learnedPlace: Pick<MobileLearnedPlace, "address" | "name" | "rawPayload">
) {
  const cachedAddress = learnedPlace.address ?? learnedPlace.rawPayload?.address;
  return !locationAddressSummary(cachedAddress) || isCoordinateBasedLocationName(learnedPlace.name);
}

export async function backfillLearnedPlaceLocations(
  learnedPlaces: MobileLearnedPlace[],
  options: {
    limit?: number;
    provider?: ReverseGeocodingProvider;
  } = {}
) {
  const provider = options.provider ?? expoLocationGeocodingProvider;
  const candidates = learnedPlaces
    .filter((learnedPlace) => (
      learnedPlaceNeedsLocationResolution(learnedPlace) &&
      !attemptedLearnedPlaceIds.has(learnedPlace.id)
    ))
    .slice(0, options.limit ?? 3);
  const resolved: Array<Awaited<ReturnType<typeof resolveLearnedPlaceLocation>>["learnedPlace"]> = [];

  for (const learnedPlace of candidates) {
    attemptedLearnedPlaceIds.add(learnedPlace.id);
    const cachedAddress = normalizeLocationAddress(
      learnedPlace.address ?? learnedPlace.rawPayload?.address
    );
    const address = cachedAddress ?? await reverseGeocodeLocation(
      learnedPlace.latitude,
      learnedPlace.longitude,
      provider
    );
    if (!address) continue;
    const result = await resolveLearnedPlaceLocation(learnedPlace.id, address).catch(() => null);
    if (result?.learnedPlace) resolved.push(result.learnedPlace);
  }

  return resolved;
}

export function resetLearnedPlaceGeocodingAttemptsForTests() {
  attemptedLearnedPlaceIds.clear();
}

function normalizeLocationAddress(value: unknown): LocationDisplayAddress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const address: LocationDisplayAddress = {
    name: cleanText(record.name),
    street: cleanText(record.street),
    streetNumber: cleanText(record.streetNumber),
    district: cleanText(record.district),
    city: cleanText(record.city),
    subregion: cleanText(record.subregion),
    region: cleanText(record.region),
    postalCode: cleanText(record.postalCode),
    formattedAddress: cleanText(record.formattedAddress)
  };
  return Object.values(address).some(Boolean) ? address : null;
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
