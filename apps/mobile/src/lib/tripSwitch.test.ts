import { describe, expect, it } from "vitest";
import { shownTripSwitch, withSavedTripSwitch } from "./tripSwitch";

const user = (logTripsAutomatically: boolean, goalsRevision: number, id = "user-1") => ({ id, email: "", name: "", logTripsAutomatically, goalsRevision });
const data = (value: boolean, revision: number, id = "user-1") => ({ user: user(value, revision, id) }) as never;
const saved = { userId: "user-1", value: false, revision: 6 };

describe("Log trips automatically on iPhone (PRD D19, A4; Codex r1 on #464)", () => {
  it("keeps the saved value over a copy read before the save, published late or recovered from cache", () => {
    expect(shownTripSwitch(user(true, 5), saved)).toBe(false);
  });

  it("shows the copy's value from the save's revision on, and for another account", () => {
    expect(shownTripSwitch(user(false, 6), saved)).toBe(false);
    expect(shownTripSwitch(user(true, 7), saved)).toBe(true);
    expect(shownTripSwitch(user(true, 2, "user-2"), saved)).toBe(true);
    expect(shownTripSwitch(undefined, saved)).toBeUndefined();
  });

  it("applies a late save answer only over an older copy of its account", () => {
    expect(withSavedTripSwitch(data(true, 5), saved)).toMatchObject({ user: { logTripsAutomatically: false, goalsRevision: 6 } });
    const newer = data(true, 7);
    expect(withSavedTripSwitch(newer, saved)).toBe(newer);
    const other = data(true, 1, "user-2");
    expect(withSavedTripSwitch(other, saved)).toBe(other);
  });
});
