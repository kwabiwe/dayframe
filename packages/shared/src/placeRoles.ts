import { z } from "zod";

// A saved place can hold one of two roles, like the Home and Work slots in a maps app.
// The role belongs to the place, so moving Home to a new place never rewrites the entries
// recorded at the old one. Each workspace has at most one Home and one Work.
export const PLACE_ROLES = ["home", "work"] as const;
export type PlaceRole = (typeof PLACE_ROLES)[number];
export const PlaceRoleSchema = z.enum(PLACE_ROLES);

const ROLE_LABELS: Record<PlaceRole, string> = { home: "Home", work: "Work" };
const PREVIOUS_ROLE_NAMES: Record<PlaceRole, string> = { home: "Previous home", work: "Previous work" };

type NamedPlace = { name: string; role?: PlaceRole | null };

export function placeRoleLabel(role: PlaceRole) {
  return ROLE_LABELS[role];
}

/** What the interface calls a saved place: its role label when it has one, otherwise its name. */
export function placeDisplayName(place: NamedPlace) {
  return place.role ? ROLE_LABELS[place.role] : place.name;
}

/** The saved name shown under a role label (often an address), or null when it adds nothing. */
export function placeSecondaryName(place: NamedPlace) {
  if (!place.role) return null;
  const name = place.name.trim();
  return name && name.toLowerCase() !== ROLE_LABELS[place.role].toLowerCase() ? name : null;
}

/** Home is the place with the Home role, or (before roles existed) a place named exactly "Home". */
export function isHomePlace(place: NamedPlace | null | undefined) {
  if (!place) return false;
  if (place.role) return place.role === "home";
  return place.name.trim().toLowerCase() === "home";
}

/** Suggested new name for the place a role moves away from, so its history doesn't read as an address. */
export function previousRolePlaceName(role: PlaceRole) {
  return PREVIOUS_ROLE_NAMES[role];
}

// Home and Work slots for the Places screens on web and iPhone.

type SlotPlace = { id: string; name: string; role: PlaceRole | null };

export type PlaceRoleSlot<T extends SlotPlace> = {
  role: PlaceRole;
  label: string;
  place: T | null;
  /** The saved name shown under the label, often an address. */
  secondary: string | null;
  /**
   * The place that loses the role when it moves: the holder, or with no holder a place
   * named exactly "Home"/"Work", which Dayframe treated as Home before roles existed.
   */
  previousHolder: T | null;
};

/** The Home and Work slots, in that order, each pointing at the place that holds the role. */
export function placeRoleSlots<T extends SlotPlace>(places: T[]): PlaceRoleSlot<T>[] {
  return PLACE_ROLES.map((role) => {
    const label = placeRoleLabel(role);
    const place = places.find((candidate) => candidate.role === role) ?? null;
    const namedLikeRole = places.find((candidate) => candidate.role === null
      && candidate.name.trim().toLowerCase() === label.toLowerCase()) ?? null;
    return { role, label, place, secondary: place ? placeSecondaryName(place) : null, previousHolder: place ?? namedLikeRole };
  });
}

/** What the rename field suggests when the role leaves `holder` for `target` (null empties the slot). */
export function initialPreviousPlaceName(role: PlaceRole, holder: SlotPlace | null, target: SlotPlace | null) {
  if (!holder) return "";
  const suggestion = previousRolePlaceName(role);
  // Moving the role elsewhere: suggest "Previous home" so the old history doesn't read as an address,
  // unless that is the name of the place Home is moving back to. Emptying the slot: keep the name.
  if (!target || target.id === holder.id) return holder.name;
  return target.name.trim().toLowerCase() === suggestion.toLowerCase() ? holder.name : suggestion;
}

/** Body for PUT /api/places/role. The rename only applies when the role really leaves a place. */
export function placeRoleRequest(input: {
  role: PlaceRole;
  targetId: string | null;
  holder: SlotPlace | null;
  previousPlaceName: string;
}) {
  const leaving = input.holder && input.holder.id !== input.targetId ? input.holder : null;
  const rename = input.previousPlaceName.trim().slice(0, 120);
  return {
    role: input.role,
    placeId: input.targetId,
    previousPlaceName: leaving && rename && rename !== leaving.name ? rename : null
  };
}

/** Option label for choosing a place: its display name, plus the saved name when a role hides it. */
export function placeChoiceLabel(place: SlotPlace) {
  const secondary = placeSecondaryName(place);
  return secondary ? `${placeDisplayName(place)} · ${secondary}` : placeDisplayName(place);
}
