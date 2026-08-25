export const TIMER_CARD_HORIZONTAL_INSET = 16;
export const TIMER_CARD_VERTICAL_INSET = 14;
export const TIMER_CARD_ACTION_SIZE = 44;
export const TIMER_CARD_ACTION_COLUMN_WIDTH = TIMER_CARD_ACTION_SIZE;
export const TIMER_CARD_ACTION_COLUMN_GAP = 8;
export const TIMER_CARD_CONTENT_TO_ACTION_GAP = 12;
export const TIMER_CARD_DESCRIPTION_TO_QUICK_ACTIONS_SPACING = 10;
export const TIMER_CARD_DESCRIPTION_HEIGHT = 48;
export const TIMER_CARD_LABEL_TO_PILL_SPACING = 4;
export const TIMER_CARD_QUICK_ACTION_LABEL_LINE_HEIGHT = 14;
export const TIMER_CARD_QUICK_ACTION_PILL_HEIGHT = 32;
export const TIMER_CARD_QUICK_ACTION_HIT_SLOP =
  (TIMER_CARD_ACTION_SIZE - TIMER_CARD_QUICK_ACTION_PILL_HEIGHT) / 2;
export const TIMER_CARD_TRAILING_SCROLL_INSET = 12;

export const TIMER_CARD_CONTENT_MIN_HEIGHT =
  TIMER_CARD_DESCRIPTION_HEIGHT +
  TIMER_CARD_DESCRIPTION_TO_QUICK_ACTIONS_SPACING +
  TIMER_CARD_QUICK_ACTION_LABEL_LINE_HEIGHT +
  TIMER_CARD_LABEL_TO_PILL_SPACING +
  TIMER_CARD_QUICK_ACTION_PILL_HEIGHT;

export const TIMER_CARD_MIN_HEIGHT =
  TIMER_CARD_VERTICAL_INSET * 2 + TIMER_CARD_CONTENT_MIN_HEIGHT;

export type TimerCardActionGeometry = {
  cardHeight: number;
  primaryCenter: { x: number; y: number };
  secondaryCenter: { x: number; y: number };
  secondaryBottomInset: number;
};

/**
 * Card-relative action coordinates used by layout tests and screenshot QA.
 * React Native still owns the responsive flex layout; this helper records the
 * invariant both idle and running cards must satisfy.
 */
export function timerCardActionGeometry(input: {
  cardWidth: number;
  contentHeight?: number;
}): TimerCardActionGeometry {
  const contentHeight = Math.max(
    TIMER_CARD_CONTENT_MIN_HEIGHT,
    input.contentHeight ?? TIMER_CARD_CONTENT_MIN_HEIGHT
  );
  const cardHeight = contentHeight + TIMER_CARD_VERTICAL_INSET * 2;
  const actionCenterX =
    input.cardWidth - TIMER_CARD_HORIZONTAL_INSET - TIMER_CARD_ACTION_COLUMN_WIDTH / 2;

  return {
    cardHeight,
    primaryCenter: {
      x: actionCenterX,
      y: TIMER_CARD_VERTICAL_INSET + TIMER_CARD_ACTION_SIZE / 2
    },
    secondaryCenter: {
      x: actionCenterX,
      y: cardHeight - TIMER_CARD_VERTICAL_INSET - TIMER_CARD_ACTION_SIZE / 2
    },
    secondaryBottomInset: TIMER_CARD_VERTICAL_INSET
  };
}
