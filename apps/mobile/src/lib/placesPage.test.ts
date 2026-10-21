import { describe, expect, it } from "vitest";
import {
  applyPlaceRoleLocally,
  archivePlaceConfirmCopy,
  archivedPlaceRows,
  learnedPlaceSubtitle,
  notePlaceDeleted,
  placeRowSubtitle,
  placesPageState,
  replacePreviousNote,
  replacePreviousOffered,
  subscribeDeletedPlaces,
  takeDeletedPlaces
} from "./placesPage";

const categories = [{ id: "c1", name: "Exercise" }];

describe("placeRowSubtitle", () => {
  it("says what a visit logs and the radius", () => {
    expect(placeRowSubtitle({ name: "Gym", radiusMeters: 100, defaultCategoryId: "c1" }, categories)).toBe("Logs as Exercise · 100 m");
    expect(placeRowSubtitle({ name: "Gym", radiusMeters: 80, defaultCategoryId: "c1", defaultActivityDescription: " Weights " }, categories))
      .toBe("Logs “Weights” as Exercise · 80 m");
    expect(placeRowSubtitle({ name: "Park", radiusMeters: 150 }, categories)).toBe("No default activity · 150 m");
    expect(placeRowSubtitle({ name: "Park", radiusMeters: 150, defaultActivityDescription: "Walk" }, categories)).toBe("Logs “Walk” · 150 m");
  });

  it("says when visits are not suggested, ignoring a stale default", () => {
    expect(placeRowSubtitle({ name: "Gym", radiusMeters: 100, loggingEnabled: false, defaultCategoryId: "c1" }, categories))
      .toBe("Visits not suggested · 100 m");
  });

  it("puts the saved name first when a role is the title", () => {
    expect(placeRowSubtitle({ name: "12 Example Street", role: "home", radiusMeters: 100 }, categories))
      .toBe("12 Example Street\nNo default activity · 100 m");
  });

  it("prefers the server's default activity name", () => {
    expect(placeRowSubtitle({ name: "Gym", radiusMeters: 100, defaultCategoryId: "gone", defaultCategoryName: "Training" }, categories))
      .toBe("Logs as Training · 100 m");
  });
});

describe("learnedPlaceSubtitle", () => {
  it("counts visits and days", () => {
    expect(learnedPlaceSubtitle({ visitCount: 1, distinctDayCount: 1, lastSeenAt: "nope" })).toBe("1 visit on 1 day · last seen recently");
    expect(learnedPlaceSubtitle({ visitCount: 4, distinctDayCount: 3, lastSeenAt: "2026-10-06T10:00:00Z" })).toMatch(/^4 visits on 3 days · last seen /);
  });
});

describe("applyPlaceRoleLocally", () => {
  const places = [
    { id: "a", name: "12 Example Street", role: "home" as const },
    { id: "b", name: "Office tower", role: "work" as const },
    { id: "c", name: "Gym", role: null }
  ];

  it("moves the role and renames the place it left", () => {
    expect(applyPlaceRoleLocally(places, { role: "home", placeId: "c", previousPlaceName: "Previous home" })).toEqual([
      { id: "a", name: "Previous home", role: null },
      { id: "b", name: "Office tower", role: "work" },
      { id: "c", name: "Gym", role: "home" }
    ]);
  });

  it("takes the other role's place, leaving that slot empty", () => {
    const next = applyPlaceRoleLocally(places, { role: "home", placeId: "b", previousPlaceName: null });
    expect(next.map((place) => place.role)).toEqual([null, "home", null]);
    expect(next[0].name).toBe("12 Example Street");
  });

  it("clears a slot", () => {
    expect(applyPlaceRoleLocally(places, { role: "work", placeId: null, previousPlaceName: null }).map((place) => place.role))
      .toEqual(["home", null, null]);
  });
});

describe("applyPlaceRoleLocally with implicit holders", () => {
  const places = [
    { id: "a", name: "Home", role: null },
    { id: "b", name: " HOME ", role: null },
    { id: "c", name: "Flat", role: null }
  ];

  it("renames every role-less place named like the role when a name is given, as the server does", () => {
    expect(applyPlaceRoleLocally(places, { role: "home", placeId: "c", previousPlaceName: "Previous home" })).toEqual([
      { id: "a", name: "Previous home", role: null },
      { id: "b", name: "Previous home", role: null },
      { id: "c", name: "Flat", role: "home" }
    ]);
  });

  it("leaves them alone without a name, and never renames the target", () => {
    expect(applyPlaceRoleLocally(places, { role: "home", placeId: "a", previousPlaceName: "Previous home" }).map((place) => [place.name, place.role]))
      .toEqual([["Home", "home"], ["Previous home", null], ["Flat", null]]);
    expect(applyPlaceRoleLocally(places, { role: "home", placeId: "c", previousPlaceName: null }).map((place) => place.name))
      .toEqual(["Home", " HOME ", "Flat"]);
  });
});

// Synthetic coordinates: at latitude 10, 0.001° of latitude is about 111 m.
describe("replacePreviousOffered (Replace the old place, PRD D19 A10)", () => {
  const oldHome = { latitude: 10, longitude: 20 };

  it("offers it only within 300 m", () => {
    expect(replacePreviousOffered(oldHome, { latitude: 10, longitude: 20 })).toBe(true);
    expect(replacePreviousOffered(oldHome, { latitude: 10.002, longitude: 20 })).toBe(true);
    expect(replacePreviousOffered(oldHome, { latitude: 10.003, longitude: 20 })).toBe(false);
  });

  it("never offers it when either place has no coordinates", () => {
    expect(replacePreviousOffered(null, oldHome)).toBe(false);
    expect(replacePreviousOffered(oldHome, null)).toBe(false);
    expect(replacePreviousOffered({ latitude: null, longitude: null }, oldHome)).toBe(false);
    expect(replacePreviousOffered(oldHome, { latitude: 10 })).toBe(false);
    expect(replacePreviousOffered(oldHome, { latitude: Number.NaN, longitude: 20 })).toBe(false);
  });

  it("says why, and that it can be restored", () => {
    expect(replacePreviousNote("home")).toBe("Your old Home is close by; archive it so the two don't overlap. You can restore it from Places.");
    expect(replacePreviousNote("work")).toMatch(/^Your old Work is close by/);
  });
});

describe("applyPlaceRoleLocally with Replace the old place", () => {
  const places = [
    { id: "a", name: "Example Flat", role: "home" as const, latitude: 10, longitude: 20 },
    { id: "b", name: "Example Gym", role: null, latitude: 10.001, longitude: 20 },
    { id: "c", name: "Example Office", role: null, latitude: 10.01, longitude: 20 }
  ];

  it("drops the archived old holder from the list", () => {
    expect(applyPlaceRoleLocally(places, { role: "home", placeId: "b", previousPlaceName: null, archivePrevious: true }).map((place) => [place.id, place.role]))
      .toEqual([["b", "home"], ["c", null]]);
  });

  it("keeps an old holder farther than 300 m (the server archives nothing)", () => {
    expect(applyPlaceRoleLocally(places, { role: "home", placeId: "c", previousPlaceName: null, archivePrevious: true }).map((place) => [place.id, place.role]))
      .toEqual([["a", null], ["b", null], ["c", "home"]]);
  });

  it("archives a nearby implicit holder named like the role, even without a rename", () => {
    const implicit = [{ ...places[0], name: "Home", role: null }, places[1]];
    expect(applyPlaceRoleLocally(implicit, { role: "home", placeId: "b", previousPlaceName: null, archivePrevious: true }).map((place) => place.id))
      .toEqual(["b"]);
  });
});

describe("Places › Archived (PRD D19 A10)", () => {
  it("keeps the server's order and says the history is kept", () => {
    expect(archivedPlaceRows([{ id: "p2", name: "Example Gym" }, { id: "p1", name: "Example Studio" }])).toEqual([
      { id: "p2", name: "Example Gym", subtitle: "History kept", accessibilityLabel: "Example Gym, archived, history kept", restoreLabel: "Restore Example Gym" },
      { id: "p1", name: "Example Studio", subtitle: "History kept", accessibilityLabel: "Example Studio, archived, history kept", restoreLabel: "Restore Example Studio" }
    ]);
  });

  it("confirms an archive with what it keeps and where to restore it", () => {
    expect(archivePlaceConfirmCopy({ name: "Example Gym", role: null })).toEqual({
      eyebrow: "Place",
      title: "Archive Example Gym?",
      message: "Past blocks keep its name, and it stops matching new visits. You can restore it from Places › Archived.",
      confirmLabel: "Archive"
    });
    expect(archivePlaceConfirmCopy({ name: "Example Flat", role: "home" })).toEqual(expect.objectContaining({
      title: "Archive Home?",
      message: "Past blocks keep its name, and it stops matching new visits and stops being your Home. You can restore it from Places › Archived."
    }));
  });
});

describe("deleted places hand-off", () => {
  it("tells a page that is already showing", () => {
    const heard: string[] = [];
    const stop = subscribeDeletedPlaces((key) => heard.push(key));
    notePlaceDeleted("w:live", "p9");
    stop();
    notePlaceDeleted("w:live", "p10");
    expect(heard).toEqual(["w:live"]);
    expect(takeDeletedPlaces("w:live")).toEqual(["p9", "p10"]);
  });

  it("is per account and taken once", () => {
    notePlaceDeleted("w:u", "p1");
    notePlaceDeleted("w:u", "p2");
    notePlaceDeleted("w:other", "p3");
    expect(takeDeletedPlaces("w:u")).toEqual(["p1", "p2"]);
    expect(takeDeletedPlaces("w:u")).toEqual([]);
    expect(takeDeletedPlaces("w:other")).toEqual(["p3"]);
  });
});

describe("placesPageState (staging feedback B2, Codex r1)", () => {
  it("draws the groups only from a list that was read", () => {
    expect(placesPageState(true, false)).toBe("ready");
    // A list already shown stays even when a later read fails.
    expect(placesPageState(true, true)).toBe("ready");
  });

  it("is pending before the first read settles and failed when it did not land", () => {
    expect(placesPageState(false, false)).toBe("pending");
    expect(placesPageState(false, true)).toBe("failed");
  });
});
