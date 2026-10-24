import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { LocationTimeline } from "@dayframe/shared";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  Text: "Text",
  View: "View",
}));
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" } }));
vi.mock("../../lib/motion", () => ({
  localLayoutTransition: () => undefined, localPresenceEntering: () => undefined, localPresenceExiting: () => undefined
}));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: (props: { glyph: string }) => `icon:${props.glyph}` }));

import { CalendarListView } from "./CalendarListView";

// Location v4 step 9: a synthetic day in Exampleton, made-up names and ids.
const at = (hour: number, minute = 0) => Date.UTC(2026, 9, 22, hour, minute);
const iso = (hour: number, minute = 0) => new Date(at(hour, minute)).toISOString();
const theme = { background: "#000", surface: "#111", surfaceMuted: "#222", border: "#333", accent: "#F66", textPrimary: "#FFF",
  textSecondary: "#AAA", textMuted: "#777", warningText: "#FB0" } as never;
const block = (entryId: string, title: string, start: number, stop: number) => ({
  entryId, actionId: entryId, title, meta: "", lengthLabel: "1h", accessibilityLabel: title, color: "#0AF", textColor: "#000",
  glyph: "briefcase", isActive: false, isReview: false, startedAtMs: at(start), stoppedAtMs: at(stop)
}) as never;
const timeline: LocationTimeline = {
  date: "2026-10-22", timeZone: "UTC", dayStart: iso(0), dayEnd: iso(24), gaps: [], openTrip: null,
  items: [
    { kind: "place", id: "seg-home", status: "finalised", startedAt: iso(0), stoppedAt: iso(8), placeId: "p-home", learnedPlaceId: null,
      name: "Home", role: "home", matchKind: "saved", confidence: "high", blockIds: [] },
    { kind: "trip", id: "seg-trip", status: "finalised", startedAt: iso(8), stoppedAt: iso(9), fromId: "seg-home", toId: "seg-office",
      mode: "walking", stopIds: [], distanceMeters: 4_000, confidence: "high", reason: null, blockIds: ["commute"], legs: [
        { startedAt: iso(8), stoppedAt: iso(8, 20), mode: "walking", confidence: "sure", distanceMeters: 1_000 },
        { startedAt: iso(8, 20), stoppedAt: iso(9), mode: "bus", confidence: "unsure", distanceMeters: 3_000 }] },
    { kind: "place", id: "seg-office", status: "finalised", startedAt: iso(9), stoppedAt: iso(12), placeId: "p-office", learnedPlaceId: null,
      name: "Office", role: "work", matchKind: "saved", confidence: "high", blockIds: ["work"] },
    { kind: "place", id: "seg-unknown", status: "finalised", startedAt: iso(12), stoppedAt: iso(13), placeId: null, learnedPlaceId: null,
      name: null, role: null, matchKind: "unknown", confidence: "medium", blockIds: [] }
  ]
};

function render(props: Partial<Parameters<typeof CalendarListView>[0]> = {}) {
  let tree!: ReturnType<typeof create>;
  const onOpenEntry = vi.fn();
  act(() => {
    tree = create(<CalendarListView clockFormat="24h" dayEndMs={at(24)} dayStartMs={at(0)} entries={[block("commute", "Commute", 8, 9), block("work", "Work", 9, 12)]}
      loggedLabel="4h" nowMs={at(18)} onOpenEntry={onOpenEntry} onRefresh={vi.fn()} reduceMotion={false} refreshing={false}
      theme={theme} timeline={timeline} {...props} />);
  });
  return { tree, onOpenEntry };
}
const labels = (tree: ReturnType<typeof create>) => tree.root.findAll((node) => typeof node.props.accessibilityLabel === "string")
  .map((node) => node.props.accessibilityLabel as string);
const textOf = (tree: ReturnType<typeof create>) => JSON.stringify(tree.toJSON());

describe("CalendarListView (location v4 step 9)", () => {
  it("lists the day's blocks oldest first, with an unlogged unknown place between them, and opens a block's editor", () => {
    const { tree, onOpenEntry } = render();
    const order = labels(tree).map((label) => label.split(".")[0]).filter((label) => ["Commute", "Work"].includes(label));
    expect(order).toEqual(["Commute", "Work"]);
    const text = textOf(tree);
    expect(text).toContain("Unknown place");
    // The day line as the mock-up's: its date and the time logged.
    expect(text).toContain("4h");
    expect(text).toContain(" logged");
    expect(text.indexOf("Work")).toBeLessThan(text.indexOf("Unknown place"));
    // Home and the logged Office stay away until asked for.
    expect(text).not.toContain("\"Home\"");
    act(() => { tree.root.findByProps({ accessibilityLabel: "Work" }).props.onPress(); });
    expect(onOpenEntry).toHaveBeenCalledWith(expect.objectContaining({ entryId: "work" }));
  });

  it("shows a trip block's route and modes, and opens its legs", () => {
    const { tree } = render();
    // VoiceOver reads the route and modes with the block itself (Codex r1 on #570).
    expect(labels(tree)).toContain("Commute. Home → Office. Legs: Walk, Bus?");
    const toggle = tree.root.findByProps({ accessibilityLabel: "Show the legs of Commute" });
    expect(toggle.props.accessibilityState).toEqual({ expanded: false });
    act(() => { toggle.props.onPress(); });
    expect(tree.root.findByProps({ accessibilityLabel: "Legs" })).toBeTruthy();
    expect(tree.root.findByProps({ accessibilityLabel: "Hide the legs of Commute" }).props.accessibilityState).toEqual({ expanded: true });
  });

  it("adds Home and logged places as faint rows on request", () => {
    const { tree } = render();
    const toggle = tree.root.findAll((node) => node.type === ("Pressable" as never) && node.props.accessibilityState?.selected === false)[0];
    act(() => { toggle.props.onPress(); });
    const text = textOf(tree);
    expect(text).toContain("Home");
    expect(text).toContain("Hide Home and logged places");
  });

  it("keeps the blocks when the day's places could not be read", () => {
    const { tree } = render({ timeline: null });
    expect(labels(tree).map((label) => label.split(".")[0]).filter((label) => ["Commute", "Work"].includes(label))).toEqual(["Commute", "Work"]);
    expect(textOf(tree)).not.toContain("Show Home and every place");
  });

  it("reads the journey in progress whole: where from, since when and its legs so far (Codex r2 on #570)", () => {
    const travelling: LocationTimeline = { ...timeline, openTrip: {
      startedAt: iso(17, 30), lastObservedAt: iso(17, 50), fromId: "seg-unknown", fromPlaceId: null, mode: "walking",
      legs: [{ startedAt: iso(17, 30), stoppedAt: iso(17, 50), mode: "walking", confidence: "sure", distanceMeters: 1_200 }]
    } as never };
    const { tree } = render({ timeline: travelling });
    const label = labels(tree).find((text) => text.startsWith("Travelling from"));
    expect(label).toMatch(/^Travelling from .+ since \d{2}:\d{2}\. Legs: Walk\. Logs when you arrive\.$/);
  });

  it("puts each open suggestion on the row it is about, counts them, and opens one to answer (location v4 step 14)", () => {
    const onOpenCheck = vi.fn();
    const { tree } = render({
      checks: [
        { id: "c-unknown", segmentId: "seg-unknown", startedAt: iso(12), stoppedAt: iso(13) },
        { id: "c-sleep", segmentId: null, startedAt: iso(1), stoppedAt: iso(6) }
      ],
      checkTitles: new Map([["c-unknown", "Unknown place"], ["c-sleep", "Sleep"]]),
      onOpenCheck
    });
    // The place's suggestion sits on its row; Apple Health has a row of its own at its time.
    expect(labels(tree)).toContain("Check Unknown place");
    expect(labels(tree).some((label) => label.startsWith("Check Sleep"))).toBe(true);
    const chip = tree.root.findByProps({ accessibilityHint: "Opens the first one" });
    expect(JSON.stringify(chip.props.children)).toContain("to check");
    act(() => { chip.props.onPress(); });
    expect(onOpenCheck).toHaveBeenCalledWith("c-sleep");
    act(() => { tree.root.findByProps({ accessibilityLabel: "Check Unknown place" }).props.onPress(); });
    expect(onOpenCheck).toHaveBeenLastCalledWith("c-unknown");
  });

  it("shows a day's checks even before its places are read", () => {
    const { tree } = render({ timeline: null, checks: [{ id: "c-sleep", segmentId: null, startedAt: iso(1), stoppedAt: iso(6) }],
      checkTitles: new Map([["c-sleep", "Sleep"]]), onOpenCheck: vi.fn() });
    expect(labels(tree).some((label) => label.startsWith("Check Sleep"))).toBe(true);
  });
});

