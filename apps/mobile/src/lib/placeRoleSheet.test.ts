import { describe, expect, it } from "vitest";
import { placeRoleSlots } from "@dayframe/shared";
import { placeRoleSheet } from "./placeRoleSheet";

const home = { id: "home", name: "12 Example Street", role: "home" as const };
const office = { id: "office", name: "Office tower", role: "work" as const };
const gym = { id: "gym", name: "Gym", role: null };

describe("placeRoleSheet", () => {
  it("offers the other places, adding one, clearing and cancel for a set slot", () => {
    const [homeSlot] = placeRoleSlots([home, office, gym]);
    const sheet = placeRoleSheet(homeSlot!, [home, office, gym]);

    expect(sheet.title).toBe("Change Home");
    expect(sheet.options).toEqual(["Work · Office tower", "Gym", "Add a new place", "Clear Home", "Cancel"]);
    expect(sheet.actions).toEqual([
      { kind: "choose", placeId: "office" },
      { kind: "choose", placeId: "gym" },
      { kind: "add" },
      { kind: "clear" },
      null
    ]);
    expect(sheet.destructiveButtonIndex).toBe(3);
    expect(sheet.cancelButtonIndex).toBe(4);
  });

  it("has no clear option for an empty slot", () => {
    const [, workSlot] = placeRoleSlots([home, gym]);
    const sheet = placeRoleSheet(workSlot!, [home, gym]);

    expect(sheet.title).toBe("Set Work");
    expect(sheet.options).toEqual(["Home · 12 Example Street", "Gym", "Add a new place", "Cancel"]);
    expect(sheet.destructiveButtonIndex).toBeUndefined();
    expect(sheet.actions.at(-1)).toBeNull();
  });
});
