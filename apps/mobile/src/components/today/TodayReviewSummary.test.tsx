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
    errorKind: null,
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
    expect(text).toContain("2 items to review · 1 today");
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

  it("qualifies a cached or partial presentation instead of presenting it as complete", () => {
    mocks.context.presentation = {
      ...mocks.context.presentation,
      coverage: "partial",
      globalReviewCount: { value: 5, exact: false },
      todayReviewCount: { value: 2, exact: false }
    };
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TodayReviewSummary isFocused />);
    });
    const text = tree.root.findAllByType("Text" as never).map((node) => node.children.join(""));
    expect(text).toContain("Today's summary is partial. Open Review for more items.");
    expect(text).toContain("Open Review for the latest available items");
  });

  it("keeps the timer surface unblocked while an unavailable summary is loading", () => {
    mocks.context = {
      isSummaryAvailable: false,
      isLoading: true,
      owner: { backendId: "staging", workspaceId: "workspace", userId: "user" },
      error: null,
      presentation: null
    };
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TodayReviewSummary isFocused />);
    });
    const container = tree.root.findByProps({ testID: "today-review-summary" });
    const style = container.props.style;
    expect(mocks.donutProps).toMatchObject({ completedLoggedMs: null, segments: [] });
    expect(JSON.stringify(tree.toJSON())).not.toContain("still loading");
    mocks.context = { ...mocks.context, isSummaryAvailable: true, presentation: {
      dayKey: "2026-09-12", daySections: [], coverage: "complete", completedLoggedMs: 0,
      donutSegments: [], globalReviewCount: { value: 0, exact: true }, todayReviewCount: { value: 0, exact: true }
    } };
    act(() => tree.update(<TodayReviewSummary isFocused />));
    expect(tree.root.findByProps({ testID: "today-review-summary" })).toBe(container);
    expect(container.props.style).toBe(style);
    expect(mocks.donutProps.completedLoggedMs).toBe(0);
  });

  it("keeps unavailable diagnostic failures out of Today", () => {
    const unavailable = (errorKind: string) => {
      mocks.context = {
        isSummaryAvailable: false,
        isLoading: false,
        owner: { backendId: "staging", workspaceId: "workspace", userId: "user" },
        error: "Safe diagnostic copy only",
        errorKind,
        presentation: null
      };
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<TodayReviewSummary isFocused />);
      });
      return tree.toJSON();
    };

    for (const kind of ["offline", "server", "validation", "cache", "snapshot_changed"]) {
      expect(JSON.stringify(unavailable(kind))).not.toContain("Safe diagnostic copy");
      expect(mocks.donutProps).toMatchObject({ completedLoggedMs: null, segments: [] });
    }
  });

  it("keeps verified content mounted without error copy after a failed refresh", () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<TodayReviewSummary isFocused />); });
    const mounted = tree.root.findByProps({ testID: "today-review-summary" });
    for (const kind of ["offline", "server", "validation", "cache", "snapshot_changed"]) {
      mocks.context = { ...mocks.context, error: "Private failure must stay out of Today", errorKind: kind };
      act(() => { tree.update(<TodayReviewSummary isFocused />); });
      expect(tree.root.findByProps({ testID: "today-review-summary" })).toBe(mounted);
      expect(JSON.stringify(tree.toJSON())).not.toContain("Private failure");
      expect(mocks.donutProps.completedLoggedMs).toBe(3_600_000);
    }
  });
});
