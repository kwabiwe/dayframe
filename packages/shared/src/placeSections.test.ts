import { describe, expect, it } from "vitest";
import {
  PLACE_SECTIONS_MIN_PLACES,
  placeLastVisitLabel,
  placeListLayout,
  placeMatchesSearch,
  placeRecentVisitsLabel,
  placeVisitsById,
  type PlaceVisitStats
} from "./placeSections";

type Place = { id: string; name: string; role: "home" | "work" | null };

const place = (id: string, name: string, role: Place["role"] = null): Place => ({ id, name, role });
const visit = (placeId: string, lastVisitAt: string | null, visitsLast30Days: number): PlaceVisitStats =>
  ({ placeId, lastVisitAt, visitsLast30Days });

const names = (places: Place[]) => places.map((item) => item.name);

// Twelve synthetic places in Exampleton, plus Home and Work.
const many: Place[] = [
  place("h", "1 Example Road", "home"),
  place("w", "Exampleton Works", "work"),
  ...["Zest Gym", "Alder Café", "Birch Library", "Cedar Pool", "Dock Market", "Elm Park", "Fern School",
    "Gorse Clinic", "Hazel Studio", "Ivy Bakery", "Juniper Hall", "Kelp Station"].map((name, index) => place(`p${index}`, name))
];

describe("placeListLayout", () => {
  it("keeps a short list as one A–Z list without search", () => {
    const short = [place("a", "Zest Gym"), place("b", "alder Café"), place("c", "1 Example Road", "home")];
    const layout = placeListLayout(short, new Map());
    expect(layout.searchable).toBe(false);
    expect(layout.sections.map((section) => section.key)).toEqual(["all"]);
    // Home sorts by the name shown ("Home"), case-insensitively.
    expect(names(layout.sections[0].places)).toEqual(["alder Café", "1 Example Road", "Zest Gym"]);
  });

  it("ignores a search typed while the list is short", () => {
    const short = [place("a", "Zest Gym"), place("b", "Alder Café")];
    expect(placeListLayout(short, new Map(), "zest").sections[0].places).toHaveLength(2);
  });

  it("gives no sections without places", () => {
    expect(placeListLayout([], new Map())).toEqual({ searchable: false, sections: [] });
  });

  it("adds Frequent and Recent above All from the threshold, leaving Home and Work out", () => {
    expect(many.length).toBeGreaterThanOrEqual(PLACE_SECTIONS_MIN_PLACES);
    const visits = placeVisitsById([
      visit("h", "2026-10-21T08:00:00.000Z", 30),
      visit("w", "2026-10-20T17:00:00.000Z", 12),
      visit("p0", "2026-10-19T09:00:00.000Z", 6),
      visit("p1", "2026-10-20T09:00:00.000Z", 3),
      visit("p2", "2026-10-21T07:00:00.000Z", 1),
      visit("p3", "2026-09-01T07:00:00.000Z", 0),
      visit("p4", "2026-10-18T07:00:00.000Z", 3)
    ]);
    const layout = placeListLayout(many, visits);
    expect(layout.searchable).toBe(true);
    expect(layout.sections.map((section) => section.key)).toEqual(["frequent", "recent", "all"]);
    // Most visits first; a tie goes to the later visit.
    expect(names(layout.sections[0].places)).toEqual(["Zest Gym", "Alder Café", "Dock Market"]);
    // Recent: by last visit, without the places already in Frequent.
    expect(names(layout.sections[1].places)).toEqual(["Birch Library", "Cedar Pool"]);
    expect(layout.sections[2].title).toBe("All places");
    expect(layout.sections[2].places).toHaveLength(many.length);
  });

  it("caps each shortlist at five and drops empty ones", () => {
    const visits = placeVisitsById(many.slice(2).map((item, index) => visit(item.id, `2026-10-${String(10 + index).padStart(2, "0")}T09:00:00.000Z`, 1)));
    const layout = placeListLayout(many, visits);
    expect(layout.sections.map((section) => section.key)).toEqual(["recent", "all"]);
    expect(names(layout.sections[0].places)).toEqual(["Kelp Station", "Juniper Hall", "Ivy Bakery", "Hazel Studio", "Gorse Clinic"]);
    expect(placeListLayout(many, new Map()).sections.map((section) => section.key)).toEqual(["all"]);
  });

  it("replaces the sections with Results: prefix matches first, accents and case ignored", () => {
    const withMore = [...many, place("x", "The Alder Rooms"), place("y", "Café Alder")];
    const layout = placeListLayout(withMore, new Map(), "  ALDER ");
    expect(layout.sections.map((section) => section.key)).toEqual(["results"]);
    expect(names(layout.sections[0].places)).toEqual(["Alder Café", "Café Alder", "The Alder Rooms"]);
    expect(names(placeListLayout(withMore, new Map(), "cafe").sections[0].places)).toEqual(["Café Alder", "Alder Café"]);
    expect(placeListLayout(withMore, new Map(), "nowhere").sections).toEqual([]);
  });

  it("finds Home and Work by their label and by their saved name", () => {
    expect(names(placeListLayout(many, new Map(), "home").sections[0].places)).toEqual(["1 Example Road"]);
    expect(names(placeListLayout(many, new Map(), "example road").sections[0].places)).toEqual(["1 Example Road"]);
    expect(placeMatchesSearch(place("w", "Exampleton Works", "work"), "work")).toBe(true);
  });
});

describe("placeLastVisitLabel", () => {
  const now = new Date("2026-10-21T10:00:00.000Z"); // a Wednesday

  it("says today, yesterday, the weekday within a week, then the date", () => {
    expect(placeLastVisitLabel("2026-10-21T06:00:00.000Z", now, "Europe/London")).toBe("Last visit today");
    expect(placeLastVisitLabel("2026-10-20T22:30:00.000Z", now, "Europe/London")).toBe("Last visit yesterday");
    expect(placeLastVisitLabel("2026-10-19T09:00:00.000Z", now, "Europe/London")).toBe("Last visit Monday");
    expect(placeLastVisitLabel("2026-10-15T09:00:00.000Z", now, "Europe/London")).toBe("Last visit Thursday");
    expect(placeLastVisitLabel("2026-10-14T09:00:00.000Z", now, "Europe/London")).toBe("Last visit 14 Oct");
    expect(placeLastVisitLabel("2025-12-30T09:00:00.000Z", now, "Europe/London")).toBe("Last visit 30 Dec 2025");
  });

  it("follows the viewer's day boundaries", () => {
    // 23:30 UTC on the 20th is already the 21st in Tokyo, and still the 20th in New York.
    expect(placeLastVisitLabel("2026-10-20T23:30:00.000Z", now, "Asia/Tokyo")).toBe("Last visit today");
    expect(placeLastVisitLabel("2026-10-20T23:30:00.000Z", now, "America/New_York")).toBe("Last visit yesterday");
  });

  it("treats a future time as today and says nothing without a visit", () => {
    expect(placeLastVisitLabel("2026-10-21T12:00:00.000Z", now, "Europe/London")).toBe("Last visit today");
    expect(placeLastVisitLabel(null, now)).toBeNull();
    expect(placeLastVisitLabel("not a date", now)).toBeNull();
  });
});

describe("placeRecentVisitsLabel", () => {
  it("counts from two visits", () => {
    expect(placeRecentVisitsLabel(visit("a", null, 4))).toBe("4 visits in 30 days");
    expect(placeRecentVisitsLabel(visit("a", null, 1))).toBeNull();
    expect(placeRecentVisitsLabel(undefined)).toBeNull();
  });
});
