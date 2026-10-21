import { describe, expect, it } from "vitest";
import {
  applyPlaceRoleLocally,
  archivePlaceConfirmCopy,
  archivedPlaceRows,
  createMonitorQueue,
  createPageReadGate,
  createPlaceRestoreGate,
  pendingRestoredRows,
  learnedPlaceSubtitle,
  notePlaceDeleted,
  placeRowSubtitle,
  placesPageState,
  replacePreviousNote,
  replacePreviousOffered,
  restoredMonitoredMessage,
  restoredNotMonitoredMessage,
  restoredNotRefreshedMessage,
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

describe("createPageReadGate (Codex r5 on #508)", () => {
  it("applies reads in any order only while each is newer than the last applied", () => {
    const gate = createPageReadGate();
    const older = gate.begin("1");
    const newer = gate.begin("1");
    expect(gate.judge(newer, "1")).toBe("apply");
    gate.applied(newer);
    expect(gate.judge(older, "1")).toBe("stale");
    expect(gate.isCurrent(newer)).toBe(true);
    expect(gate.superseded(older)).toBe(true);
  });

  it("lets an older read apply when it lands first, then the newer one", () => {
    const gate = createPageReadGate();
    const older = gate.begin("1");
    const newer = gate.begin("1");
    expect(gate.judge(older, "1")).toBe("apply");
    gate.applied(older);
    expect(gate.judge(newer, "1")).toBe("apply");
    gate.applied(newer);
    expect(gate.isCurrent(older)).toBe(false);
  });

  it("drops a read that a change overtook, and one from another account lifetime", () => {
    const gate = createPageReadGate();
    const before = gate.begin("1");
    gate.changed();
    const after = gate.begin("1");
    expect(gate.judge(before, "1")).toBe("stale");
    expect(gate.judge(after, "1")).toBe("apply");
    expect(gate.judge(after, "2")).toBe("foreign");
  });

  it("ends an applied list's follow-ups once a change is accepted (Codex r6 on #508)", () => {
    const gate = createPageReadGate();
    const read = gate.begin("1");
    gate.applied(read);
    expect(gate.isCurrent(read)).toBe(true);
    gate.changed();
    expect(gate.isCurrent(read)).toBe(false);
    // The read after the change is current again once applied.
    const next = gate.begin("1");
    gate.applied(next);
    expect(gate.isCurrent(next)).toBe(true);
  });

  it("reports a failure only for the newest read started", () => {
    const gate = createPageReadGate();
    const first = gate.begin("1");
    expect(gate.isNewest(first)).toBe(true);
    const second = gate.begin("1");
    expect(gate.isNewest(first)).toBe(false);
    expect(gate.isNewest(second)).toBe(true);
  });
});

function deferredBoolean() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((res) => { resolve = res; });
  return { promise, resolve };
}

describe("createMonitorQueue (Codex r6 on #508)", () => {
  it("runs one refresh at a time, ends on the newest input, and finishes only that one", async () => {
    const runs: Array<{ input: string; done: ReturnType<typeof deferredBoolean> }> = [];
    const finished: Array<[string, boolean]> = [];
    const queue = createMonitorQueue<string>((input) => {
      const done = deferredBoolean();
      runs.push({ input, done });
      return done.promise;
    }, (input, refreshed) => finished.push([input, refreshed]));
    expect(queue.engaged()).toBe(false);
    const first = queue.request("older");
    expect(queue.engaged()).toBe(true);
    await Promise.resolve();
    void queue.request("middle");
    const last = queue.request("newest");
    // Only the running one has started; the newest replaced the one waiting.
    expect(runs.map((run) => run.input)).toEqual(["older"]);
    runs[0].done.resolve(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runs.map((run) => run.input)).toEqual(["older", "newest"]);
    expect(finished).toEqual([]);
    runs[1].done.resolve(false);
    await Promise.all([first, last]);
    expect(finished).toEqual([["newest", false]]);
  });

  it("starts again for a request made after it drained, and treats a throw as a failed refresh", async () => {
    const finished: Array<[number, boolean]> = [];
    const queue = createMonitorQueue<number>(async (input) => {
      if (input === 2) throw new Error("location unavailable");
      return true;
    }, (input, refreshed) => finished.push([input, refreshed]));
    await queue.request(1);
    await queue.request(2);
    expect(finished).toEqual([[1, true], [2, false]]);
  });
});

describe("createPlaceRestoreGate (Codex r1 on #508)", () => {
  it("lets one restore through at a time, and only its own request unlocks it", () => {
    const gate = createPlaceRestoreGate();
    const first = gate.take("ws:a");
    expect(first).not.toBeNull();
    expect(gate.take("ws:a")).toBeNull();
    expect(gate.release(first! + 1)).toBe(false);
    expect(gate.take("ws:a")).toBeNull();
    expect(gate.release(first!)).toBe(true);
    expect(gate.take("ws:a")).not.toBeNull();
  });

  it("is taken over by another account, and the old request's release never frees the new one", () => {
    const gate = createPlaceRestoreGate();
    const old = gate.take("ws:a")!;
    const other = gate.take("ws:b");
    expect(other).not.toBeNull();
    expect(gate.release(old)).toBe(false);
    expect(gate.take("ws:b")).toBeNull();
  });
});

describe("restored places waiting for a refresh (Codex r1 on #508)", () => {
  it("shows them under Saved places until the shown list has them", () => {
    const pending = [{ id: "p1", name: "Example Gym" }, { id: "p2", name: "Example Studio" }];
    expect(pendingRestoredRows(pending, [{ id: "p2" }])).toEqual([
      { id: "p1", name: "Example Gym", subtitle: "Restored · pull to refresh to finish", accessibilityLabel: "Example Gym, restored, pull to refresh to finish" }
    ]);
    expect(pendingRestoredRows(pending, [{ id: "p1" }, { id: "p2" }])).toEqual([]);
  });

  it("says honestly when visits at a restored place aren't noticed yet, and when they are again (Codex r4 on #508)", () => {
    expect(restoredNotMonitoredMessage("Example Gym")).toBe("Example Gym is restored, but visits there aren't noticed yet. Dayframe will keep trying.");
    expect(restoredMonitoredMessage("Example Gym")).toBe("Example Gym restored. Visits there are noticed again.");
  });

  it("says honestly that the restore landed but the list did not", () => {
    expect(restoredNotRefreshedMessage("Example Gym")).toBe(
      "Example Gym is restored, but Places couldn't refresh. Pull to refresh to finish; visits there are noticed again once it shows."
    );
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
