import {
  PLACE_ROLES,
  placeDisplayName,
  placeRoleLabel,
  placeSecondaryName,
  previousRolePlaceName,
  type PlaceRole
} from "@dayframe/shared";

type SlotPlace = { id: string; name: string; role: PlaceRole | null };

export type PlaceRoleSlot<T extends SlotPlace> = {
  role: PlaceRole;
  label: string;
  place: T | null;
  /** The saved name shown under the label, often an address. */
  secondary: string | null;
};

/** The Home and Work slots, in that order, each pointing at the place that holds the role. */
export function placeRoleSlots<T extends SlotPlace>(places: T[]): PlaceRoleSlot<T>[] {
  return PLACE_ROLES.map((role) => {
    const place = places.find((candidate) => candidate.role === role) ?? null;
    return { role, label: placeRoleLabel(role), place, secondary: place ? placeSecondaryName(place) : null };
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
