import { distanceMeters, placeDisplayName, placeRoleLabel, placeSecondaryName, type PlaceRole } from "@dayframe/shared";
import { formatLocaleDate } from "./localeDateFormat";

type PagePlace = {
  name: string;
  role?: PlaceRole | null;
  radiusMeters: number;
  loggingEnabled?: boolean;
  defaultCategoryId?: string | null;
  defaultCategoryName?: string | null;
  defaultActivityDescription?: string | null;
};

/**
 * Blocks parity step 7a: the plain line under a saved place on the Places page. The saved name
 * first when a role (Home, Work) is the title, then what a visit logs, then the radius.
 */
export function placeRowSubtitle(place: PagePlace, categories: readonly { id: string; name: string }[]) {
  const secondary = placeSecondaryName({ name: place.name, role: place.role ?? null });
  const radius = `${place.radiusMeters} m`;
  let visits: string;
  if (place.loggingEnabled === false) {
    visits = "Visits not suggested";
  } else {
    const activity = place.defaultCategoryName
      ?? categories.find((category) => category.id === place.defaultCategoryId)?.name
      ?? null;
    const description = place.defaultActivityDescription?.trim() || null;
    visits = activity
      ? `Logs ${description ? `“${description}” as ` : "as "}${activity}`
      : description ? `Logs “${description}”` : "No default activity";
  }
  return [secondary, `${visits} · ${radius}`].filter(Boolean).join("\n");
}

/** "4 visits on 3 days · last seen 6 Oct", the plain line under a suggested place. */
export function learnedPlaceSubtitle(input: { visitCount: number; distinctDayCount: number; lastSeenAt: string }) {
  const visits = input.visitCount === 1 ? "1 visit" : `${input.visitCount} visits`;
  const days = input.distinctDayCount === 1 ? "1 day" : `${input.distinctDayCount} days`;
  const lastSeen = new Date(input.lastSeenAt);
  const seen = Number.isNaN(lastSeen.getTime())
    ? "recently"
    : formatLocaleDate(lastSeen, { day: "numeric", month: "short" });
  return `${visits} on ${days} · last seen ${seen}`;
}

type RolePlace = { id: string; name: string; role?: PlaceRole | null; latitude?: number | null; longitude?: number | null };

type MaybeCoordinate = { latitude?: number | null; longitude?: number | null } | null | undefined;

/** "Replace the old place" (PRD D19 A10): the server archives the old holder only this close. */
export const REPLACE_PREVIOUS_PLACE_METERS = 300;

/**
 * Whether to offer "Replace the old place" when Home or Work moves from `holder` to `chosen`: only
 * when both have coordinates and are within 300 m, where their two circles would overlap (as the
 * web's PlaceEditor and PlaceRoleSlots decide). The server checks the distance again.
 */
export function replacePreviousOffered(holder: MaybeCoordinate, chosen: MaybeCoordinate) {
  if (!holder || !chosen) return false;
  const { latitude: holderLatitude, longitude: holderLongitude } = holder;
  const { latitude: chosenLatitude, longitude: chosenLongitude } = chosen;
  if (!isCoordinate(holderLatitude) || !isCoordinate(holderLongitude) || !isCoordinate(chosenLatitude) || !isCoordinate(chosenLongitude)) {
    return false;
  }
  return distanceMeters(
    { latitude: holderLatitude, longitude: holderLongitude },
    { latitude: chosenLatitude, longitude: chosenLongitude }
  ) <= REPLACE_PREVIOUS_PLACE_METERS;
}

/** The line under the "Replace the old place" switch: why it is offered, and that it can be undone. */
export function replacePreviousNote(role: PlaceRole) {
  return `Your old ${placeRoleLabel(role)} is close by; archive it so the two don't overlap. You can restore it from Places.`;
}

function isCoordinate(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * An accepted Home/Work change applied to the page at once (PUT /api/places/role), mirroring the
 * server (`assignPlaceRoleWith`), so a refresh that fails afterwards never shows the old holder:
 * the target takes the role (leaving any other role it held); the place holding the role loses it
 * and takes the requested name; with no holder, every role-less place named like the role
 * ("Home", "HOME") is an implicit holder and is renamed when a name was given. With
 * `archivePrevious` (the server said it archived the old holder) every previous holder within
 * 300 m of the target leaves the list, as archived places leave bootstrap.
 */
export function applyPlaceRoleLocally<T extends RolePlace>(
  places: readonly T[],
  request: { role: PlaceRole; placeId: string | null; previousPlaceName: string | null; archivePrevious?: boolean }
): T[] {
  const holder = places.find((place) => place.role === request.role && place.id !== request.placeId) ?? null;
  const holderIsTarget = places.some((place) => place.role === request.role && place.id === request.placeId);
  const label = placeRoleLabel(request.role).toLowerCase();
  const implicit = holder || holderIsTarget
    ? []
    : places.filter((place) => !place.role && place.id !== request.placeId && place.name.trim().toLowerCase() === label);
  const previous = new Set((holder ? [holder] : request.previousPlaceName || request.archivePrevious ? implicit : []).map((place) => place.id));
  const target = request.placeId ? places.find((place) => place.id === request.placeId) ?? null : null;
  const archived = new Set(request.archivePrevious && target
    ? places.filter((place) => previous.has(place.id) && replacePreviousOffered(place, target)).map((place) => place.id)
    : []);
  return places.flatMap((place) => {
    if (place.id === request.placeId) return [{ ...place, role: request.role }];
    if (archived.has(place.id)) return [];
    if (previous.has(place.id)) return [{ ...place, role: null, name: request.previousPlaceName ?? place.name }];
    return [place];
  });
}

/** Places › Archived (PRD D19 A10): one row per archived place, newest first as the server sends them. */
export function archivedPlaceRows(places: readonly { id: string; name: string }[]) {
  return places.map((place) => ({
    id: place.id,
    name: place.name,
    subtitle: "History kept",
    accessibilityLabel: `${place.name}, archived, history kept`,
    restoreLabel: `Restore ${place.name}`
  }));
}

/** The place editor's Archive confirmation: what archiving keeps, and where it can be restored. */
export function archivePlaceConfirmCopy(place: { name: string; role?: PlaceRole | null }) {
  const role = place.role ? placeRoleLabel(place.role) : null;
  return {
    eyebrow: "Place",
    title: `Archive ${placeDisplayName({ name: place.name, role: place.role ?? null })}?`,
    message: `Past blocks keep its name, and it stops matching new visits${role ? ` and stops being your ${role}` : ""}. You can restore it from Places › Archived.`,
    confirmLabel: "Archive"
  };
}

// Places the editor deleted, per account, for the Places page to drop when it is shown again
// (even if its own refresh then fails). Taken once.
const deletedPlaceIds = new Map<string, Set<string>>();

const deletedPlaceListeners = new Set<(accountKey: string) => void>();

export function notePlaceDeleted(accountKey: string, placeId: string) {
  const ids = deletedPlaceIds.get(accountKey) ?? new Set<string>();
  ids.add(placeId);
  deletedPlaceIds.set(accountKey, ids);
  // A Places page already showing (the person went back before the delete finished) hears it now.
  for (const listener of [...deletedPlaceListeners]) listener(accountKey);
}

/** Calls `listener` whenever a delete is noted; returns the unsubscribe. */
export function subscribeDeletedPlaces(listener: (accountKey: string) => void) {
  deletedPlaceListeners.add(listener);
  return () => {
    deletedPlaceListeners.delete(listener);
  };
}

export function takeDeletedPlaces(accountKey: string) {
  const ids = deletedPlaceIds.get(accountKey);
  deletedPlaceIds.delete(accountKey);
  return ids ? [...ids] : [];
}

export type PlacesPageState = "ready" | "pending" | "failed";

/**
 * What the Places page draws (staging feedback B2, Codex r1): the Home/Work and place groups only
 * from a list that was actually read, so "Not set", "Nothing saved yet" and Set-goes-straight-to-
 * adding never appear for places not yet known. Before the first read settles it is a quiet
 * pending line (no spinner); a failed first read is the Blocks unavailable state.
 */
export function placesPageState(hasData: boolean, loadFailed: boolean): PlacesPageState {
  if (hasData) return "ready";
  return loadFailed ? "failed" : "pending";
}
