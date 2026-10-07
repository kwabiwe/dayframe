import { placeChoiceLabel, type PlaceRole, type PlaceRoleSlot } from "@dayframe/shared";

type SheetPlace = { id: string; name: string; role: PlaceRole | null };

export type PlaceRoleSheetAction =
  | { kind: "choose"; placeId: string }
  | { kind: "add" }
  | { kind: "clear" };

/**
 * The native action sheet for a Home or Work slot: every other saved place, then
 * "Add a new place", then "Clear" when the slot is set, then Cancel.
 */
export function placeRoleSheet<T extends SheetPlace>(slot: PlaceRoleSlot<T>, places: T[]) {
  const choices = places.filter((place) => place.id !== slot.place?.id);
  const actions: Array<PlaceRoleSheetAction | null> = [
    ...choices.map((place) => ({ kind: "choose", placeId: place.id }) as const),
    { kind: "add" },
    ...(slot.place ? [{ kind: "clear" } as const] : []),
    null
  ];
  const options = [
    ...choices.map((place) => placeChoiceLabel(place)),
    "Add a new place",
    ...(slot.place ? [`Clear ${slot.label}`] : []),
    "Cancel"
  ];
  return {
    title: slot.place ? `Change ${slot.label}` : `Set ${slot.label}`,
    options,
    actions,
    cancelButtonIndex: options.length - 1,
    destructiveButtonIndex: slot.place ? options.length - 2 : undefined
  };
}
