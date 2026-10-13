import { describe, expect, it, vi } from "vitest";
import { formatLocaleDate } from "./localeDateFormat";

describe("formatLocaleDate", () => {
  const date = new Date(2026, 9, 12, 18, 45);
  it.each([
    { weekday: "narrow" },
    { weekday: "long", day: "numeric", month: "long" },
    { day: "numeric", month: "short" },
    { month: "long" }
  ] as Intl.DateTimeFormatOptions[])("matches toLocaleDateString for %j", (options) => {
    expect(formatLocaleDate(date, options)).toBe(date.toLocaleDateString(undefined, options));
  });
  it("builds one formatter per option set", () => {
    const Original = Intl.DateTimeFormat;
    let created = 0;
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation((function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      created += 1;
      return new Original(...args);
    }) as never);
    for (let day = 1; day <= 30; day += 1) formatLocaleDate(new Date(2026, 8, day), { weekday: "short", day: "2-digit" });
    expect(created).toBe(1);
    spy.mockRestore();
  });
});
