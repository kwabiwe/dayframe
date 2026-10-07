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
