import { DAYFRAME_BLOCKS } from "@dayframe/shared";

// Today timer card geometry for Dayframe Blocks. The idle card and the live block share one minimum
// height and one action track, so Start becomes Stop in place and the screen below never jumps.
export const TODAY_CARD = {
  minHeight: 184,
  padding: 18,
  radius: DAYFRAME_BLOCKS.radius.card,
  primaryActionSize: 56,
  secondaryActionSize: 44,
  actionGap: 10,
} as const;

/** Width the bottom row of text leaves free for the two actions. */
export const TODAY_CARD_ACTIONS_WIDTH =
  TODAY_CARD.primaryActionSize + TODAY_CARD.actionGap + TODAY_CARD.secondaryActionSize;

/** Card-relative centres of the two actions; both cards must use these. */
export function todayCardActionCentres(cardWidth: number, cardHeight: number = TODAY_CARD.minHeight) {
  const bottom = cardHeight - TODAY_CARD.padding;
  const primaryX = cardWidth - TODAY_CARD.padding - TODAY_CARD.primaryActionSize / 2;
  return {
    primary: { x: primaryX, y: bottom - TODAY_CARD.primaryActionSize / 2 },
    secondary: {
      x: primaryX - TODAY_CARD.primaryActionSize / 2 - TODAY_CARD.actionGap - TODAY_CARD.secondaryActionSize / 2,
      y: bottom - TODAY_CARD.primaryActionSize / 2,
    },
  };
}

export function colorWithAlpha(hex: string, alpha: number) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** "1 hour 5 minutes", for VoiceOver; the visible clock stays tabular. */
export function spokenDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return "less than a minute";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  return parts.join(" ");
}

/** "4h 12m", "35m" or "0m" for a tile's week total. */
export function compactDuration(totalSeconds: number) {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${minutes}m`;
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
