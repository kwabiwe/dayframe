import { describe, expect, it, vi } from "vitest";
import { placeRoleSlots } from "@dayframe/shared";
import { placeRoleChoice, type PlaceRoleFlowPrompts, type RenameAnswer } from "./placeRoleFlow";

const home = { id: "home", name: "12 Example Street", role: "home" as const };
const office = { id: "office", name: "Office tower", role: "work" as const };
const flat = { id: "flat", name: "34 Sample Road", role: null };
const namedHome = { id: "named", name: "Home", role: null };

function prompts(confirmAnswers: boolean[] = [], rename: RenameAnswer = { kind: "keep" }) {
  const confirm = vi.fn(async () => confirmAnswers.shift() ?? true);
  const promptRename = vi.fn(async () => rename);
  return { confirm, promptRename } satisfies PlaceRoleFlowPrompts;
}

describe("placeRoleChoice", () => {
  it("moves Home with the typed rename", async () => {
    const [slot] = placeRoleSlots([home, flat]);
    const ask = prompts([], { kind: "rename", name: " Previous home " });

    await expect(placeRoleChoice(slot!, flat, ask)).resolves.toEqual({ role: "home", placeId: "flat", previousPlaceName: "Previous home" });
    expect(ask.confirm).not.toHaveBeenCalled();
    expect(ask.promptRename).toHaveBeenCalledWith("Rename the old home?", expect.any(String), "Previous home");
  });

  it("keeps the old name, or backs out entirely, from the rename prompt", async () => {
    const [slot] = placeRoleSlots([home, flat]);
    await expect(placeRoleChoice(slot!, flat, prompts([], { kind: "keep" })))
      .resolves.toEqual({ role: "home", placeId: "flat", previousPlaceName: null });
    await expect(placeRoleChoice(slot!, flat, prompts([], { kind: "cancel" }))).resolves.toBeNull();
  });

  it("warns before taking the Work place for Home, and stops if the person cancels", async () => {
    const [slot] = placeRoleSlots([home, office]);
    const declined = prompts([false]);
    await expect(placeRoleChoice(slot!, office, declined)).resolves.toBeNull();
    expect(declined.confirm).toHaveBeenCalledWith("Make this place Home?", "This place is your Work, so Work will be empty.", "Continue", false);
    expect(declined.promptRename).not.toHaveBeenCalled();

    const accepted = prompts([true], { kind: "keep" });
    await expect(placeRoleChoice(slot!, office, accepted)).resolves.toEqual({ role: "home", placeId: "office", previousPlaceName: null });
    expect(accepted.promptRename).toHaveBeenCalledTimes(1);
  });

  it("skips the rename prompt when no other place loses the role", async () => {
    const [, workSlot] = placeRoleSlots([home, flat]);
    const ask = prompts();
    await expect(placeRoleChoice(workSlot!, flat, ask)).resolves.toEqual({ role: "work", placeId: "flat", previousPlaceName: null });
    expect(ask.promptRename).not.toHaveBeenCalled();

    const [homeSlot] = placeRoleSlots([namedHome, flat]);
    const choosingNamed = prompts();
    await expect(placeRoleChoice(homeSlot!, namedHome, choosingNamed)).resolves.toEqual({ role: "home", placeId: "named", previousPlaceName: null });
    expect(choosingNamed.promptRename).not.toHaveBeenCalled();
  });

  it("offers the rename for a place named Home when Home first goes elsewhere", async () => {
    const [slot] = placeRoleSlots([namedHome, flat]);
    const ask = prompts([], { kind: "rename", name: "Previous home" });
    await expect(placeRoleChoice(slot!, flat, ask)).resolves.toEqual({ role: "home", placeId: "flat", previousPlaceName: "Previous home" });
  });

  it("clears only after confirmation, keeping the name", async () => {
    const [slot] = placeRoleSlots([home, flat]);
    await expect(placeRoleChoice(slot!, null, prompts([false]))).resolves.toBeNull();
    const ask = prompts([true]);
    await expect(placeRoleChoice(slot!, null, ask)).resolves.toEqual({ role: "home", placeId: null, previousPlaceName: null });
    expect(ask.confirm).toHaveBeenCalledWith("Clear Home?", expect.any(String), "Clear", true);
  });
});
