import { describe, expect, it } from "vitest";
import { runLocationEngine, type LocationEngineInput } from "../src/location";

import { place, incident } from "../src/location/savedPlaceQualityFixture";

// Archive place (location v3 PR 15, PRD D19 A10; Codex r1 on #503): replay keeps an archived place
// in its catalogue, matching only evidence from before it was archived, so its past visits keep
// their identity (and their blocks) and no new visit matches it. Synthetic fixture only.
function stays(value: LocationEngineInput) { return runLocationEngine(value).segmentUpserts.filter((segment) => segment.kind === "stay"); }
function archivedAt(value: LocationEngineInput, at: string, learned = false): LocationEngineInput {
  return learned
    ? { ...value, savedPlaces: [], acceptedLearnedPlaces: [{ ...place, accepted: true, archivedAt: at }] }
    : { ...value, savedPlaces: [{ ...place, archivedAt: at }] };
}

describe("an archived place in replay", () => {
  it("replays visits from before it was archived exactly as before", () => {
    for (const learned of [false, true]) {
      const live = learned ? { ...incident(), savedPlaces: [], acceptedLearnedPlaces: [{ ...place, accepted: true as const }] } : incident();
      expect(runLocationEngine(archivedAt(incident(), "2026-09-15T13:00:00.000Z", learned))).toEqual(runLocationEngine(live));
      expect(stays(live)[0]).toMatchObject(learned ? { learnedPlaceId: place.id } : { placeId: place.id });
    }
  });

  it("matches nothing there from the moment it was archived, geofence hints included", () => {
    for (const learned of [false, true]) {
      const result = stays(archivedAt(incident(), "2026-09-15T11:00:00.000Z", learned));
      expect(result.some((stay) => stay.placeId === place.id || stay.learnedPlaceId === place.id)).toBe(false);
    }
  });

  it("leaves history with the old place when a new one next to it replaced it (Codex r2 on #503)", () => {
    const replacedAt = "2026-09-15T13:00:00.000Z";
    // On the same spot and sorting first, so without its start it would take the old place's visits.
    const successor = { ...place, id: "00000000-0000-4000-8000-000000000001", name: "Synthetic gym (new)" };
    const before = stays(incident());
    const replaced = { ...incident(), savedPlaces: [{ ...place, archivedAt: replacedAt }, { ...successor, matchingStartsAt: replacedAt }] };
    expect(stays(replaced)).toEqual(before);
    const unguarded = { ...incident(), savedPlaces: [{ ...place, archivedAt: replacedAt }, successor] };
    expect(stays(unguarded).some((stay) => stay.placeId === successor.id)).toBe(true);
    // Readings after it replaced the old place match the new one.
    const later = { ...incident(), savedPlaces: [{ ...place, archivedAt: "2026-09-15T11:00:00.000Z" }, { ...successor, matchingStartsAt: "2026-09-15T11:00:00.000Z" }] };
    expect(stays(later).some((stay) => stay.placeId === successor.id)).toBe(true);
  });
});
