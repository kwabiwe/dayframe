import { describe, expect, it } from "vitest";
import {
  HISTORY_REPLAY_ACTION_GAP,
  HISTORY_REPLAY_ACTION_WIDTH,
  HISTORY_STACKED_DURATION_TRAILING_INSET,
  historyRowLayout,
  summaryLayout
} from "./mobileAccessibilityLayout";

describe("mobile accessibility presentation budgets", () => {
  it("reserves the title, complete measured duration, and replay target at supported phone widths", () => {
    const availableByViewport = [320, 375, 390, 430].map((viewport) => viewport - 60);
    expect(availableByViewport.map((availableWidth) => historyRowLayout({
      availableWidth,
      countBadgeWidth: 34,
      durationWidth: 62,
    }))).toEqual(["stacked", "inline", "inline", "inline"]);
  });

  it("stacks values rather than squeezing when a complete summary cannot fit", () => {
    expect(summaryLayout({ availableWidth: 140, labelWidth: 54, valueWidth: 98 })).toBe("stacked");
    expect(summaryLayout({ availableWidth: 190, labelWidth: 54, valueWidth: 98 })).toBe("inline");
    expect(summaryLayout({
      availableWidth: 390,
      labelWidth: 279.3,
      valueWidth: 76.7,
      gap: 10,
      padding: 24,
    })).toBe("stacked");
    expect(summaryLayout({
      availableWidth: 398,
      labelWidth: 279.3,
      valueWidth: 76.7,
      gap: 10,
      padding: 24,
    })).toBe("inline");
  });

  it("reserves the measured width of a multi-digit group counter", () => {
    expect(historyRowLayout({
      availableWidth: 280,
      countBadgeWidth: 34,
      durationWidth: 62,
    })).toBe("inline");
    expect(historyRowLayout({
      availableWidth: 280,
      countBadgeWidth: 42,
      durationWidth: 62,
    })).toBe("stacked");
  });

  it("keeps the stacked duration inset tied to the replay target and its action gap", () => {
    expect(HISTORY_REPLAY_ACTION_WIDTH).toBe(44);
    expect(HISTORY_REPLAY_ACTION_GAP).toBe(3);
    expect(HISTORY_STACKED_DURATION_TRAILING_INSET).toBe(
      HISTORY_REPLAY_ACTION_WIDTH + HISTORY_REPLAY_ACTION_GAP
    );
  });
});
