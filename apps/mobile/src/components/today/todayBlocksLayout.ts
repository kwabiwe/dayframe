// Today timer card geometry for Dayframe Blocks, from the prototype (design/blocks/ios.html .live,
// .idle): each card takes its natural height, and the mosaic below moves under the layout
// transition when Start or Stop swaps them.
export const TODAY_CARD = {
  padding: 18,
  liveBottomPadding: 16,
  idlePadding: 20,
  radius: 26,
  primaryActionSize: 56,
  secondaryActionSize: 44,
  actionGap: 10,
} as const;

/** Width the live block's footer leaves free for Add past time and Stop. */
export const TODAY_CARD_ACTIONS_WIDTH =
  TODAY_CARD.primaryActionSize + TODAY_CARD.actionGap + TODAY_CARD.secondaryActionSize;

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

/** The live block's clock, always H:MM:SS like the prototype ("0:04:09", "12:00:00"). */
export function formatLiveClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}
