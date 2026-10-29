import { StyleSheet, type ViewStyle } from "react-native";

/**
 * The one way the iPhone draws a divider line (owner rule, 28 Oct 2026; the web half is #614).
 *
 * A divider never touches its container's edges: it is inset on both sides, by the row's horizontal
 * padding, and on the leading side further, past the lead block or icon, where the row has one
 * (Today's and Calendar › List rows: 60 points, the text column). Insets are logical (start / end),
 * so a right-to-left layout keeps the gap at the row's own leading edge.
 *
 * - Between rows (`edge` omitted): a hairline in the flow, with `marginStart` / `marginEnd`.
 * - On a row's own edge (`edge: "top" | "bottom"`): an absolute hairline inside the row, placed with
 *   `start` / `end`, so the row's layout is unchanged from the full-width border it replaces. It is the
 *   row's last child, so it draws above any opaque surface in the row (Today's swipe surface).
 *   Absolute insets count from the row's own edge, not inside its padding.
 * - `paddedBy`: an ancestor container already pads the list (a card's or sheet's content padding), so
 *   the line may run to the content edge. Name that container's style as `path:styleKey` (relative to
 *   apps/mobile); the contract test checks it has horizontal padding. Only then may an inset be 0.
 *
 * Draw it with `<InsetDivider>` (src/components/InsetDivider.tsx), or with `insetDividerStyle` in a
 * themed StyleSheet. `src/components/dividers.contract.test.ts` fails on a hairline drawn any other way.
 */
export const DIVIDER_INSET = 16;

/** Today's and Calendar › List rows: 14 of padding, the 34-point block, 12 of gap. */
export const DIVIDER_INSET_PAST_BLOCK = 60;

/** Library rows (Places, Activities): 16 of padding, the 36-point tile, 12 of gap. */
export const DIVIDER_INSET_PAST_TILE = 64;

export type InsetDividerGeometry = {
  /** The line's colour token, normally `theme.border`. */
  color: string;
  /** Overlay the row's own top or bottom edge instead of sitting between rows. */
  edge?: "top" | "bottom";
  /** Trailing inset in points (default 16, or 0 with `paddedBy`). */
  end?: number;
  /** `path:styleKey` of the ancestor container style whose horizontal padding insets the line. */
  paddedBy?: string;
  /** Leading inset in points (default 16, or 0 with `paddedBy`). */
  start?: number;
};

export function insetDividerStyle({ color, edge, end, paddedBy, start }: InsetDividerGeometry): ViewStyle {
  const fallback = paddedBy ? 0 : DIVIDER_INSET;
  const leading = start ?? fallback;
  const trailing = end ?? fallback;
  const line = { backgroundColor: color, height: StyleSheet.hairlineWidth };
  if (edge) return { ...line, end: trailing, position: "absolute", start: leading, [edge]: 0 };
  return { ...line, marginEnd: trailing, marginStart: leading };
}
