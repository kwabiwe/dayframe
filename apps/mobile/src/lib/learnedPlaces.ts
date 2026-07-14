import {
  formatLocationCoordinates,
  locationAddressSummary
} from "@dayframe/shared";
import type { MobileLearnedPlace } from "./api";

export function learnedPlaceDetailValues(learnedPlace: MobileLearnedPlace) {
  const address =
    cleanText(learnedPlace.formattedAddress) ??
    locationAddressSummary(learnedPlace.address ?? learnedPlace.rawPayload?.address);
  return {
    name: learnedPlace.name,
    address,
    coordinates: formatLocationCoordinates(
      learnedPlace.latitude,
      learnedPlace.longitude,
      6
    )
  };
}

export async function copyLearnedPlaceDetail(
  value: string | null,
  writeClipboard: (text: string) => Promise<unknown>
) {
  const copyValue = cleanText(value);
  if (!copyValue) return false;
  await writeClipboard(copyValue);
  return true;
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
