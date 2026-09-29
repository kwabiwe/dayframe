import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCommuteInterruptionDraft } from "../../lib/commuteInterruptionDraft";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({ Text: "Text", View: "View" }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { CommuteInterruptionPreview } from "./CommuteInterruptionPreview";

const startedAt = new Date(2026, 8, 29, 23, 10, 23).toISOString();
const stoppedAt = new Date(2026, 8, 30, 0, 30, 52).toISOString();
const draft = {
  baselineStartedAt: startedAt,
  baselineStoppedAt: stoppedAt,
  startDateText: "2026-09-29",
  startTimeText: "23:20",
  stopDateText: "2026-09-30",
  stopTimeText: "00:05"
};
const styles = { splitSummary: { gap: 7 }, fieldLabel: {}, helperText: {} };
let tree: ReturnType<typeof create>;
afterEach(() => { if (tree) act(() => tree.unmount()); });

function preview(interruption = parseCommuteInterruptionDraft(draft)) {
  return <CommuteInterruptionPreview startedAt={startedAt} stoppedAt={stoppedAt}
    interruption={interruption} styles={styles} />;
}

function spokenRanges() {
  return tree.root.findAllByType("View" as never)
    .filter((node) => node.props.accessible)
    .map((node) => {
      expect(node.props.accessibilityRole).toBe("text");
      return node.props.accessibilityLabel;
    });
}

function fullTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

describe("commute interruption preview presentation and accessibility", () => {
  it("exposes all three ordered parts with complete dates and times across midnight", () => {
    const interruption = parseCommuteInterruptionDraft(draft);
    const mutation = interruption.mutation!;
    act(() => { tree = create(preview(interruption)); });
    const ranges = [
      `${fullTime(startedAt)} to ${fullTime(mutation.stopStartedAt)}`,
      `${fullTime(mutation.stopStartedAt)} to ${fullTime(mutation.stopEndedAt)}`,
      `${fullTime(mutation.stopEndedAt)} to ${fullTime(stoppedAt)}`
    ];
    expect(spokenRanges()).toEqual([
      `Journey 1. ${ranges[0]}`,
      `Unassigned stop. ${ranges[1]}`,
      `Journey 2. ${ranges[2]}`
    ]);
    expect(tree.root.findAllByType("Text" as never).map((node) => node.children.join(""))).toEqual([
      "Journey 1", ranges[0], "Unassigned stop", ranges[1], "Journey 2", ranges[2]
    ]);
  });

  it("updates the mounted preview from revised stop times while retaining parent bounds", () => {
    act(() => { tree = create(preview()); });
    const updated = parseCommuteInterruptionDraft({ ...draft, startTimeText: "23:25", stopTimeText: "00:10" });
    act(() => tree.update(preview(updated)));
    expect(spokenRanges()).toEqual([
      `Journey 1. ${fullTime(startedAt)} to ${fullTime(updated.mutation!.stopStartedAt)}`,
      `Unassigned stop. ${fullTime(updated.mutation!.stopStartedAt)} to ${fullTime(updated.mutation!.stopEndedAt)}`,
      `Journey 2. ${fullTime(updated.mutation!.stopEndedAt)} to ${fullTime(stoppedAt)}`
    ]);
  });

  it.each([
    { startTimeText: "" }, { stopTimeText: "" }, { stopDateText: "" }
  ])("keeps completion guidance for incomplete fields: %j", (changes) => {
    act(() => { tree = create(preview(parseCommuteInterruptionDraft({ ...draft, ...changes }))); });
    expect(spokenRanges()).toEqual([
      "Journey 1. Set both stop times", "Unassigned stop. No time assigned", "Journey 2. Set both stop times"
    ]);
  });

  it.each([
    [{ startTimeText: "invalid" }, "Enter the time as HH:mm."],
    [{ startTimeText: "23:00" }, "Both stop times must be inside this commute."],
    [{ stopTimeText: "00:40" }, "Both stop times must be inside this commute."],
    [{ stopDateText: "2026-09-29", stopTimeText: "23:15" }, "The stop must begin before the journey resumes."]
  ])("shows the parser reason instead of completion guidance for populated invalid fields: %j", (changes, reason) => {
    act(() => { tree = create(preview(parseCommuteInterruptionDraft({ ...draft, ...changes }))); });
    expect(spokenRanges()).toEqual([
      `Journey 1. ${reason}`, "Unassigned stop. No time assigned", `Journey 2. ${reason}`
    ]);
    expect(tree.root.findAllByType("Text" as never).some((node) => node.children.join("") === "Set both stop times")).toBe(false);
  });

  it("keeps text scalable, wrapping and fully spoken without adding touch controls", () => {
    act(() => { tree = create(preview()); });
    const text = tree.root.findAllByType("Text" as never);
    expect(text.every((node) => node.props.allowFontScaling === true)).toBe(true);
    expect(text.map((node) => node.props.maxFontSizeMultiplier)).toEqual([1.3, 0, 1.3, 0, 1.3, 0]);
    expect(text.every((node) => node.props.numberOfLines === undefined)).toBe(true);
    expect(tree.root.findAllByType("Pressable" as never)).toHaveLength(0);
    expect(tree.root.findAllByType("View" as never).every((node) => node.props.style?.height === undefined)).toBe(true);
  });
});
