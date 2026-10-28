import { act, create } from "react-test-renderer";
import { reviewAnswerQuestion } from "../../lib/reviewAnswer";
import type { MobileReviewItem } from "../../lib/api";
import { describe, expect, it, vi } from "vitest";
import { formatClockTime, type LocationTimeline } from "@dayframe/shared";

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
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" }, runOnJS: (fn: unknown) => fn }));
// The List's day swipe (a horizontal pan on the List).
vi.mock("react-native-gesture-handler", () => {
  function Pan() {
    const pan: Record<string, unknown> = {};
    for (const method of ["enabled", "activeOffsetX", "failOffsetY", "onEnd"]) pan[method] = () => pan;
    return pan;
  }
  return { Gesture: { Pan }, GestureDetector: ({ children }: { children: unknown }) => children };
});
// "All places" is remembered on this device (owner, 28 Oct 2026, concern 3).
const storage = vi.hoisted(() => ({ values: new Map<string, string>(), setItem: vi.fn() }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: async (key: string) => storage.values.get(key) ?? null,
  setItem: async (key: string, value: string) => { storage.setItem(key, value); storage.values.set(key, value); }
} }));
vi.mock("../../lib/motion", () => ({
  localLayoutTransition: () => undefined, localPresenceEntering: () => undefined, localPresenceExiting: () => undefined
}));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: (props: { glyph: string }) => `icon:${props.glyph}` }));

import { CalendarListView } from "./CalendarListView";

// Location v4 step 9: a synthetic day in Exampleton, made-up names and ids.
const at = (hour: number, minute = 0) => Date.UTC(2026, 9, 22, hour, minute);
const iso = (hour: number, minute = 0) => new Date(at(hour, minute)).toISOString();
const theme = { background: "#000", surface: "#111", surfaceInset: "#0A0", surfaceMuted: "#222", border: "#333", accent: "#F66", textPrimary: "#FFF",
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

  it("draws a block row as Calendar v3's List: Today's block mark by length, the bold title, a pin line, start over end (owner choice A)", () => {
    const work = { ...(block("work", "Work", 9, 12) as object), detailLines: [{ glyph: "place", text: "Exampleton Library" }, { glyph: "time", text: "09:00–12:00" }] } as never;
    const short = { ...(block("short", "Coffee", 13, 13) as object), stoppedAtMs: at(13, 20), detailLines: [{ glyph: "time", text: "13:00–13:20" }] } as never;
    const { tree } = render({ entries: [work, short] });
    const marks = tree.root.findAll((node) => node.type === ("View" as never) && node.props.style?.[0]?.width === 34);
    // Today's rows: 18 + 22 an hour, between 24 and 56 (3 h → 56, 20 min → 25).
    expect(marks.map((mark) => mark.props.style[1].height)).toEqual([56, 25]);
    expect(marks.map((mark) => mark.props.style[1].backgroundColor)).toEqual(["#0AF", "#0AF"]);
    const text = textOf(tree);
    expect(text).toContain("Exampleton Library");
    expect(text).toContain("icon:map-pin");
    // Start over end on the right; no times line under the title (the time is on the right).
    const clock = (ms: number) => formatClockTime(new Date(ms), "24h");
    expect(text).toContain(`"${clock(at(9))}"`);
    expect(text).toContain(`"${clock(at(12))}"`);
    expect(text.indexOf(`"${clock(at(9))}"`)).toBeLessThan(text.indexOf(`"${clock(at(12))}"`));
    expect(text).not.toContain("09:00–12:00");
    // No second line when there is nothing but the time.
    const coffeeRow = tree.root.findByProps({ accessibilityLabel: "Coffee" });
    expect(JSON.stringify(coffeeRow.props.children)).not.toContain("icon:map-pin");
  });

  it("shows a trip block's route on its own line and its modes under it, the modes opening its legs (owner items C, G)", () => {
    const { tree } = render();
    // VoiceOver reads the route and modes with the block itself (Codex r1 on #570).
    expect(labels(tree)).toContain("Commute. Home → Office. Legs: Walk, Bus?");
    const route = tree.root.findAll((node) => node.type === ("Text" as never) && node.props.children === "Home → Office");
    expect(route).toHaveLength(1);
    // No right-hand chevron: the modes line is the legs' toggle.
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === "Show the legs of Commute")).toHaveLength(0);
    const toggle = tree.root.findByProps({ accessibilityLabel: "Show the 2 legs" });
    expect(toggle.props.accessibilityState).toEqual({ expanded: false });
    expect(JSON.stringify(toggle.props.children)).toContain("Bus?");
    act(() => { toggle.props.onPress(); });
    expect(tree.root.findByProps({ accessibilityLabel: "Legs" })).toBeTruthy();
    expect(tree.root.findByProps({ accessibilityLabel: "Hide the 2 legs" }).props.accessibilityState).toEqual({ expanded: true });
  });

  it("adds Home as a quiet row with \"All places\" by the day's header, and remembers it on this device (concern 3)", async () => {
    storage.values.clear();
    storage.setItem.mockClear();
    const { tree } = render();
    const filter = tree.root.findByProps({ testID: "calendar-list-show-all" });
    expect(JSON.stringify(filter.props.children)).toContain("All places");
    expect(filter.props.accessibilityState).toEqual({ selected: false });
    act(() => { filter.props.onPress(); });
    const text = textOf(tree);
    expect(text).toContain("\"Home\"");
    expect(text).toContain("Fewer places");
    // The old filled toggle under the List is gone.
    expect(text).not.toContain("Show Home and every place");
    expect(text).not.toContain("Hide Home and logged places");
    expect(storage.setItem).toHaveBeenCalledWith("dayframe.calendar.showAllPlaces", "1");
    // A List shown later reads it back.
    let later!: ReturnType<typeof create>;
    await act(async () => {
      later = create(<CalendarListView clockFormat="24h" dayEndMs={at(24)} dayStartMs={at(0)} entries={[block("commute", "Commute", 8, 9), block("work", "Work", 9, 12)]}
        loggedLabel="4h" nowMs={at(18)} onOpenEntry={vi.fn()} onRefresh={vi.fn()} reduceMotion={false} refreshing={false} theme={theme} timeline={timeline} />);
    });
    expect(textOf(later)).toContain("\"Home\"");
    expect(later.root.findByProps({ testID: "calendar-list-show-all" }).props.accessibilityState).toEqual({ selected: true });
  });

  it("never lists a place your blocks cover, even with All places (concern 2)", () => {
    const { tree } = render();
    act(() => { tree.root.findByProps({ testID: "calendar-list-show-all" }).props.onPress(); });
    // Office (09:00–12:00) is all inside the Work block.
    expect(tree.root.findAll((node) => node.props.testID === "calendar-list-place-seg-office")).toHaveLength(0);
    expect(tree.root.findAll((node) => node.props.testID === "calendar-list-place-seg-home").length).toBeGreaterThan(0);
  });

  it("keeps the blocks when the day's places could not be read", () => {
    const { tree } = render({ timeline: null });
    expect(labels(tree).map((label) => label.split(".")[0]).filter((label) => ["Commute", "Work"].includes(label))).toEqual(["Commute", "Work"]);
    expect(tree.root.findAll((node) => node.props.testID === "calendar-list-show-all")).toHaveLength(0);
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

  const question = (text: string, more = false) => ({ question: text, detail: null, logLabel: "Log it", skipLabel: "Not now", more, opens: false });
  const questions = (tree: ReturnType<typeof create>) =>
    tree.root.findAll((node) => node.props.testID === "calendar-list-question" && typeof node.type === "string");
  const flat = (style: unknown) => Object.assign({}, ...[style].flat(3).filter(Boolean)) as Record<string, unknown>;
  // A compact pill: 32 points tall, 16 across, 14-point bold, its hitSlop making a 44-point target.
  const expectCompactPill = (node: { props: Record<string, unknown> }) => {
    const style = flat((node.props.style as (state: { pressed: boolean }) => unknown)({ pressed: false }));
    expect(style).toMatchObject({ minHeight: 32, paddingHorizontal: 16 });
    const slop = node.props.hitSlop as { top: number; bottom: number };
    expect((style.minHeight as number) + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
  };
  const placeCheck = { id: "c-unknown", segmentId: "seg-unknown", startedAt: iso(12), stoppedAt: iso(13) };
  const sleepCheck = { id: "c-sleep", segmentId: null, startedAt: iso(1), stoppedAt: iso(6) };
  const visited = { question: "Visited Pret?", detail: null, logLabel: "Yes", skipLabel: "Not now", more: true, moreLabel: "Edit", opens: false };

  it("opens a place's sheet from its row, answers Yes from the row's compact pill, and never shows the question under it (owner, 28 Oct 2026)", () => {
    const onAnswerCheck = vi.fn();
    const onOpenPlace = vi.fn();
    const { tree } = render({
      checks: [placeCheck], checkTitles: new Map([["c-unknown", "Unknown place"]]),
      checkQuestions: new Map([["c-unknown", visited]]), onAnswerCheck, onOpenCheck: vi.fn(), onOpenPlace
    });
    const row = tree.root.findByProps({ testID: "calendar-list-place-seg-unknown" });
    // Q7: an unnamed place reads its guess; the row says it needs a look (the one amber dot).
    expect(row.props.accessibilityLabel).toContain("Pret?");
    expect(row.props.accessibilityLabel).toContain("Needs a look");
    act(() => { row.props.onPress(); });
    expect(onOpenPlace).toHaveBeenCalledWith(expect.objectContaining({ id: "seg-unknown" }), "Pret?");
    expect(questions(tree)).toHaveLength(0);
    const yes = tree.root.findByProps({ testID: "calendar-list-yes-c-unknown" });
    expectCompactPill(yes);
    act(() => { yes.props.onPress(); });
    expect(onAnswerCheck).toHaveBeenCalledWith("c-unknown", true);
    expect(questions(tree)).toHaveLength(0);
    // No outlined "?" check button beside the row.
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === "Check Unknown place")).toHaveLength(0);
  });

  it("opens Apple Health's question under its row, with compact pills (card D item 9)", () => {
    const onAnswerCheck = vi.fn();
    const onOpenCheck = vi.fn();
    const { tree } = render({
      checks: [placeCheck, sleepCheck],
      checkTitles: new Map([["c-unknown", "Unknown place"], ["c-sleep", "Sleep"]]),
      checkQuestions: new Map([["c-unknown", visited], ["c-sleep", question("Log your sleep?", true)]]),
      onAnswerCheck, onOpenCheck, onOpenPlace: vi.fn()
    });
    expect(questions(tree)).toHaveLength(0);
    const sleepRow = tree.root.findByProps({ testID: "calendar-list-check-c-sleep" });
    expect(sleepRow.props.accessibilityState).toEqual({ expanded: false });
    act(() => { sleepRow.props.onPress(); });
    expect(questions(tree)).toHaveLength(1);
    expect(JSON.stringify(questions(tree)[0].props.children)).toContain("Log your sleep?");
    expect(tree.root.findByProps({ testID: "calendar-list-check-c-sleep" }).props.accessibilityState).toEqual({ expanded: true });
    // The inset surface, "Log it" a neutral dark pill (textPrimary, background text), the skip muted; every pill compact.
    expect(flat(questions(tree)[0].props.style).backgroundColor).toBe("#0A0");
    const log = tree.root.findByProps({ testID: "calendar-list-answer-log" });
    expect(flat(log.props.style({ pressed: false })).backgroundColor).toBe("#FFF");
    expect(flat(log.findByType("Text" as never).props.style)).toMatchObject({ color: "#000", fontSize: 14, fontWeight: "700" });
    const skip = tree.root.findByProps({ testID: "calendar-list-answer-skip" });
    expect(flat(skip.props.style({ pressed: false })).backgroundColor).toBe("#222");
    const more = tree.root.findByProps({ testID: "calendar-list-answer-more" });
    for (const pill of [log, skip, more]) expectCompactPill(pill);
    act(() => { more.props.onPress(); });
    expect(onOpenCheck).toHaveBeenCalledWith("c-sleep");
    // Answering closes the question and hands the answer to the caller (it holds it for Undo).
    act(() => { tree.root.findByProps({ testID: "calendar-list-answer-skip" }).props.onPress(); });
    expect(onAnswerCheck).toHaveBeenCalledWith("c-sleep", false);
    expect(questions(tree)).toHaveLength(0);
  });

  it("asks a sheetless suggestion Yes, Edit, Not now, and Edit opens it on its own screen (card A)", () => {
    const onAnswerCheck = vi.fn();
    const onOpenCheck = vi.fn();
    const { tree } = render({
      checks: [{ id: "c-trip", segmentId: null, startedAt: iso(12), stoppedAt: iso(13) }],
      checkTitles: new Map([["c-trip", "Getting around"]]),
      checkQuestions: new Map([["c-trip", { question: "Getting around, 12:00–13:00?", detail: null, logLabel: "Yes", skipLabel: "Not now",
        more: true, moreLabel: "Edit", opens: false }]]),
      onAnswerCheck,
      onOpenCheck
    });
    act(() => { tree.root.findByProps({ testID: "calendar-list-check-c-trip" }).props.onPress(); });
    const answers = tree.root.findAll((node) => typeof node.props.testID === "string" && node.props.testID.startsWith("calendar-list-answer-") &&
      typeof node.props.onPress === "function").map((node) => node.props.testID);
    expect(answers).toEqual(["calendar-list-answer-log", "calendar-list-answer-edit", "calendar-list-answer-skip"]);
    const edit = tree.root.findByProps({ testID: "calendar-list-answer-edit" });
    expect(edit.findByType("Text" as never).props.children).toBe("Edit");
    expect(edit.props.accessibilityHint).toBe("Opens it on its own screen to edit it");
    expectCompactPill(edit);
    act(() => { edit.props.onPress(); });
    expect(onOpenCheck).toHaveBeenCalledWith("c-trip");
    expect(onAnswerCheck).not.toHaveBeenCalled();
  });

  it("asks a place Visited {guess}? from the real question words, with the Yes pill on its row (card B; Codex r1 on #594)", () => {
    const place = { id: "c-place", title: "Exampleton Library", eventSource: "location_learning", eventType: "unknown_stay",
      suggestedStartedAt: iso(12), suggestedStoppedAt: iso(13), rawPayload: { clientSegmentId: "seg-unknown" } } as unknown as MobileReviewItem;
    const asked = reviewAnswerQuestion(place, "24h");
    const onOpenPlace = vi.fn();
    const { tree } = render({
      checks: [{ id: "c-place", segmentId: "seg-unknown", startedAt: iso(12), stoppedAt: iso(13) }],
      checkTitles: new Map([["c-place", "Exampleton Library"]]),
      checkQuestions: new Map([["c-place", asked]]),
      onAnswerCheck: vi.fn(),
      onOpenPlace
    });
    expect(asked.question).toMatch(/^Visited .+\?$/);
    expect(tree.root.findAll((node) => node.props.testID === "calendar-list-yes-c-place" && typeof node.props.onPress === "function")).toHaveLength(1);
    act(() => { tree.root.findByProps({ testID: "calendar-list-place-seg-unknown" }).props.onPress(); });
    expect(onOpenPlace).toHaveBeenCalledOnce();
    expect(questions(tree)).toHaveLength(0);
  });

  it("opens a requested \"?\" by id: a place's in its sheet, never the card; a trip's through onOpenCheck; Apple Health's under its row", () => {
    const onOpenPlace = vi.fn();
    const onOpenCheck = vi.fn();
    const common = {
      checkTitles: new Map([["c-unknown", "Unknown place"], ["c-sleep", "Sleep"], ["c-trip", "Getting around"]]),
      checkQuestions: new Map([["c-unknown", visited], ["c-sleep", question("Log your sleep?")], ["c-trip", question("Getting around?")]]),
      onAnswerCheck: vi.fn(), onOpenCheck, onOpenPlace
    };
    const place = render({ ...common, checks: [placeCheck, sleepCheck], openCheckRequest: { id: "c-unknown", request: 1 } });
    expect(onOpenPlace).toHaveBeenCalledOnce();
    expect(onOpenPlace).toHaveBeenCalledWith(expect.objectContaining({ id: "seg-unknown" }), "Pret?");
    expect(questions(place.tree)).toHaveLength(0);
    // A trip not in a block has its own row and sheet (the Dashboard routes onOpenCheck to it).
    const freeTrip = { ...timeline, items: timeline.items.map((item) => item.kind === "trip" ? { ...item, blockIds: [] } : item) } as LocationTimeline;
    const trip = render({ ...common, checks: [{ id: "c-trip", segmentId: "seg-trip", startedAt: iso(8), stoppedAt: iso(9) }],
      entries: [block("work", "Work", 9, 12)], timeline: freeTrip, openCheckRequest: { id: "c-trip", request: 1 } });
    expect(onOpenCheck).toHaveBeenCalledWith("c-trip");
    expect(questions(trip.tree)).toHaveLength(0);
    // Tapping the trip's row opens it the same way, its modes stacked under its title.
    onOpenCheck.mockClear();
    act(() => { trip.tree.root.findByProps({ testID: "calendar-list-check-c-trip" }).props.onPress(); });
    expect(onOpenCheck).toHaveBeenCalledWith("c-trip");
    expect(questions(trip.tree)).toHaveLength(0);
    const health = render({ ...common, checks: [placeCheck, sleepCheck], openCheckRequest: { id: "c-sleep", request: 1 } });
    expect(questions(health.tree)).toHaveLength(1);
    expect(JSON.stringify(questions(health.tree)[0].props.children)).toContain("Log your sleep?");
  });

  it("holds a request for a place's \"?\" until the day's places are read, then opens its sheet, never the card (Codex r1 on #610)", () => {
    const onOpenPlace = vi.fn();
    const onOpenCheck = vi.fn();
    const props = { checks: [placeCheck], checkTitles: new Map([["c-unknown", "Unknown place"]]), checkQuestions: new Map([["c-unknown", visited]]),
      onAnswerCheck: vi.fn(), onOpenCheck, onOpenPlace, openCheckRequest: { id: "c-unknown", request: 1 } };
    const { tree } = render({ ...props, timeline: null });
    // Its placeholder row is there, but what it is isn't known yet: nothing opens, under the row or elsewhere.
    expect(tree.root.findAll((node) => node.props.testID === "calendar-list-check-c-unknown").length).toBeGreaterThan(0);
    expect(questions(tree)).toHaveLength(0);
    expect(onOpenPlace).not.toHaveBeenCalled();
    expect(onOpenCheck).not.toHaveBeenCalled();
    act(() => {
      tree.update(<CalendarListView clockFormat="24h" dayEndMs={at(24)} dayStartMs={at(0)} entries={[block("commute", "Commute", 8, 9), block("work", "Work", 9, 12)]}
        loggedLabel="4h" nowMs={at(18)} onOpenEntry={vi.fn()} onRefresh={vi.fn()} reduceMotion={false} refreshing={false}
        theme={theme} timeline={timeline} {...props} />);
    });
    expect(onOpenPlace).toHaveBeenCalledOnce();
    expect(onOpenPlace).toHaveBeenCalledWith(expect.objectContaining({ id: "seg-unknown" }), "Pret?");
    expect(questions(tree)).toHaveLength(0);
    // Tapping the placeholder row before the places arrive waits too, then opens the sheet: never the card, never
    // the Review screen (Codex r2 on #610).
    onOpenPlace.mockClear();
    const early = render({ ...props, openCheckRequest: null, timeline: null });
    act(() => { early.tree.root.findByProps({ testID: "calendar-list-check-c-unknown" }).props.onPress(); });
    expect(onOpenCheck).not.toHaveBeenCalled();
    expect(onOpenPlace).not.toHaveBeenCalled();
    expect(questions(early.tree)).toHaveLength(0);
    act(() => {
      early.tree.update(<CalendarListView clockFormat="24h" dayEndMs={at(24)} dayStartMs={at(0)} entries={[block("commute", "Commute", 8, 9), block("work", "Work", 9, 12)]}
        loggedLabel="4h" nowMs={at(18)} onOpenEntry={vi.fn()} onRefresh={vi.fn()} reduceMotion={false} refreshing={false}
        theme={theme} timeline={timeline} {...props} openCheckRequest={null} />);
    });
    expect(onOpenPlace).toHaveBeenCalledOnce();
    expect(onOpenCheck).not.toHaveBeenCalled();
  });

  it("asks a place's or trip's \"?\" under its row when the day's places are read and lack its item, never Review (Codex r2 on #610)", () => {
    const onOpenCheck = vi.fn();
    const onOpenPlace = vi.fn();
    const missing = { id: "c-missing", segmentId: "seg-not-in-the-day", startedAt: iso(15), stoppedAt: iso(16) };
    const { tree } = render({ checks: [missing], checkKinds: new Map([["c-missing", "trip"]]), checkTitles: new Map([["c-missing", "Getting around"]]),
      checkQuestions: new Map([["c-missing", question("Getting around, 15:00–16:00?")]]), onAnswerCheck: vi.fn(), onOpenCheck, onOpenPlace,
      openCheckRequest: { id: "c-missing", request: 1 } });
    expect(questions(tree)).toHaveLength(1);
    expect(onOpenCheck).not.toHaveBeenCalled();
    expect(onOpenPlace).not.toHaveBeenCalled();
  });

  it("waits for the day's next read before asking a request's missing item under its row (Codex r3 on #610)", () => {
    const missing = { id: "c-missing", segmentId: "seg-not-in-the-day", startedAt: iso(15), stoppedAt: iso(16) };
    const props = { checks: [missing], checkKinds: new Map([["c-missing", "place" as const]]), checkTitles: new Map([["c-missing", "Unknown place"]]),
      checkQuestions: new Map([["c-missing", question("Visited Pret?")]]), onAnswerCheck: vi.fn(), onOpenCheck: vi.fn(), onOpenPlace: vi.fn(),
      openCheckRequest: { id: "c-missing", request: 1, at: 1_000 } };
    // The places shown were read before the request: they may just be out of date.
    const { tree } = render({ ...props, timelineReadAt: 500 });
    expect(questions(tree)).toHaveLength(0);
    act(() => {
      tree.update(<CalendarListView clockFormat="24h" dayEndMs={at(24)} dayStartMs={at(0)} entries={[block("commute", "Commute", 8, 9), block("work", "Work", 9, 12)]}
        loggedLabel="4h" nowMs={at(18)} onOpenEntry={vi.fn()} onRefresh={vi.fn()} reduceMotion={false} refreshing={false}
        theme={theme} timeline={timeline} {...props} timelineReadAt={1_200} />);
    });
    // Read again since, and still without it: it asks under its row, its only way to be answered (intended).
    expect(questions(tree)).toHaveLength(1);
  });

  it("opens a trip's \"?\" in the trip's own sheet, at no leg", () => {
    const onOpenTripLeg = vi.fn();
    const onOpenCheck = vi.fn();
    const freeTrip = { ...timeline, items: timeline.items.map((item) => item.kind === "trip" ? { ...item, blockIds: [] } : item) } as LocationTimeline;
    const { tree } = render({ checks: [{ id: "c-trip", segmentId: "seg-trip", startedAt: iso(8), stoppedAt: iso(9) }], checkKinds: new Map([["c-trip", "trip"]]),
      entries: [block("work", "Work", 9, 12)], timeline: freeTrip, onAnswerCheck: vi.fn(), onOpenCheck, onOpenTripLeg });
    act(() => { tree.root.findByProps({ testID: "calendar-list-check-c-trip" }).props.onPress(); });
    expect(onOpenTripLeg).toHaveBeenCalledWith(expect.objectContaining({ id: "seg-trip" }), null);
    expect(onOpenCheck).not.toHaveBeenCalled();
  });

  it("opens Apple Health's requested question at once, even before the day's places are read", () => {
    const { tree } = render({ checks: [sleepCheck], checkTitles: new Map([["c-sleep", "Sleep"]]), checkQuestions: new Map([["c-sleep", question("Log your sleep?")]]),
      onAnswerCheck: vi.fn(), onOpenCheck: vi.fn(), openCheckRequest: { id: "c-sleep", request: 1 }, timeline: null });
    expect(questions(tree)).toHaveLength(1);
  });

  it("holds Today's first request too until the day's places are read (Codex r1 on #610)", () => {
    const onOpenPlace = vi.fn();
    const props = { checks: [placeCheck], checkTitles: new Map([["c-unknown", "Unknown place"]]), checkQuestions: new Map([["c-unknown", visited]]),
      onAnswerCheck: vi.fn(), onOpenPlace, scrollToFirstCheck: 1 };
    const { tree } = render({ ...props, timeline: null });
    expect(onOpenPlace).not.toHaveBeenCalled();
    expect(questions(tree)).toHaveLength(0);
    act(() => {
      tree.update(<CalendarListView clockFormat="24h" dayEndMs={at(24)} dayStartMs={at(0)} entries={[]} loggedLabel="4h" nowMs={at(18)} onOpenEntry={vi.fn()}
        onRefresh={vi.fn()} reduceMotion={false} refreshing={false} theme={theme} timeline={timeline} {...props} />);
    });
    expect(onOpenPlace).toHaveBeenCalledOnce();
    expect(questions(tree)).toHaveLength(0);
  });

  it("offers the row's Yes for a confident named place's \"Visited X?\" and a trip's, not for Apple Health (Codex r1 on #610)", () => {
    const named = { ...timeline, items: timeline.items.map((item) => item.id === "seg-unknown"
      ? { ...item, name: "Exampleton Library", placeId: "p-lib", matchKind: "saved" } : item.kind === "trip" ? { ...item, blockIds: [] } : item) } as LocationTimeline;
    const { tree } = render({
      timeline: named, entries: [block("work", "Work", 9, 12)],
      checks: [placeCheck, sleepCheck, { id: "c-trip", segmentId: "seg-trip", startedAt: iso(8), stoppedAt: iso(9) }],
      checkTitles: new Map([["c-unknown", "Exampleton Library"], ["c-sleep", "Sleep"], ["c-trip", "Getting around"]]),
      checkQuestions: new Map([["c-unknown", { ...visited, question: "Visited Exampleton Library?" }],
        ["c-sleep", { ...question("Log your sleep, 01:00–06:00?"), logLabel: "Log as Sleep" }],
        ["c-trip", { ...question("Getting around, 08:00–09:00?"), logLabel: "Yes" }]]),
      onAnswerCheck: vi.fn(), onOpenCheck: vi.fn(), onOpenPlace: vi.fn()
    });
    const pills = tree.root.findAll((node) => typeof node.props.testID === "string" && node.props.testID.startsWith("calendar-list-yes-")
      && typeof node.props.onPress === "function").map((node) => node.props.testID);
    expect(pills.sort()).toEqual(["calendar-list-yes-c-trip", "calendar-list-yes-c-unknown"]);
    // A place question that isn't a guess ("Where were you?") has no row pill.
    const unsure = render({ checks: [placeCheck], checkTitles: new Map([["c-unknown", "Unknown place"]]),
      checkQuestions: new Map([["c-unknown", { ...visited, question: "Where were you?" }]]), onAnswerCheck: vi.fn(), onOpenPlace: vi.fn() });
    expect(unsure.tree.root.findAll((node) => node.props.testID === "calendar-list-yes-c-unknown")).toHaveLength(0);
  });

  it("opens Today's first \"?\" in its sheet when it is a place's", () => {
    const onOpenPlace = vi.fn();
    const { tree } = render({ checks: [placeCheck], checkTitles: new Map([["c-unknown", "Unknown place"]]),
      checkQuestions: new Map([["c-unknown", visited]]), onAnswerCheck: vi.fn(), onOpenPlace, scrollToFirstCheck: 1 });
    expect(onOpenPlace).toHaveBeenCalledOnce();
    expect(questions(tree)).toHaveLength(0);
  });

  it("\"N to check\" counts the last 7 days and asks the caller for the next one after the one last opened (concern 4)", () => {
    const onNextCheck = vi.fn();
    const { tree } = render({ checks: [placeCheck, sleepCheck], checkTitles: new Map([["c-unknown", "Unknown place"], ["c-sleep", "Sleep"]]),
      checkQuestions: new Map([["c-unknown", visited], ["c-sleep", question("Log your sleep?")]]),
      checkTotal: 5, onAnswerCheck: vi.fn(), onNextCheck, onOpenPlace: vi.fn() });
    const chip = () => tree.root.findByProps({ testID: "calendar-list-checks-chip" });
    expect(chip().props.accessibilityLabel).toBe("5 to check in the last 7 days");
    expect(JSON.stringify(chip().props.children)).toContain("5");
    act(() => { chip().props.onPress(); });
    expect(onNextCheck).toHaveBeenLastCalledWith(null);
    act(() => { tree.root.findByProps({ testID: "calendar-list-place-seg-unknown" }).props.onPress(); });
    act(() => { chip().props.onPress(); });
    expect(onNextCheck).toHaveBeenLastCalledWith("c-unknown");
    act(() => { tree.root.findByProps({ testID: "calendar-list-check-c-sleep" }).props.onPress(); });
    act(() => { chip().props.onPress(); });
    expect(onNextCheck).toHaveBeenLastCalledWith("c-sleep");
    // The chip never opens a question by itself.
    expect(questions(tree)).toHaveLength(1);
  });

  it("shows no day-only chip without the caller's 7-day count", () => {
    const { tree } = render({ checks: [placeCheck, sleepCheck], checkTitles: new Map([["c-unknown", "Unknown place"], ["c-sleep", "Sleep"]]),
      onAnswerCheck: vi.fn(), onOpenCheck: vi.fn() });
    expect(tree.root.findAll((node) => node.props.testID === "calendar-list-checks-chip")).toHaveLength(0);
    expect(textOf(tree)).not.toContain("\" to check\"");
  });

  it("reads Today's opened question to VoiceOver, and keeps a closed question closed when its row comes back (Codex r2 on #582)", async () => {
    const { AccessibilityInfo } = await import("react-native");
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
    const checks = [sleepCheck];
    const props = {
      checks,
      checkTitles: new Map([["c-sleep", "Sleep"]]),
      checkQuestions: new Map([["c-sleep", question("Log your sleep?")]]),
      onAnswerCheck: vi.fn(),
      onOpenCheck: vi.fn()
    };
    const { tree } = render({ ...props, scrollToFirstCheck: 1 });
    // Today's chip opened it: VoiceOver hears the question, as when its "?" is tapped.
    expect(questions(tree)).toHaveLength(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Log your sleep?");
    const rerender = (next: Partial<Parameters<typeof CalendarListView>[0]>) => act(() => {
      tree.update(<CalendarListView clockFormat="24h" dayEndMs={at(24)} dayStartMs={at(0)} entries={[block("commute", "Commute", 8, 9), block("work", "Work", 9, 12)]}
        loggedLabel="4h" nowMs={at(18)} onOpenEntry={vi.fn()} onRefresh={vi.fn()} reduceMotion={false} refreshing={false}
        theme={theme} timeline={timeline} {...props} scrollToFirstCheck={1} {...next} />);
    });
    // Its row leaves (another day, a refresh) and comes back: the question stays closed until asked again.
    rerender({ checks: [] });
    expect(questions(tree)).toHaveLength(0);
    rerender({ checks });
    expect(questions(tree)).toHaveLength(0);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    // An overnight "?" opened on one day, then the day before, which shows it too: it closes there (Codex r4 on #582).
    const overnight = [{ id: "c-sleep", segmentId: null, startedAt: new Date(at(0) - 2 * 3_600_000).toISOString(), stoppedAt: iso(6) }];
    rerender({ checks: overnight });
    const sleepRow = () => tree.root.findAll((node) => node.props.testID === "calendar-list-check-c-sleep" && typeof node.props.onPress === "function");
    act(() => { sleepRow()[0].props.onPress(); });
    expect(questions(tree)).toHaveLength(1);
    rerender({ checks: overnight, dayStartMs: at(0) - 86_400_000, dayEndMs: at(0), timeline: null });
    expect(sleepRow()).toHaveLength(1);
    expect(questions(tree)).toHaveLength(0);
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
    act(() => { tree.root.findByProps({ testID: "calendar-list-check-c-sleep" }).props.onPress(); });
    expect(tree.root.findAll((node) => node.props.testID === "calendar-list-answer-log")).toHaveLength(0);
    expect(tree.root.findAll((node) => node.props.testID === "calendar-list-answer-skip")).toHaveLength(0);
    const open = tree.root.findByProps({ testID: "calendar-list-answer-open" });
    expectCompactPill(open);
    act(() => { open.props.onPress(); });
    expect(onOpenCheck).toHaveBeenCalledWith("c-sleep");
    expect(onAnswerCheck).not.toHaveBeenCalled();
  });

  it("marks Today's waiting request done when \"N to check\" moves on from it (Codex r12 on #582)", () => {
    const onScrolledToFirstCheck = vi.fn();
    const { tree } = render({
      checks: [placeCheck, sleepCheck],
      checkTitles: new Map([["c-unknown", "Unknown place"], ["c-sleep", "Sleep"]]),
      checkQuestions: new Map([["c-unknown", question("Log Unknown place?")], ["c-sleep", question("Log your sleep?")]]),
      checkTotal: 2,
      onAnswerCheck: vi.fn(),
      onNextCheck: vi.fn(),
      onOpenCheck: vi.fn(),
      onScrolledToFirstCheck,
      scrollToFirstCheck: 1
    });
    // Its row has not been measured yet (no native layout here): the request is still waiting.
    expect(onScrolledToFirstCheck).not.toHaveBeenCalled();
    act(() => { tree.root.findByProps({ testID: "calendar-list-checks-chip" }).props.onPress(); });
    expect(onScrolledToFirstCheck).toHaveBeenCalledOnce();
  });

  it("puts each open suggestion on the row it is about, and opens one on its own screen without answers here (location v4 step 14)", () => {
    const onOpenCheck = vi.fn();
    const { tree } = render({
      checks: [placeCheck, sleepCheck],
      checkTitles: new Map([["c-unknown", "Unknown place"], ["c-sleep", "Sleep"]]),
      onOpenCheck
    });
    // The place's suggestion sits on its row; Apple Health has a row of its own at its time.
    const placeRow = tree.root.findByProps({ testID: "calendar-list-place-seg-unknown" });
    expect(placeRow.props.accessibilityLabel).toContain("Needs a look");
    expect(labels(tree).some((label) => label.startsWith("Sleep") && label.includes("Needs a look"))).toBe(true);
    act(() => { placeRow.props.onPress(); });
    expect(onOpenCheck).toHaveBeenLastCalledWith("c-unknown");
    act(() => { tree.root.findByProps({ testID: "calendar-list-check-c-sleep" }).props.onPress(); });
    expect(onOpenCheck).toHaveBeenLastCalledWith("c-sleep");
    expect(questions(tree)).toHaveLength(0);
  });

  it("shows a day's checks even before its places are read", () => {
    const { tree } = render({ timeline: null, checks: [sleepCheck], checkTitles: new Map([["c-sleep", "Sleep"]]), onOpenCheck: vi.fn() });
    expect(tree.root.findAll((node) => node.props.testID === "calendar-list-check-c-sleep").length).toBeGreaterThan(0);
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

describe("CalendarListView modes line (card D item 12)", () => {
  it("shows at most three legs, then +N, while VoiceOver still hears every leg", () => {
    const legs = [0, 10, 20, 30, 40].map((minute, index) => ({
      startedAt: iso(8, minute), stoppedAt: iso(8, minute + 10), mode: index % 2 ? "bus" : "walking", confidence: "sure", distanceMeters: 500
    }));
    const fiveLegs = { ...timeline, items: timeline.items.map((item) => (item.kind === "trip" ? { ...item, legs } : item)) } as LocationTimeline;
    const { tree } = render({ timeline: fiveLegs });
    expect(tree.root.findByProps({ testID: "calendar-list-modes-more" }).props.children).toEqual(["+", 2]);
    expect(labels(tree)).toContain("Commute. Home → Office. Legs: Walk, Bus, Walk, Bus, Walk");
    // Two legs: no "+N".
    expect(render().tree.root.findAll((node) => node.props.testID === "calendar-list-modes-more")).toHaveLength(0);
  });
});



describe("CalendarListView correction sheets (location v4 step 12)", () => {
  it("opens a place's sheet from its row, and a trip's at a leg", () => {
    const onOpenPlace = vi.fn();
    const onOpenTripLeg = vi.fn();
    const { tree } = render({ onOpenPlace, onOpenTripLeg });
    const unknown = tree.root.findByProps({ testID: "calendar-list-place-seg-unknown" });
    expect(unknown.props.accessibilityHint).toBe("Opens the place");
    act(() => { unknown.props.onPress(); });
    expect(onOpenPlace).toHaveBeenCalledWith(expect.objectContaining({ id: "seg-unknown" }), "Unknown place");
    // The commute's legs, opened from its modes line: each opens its trip's sheet at that leg.
    act(() => { tree.root.findByProps({ accessibilityLabel: "Show the 2 legs" }).props.onPress(); });
    act(() => { tree.root.findByProps({ testID: "calendar-list-leg-1" }).props.onPress(); });
    expect(onOpenTripLeg).toHaveBeenCalledWith(expect.objectContaining({ id: "seg-trip", route: "Home → Office" }), 1);
  });

  it("opens a place with a question in its sheet too (the sheet asks it at its top), and Home with All places", () => {
    const onOpenPlace = vi.fn();
    const { tree } = render({ onOpenPlace, checks: [{ id: "c-unknown", segmentId: "seg-unknown", startedAt: iso(12), stoppedAt: iso(13) }],
      checkTitles: new Map([["c-unknown", "Unknown place"]]), onAnswerCheck: vi.fn() });
    act(() => { tree.root.findByProps({ testID: "calendar-list-place-seg-unknown" }).props.onPress(); });
    expect(onOpenPlace).toHaveBeenCalledWith(expect.objectContaining({ id: "seg-unknown" }), "Unknown place");
    act(() => { tree.root.findByProps({ testID: "calendar-list-show-all" }).props.onPress(); });
    const home = tree.root.findAll((node) => node.props.testID === "calendar-list-place-seg-home" && typeof node.props.onPress === "function");
    expect(home.map((node) => node.props.disabled)).toEqual([false]);
  });
});

describe("CalendarListView's open question (card B part 2)", () => {
  // A legacy location suggestion (before location v2) has no segment: nothing to open, so it is "none" and asks under
  // its row (Codex r2 on #610).
  it("says which question is open under its row, a legacy place \"?\" without a segment, so only that one looks for a place nearby", () => {
    const onOpenCheckChange = vi.fn();
    const { tree } = render({
      checkKinds: new Map([["c-place", "none"]]),
      checks: [{ id: "c-place", segmentId: null, startedAt: iso(12), stoppedAt: iso(13) }],
      checkTitles: new Map([["c-place", "Unknown place"]]),
      checkQuestions: new Map([["c-place", { question: "Where were you?", detail: null, logLabel: null, skipLabel: "Not now", more: true, moreLabel: "Edit", opens: false }]]),
      onAnswerCheck: vi.fn(),
      onOpenCheckChange
    });
    expect(onOpenCheckChange).toHaveBeenLastCalledWith(null);
    act(() => { tree.root.findByProps({ testID: "calendar-list-check-c-place" }).props.onPress(); });
    expect(onOpenCheckChange).toHaveBeenLastCalledWith("c-place");
  });
});
