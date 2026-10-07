import { describe, expect, it } from "vitest";
import { initialPreviousPlaceName, placeChoiceLabel, placeRoleRequest, placeRoleSlots } from "./index";

const home = { id: "home", name: "12 Example Street", role: "home" as const };
const flat = { id: "flat", name: "34 Sample Road", role: null };
const gym = { id: "gym", name: "Gym", role: null };

describe("place role slots", () => {
  it("lists Home then Work, pointing at the place holding each role", () => {
    expect(placeRoleSlots([gym, home, flat])).toEqual([
      { role: "home", label: "Home", place: home, secondary: "12 Example Street", previousHolder: home },
      { role: "work", label: "Work", place: null, secondary: null, previousHolder: null }
    ]);
  });

  it("treats a place named Home as the one losing Home when no place holds the role yet", () => {
    const namedHome = { id: "named", name: " home ", role: null };
    const [homeSlot] = placeRoleSlots([gym, namedHome]);
    expect(homeSlot).toEqual(expect.objectContaining({ place: null, previousHolder: namedHome }));
    expect(initialPreviousPlaceName("home", namedHome, flat)).toBe("Previous home");
    expect(placeRoleRequest({ role: "home", targetId: flat.id, holder: namedHome, previousPlaceName: "Previous home" }))
      .toEqual({ role: "home", placeId: flat.id, previousPlaceName: "Previous home" });
  });

  it("suggests Previous home when Home moves, and the saved name when the slot is emptied", () => {
    expect(initialPreviousPlaceName("home", home, flat)).toBe("Previous home");
    expect(initialPreviousPlaceName("home", home, null)).toBe("12 Example Street");
    expect(initialPreviousPlaceName("work", null, flat)).toBe("");
  });

  it("keeps the current name when Home moves back to the place already called Previous home", () => {
    expect(initialPreviousPlaceName("home", home, { id: "old", name: "Previous home", role: null })).toBe("12 Example Street");
  });

  it("sends a rename only when the role leaves a place and the name changes", () => {
    expect(placeRoleRequest({ role: "home", targetId: flat.id, holder: home, previousPlaceName: " Previous home " }))
      .toEqual({ role: "home", placeId: flat.id, previousPlaceName: "Previous home" });
    expect(placeRoleRequest({ role: "home", targetId: flat.id, holder: home, previousPlaceName: "   " }))
      .toEqual({ role: "home", placeId: flat.id, previousPlaceName: null });
    expect(placeRoleRequest({ role: "home", targetId: null, holder: home, previousPlaceName: "12 Example Street" }))
      .toEqual({ role: "home", placeId: null, previousPlaceName: null });
    expect(placeRoleRequest({ role: "home", targetId: home.id, holder: home, previousPlaceName: "Previous home" }))
      .toEqual({ role: "home", placeId: home.id, previousPlaceName: null });
    expect(placeRoleRequest({ role: "work", targetId: gym.id, holder: null, previousPlaceName: "Previous work" }))
      .toEqual({ role: "work", placeId: gym.id, previousPlaceName: null });
  });

  it("labels choices with the role and the saved name it hides", () => {
    expect(placeChoiceLabel(home)).toBe("Home · 12 Example Street");
    expect(placeChoiceLabel(gym)).toBe("Gym");
  });
});
