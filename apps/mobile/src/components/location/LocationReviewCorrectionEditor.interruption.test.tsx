import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocationReviewAction } from "@dayframe/shared";
import { syntheticReviewBootstrap, syntheticReviewEvidence } from "../../../../../scripts/fixtures/review-performance";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() }, Keyboard: { addListener: () => ({ remove: vi.fn() }), dismiss: vi.fn() },
  Platform: { OS: "ios" }, Pressable: "Pressable", ScrollView: "ScrollView", Switch: "Switch",
  Text: "Text", TextInput: "TextInput", View: "View",
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1.8 })
}));
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" } }));
vi.mock("react-native-svg", () => ({ default: "Svg", Circle: "Circle", Path: "Path", Rect: "Rect" }));
vi.mock("@/lib/locationReviewDraft", async () => import("../../lib/locationReviewDraft"));
vi.mock("@/lib/commuteInterruptionDraft", async () => import("../../lib/commuteInterruptionDraft"));
vi.mock("@/lib/mobileTypography", async () => import("../../lib/mobileTypography"));
vi.mock("@/lib/mobileTheme", () => ({
  useMobileTheme: () => ({ styles: {}, theme: { mode: "dark" } }), pressable: (style: unknown) => style
}));
vi.mock("@/lib/placeSearch", () => ({
  createNativeNearbyPointOfInterestProvider: () => null,
  createNativePlaceSearchProvider: () => null,
  visibleNearbyPlaces: () => []
}));
vi.mock("@/lib/motion", () => ({
  localLayoutTransition: vi.fn(), localPresenceEntering: vi.fn(), localPresenceExiting: vi.fn(),
  useReduceMotionPreference: () => true
}));
vi.mock("./LocationEvidenceMap", () => ({ LocationEvidenceMap: () => null }));

import { LocationReviewCorrectionEditor } from "./LocationReviewCorrectionEditor";
import { CommuteInterruptionPreview } from "./CommuteInterruptionPreview";

let tree: ReturnType<typeof create>;
afterEach(() => { if (tree) act(() => tree.unmount()); });

function mount(startedAt = new Date(2026, 8, 29, 7, 0, 34, 123).toISOString(),
  stoppedAt = new Date(2026, 8, 29, 7, 39, 52, 987).toISOString()) {
  const evidence = syntheticReviewEvidence(syntheticReviewBootstrap(2))[0];
  evidence.segment.startedAt = startedAt;
  evidence.segment.stoppedAt = stoppedAt;
  evidence.map.acceptedSamples.forEach((sample) => { sample.role = "route"; });
  const onResolve = vi.fn<(action: LocationReviewAction, message: string) => Promise<void>>().mockResolvedValue(undefined);
  act(() => {
    tree = create(<LocationReviewCorrectionEditor evidence={evidence} categories={[]} places={[]}
      adjacentReview={undefined} reviewItem={undefined} isFocused={true} saving={false} onResolve={onResolve} />);
  });
  act(() => tree.root.findByProps({ accessibilityLabel: "Show more resolution options" }).props.onPress());
  return onResolve;
}

function enter(label: string, value: string) {
  act(() => tree.root.findByProps({ accessibilityLabel: label }).props.onChangeText(value));
}

function save() {
  const button = tree.root.findAllByType("Pressable" as never).find((node) =>
    node.findAllByType("Text" as never).some((text) => text.children.join("") === "Save interruption and review both legs"));
  act(() => button!.props.onPress());
}

function fullTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

describe("mobile interruption editor preview and submission", () => {
  it.each([26, 39])("submits zero seconds for 07:13 / 07:%s and previews those exact values", (endMinute) => {
    const onResolve = mount();
    enter("Stop began time", "07:13");
    enter("Journey resumed time", `07:${endMinute}`);
    const preview = tree.root.findByType(CommuteInterruptionPreview);
    const mutation = preview.props.interruption.mutation;
    expect(mutation).toEqual({ action: "interrupt_commute",
      stopStartedAt: new Date(2026, 8, 29, 7, 13).toISOString(),
      stopEndedAt: new Date(2026, 8, 29, 7, endMinute).toISOString() });
    expect(preview.findAllByType("View" as never).filter((node) => node.props.accessible)
      .map((node) => node.props.accessibilityLabel)).toEqual([
      `Journey 1. ${fullTime(preview.props.startedAt)} to ${fullTime(mutation.stopStartedAt)}`,
      `Unassigned stop. ${fullTime(mutation.stopStartedAt)} to ${fullTime(mutation.stopEndedAt)}`,
      `Journey 2. ${fullTime(mutation.stopEndedAt)} to ${fullTime(preview.props.stoppedAt)}`
    ]);
    save();
    expect(onResolve).toHaveBeenCalledOnce();
    expect(onResolve.mock.calls[0][0]).toBe(mutation);
  });

  it("retains the entered local dates across midnight in preview and submission", () => {
    const onResolve = mount(new Date(2026, 8, 29, 23, 50, 34).toISOString(), new Date(2026, 8, 30, 0, 39, 52).toISOString());
    enter("Stop began time", "23:58");
    enter("Journey resumed time", "00:26");
    const mutation = tree.root.findByType(CommuteInterruptionPreview).props.interruption.mutation;
    expect(mutation).toEqual({ action: "interrupt_commute",
      stopStartedAt: new Date(2026, 8, 29, 23, 58).toISOString(),
      stopEndedAt: new Date(2026, 8, 30, 0, 26).toISOString() });
    save();
    expect(onResolve.mock.calls[0][0]).toBe(mutation);
  });

  it.each([
    ["07:26", "07:13", "The stop must begin before the journey resumes."],
    ["07:00", "07:26", "Both stop times must be inside this commute."]
  ])("shows the reason for populated invalid times %s / %s and prevents submission", (start, end, reason) => {
    const onResolve = mount();
    enter("Stop began time", start);
    enter("Journey resumed time", end);
    const preview = tree.root.findByType(CommuteInterruptionPreview);
    const labels = preview.findAllByType("Text" as never).map((node) => node.children.join(""));
    expect(labels).toContain(reason);
    expect(labels).not.toContain("Set both stop times");
    save();
    expect(onResolve).not.toHaveBeenCalled();
    enter("Stop began time", "07:13");
    enter("Journey resumed time", "07:26");
    expect(tree.root.findByType(CommuteInterruptionPreview).props.interruption.status).toBe("valid");
    enter("Journey resumed time", "");
    expect(tree.root.findByType(CommuteInterruptionPreview).props.interruption.status).toBe("incomplete");
  });
});
