import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { LocationTimeline } from "@dayframe/shared";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const scrollTo = vi.hoisted(() => vi.fn());
vi.mock("react-native", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  const React = await import("../../../../../node_modules/react/index.js");
  // A ScrollView whose ref can scroll, to see the jump to the first "?" (step 14).
  const ScrollView = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ scrollTo }));
    return React.createElement("ScrollView", props);
  });
  return {
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView,
  Text: "Text",
  View: "View",
  };
});
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

  it("answers a \"?\" where it sits: its question opens under the row, and the chip walks the questions (step 14 part 3b)", () => {
    const onAnswerCheck = vi.fn();
    const onOpenCheck = vi.fn();
    const question = (text: string, more = false) => ({ question: text, detail: null, logLabel: "Log it", skipLabel: "Not now", more, opens: false });
    const { tree } = render({
      checks: [
        { id: "c-unknown", segmentId: "seg-unknown", startedAt: iso(12), stoppedAt: iso(13) },
        { id: "c-sleep", segmentId: null, startedAt: iso(1), stoppedAt: iso(6) }
      ],
      checkTitles: new Map([["c-unknown", "Unknown place"], ["c-sleep", "Sleep"]]),
      checkQuestions: new Map([["c-unknown", question("Log Unknown place, 12:00–13:00?", true)], ["c-sleep", question("Log your sleep?")]]),
      onAnswerCheck,
      onOpenCheck
    });
    const questions = () => tree.root.findAll((node) => node.props.testID === "calendar-list-question" && typeof node.type === "string");
    expect(questions()).toHaveLength(0);
    // The place's "?" opens its question under its row, with More… for picking another place.
    const placeCheck = tree.root.findByProps({ accessibilityLabel: "Check Unknown place" });
    expect(placeCheck.props.accessibilityState).toEqual({ expanded: false });
    act(() => { placeCheck.props.onPress(); });
    expect(questions()).toHaveLength(1);
    expect(JSON.stringify(questions()[0].props.children)).toContain("Log Unknown place, 12:00–13:00?");
    expect(tree.root.findByProps({ accessibilityLabel: "Check Unknown place" }).props.accessibilityState).toEqual({ expanded: true });
    act(() => { tree.root.findByProps({ testID: "calendar-list-answer-more" }).props.onPress(); });
    expect(onOpenCheck).toHaveBeenCalledWith("c-unknown");
    // Answering closes the question and hands the answer to the caller (it holds it for Undo).
    act(() => { tree.root.findByProps({ testID: "calendar-list-answer-log" }).props.onPress(); });
    expect(onAnswerCheck).toHaveBeenCalledWith("c-unknown", true);
    expect(questions()).toHaveLength(0);
    // "N to check" opens the next question, from the top, and scrolls to it; a second tap moves on.
    const chip = tree.root.findByProps({ accessibilityHint: "Opens the next one" });
    act(() => { chip.props.onPress(); });
    expect(JSON.stringify(questions()[0].props.children)).toContain("Log your sleep?");
    expect(tree.root.findAll((node) => node.props.testID === "calendar-list-answer-more")).toHaveLength(0);
    act(() => { tree.root.findByProps({ accessibilityHint: "Opens the next one" }).props.onPress(); });
    expect(JSON.stringify(questions()[0].props.children)).toContain("Log Unknown place");
    act(() => { tree.root.findByProps({ testID: "calendar-list-answer-skip" }).props.onPress(); });
    expect(onAnswerCheck).toHaveBeenLastCalledWith("c-unknown", false);
    // Without answers here a "?" still opens the suggestion, as before.
    expect(onOpenCheck).toHaveBeenCalledTimes(1);
  });

  it("reads Today's opened question to VoiceOver, and keeps a closed question closed when its row comes back (Codex r2 on #582)", async () => {
    const { AccessibilityInfo } = await import("react-native");
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
    const question = (text: string) => ({ question: text, detail: null, logLabel: "Log it", skipLabel: "Not now", more: false, opens: false });
    const checks = [{ id: "c-sleep", segmentId: null, startedAt: iso(1), stoppedAt: iso(6) }];
    const props = {
      checks,
      checkTitles: new Map([["c-sleep", "Sleep"]]),
      checkQuestions: new Map([["c-sleep", question("Log your sleep?")]]),
      onAnswerCheck: vi.fn(),
      onOpenCheck: vi.fn()
    };
    const { tree } = render({ ...props, scrollToFirstCheck: 1 });
    const questions = () => tree.root.findAll((node) => node.props.testID === "calendar-list-question" && typeof node.type === "string");
    // Today's chip opened it: VoiceOver hears the question, as when its "?" is tapped.
    expect(questions()).toHaveLength(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Log your sleep?");
    const rerender = (next: Partial<Parameters<typeof CalendarListView>[0]>) => act(() => {
      tree.update(<CalendarListView clockFormat="24h" dayEndMs={at(24)} dayStartMs={at(0)} entries={[block("commute", "Commute", 8, 9), block("work", "Work", 9, 12)]}
        loggedLabel="4h" nowMs={at(18)} onOpenEntry={vi.fn()} onRefresh={vi.fn()} reduceMotion={false} refreshing={false}
        theme={theme} timeline={timeline} {...props} scrollToFirstCheck={1} {...next} />);
    });
    // Its row leaves (another day, a refresh) and comes back: the question stays closed until asked again.
    rerender({ checks: [] });
    expect(questions()).toHaveLength(0);
    rerender({ checks });
    expect(questions()).toHaveLength(0);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    // An overnight "?" opened on one day, then the day before, which shows it too: it closes there (Codex r4 on #582).
    const overnight = [{ id: "c-sleep", segmentId: null, startedAt: new Date(at(0) - 2 * 3_600_000).toISOString(), stoppedAt: iso(6) }];
    rerender({ checks: overnight });
    const sleepRow = () => tree.root.findAll((node) => typeof node.props.accessibilityLabel === "string"
      && node.props.accessibilityLabel.startsWith("Check Sleep") && typeof node.props.onPress === "function");
    act(() => { sleepRow()[0].props.onPress(); });
    expect(questions()).toHaveLength(1);
    rerender({ checks: overnight, dayStartMs: at(0) - 86_400_000, dayEndMs: at(0), timeline: null });
    expect(sleepRow()).toHaveLength(1);
    expect(questions()).toHaveLength(0);
  });

  it("offers a suggestion without a complete time on its own screen, never answers the outbox would refuse (Codex r3 on #582)", () => {
    const onAnswerCheck = vi.fn();
    const onOpenCheck = vi.fn();
    const { tree } = render({
      checks: [{ id: "c-sleep", segmentId: null, startedAt: iso(1), stoppedAt: null }],
      checkTitles: new Map([["c-sleep", "Sleep"]]),
      checkQuestions: new Map([["c-sleep", { question: "Log your sleep?", detail: "It has no complete time yet, so it can't be answered here.",
        logLabel: null, skipLabel: null, more: false, opens: true }]]),
      onAnswerCheck,
      onOpenCheck
    });
    act(() => { tree.root.find((node) => typeof node.props.accessibilityLabel === "string" && node.props.accessibilityLabel.startsWith("Check Sleep") && typeof node.props.onPress === "function").props.onPress(); });
    expect(tree.root.findAll((node) => node.props.testID === "calendar-list-answer-log")).toHaveLength(0);
    expect(tree.root.findAll((node) => node.props.testID === "calendar-list-answer-skip")).toHaveLength(0);
    act(() => { tree.root.findByProps({ testID: "calendar-list-answer-open" }).props.onPress(); });
    expect(onOpenCheck).toHaveBeenCalledWith("c-sleep");
    expect(onAnswerCheck).not.toHaveBeenCalled();
  });

  it("marks Today's waiting request done when \"N to check\" moves on from it (Codex r12 on #582)", () => {
    const onScrolledToFirstCheck = vi.fn();
    const question = (text: string) => ({ question: text, detail: null, logLabel: "Log it", skipLabel: "Not now", more: false, opens: false });
    const { tree } = render({
      checks: [
        { id: "c-unknown", segmentId: "seg-unknown", startedAt: iso(12), stoppedAt: iso(13) },
        { id: "c-sleep", segmentId: null, startedAt: iso(1), stoppedAt: iso(6) }
      ],
      checkTitles: new Map([["c-unknown", "Unknown place"], ["c-sleep", "Sleep"]]),
      checkQuestions: new Map([["c-unknown", question("Log Unknown place?")], ["c-sleep", question("Log your sleep?")]]),
      onAnswerCheck: vi.fn(),
      onOpenCheck: vi.fn(),
      onScrolledToFirstCheck,
      scrollToFirstCheck: 1
    });
    // Its row has not been measured yet (no native layout here): the request is still waiting.
    expect(onScrolledToFirstCheck).not.toHaveBeenCalled();
    act(() => { tree.root.findByProps({ accessibilityHint: "Opens the next one" }).props.onPress(); });
    expect(onScrolledToFirstCheck).toHaveBeenCalledOnce();
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

  describe("the jump to the first \"?\" (Codex r1–r3 on #573)", () => {
    // Each row view measures where it is now; frames run at once.
    const positions = new Map<string, number>();
    const mount = (props: Partial<Parameters<typeof CalendarListView>[0]>) => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<CalendarListView clockFormat="24h" dayEndMs={at(24)} dayStartMs={at(0)} entries={[block("work", "Work", 9, 12)]}
          loggedLabel="4h" nowMs={at(18)} onOpenEntry={vi.fn()} onRefresh={vi.fn()} reduceMotion={false} refreshing={false}
          theme={theme} timeline={timeline} {...props} />, {
          // As Fabric: measureLayout needs a native component ref, and does nothing for a numeric tag.
          createNodeMock: () => ({
            measureLayout: (relativeTo: unknown, done: (x: number, y: number) => void) => {
              if (typeof relativeTo !== "object" || relativeTo === null) return;
              done(0, positions.get("first") ?? -1);
            }
          })
        });
      });
      return tree;
    };
    const checks = [{ id: "c-unknown", segmentId: "seg-unknown", startedAt: iso(12), stoppedAt: iso(13) }];
    const base = { checks, checkTitles: new Map([["c-unknown", "Unknown place"]]), onOpenCheck: vi.fn() };
    vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => { callback(0); return 0; });

    it("lands on the row where it is now, once per request, then reports it", () => {
      scrollTo.mockClear();
      positions.set("first", 400);
      const onScrolled = vi.fn();
      const tree = mount({ ...base, onScrolledToFirstCheck: onScrolled, scrollToFirstCheck: 1 });
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo.mock.calls[0][0]).toMatchObject({ y: 376, animated: true });
      expect(onScrolled).toHaveBeenCalledTimes(1);
      // Later renders do not jump again.
      act(() => { tree.update(<CalendarListView clockFormat="24h" dayEndMs={at(24)} dayStartMs={at(0)} entries={[]} loggedLabel="4h" nowMs={at(18)}
        onOpenEntry={vi.fn()} onRefresh={vi.fn()} reduceMotion refreshing={false} theme={theme} timeline={timeline} {...base}
        onScrolledToFirstCheck={onScrolled} scrollToFirstCheck={1} />); });
      expect(scrollTo).toHaveBeenCalledTimes(1);
    });

    it("measures a surviving row that moved on a day change where it is now, not where it was", () => {
      scrollTo.mockClear();
      positions.set("first", 400);
      const tree = mount(base);
      expect(scrollTo).not.toHaveBeenCalled();
      // The day changes: earlier blocks go, the row survives and moves up; the chip asks.
      positions.set("first", 150);
      act(() => { tree.update(<CalendarListView clockFormat="24h" dayEndMs={at(24) + 1} dayStartMs={at(0) + 1} entries={[]} loggedLabel="4h"
        nowMs={at(18)} onOpenEntry={vi.fn()} onRefresh={vi.fn()} reduceMotion refreshing={false} theme={theme} timeline={timeline} {...base}
        onScrolledToFirstCheck={vi.fn()} scrollToFirstCheck={1} />); });
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo.mock.calls[0][0]).toMatchObject({ y: 126, animated: false });
    });

    it("does not jump when shown again with the request cleared", () => {
      scrollTo.mockClear();
      positions.set("first", 400);
      mount({ ...base, scrollToFirstCheck: 0 });
      expect(scrollTo).not.toHaveBeenCalled();
    });
  });
});

