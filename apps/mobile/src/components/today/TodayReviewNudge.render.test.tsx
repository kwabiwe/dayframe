import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({ context: null as unknown }));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style },
  Text: "Text",
  View: "View",
}));
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" } }));
vi.mock("../../lib/motion", () => ({ localPresenceEntering: () => "entering", localPresenceExiting: () => "exiting" }));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: () => null }));
vi.mock("./TodayReviewPresentationContext", () => ({ useTodayReviewPresentationContext: () => mocks.context }));

import { reviewNudgeCopy, TodayReviewNudge } from "./TodayReviewNudge";

const theme = { mode: "dark", surface: "#151B26", surfaceMuted: "#202838", textMuted: "#707B91", textPrimary: "#FFF", textSecondary: "#8993A7" } as never;

function activity(color: string | null, awaitingDecision = true) {
  return { awaitingDecision, category: color ? { id: color, name: color, color } : null };
}

function render(fallbackCount: number, reduceMotion = false) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<TodayReviewNudge fallbackCount={fallbackCount} onOpenReview={vi.fn()} reduceMotion={reduceMotion} theme={theme} />);
  });
  return tree;
}

beforeEach(() => {
  mocks.context = null;
});

describe("reviewNudgeCopy", () => {
  it("names an exact count and hides only on an exact zero", () => {
    expect(reviewNudgeCopy({ value: 1, exact: true }, 0)?.title).toBe("1 moment to review");
    expect(reviewNudgeCopy({ value: 4, exact: true }, 0)?.title).toBe("4 moments to review");
    expect(reviewNudgeCopy({ value: 0, exact: true }, 7)).toBeNull();
  });

  it("never shows a number it cannot vouch for", () => {
    expect(reviewNudgeCopy({ value: 12, exact: false }, 3)).toEqual({
      count: null,
      detail: "Open Review for the latest items.",
      title: "Moments to review",
    });
    expect(reviewNudgeCopy({ value: null, exact: false }, 2)?.title).toBe("2 moments to review");
    expect(reviewNudgeCopy(null, 0)).toBeNull();
  });
});

describe("TodayReviewNudge", () => {
  it("stacks up to three awaiting activities' colours in the prototype's poses", () => {
    mocks.context = {
      isSummaryAvailable: true,
      presentation: {
        globalReviewCount: { value: 5, exact: true },
        daySections: [
          { activities: [activity("blue"), activity("lime", false), activity("amber")] },
          { activities: [activity(null), activity("rose")] },
        ],
      },
    };
    const tree = render(0);
    const nudge = tree.root.findByProps({ testID: "today-review-nudge" });
    expect(nudge.props.accessibilityLabel).toBe("5 moments to review. Dayframe found time you didn't track.");
    const blocks = tree.root.findAll((node) =>
      node.type === ("View" as never) && Array.isArray(node.props.style) && node.props.style[0]?.position === "absolute");
    expect(blocks).toHaveLength(3);
    expect(blocks.map((block) => block.props.style[1].opacity)).toEqual([0.55, 0.8, 1]);
    // A Review item without an activity draws a neutral block.
    expect(blocks[2].props.style[2].backgroundColor).toBe("#202838");
  });

  it("fades in only after first paint and always fades out", () => {
    const tree = render(0);
    expect(tree.toJSON()).toBeNull();
    act(() => tree.update(<TodayReviewNudge fallbackCount={2} onOpenReview={vi.fn()} reduceMotion={false} theme={theme} />));
    const presence = tree.root.findByType("AnimatedView" as never);
    expect(presence.props).toMatchObject({ entering: "entering", exiting: "exiting" });

    const firstPaint = render(2);
    expect(firstPaint.root.findByType("AnimatedView" as never).props.entering).toBeUndefined();
  });
});
