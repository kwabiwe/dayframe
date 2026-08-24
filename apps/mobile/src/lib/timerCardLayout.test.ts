import { describe, expect, it } from "vitest";
import {
  TIMER_CARD_ACTION_COLUMN_WIDTH,
  TIMER_CARD_ACTION_SIZE,
  TIMER_CARD_CONTENT_MIN_HEIGHT,
  TIMER_CARD_DESCRIPTION_TO_QUICK_ACTIONS_SPACING,
  TIMER_CARD_HORIZONTAL_INSET,
  TIMER_CARD_LABEL_TO_PILL_SPACING,
  TIMER_CARD_MIN_HEIGHT,
  TIMER_CARD_QUICK_ACTION_ROW_HEIGHT,
  TIMER_CARD_VERTICAL_INSET,
  timerCardActionGeometry
} from "./timerCardLayout";

describe("mobile timer-card layout", () => {
  it.each([375, 402, 414, 440])(
    "keeps idle Play and running Stop on the same action track at %ipx",
    (cardWidth) => {
      const idle = timerCardActionGeometry({ cardWidth });
      const running = timerCardActionGeometry({ cardWidth });

      expect(running.primaryCenter).toEqual(idle.primaryCenter);
      expect(running.secondaryCenter).toEqual(idle.secondaryCenter);
      expect(idle.primaryCenter.x).toBe(
        cardWidth - TIMER_CARD_HORIZONTAL_INSET - TIMER_CARD_ACTION_COLUMN_WIDTH / 2
      );
      expect(idle.cardHeight).toBe(TIMER_CARD_MIN_HEIGHT);
    }
  );

  it("bottom-aligns both plus controls with the Quick Actions row", () => {
    const geometry = timerCardActionGeometry({ cardWidth: 414 });
    const plusBottom = geometry.secondaryCenter.y + TIMER_CARD_ACTION_SIZE / 2;
    const quickActionsBottom =
      TIMER_CARD_VERTICAL_INSET + TIMER_CARD_CONTENT_MIN_HEIGHT;

    expect(plusBottom).toBe(quickActionsBottom);
    expect(geometry.cardHeight - plusBottom).toBe(TIMER_CARD_VERTICAL_INSET);
    expect(geometry.secondaryBottomInset).toBe(TIMER_CARD_VERTICAL_INSET);
    expect(TIMER_CARD_QUICK_ACTION_ROW_HEIGHT).toBe(TIMER_CARD_ACTION_SIZE);
  });

  it("keeps deliberate description, label, and pill spacing", () => {
    expect(TIMER_CARD_DESCRIPTION_TO_QUICK_ACTIONS_SPACING).toBeGreaterThan(
      TIMER_CARD_LABEL_TO_PILL_SPACING
    );
    expect(TIMER_CARD_LABEL_TO_PILL_SPACING).toBeGreaterThanOrEqual(2);
  });

  it("lets larger text and long content grow vertically without moving the top action or bottom inset", () => {
    const baseline = timerCardActionGeometry({ cardWidth: 402 });
    const expanded = timerCardActionGeometry({
      cardWidth: 402,
      contentHeight: TIMER_CARD_CONTENT_MIN_HEIGHT + 72
    });

    expect(expanded.cardHeight).toBe(baseline.cardHeight + 72);
    expect(expanded.primaryCenter).toEqual(baseline.primaryCenter);
    expect(expanded.secondaryCenter.x).toBe(baseline.secondaryCenter.x);
    expect(expanded.secondaryBottomInset).toBe(TIMER_CARD_VERTICAL_INSET);
  });
});
