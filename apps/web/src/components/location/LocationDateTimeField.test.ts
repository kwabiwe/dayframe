import { describe, expect, it, vi } from "vitest";

// The hour the clocks skip depends on this machine's zone; stand it in for one local time.
vi.mock("@/lib/format", async (original) => {
  const actual = await original<typeof import("@/lib/format")>();
  return { ...actual, dateTimeLocalInputToIso: (value: string) => value === "2026-03-29T01:30" ? null : actual.dateTimeLocalInputToIso(value) };
});

const { locationDateTimeStatus } = await import("./LocationDateTimeField");

describe("locationDateTimeStatus (WUI-042, Codex r1/r2 on #474)", () => {
  const today = "2026-10-17";

  it("sends a readable time, and nothing for an empty field", () => {
    expect(locationDateTimeStatus("2026-10-16T09:59", null, today)).toBe("ok");
    expect(locationDateTimeStatus("2026-10-16T09:59", "10:05 am", today)).toBe("ok");
    expect(locationDateTimeStatus("", null, today)).toBe("ok");
    // Focusing an empty End shows an empty field, which is still fine (Codex r2 on #474).
    expect(locationDateTimeStatus("", "", today)).toBe("ok");
  });

  it("holds an unreadable time, a cleared time and a day without a time", () => {
    expect(locationDateTimeStatus("2026-10-16T09:59", "99", today)).toBe("unreadable");
    expect(locationDateTimeStatus("2026-10-16T09:59", "", today)).toBe("unreadable");
    expect(locationDateTimeStatus("2026-10-16T", null, today)).toBe("missing");
  });

  it("holds a local time the day does not have instead of dropping it (Codex r2 on #474)", () => {
    expect(locationDateTimeStatus("2026-03-29T00:30", "1:30", today)).toBe("nonexistent");
  });
});
