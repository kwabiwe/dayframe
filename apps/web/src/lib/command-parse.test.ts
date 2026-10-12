import { describe, expect, it } from "vitest";
import { activitiesForMention, findActiveMention, parseCommand } from "./command-parse";

const activities = [
  { id: "deep", name: "Deep work" },
  { id: "admin", name: "Admin" },
  { id: "adm2", name: "Admissions" },
  { id: "cafe", name: "Café" }
];

describe("parseCommand", () => {
  it("keeps plain text as the description", () => {
    expect(parseCommand("  Write  proposal ")).toEqual({ description: "Write proposal", durationSeconds: null });
  });

  it("never parses @words: only a choice from the Activities list removes one", () => {
    expect(parseCommand("Plan @deepwork week")).toEqual({ description: "Plan @deepwork week", durationSeconds: null });
    expect(parseCommand("mail me@admin.com")).toEqual({ description: "mail me@admin.com", durationSeconds: null });
  });

  it("reads a trailing duration as a finished block", () => {
    expect(parseCommand("Write proposal 45m")).toEqual({ description: "Write proposal", durationSeconds: 2700 });
    expect(parseCommand("Write proposal @admin 45m")).toEqual({ description: "Write proposal @admin", durationSeconds: 2700 });
    expect(parseCommand("Run 1.5h").durationSeconds).toBe(5400);
    expect(parseCommand("Run 2 hours").durationSeconds).toBe(7200);
    expect(parseCommand("45m")).toEqual({ description: "", durationSeconds: 2700 });
  });

  it("ignores durations in the middle, under a minute or over a day", () => {
    expect(parseCommand("Read 45m article").durationSeconds).toBeNull();
    expect(parseCommand("Stretch 0.5m").durationSeconds).toBeNull();
    expect(parseCommand("Trip 30h")).toEqual({ description: "Trip 30h", durationSeconds: null });
    expect(parseCommand("Room 101m2").durationSeconds).toBeNull();
  });
});

describe("the @ Activities list", () => {
  it("finds the @word at the caret, from the start of the text or after a space", () => {
    expect(findActiveMention("@", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(findActiveMention("Plan @dee", 9)).toEqual({ start: 5, end: 9, query: "dee" });
    // The caret inside the word still owns the whole word.
    expect(findActiveMention("Plan @deep later", 8)).toEqual({ start: 5, end: 10, query: "deep" });
    expect(findActiveMention("Plan @café", 10)?.query).toBe("café");
  });

  it("ignores an @ inside a word (an email address) or one the caret has left", () => {
    expect(findActiveMention("mail me@example", 15)).toBeNull();
    expect(findActiveMention("Plan @deep later", 16)).toBeNull();
    expect(findActiveMention("Plan", 4)).toBeNull();
  });

  it("offers names that start with the query first, then names that contain it", () => {
    expect(activitiesForMention("adm", activities).map((activity) => activity.id)).toEqual(["admin", "adm2"]);
    expect(activitiesForMention("work", activities).map((activity) => activity.id)).toEqual(["deep"]);
    expect(activitiesForMention("pwo", activities).map((activity) => activity.id)).toEqual(["deep"]);
    expect(activitiesForMention("", activities)).toHaveLength(activities.length);
    expect(activitiesForMention("zzz", activities)).toEqual([]);
  });

  it("ranks the exact name first, then prefixes, then contains", () => {
    const pinnedFirst = [
      { id: "focused", name: "Focused work" },
      { id: "refocus", name: "Refocus" },
      { id: "focus", name: "Focus" }
    ];
    expect(activitiesForMention("focus", pinnedFirst).map((activity) => activity.id)).toEqual(["focus", "focused", "refocus"]);
    expect(activitiesForMention("FOCUS", pinnedFirst)[0].id).toBe("focus");
  });
});
