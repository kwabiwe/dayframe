import { describe, expect, it } from "vitest";
import { previousEndOffer } from "./previousEndStart";

const day = Date.parse("2026-10-14T00:00:00.000Z");
const at = (time: string) => `2026-10-14T${time}:00.000Z`;
const entry = (id: string, startedAt: string, stoppedAt: string | null, description: string | null = null, categoryName: string | null = "Deep work") =>
  ({ id, categoryName, description, startedAt, stoppedAt });

describe("previousEndOffer", () => {
  it("offers today's latest end within four hours, named as its row is", () => {
    const entries = [
      entry("a", at("08:00"), at("09:00")),
      entry("b", at("09:30"), at("10:15"), "Write report"),
      entry("c", at("07:00"), at("08:00"))
    ];
    expect(previousEndOffer(entries, { dayStartMs: day, startMs: Date.parse(at("11:00")) })).toEqual({
      startedAt: at("10:15"),
      previousName: "Write report",
      previousId: "b"
    });
  });

  it("uses the latest end, not the latest start, so the new block overlaps nothing", () => {
    const entries = [entry("long", at("08:00"), at("10:30")), entry("short", at("09:00"), at("09:30"))];
    expect(previousEndOffer(entries, { dayStartMs: day, startMs: Date.parse(at("11:00")) })?.startedAt).toBe(at("10:30"));
  });

  it("offers nothing for a gap under a minute, over four hours, or a block that ended yesterday", () => {
    const one = (stoppedAt: string) => [entry("a", "2026-10-13T20:00:00.000Z", stoppedAt)];
    expect(previousEndOffer(one(at("10:59")), { dayStartMs: day, startMs: Date.parse(at("10:59")) + 59_000 })).toBeNull();
    expect(previousEndOffer(one(at("10:59")), { dayStartMs: day, startMs: Date.parse(at("10:59")) + 60_000 })).not.toBeNull();
    expect(previousEndOffer(one(at("06:59")), { dayStartMs: day, startMs: Date.parse(at("11:00")) })).toBeNull();
    expect(previousEndOffer(one(at("07:00")), { dayStartMs: day, startMs: Date.parse(at("11:00")) })).not.toBeNull();
    expect(previousEndOffer(one("2026-10-13T23:30:00.000Z"), { dayStartMs: day, startMs: Date.parse(at("01:00")) })).toBeNull();
  });

  it("offers nothing when a finished block ends after the start (time added ahead)", () => {
    const entries = [entry("a", at("08:00"), at("09:00")), entry("ahead", at("10:00"), at("12:00"))];
    expect(previousEndOffer(entries, { dayStartMs: day, startMs: Date.parse(at("11:00")) })).toBeNull();
  });

  it("ignores the running block and the excluded block", () => {
    const entries = [entry("a", at("08:00"), at("09:00")), entry("run", at("09:10"), null), entry("x", at("09:00"), at("10:00"))];
    expect(previousEndOffer(entries, { dayStartMs: day, excludeId: "x", startMs: Date.parse(at("10:30")) })?.previousId).toBe("a");
    expect(previousEndOffer([], { dayStartMs: day, startMs: Date.parse(at("10:30")) })).toBeNull();
  });

  it("falls back to the activity, then No activity", () => {
    const options = { dayStartMs: day, startMs: Date.parse(at("11:00")) };
    expect(previousEndOffer([entry("a", at("09:00"), at("10:00"), "  ", "Reading")], options)?.previousName).toBe("Reading");
    expect(previousEndOffer([entry("a", at("09:00"), at("10:00"), null, null)], options)?.previousName).toBe("No activity");
  });
});
