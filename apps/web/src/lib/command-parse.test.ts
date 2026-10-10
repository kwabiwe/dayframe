import { describe, expect, it } from "vitest";
import { parseCommand } from "./command-parse";

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
