import {
  initialPreviousPlaceName,
  leavingRoleHolder,
  placeRoleLabel,
  placeRoleRequest,
  type PlaceRole,
  type PlaceRoleSlot
} from "@dayframe/shared";

type FlowPlace = { id: string; name: string; role: PlaceRole | null };

export type RenameAnswer = { kind: "cancel" } | { kind: "keep" } | { kind: "rename"; name: string };

/** The native questions the Places screen asks; each resolves once with the person's answer. */
export type PlaceRoleFlowPrompts = {
  confirm: (title: string, message: string, actionLabel: string, destructive: boolean) => Promise<boolean>;
  promptRename: (title: string, message: string, suggestion: string) => Promise<RenameAnswer>;
};

/**
 * Asks what the slot change needs and returns the PUT /api/places/role body, or null when the
 * person backed out. `target` null clears the slot. Order: the other-role warning first, then
 * the rename prompt, only when the role really leaves another place.
 */
export async function placeRoleChoice<T extends FlowPlace>(
  slot: PlaceRoleSlot<T>,
  target: T | null,
  prompts: PlaceRoleFlowPrompts
) {
  if (!target) {
    const cleared = await prompts.confirm(
      `Clear ${slot.label}?`,
      `The place stays saved and keeps its entries; it just stops being ${slot.label}.`,
      "Clear",
      true
    );
    return cleared ? placeRoleRequest({ role: slot.role, targetId: null, holder: slot.place, previousPlaceName: "" }) : null;
  }
  if (target.role && target.role !== slot.role) {
    const other = placeRoleLabel(target.role);
    const proceed = await prompts.confirm(
      `Make this place ${slot.label}?`,
      `This place is your ${other}, so ${other} will be empty.`,
      "Continue",
      false
    );
    if (!proceed) return null;
  }
  const holder = leavingRoleHolder(slot, target.id);
  if (!holder) return placeRoleRequest({ role: slot.role, targetId: target.id, holder: null, previousPlaceName: "" });
  const answer = await prompts.promptRename(
    `Rename the old ${slot.label.toLowerCase()}?`,
    "Its past entries stay there and keep this name.",
    initialPreviousPlaceName(slot.role, holder, target)
  );
  if (answer.kind === "cancel") return null;
  return placeRoleRequest({
    role: slot.role,
    targetId: target.id,
    holder,
    previousPlaceName: answer.kind === "rename" ? answer.name : ""
  });
}
