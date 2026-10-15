import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove: () => undefined }) } }));

const { nextAnchoredSecondDelayMs } = await import("./dashboardClock");

describe("nextAnchoredSecondDelayMs", () => {
  it("lands just after the next whole second since the anchor, also before the anchor and on the boundary", () => {
    const anchor = Date.parse("2026-10-15T14:30:07.000Z");
    expect(nextAnchoredSecondDelayMs(anchor, anchor + 400)).toBe(615);
    expect(nextAnchoredSecondDelayMs(anchor, anchor + 999)).toBe(16);
    expect(nextAnchoredSecondDelayMs(anchor, anchor + 1000)).toBe(1015);
    expect(nextAnchoredSecondDelayMs(anchor + 250, anchor)).toBe(265);
    expect(nextAnchoredSecondDelayMs(anchor, anchor + 45 * 60_000 + 123)).toBe(892);
  });
});
