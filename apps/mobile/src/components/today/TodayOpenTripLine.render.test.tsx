import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style },
  Text: "Text",
  View: "View",
}));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: (props: { glyph: string }) => `icon:${props.glyph}` }));

import { freshOpenTrip, OPEN_TRIP_FRESH_MS, TodayOpenTripLine } from "./TodayOpenTripLine";

const theme = { mode: "dark", textMuted: "#707B91", textPrimary: "#FFF", textSecondary: "#8993A7" } as never;
const trip = { startedAt: "2026-10-22T13:44:00.000Z", lastObservedAt: "2026-10-22T14:18:00.000Z", fromPlaceId: null, travelMode: null };

function text(node: ReturnType<typeof create>["root"]): string {
  return node.findAllByType("Text" as never).filter((item) => item.parent?.type !== "Text")
    .map((item) => item.children.map((child) => typeof child === "string" ? child : child.children.join("")).join("")).join("");
}

describe("TodayOpenTripLine (location v4 step 5)", () => {
  it("reads Travelling since its start, logs when you arrive, as one quiet non-button line", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TodayOpenTripLine clockFormat="24h" openTrip={trip} theme={theme} />);
    });
    const row = tree.root.findByProps({ testID: "today-open-trip" });
    expect(row.props.accessibilityLabel).toMatch(/^Travelling since \d{2}:\d{2}\. Logs when you arrive\.$/);
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(row.props.onPress).toBeUndefined();
    expect(text(tree.root)).toMatch(/^Travelling since \d{2}:\d{2} · logs when you arrive$/);
    expect(JSON.stringify(tree.toJSON())).toContain("icon:route");
  });

  it("shows only a journey heard from within the engine's continuity limit", () => {
    const last = Date.parse(trip.lastObservedAt);
    expect(OPEN_TRIP_FRESH_MS).toBe(12 * 60_000);
    expect(freshOpenTrip(trip, last + OPEN_TRIP_FRESH_MS)).toBe(trip);
    expect(freshOpenTrip(trip, last + OPEN_TRIP_FRESH_MS + 1)).toBeNull();
    expect(freshOpenTrip(null, last)).toBeNull();
    expect(freshOpenTrip(undefined, last)).toBeNull();
    expect(freshOpenTrip({ ...trip, lastObservedAt: "not a time" }, last)).toBeNull();
  });
});
