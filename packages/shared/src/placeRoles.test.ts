import { describe, expect, it } from "vitest";
import {
  PLACE_ROLES,
  PlaceRoleSchema,
  isHomePlace,
  placeDisplayName,
  placeRoleLabel,
  placeSecondaryName,
  previousRolePlaceName
} from "./index";

describe("place roles", () => {
  it("are Home and Work only", () => {
    expect(PLACE_ROLES).toEqual(["home", "work"]);
    expect(PlaceRoleSchema.safeParse("home").success).toBe(true);
    expect(PlaceRoleSchema.safeParse("gym").success).toBe(false);
    expect(placeRoleLabel("home")).toBe("Home");
    expect(placeRoleLabel("work")).toBe("Work");
  });

  it("show the role label in place of a saved name", () => {
    expect(placeDisplayName({ name: "12 Example Street", role: "home" })).toBe("Home");
    expect(placeDisplayName({ name: "Office tower", role: "work" })).toBe("Work");
    expect(placeDisplayName({ name: "Gym", role: null })).toBe("Gym");
    expect(placeDisplayName({ name: "Gym" })).toBe("Gym");
  });

  it("keep the saved name as secondary text unless it only repeats the label", () => {
    expect(placeSecondaryName({ name: "12 Example Street", role: "home" })).toBe("12 Example Street");
    expect(placeSecondaryName({ name: " home ", role: "home" })).toBeNull();
    expect(placeSecondaryName({ name: "Gym", role: null })).toBeNull();
  });

  it("treat a Home role, or a place literally named Home, as Home", () => {
    expect(isHomePlace({ name: "12 Example Street", role: "home" })).toBe(true);
    expect(isHomePlace({ name: "Home", role: null })).toBe(true);
    expect(isHomePlace({ name: "home", role: "work" })).toBe(false);
    expect(isHomePlace({ name: "Gym" })).toBe(false);
    expect(isHomePlace(undefined)).toBe(false);
  });

  it("suggest a name for the place that loses its role", () => {
    expect(previousRolePlaceName("home")).toBe("Previous home");
    expect(previousRolePlaceName("work")).toBe("Previous work");
  });
});
