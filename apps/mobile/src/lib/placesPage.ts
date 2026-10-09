import { placeRoleLabel, placeSecondaryName, type PlaceRole } from "@dayframe/shared";

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
    : lastSeen.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${visits} on ${days} · last seen ${seen}`;
}

type RolePlace = { id: string; name: string; role?: PlaceRole | null };

/**
 * An accepted Home/Work change applied to the page at once (PUT /api/places/role), mirroring the
 * server (`assignPlaceRoleWith`), so a refresh that fails afterwards never shows the old holder:
 * the target takes the role (leaving any other role it held); the place holding the role loses it
 * and takes the requested name; with no holder, every role-less place named like the role
 * ("Home", "HOME") is an implicit holder and is renamed when a name was given.
 */
export function applyPlaceRoleLocally<T extends RolePlace>(
  places: readonly T[],
  request: { role: PlaceRole; placeId: string | null; previousPlaceName: string | null }
): T[] {
  const holder = places.find((place) => place.role === request.role && place.id !== request.placeId) ?? null;
  const holderIsTarget = places.some((place) => place.role === request.role && place.id === request.placeId);
  const label = placeRoleLabel(request.role).toLowerCase();
  const implicit = holder || holderIsTarget
    ? []
    : places.filter((place) => !place.role && place.id !== request.placeId && place.name.trim().toLowerCase() === label);
  const previous = new Set((holder ? [holder] : request.previousPlaceName ? implicit : []).map((place) => place.id));
  return places.map((place) => {
    if (place.id === request.placeId) return { ...place, role: request.role };
    if (previous.has(place.id)) return { ...place, role: null, name: request.previousPlaceName ?? place.name };
    return place;
  });
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
