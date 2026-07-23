import type { WebPlaceSuggestion } from "./place-search";

export const DEFAULT_WEB_PLACE_RADIUS_METERS = 100;
export const MIN_WEB_PLACE_RADIUS_METERS = 25;
export const MAX_WEB_PLACE_RADIUS_METERS = 2_000;

export type WebPlaceCoordinate = {
  latitude: number;
  longitude: number;
};

export type WebPlaceSearchBias = WebPlaceCoordinate | null;

export type WebPlaceFormInput = {
  name: string;
  latitude: string;
  longitude: string;
  radiusMeters: string;
  loggingEnabled: boolean;
  defaultCategoryId: string;
  defaultActivityDescription: string;
};

export type WebPlaceFormValue = {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  loggingEnabled: boolean;
  defaultCategoryId: string | null;
  defaultActivityDescription: string | null;
};

export type WebPlaceFormValidation =
  | { ok: true; value: WebPlaceFormValue }
  | { ok: false; field: "name" | "latitude" | "longitude" | "radiusMeters"; message: string };

type WebPlaceFormField = "name" | "latitude" | "longitude" | "radiusMeters";

export type BrowserLocationSource = {
  permissions?: {
    query(descriptor: { name: "geolocation" }): Promise<{ state: "granted" | "denied" | "prompt" }>;
  };
  geolocation?: {
    getCurrentPosition(
      success: (position: { coords: { latitude: number; longitude: number } }) => void,
      error: () => void,
      options: { enableHighAccuracy: boolean; maximumAge: number; timeout: number }
    ): void;
  };
};

export function validateWebPlaceForm(input: WebPlaceFormInput): WebPlaceFormValidation {
  const name = input.name.trim();
  if (!name) return invalid("name", "Name in Dayframe is required.");

  const latitude = requiredCoordinate(input.latitude, -90, 90);
  if (!latitude.ok) return invalid("latitude", latitude.message);
  const longitude = requiredCoordinate(input.longitude, -180, 180);
  if (!longitude.ok) return invalid("longitude", longitude.message);

  const radius = Number(input.radiusMeters);
  if (!input.radiusMeters.trim() || !Number.isFinite(radius)) {
    return invalid("radiusMeters", "Radius must be a number.");
  }
  const radiusMeters = Math.round(radius);
  if (radiusMeters < MIN_WEB_PLACE_RADIUS_METERS) {
    return invalid("radiusMeters", `Radius must be at least ${MIN_WEB_PLACE_RADIUS_METERS}m.`);
  }
  if (radiusMeters > MAX_WEB_PLACE_RADIUS_METERS) {
    return invalid("radiusMeters", `Radius must be ${MAX_WEB_PLACE_RADIUS_METERS}m or less.`);
  }

  return {
    ok: true,
    value: {
      name,
      latitude: latitude.value,
      longitude: longitude.value,
      radiusMeters,
      loggingEnabled: input.loggingEnabled,
      defaultCategoryId: input.loggingEnabled ? input.defaultCategoryId.trim() || null : null,
      defaultActivityDescription: input.loggingEnabled
        ? input.defaultActivityDescription.trim() || null
        : null
    }
  };
}

export function applyWebPlaceSuggestion(
  suggestion: WebPlaceSuggestion,
  currentName: string,
  nameTouched: boolean
) {
  return {
    name: nameTouched ? currentName : suggestedDayframeName(suggestion),
    latitude: formatWebCoordinate(suggestion.latitude),
    longitude: formatWebCoordinate(suggestion.longitude)
  };
}

export function suggestedDayframeName(suggestion: Pick<WebPlaceSuggestion, "title">) {
  return suggestion.title.trim();
}

export function selectWebPlaceSearchBias(inputs: {
  selectedCoordinate?: WebPlaceCoordinate | null;
  existingCoordinate?: WebPlaceCoordinate | null;
  browserCoordinate?: WebPlaceCoordinate | null;
  savedPlaceCoordinates?: WebPlaceCoordinate[];
}): WebPlaceSearchBias {
  const direct = [
    inputs.selectedCoordinate,
    inputs.existingCoordinate,
    inputs.browserCoordinate
  ].find(isWebPlaceCoordinate);
  return direct ?? robustWebCoordinateMedian(inputs.savedPlaceCoordinates ?? []);
}

export function robustWebCoordinateMedian(
  coordinates: WebPlaceCoordinate[]
): WebPlaceCoordinate | null {
  const valid = coordinates.filter(isWebPlaceCoordinate);
  if (valid.length === 0) return null;
  const latitudes = valid.map((coordinate) => coordinate.latitude).sort((a, b) => a - b);
  const longitudes = valid.map((coordinate) => coordinate.longitude).sort((a, b) => a - b);
  return {
    latitude: median(latitudes),
    longitude: median(longitudes)
  };
}

export async function resolveGrantedBrowserCoordinate(
  source: BrowserLocationSource
): Promise<WebPlaceCoordinate | null> {
  if (!source.permissions || !source.geolocation) return null;
  try {
    const permission = await source.permissions.query({ name: "geolocation" });
    if (permission.state !== "granted") return null;
    const coordinate = await new Promise<WebPlaceCoordinate | null>((resolve) => {
      source.geolocation?.getCurrentPosition(
        (position) => resolve(isWebPlaceCoordinate(position.coords) ? position.coords : null),
        () => resolve(null),
        { enableHighAccuracy: false, maximumAge: 24 * 60 * 60 * 1_000, timeout: 1_500 }
      );
    });
    return coordinate;
  } catch {
    return null;
  }
}

export function parseWebPlaceCoordinate(latitude: string, longitude: string) {
  if (!latitude.trim() || !longitude.trim()) return null;
  const coordinate = { latitude: Number(latitude), longitude: Number(longitude) };
  return isWebPlaceCoordinate(coordinate) ? coordinate : null;
}

export function formatWebCoordinate(value: number) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

export function friendlyBrowserLocationError(code?: number) {
  if (code === 1) {
    return "Location permission was denied. Use place search or Advanced coordinates instead.";
  }
  if (code === 3) {
    return "Current location took too long. Try again, or use place search or Advanced coordinates.";
  }
  return "Current location is unavailable. Try again, or use place search or Advanced coordinates.";
}

function requiredCoordinate(value: string, minimum: number, maximum: number) {
  if (!value.trim()) return { ok: false as const, message: "Choose a place or enter coordinates." };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { ok: false as const, message: "Coordinate must be a number." };
  if (parsed < minimum || parsed > maximum) {
    return { ok: false as const, message: `Coordinate must be between ${minimum} and ${maximum}.` };
  }
  return { ok: true as const, value: parsed };
}

function invalid(field: WebPlaceFormField, message: string) {
  return { ok: false as const, field, message };
}

function isWebPlaceCoordinate(value: unknown): value is WebPlaceCoordinate {
  if (!value || typeof value !== "object") return false;
  const coordinate = value as WebPlaceCoordinate;
  return Number.isFinite(coordinate.latitude) &&
    coordinate.latitude >= -90 &&
    coordinate.latitude <= 90 &&
    Number.isFinite(coordinate.longitude) &&
    coordinate.longitude >= -180 &&
    coordinate.longitude <= 180;
}

function median(values: number[]) {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
}
