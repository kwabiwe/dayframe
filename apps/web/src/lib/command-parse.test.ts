import { describe, expect, it } from "vitest";
import {
  activitiesForMention,
  findActiveMention,
  mentionGuardFor,
  mentionMarks,
  mentionTokens,
  parseCommand,
  pendingMentionActivity,
  shiftMentionMarks,
  syncMentionGuard,
  withoutPendingMentions,
  type MentionMark
} from "./command-parse";

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
    expect(withoutPendingMentions("Fix bug @wri", savedIn("Fix bug", "Fix bug @wri"))).toBe("Fix bug");
    expect(withoutPendingMentions("Fix bug @", savedIn("Fix bug", "Fix bug @"))).toBe("Fix bug");
    expect(withoutPendingMentions("Fix @a more @b ", savedIn("Fix", "Fix @a more @b "))).toBe("Fix more");
    // An @word the block already had stays; unchanged text is returned as it was.
    expect(withoutPendingMentions("Call @mum today", savedIn("Call @mum", "Call @mum today"))).toBe("Call @mum today");
    expect(withoutPendingMentions("Call @mum @mum", savedIn("Call @mum", "Call @mum @mum"))).toBe("Call @mum");
    expect(withoutPendingMentions("  spaced  text ")).toBe("  spaced  text ");
    expect(withoutPendingMentions("mail me@example.com")).toBe("mail me@example.com");
  });

  it("recording: Enter resolves only newly typed @words, leaving a duration and saved @words as text", () => {
    expect(pendingMentionActivity("Fix bug @admin 45m", savedIn("Fix bug", "Fix bug @admin 45m"), activities))
      .toMatchObject({ categoryId: "admin", description: "Fix bug 45m" });
    // Unresolved new @words still never reach the saved text.
    expect(pendingMentionActivity("Fix bug @nothing", savedIn("Fix bug", "Fix bug @nothing"), activities))
      .toMatchObject({ categoryId: null, description: "Fix bug" });
    // A saved "@admin" is literal: it neither switches nor leaves the text.
    expect(pendingMentionActivity("Email @admin team", mentionMarks("Email @admin team"), activities))
      .toMatchObject({ categoryId: null, description: "Email @admin team" });
    expect(pendingMentionActivity("Email @admin team @deep", savedIn("Email @admin team", "Email @admin team @deep"), activities))
      .toEqual({ categoryId: "deep", description: "Email @admin team", marks: [{ start: 6, token: "@admin" }] });
  });

  it("uses the list's resolver everywhere: exact, then prefix, then substring", () => {
    const writing = [{ id: "write", name: "Writing" }, { id: "wr", name: "Wrap-up" }];
    expect(parseCommand("Plan @rit", writing)).toMatchObject({ categoryId: "write", description: "Plan" });
    expect(parseCommand("Plan @rit", writing).categoryId).toBe(activitiesForMention("rit", writing)[0].id);
    expect(pendingMentionActivity("Fix @rit", [], writing).categoryId).toBe("write");
  });

  it("leaves literal @words alone after an activity was picked from the list", () => {
    expect(parseCommand("Plan @admin 45m", activities, mentionMarks("Plan @admin"))).toEqual({ description: "Plan @admin", categoryId: null, durationSeconds: 2700 });
    // A newly typed one still parses.
    expect(parseCommand("Plan @admin @deep", activities, mentionMarks("Plan @admin")).categoryId).toBe("deep");
    // Only the protected occurrence stays literal, whichever comes first.
    expect(parseCommand("Plan @admin @admin", activities, mentionMarks("Plan @admin"))).toMatchObject({ categoryId: "admin", description: "Plan @admin" });
    expect(parseCommand("@admin Plan @admin", activities, [{ start: 12, token: "@admin" }])).toMatchObject({ categoryId: "admin", description: "Plan @admin" });
  });

  it("tracks protected @words per occurrence across edits", () => {
    const literal = mentionMarks("Plan @foc @other");
    expect(literal).toEqual([{ start: 5, token: "@foc" }, { start: 10, token: "@other" }]);
    // Deleting @other unprotects only @other.
    expect(shiftMentionMarks(literal, "Plan @foc @other", "Plan @foc ", 10)).toEqual([{ start: 5, token: "@foc" }]);
    // Editing a token unprotects that token; the other one moves with the text.
    expect(shiftMentionMarks(literal, "Plan @foc @other", "Plan @focus @other", 11)).toEqual([{ start: 12, token: "@other" }]);
    // Of two identical literals, deleting one keeps the other protected where it is.
    expect(shiftMentionMarks(mentionMarks("@a x @a"), "@a x @a", "x @a", 0)).toEqual([{ start: 2, token: "@a" }]);
    expect(shiftMentionMarks(mentionMarks("@a x @a"), "@a x @a", "@a x ", 5)).toEqual([{ start: 0, token: "@a" }]);
    // Unchanged marks: the same array.
    expect(shiftMentionMarks(literal, "Plan @foc @other", "Plan @foc @other more", 21)).toBe(literal);
  });

  it("protection belongs to the occurrence, not the spelling (Codex r4)", () => {
    // Typing "@writing " before a saved "Discuss @writing", one key at a time (caret after each).
    let text = "Discuss @writing";
    let marks: readonly MentionMark[] = mentionMarks(text);
    for (const [index, char] of [..."@writing "].entries()) {
      const next = `${text.slice(0, index)}${char}${text.slice(index)}`;
      marks = shiftMentionMarks(marks, text, next, index + 1);
      text = next;
    }
    expect(text).toBe("@writing Discuss @writing");
    expect(marks).toEqual([{ start: 17, token: "@writing" }]);
    // The new one at the start is the command; the saved one at the end is literal.
    expect(findActiveMention(text, text.length, marks)).toBeNull();
    expect(findActiveMention(text, 8, marks)).toEqual({ start: 0, end: 8, query: "writing" });
    expect(withoutPendingMentions(text, marks)).toBe("Discuss @writing");

    // The same with identical text on both sides, where only the caret tells the edits apart.
    text = "@x @x";
    marks = mentionMarks(text);
    for (const [index, char] of [..."@x "].entries()) {
      const next = `${text.slice(0, index)}${char}${text.slice(index)}`;
      marks = shiftMentionMarks(marks, text, next, index + 1);
      text = next;
    }
    expect(text).toBe("@x @x @x");
    expect(marks).toEqual([{ start: 3, token: "@x" }, { start: 6, token: "@x" }]);
    // Pasted in one go.
    expect(shiftMentionMarks(mentionMarks("@x @x"), "@x @x", "@x @x @x", 3)).toEqual([{ start: 3, token: "@x" }, { start: 6, token: "@x" }]);

    // Inserted after the literal: it stays where it is.
    expect(shiftMentionMarks(mentionMarks("Discuss @writing"), "Discuss @writing", "Discuss @writing @writing", 25))
      .toEqual([{ start: 8, token: "@writing" }]);
    // Deleting text before it moves it back.
    expect(shiftMentionMarks(mentionMarks("Discuss @writing"), "Discuss @writing", "Dis @writing", 3))
      .toEqual([{ start: 4, token: "@writing" }]);
    // Typing straight on after it extends (edits) it.
    expect(shiftMentionMarks(mentionMarks("Call @mum"), "Call @mum", "Call @mums", 10)).toEqual([]);
    // Typing before it moves it; a space typed straight after it keeps it.
    expect(shiftMentionMarks(mentionMarks("Call @mum"), "Call @mum", "Call @mum ", 10)).toEqual([{ start: 5, token: "@mum" }]);
  });

  it("follows the running block: a new block re-reads its saved @words, its own autosave keeps the marks", () => {
    const guard = mentionGuardFor("block", "Discuss @writing", "@writing Discuss @writing");
    expect(guard.marks).toEqual([{ start: 17, token: "@writing" }]);
    // Unchanged: the same guard.
    expect(syncMentionGuard(guard, "block", "Discuss @writing", "@writing Discuss @writing")).toBe(guard);
    // The bar's own autosave landed: the tracked occurrence stays, the new command does not gain it.
    const typed = { ...guard, text: "@writing Discuss @writing now" };
    expect(syncMentionGuard(typed, "block", "Discuss @writing now", "@writing Discuss @writing now").marks)
      .toEqual([{ start: 17, token: "@writing" }]);
    // Idle has no saved @words; a new block reads its own.
    expect(syncMentionGuard(guard, null, "", "Plan").marks).toEqual([]);
    expect(syncMentionGuard(guard, "next", "Call @mum", "Call @mum").marks).toEqual([{ start: 5, token: "@mum" }]);
  });

  it("never opens the list on a protected @word, only on a new occurrence", () => {
    expect(findActiveMention("Plan @foc", 9, mentionMarks("Plan @foc"))).toBeNull();
    expect(findActiveMention("Plan @foc @foc", 14, mentionMarks("Plan @foc"))).toEqual({ start: 10, end: 14, query: "foc" });
    expect(findActiveMention("Plan @foc @fo", 13, mentionMarks("Plan @foc"))).toEqual({ start: 10, end: 13, query: "fo" });
    expect(findActiveMention("Discuss @writing", 16, mentionMarks("Discuss @writing"))).toBeNull();
    expect(mentionTokens("Plan @foc @")).toEqual(["@foc", "@"]);
  });
});

/** The saved description's protected @words, followed into the edited text. */
function savedIn(saved: string, text: string) {
  return mentionGuardFor("block", saved, text).marks;
}
