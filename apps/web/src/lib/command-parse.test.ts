import { describe, expect, it } from "vitest";
import { activitiesForMention, findActiveMention, parseActivityMention, parseCommand, withoutPendingMentions } from "./command-parse";

const activities = [
  { id: "deep", name: "Deep work" },
  { id: "admin", name: "Admin" },
  { id: "adm2", name: "Admissions" },
  { id: "cafe", name: "Café" }
];

describe("parseCommand", () => {
  it("keeps plain text as the description", () => {
    expect(parseCommand("  Write  proposal ", activities)).toEqual({ description: "Write proposal", categoryId: null, durationSeconds: null });
  });

  it("picks an activity by @ and the start of its name, ignoring spaces", () => {
    expect(parseCommand("Plan @deepwork week", activities)).toMatchObject({ description: "Plan week", categoryId: "deep" });
    expect(parseCommand("@dee", activities).categoryId).toBe("deep");
    expect(parseCommand("@café", activities).categoryId).toBe("cafe");
  });

  it("prefers an exact name over a longer one that starts the same", () => {
    expect(parseCommand("@admin", activities).categoryId).toBe("admin");
  });

  it("leaves an unknown @word and email-like text alone", () => {
    expect(parseCommand("Ping @nobody", activities)).toMatchObject({ description: "Ping @nobody", categoryId: null });
    expect(parseCommand("mail me@admin.com", activities)).toMatchObject({ description: "mail me@admin.com", categoryId: null });
  });

  it("reads a trailing duration as a finished block", () => {
    expect(parseCommand("Write proposal @admin 45m", activities)).toEqual({ description: "Write proposal", categoryId: "admin", durationSeconds: 2700 });
    expect(parseCommand("Run 1.5h", activities).durationSeconds).toBe(5400);
    expect(parseCommand("Run 2 hours", activities).durationSeconds).toBe(7200);
    expect(parseCommand("45m", activities)).toEqual({ description: "", categoryId: null, durationSeconds: 2700 });
  });

  it("ignores durations in the middle, under a minute or over a day", () => {
    expect(parseCommand("Read 45m article", activities).durationSeconds).toBeNull();
    expect(parseCommand("Stretch 0.5m", activities).durationSeconds).toBeNull();
    expect(parseCommand("Trip 30h", activities)).toMatchObject({ description: "Trip 30h", durationSeconds: null });
    expect(parseCommand("Room 101m2", activities).durationSeconds).toBeNull();
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

  it("ranks the exact name first, as the parser picks it, then prefixes, then contains", () => {
    const pinnedFirst = [
      { id: "focused", name: "Focused work" },
      { id: "refocus", name: "Refocus" },
      { id: "focus", name: "Focus" }
    ];
    expect(activitiesForMention("focus", pinnedFirst).map((activity) => activity.id)).toEqual(["focus", "focused", "refocus"]);
    expect(activitiesForMention("FOCUS", pinnedFirst)[0].id).toBe(parseCommand("@focus", pinnedFirst).categoryId);
    expect(activitiesForMention("focu", pinnedFirst)[0].id).toBe(parseCommand("@focu", pinnedFirst).categoryId);
  });

  it("leaves unfinished @ commands out of a running block's saved description", () => {
    expect(withoutPendingMentions("Fix bug @wri", "Fix bug")).toBe("Fix bug");
    expect(withoutPendingMentions("Fix bug @", "Fix bug")).toBe("Fix bug");
    expect(withoutPendingMentions("Fix @a more @b ", "Fix")).toBe("Fix more");
    // An @word the block already had stays; unchanged text is returned as it was.
    expect(withoutPendingMentions("Call @mum today", "Call @mum")).toBe("Call @mum today");
    expect(withoutPendingMentions("Call @mum @mum", "Call @mum")).toBe("Call @mum");
    expect(withoutPendingMentions("  spaced  text ", "")).toBe("  spaced  text ");
    expect(withoutPendingMentions("mail me@example.com", "")).toBe("mail me@example.com");
  });

  it("parses only the @activity while recording, leaving a duration as text", () => {
    expect(parseActivityMention("Fix bug @admin 45m", activities)).toEqual({ categoryId: "admin", description: "Fix bug 45m" });
    expect(parseActivityMention("Fix bug @nothing", activities)).toEqual({ categoryId: null, description: "Fix bug @nothing" });
  });
});
