import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({ context: null as any, donutProps: null as any }));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View" }));
vi.mock("@/lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("@/lib/mobileTheme", () => ({
  pressable: (base: unknown) => base,
  useMobileTheme: () => ({
    styles: {
      buttonPressed: "pressed",
      todayReviewAwaiting: "awaiting",
      todayReviewOpenButton: "open",
      todayReviewOpenMeta: "openMeta",
      todayReviewOpenTitle: "openTitle",
      todayReviewSaved: "saved",
      todayReviewSummary: "summary",
    },
    theme: { textPrimary: "primary" }
  })
}));
vi.mock("@/lib/motion", () => ({
  useResolvedReduceMotionPreference: () => ({ reduceMotion: false, resolved: true })
}));
vi.mock("./TodayReviewPresentationContext", () => ({
  useTodayReviewPresentationContext: () => mocks.context
}));
vi.mock("./TodayReviewDonut", () => ({
  TodayReviewDonut: (props: unknown) => {
    mocks.donutProps = props;
    return null;
  }
}));

import { TodayReviewSummary } from "./TodayReviewSummary";

beforeEach(() => {
  mocks.donutProps = null;
  mocks.context = {
    isSummaryAvailable: true,
    error: null,
    openReview: vi.fn(),
    presentation: {
      completedLoggedMs: 3_600_000,
      awaitingReviewMs: 1_800_000,
      savedConfirmationCount: 1,
      dayKey: "2026-09-12",
      donutSegments: [],
      daySections: [],
      coverage: "complete",
      globalReviewCount: { value: 2, exact: true },
      todayReviewCount: { value: 1, exact: true }
    }
  };
});

describe("TodayReviewSummary", () => {
  it("has one global Review control and separates logged, awaiting, and saved-local copy", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TodayReviewSummary isFocused />);
    });
    const text = tree.root.findAllByType("Text" as never).map((node) => node.children.join(""));
    expect(mocks.donutProps).toMatchObject({
      completedLoggedMs: 3_600_000,
      animateEntrance: true,
      isFocused: true
    });
    expect(text).toContain("+ 30m awaiting review");
    expect(text).toContain("1 confirmation syncing");
    const actions = tree.root.findAllByType("Pressable" as never);
    expect(actions).toHaveLength(1);
    act(() => actions[0].props.onPress());
    expect(mocks.context.openReview).toHaveBeenCalledTimes(1);
  });

  it("hides the control only when complete current evidence proves no outstanding work", () => {
    mocks.context.presentation = {
      ...mocks.context.presentation,
      globalReviewCount: { value: 0, exact: true },
      todayReviewCount: { value: 0, exact: true }
    };
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TodayReviewSummary isFocused />);
    });
    expect(tree.root.findAllByType("Pressable" as never)).toHaveLength(0);
  });
});
