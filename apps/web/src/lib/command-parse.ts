// The command timer's typed shorthand (prototype `parseCommand`): a trailing duration such as
// `45m`, `1h` or `1.5h` logs a finished block ending now instead of starting the timer.
//
// `@activity` is not parsed out of the text. Typing `@` opens the description's Activities list
// (`findActiveMention`, `activitiesForMention`), and only an explicit choice from that list
// removes the `@query` it was opened for and sets the activity. Any other `@word` is ordinary
// description text and is saved as written. `#tags` work the same way through the inline tag
// input, so they are not parsed here either.

export type CommandActivity = { id: string; name: string };

export type ParsedCommand = {
  description: string;
  durationSeconds: number | null;
};

/** The longest block a typed duration can log: one day. */
export const MAX_COMMAND_DURATION_SECONDS = 24 * 60 * 60;

const DURATION = /(^|\s)(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\s*$/i;
const MENTION_CHAR = /[\p{L}\p{N}_-]/u;

function squash(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, "");
}

export type ActiveMention = { start: number; end: number; query: string };

/**
 * The `@word` the caret is in or just after (as `findActiveHashtag` does for `#tags`). An `@`
 * only starts a mention at the start of the text or after a space, so an email address never
 * does. The description field opens the Activities list for it only while it is being typed.
 */
export function findActiveMention(text: string, caret: number): ActiveMention | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const match = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(text.slice(0, safeCaret));
  if (!match) return null;
  const start = match.index + match[1].length;
  let end = safeCaret;
  while (end < text.length && MENTION_CHAR.test(text[end] ?? "")) end += 1;
  return { start, end, query: text.slice(start + 1, end) };
}

/**
 * The activities an `@query` offers, best first: the exact name, then names that start with it,
 * then names that contain it (case and spaces ignored). An empty query offers every activity.
 */
export function activitiesForMention<T extends CommandActivity>(query: string, activities: readonly T[]): T[] {
  const wanted = squash(query);
  if (!wanted) return [...activities];
  const exact = activities.filter((activity) => squash(activity.name) === wanted);
  const starts = activities.filter((activity) => !exact.includes(activity) && squash(activity.name).startsWith(wanted));
  const contains = activities.filter((activity) => !exact.includes(activity) && !starts.includes(activity) && squash(activity.name).includes(wanted));
  return [...exact, ...starts, ...contains];
}

/** Idle Start: a trailing duration logs a finished block; everything else is the description. */
export function parseCommand(text: string): ParsedCommand {
  let durationSeconds: number | null = null;
  const rest = text.replace(DURATION, (match, space: string, amount: string, unit: string) => {
    const seconds = Math.round(Number(amount) * (unit[0].toLowerCase() === "h" ? 3600 : 60));
    if (!Number.isFinite(seconds) || seconds < 60 || seconds > MAX_COMMAND_DURATION_SECONDS) return match;
    durationSeconds = seconds;
    return space;
  });

  return { description: rest.replace(/\s+/g, " ").trim(), durationSeconds };
}
