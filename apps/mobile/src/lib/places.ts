export const DEFAULT_PLACE_RADIUS_METERS = 100;
export const MIN_PLACE_RADIUS_METERS = 25;
export const MAX_PLACE_RADIUS_METERS = 2000;
export const POOR_LOCATION_ACCURACY_METERS = 150;

export type PlaceFormInput = {
  name: string;
  latitude: string;
  longitude: string;
  radiusMeters: string;
  defaultCategoryId?: string | null;
  defaultActivityDescription?: string | null;
};

export type PlaceFormValue = {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  defaultCategoryId: string | null;
  defaultActivityDescription: string | null;
};

export type PlaceFormValidation =
  | { ok: true; value: PlaceFormValue }
  | { ok: false; message: string };

export type ForegroundPermissionState = {
  granted: boolean;
  canAskAgain?: boolean;
};

export type ReverseGeocodeResult = {
  name?: string | null;
  street?: string | null;
  district?: string | null;
  city?: string | null;
  region?: string | null;
};

export function validatePlaceForm(input: PlaceFormInput): PlaceFormValidation {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Place name is required." };

  const latitude = Number(input.latitude);
  if (!Number.isFinite(latitude)) return { ok: false, message: "Latitude must be a number." };
  if (latitude < -90 || latitude > 90) return { ok: false, message: "Latitude must be between -90 and 90." };

  const longitude = Number(input.longitude);
  if (!Number.isFinite(longitude)) return { ok: false, message: "Longitude must be a number." };
  if (longitude < -180 || longitude > 180) {
    return { ok: false, message: "Longitude must be between -180 and 180." };
  }

  const radius = Number(input.radiusMeters);
  if (!Number.isFinite(radius)) return { ok: false, message: "Radius must be a number." };

  const radiusMeters = Math.round(radius);
  if (radiusMeters < MIN_PLACE_RADIUS_METERS) {
    return { ok: false, message: `Radius must be at least ${MIN_PLACE_RADIUS_METERS}m.` };
  }
  if (radiusMeters > MAX_PLACE_RADIUS_METERS) {
    return { ok: false, message: `Radius must be ${MAX_PLACE_RADIUS_METERS}m or less.` };
  }

  return {
    ok: true,
    value: {
      name,
      latitude,
      longitude,
      radiusMeters,
      defaultCategoryId: input.defaultCategoryId?.trim() || null,
      defaultActivityDescription: input.defaultActivityDescription?.trim() || null
    }
  };
}

export function foregroundLocationPermissionGuidance(permission: ForegroundPermissionState) {
  if (permission.granted) return null;
  return permission.canAskAgain === false
    ? "Location is denied. Open iOS Settings to allow Dayframe to use location, then add this place again."
    : "Location permission is needed to add a place from where you are. You can try again when you are ready.";
}

export function formatLocationAccuracy(accuracyMeters?: number | null) {
  if (typeof accuracyMeters !== "number" || !Number.isFinite(accuracyMeters)) {
    return "Location captured. Accuracy was not reported.";
  }
  return `Location captured with about ${Math.round(accuracyMeters)}m accuracy.`;
}

export function locationAccuracyWarning(accuracyMeters?: number | null, precise = true) {
  if (!precise) {
    return "Precise Location is off, so this place may need a larger radius.";
  }
  if (typeof accuracyMeters === "number" && accuracyMeters > POOR_LOCATION_ACCURACY_METERS) {
    return `Accuracy looks broad at about ${Math.round(accuracyMeters)}m. You can still save this place if the radius is useful.`;
  }
  return null;
}

export function suggestedPlaceNameFromGeocode(result?: ReverseGeocodeResult | null) {
  const candidates = [
    result?.name,
    result?.street,
    result?.district,
    result?.city,
    result?.region
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}
