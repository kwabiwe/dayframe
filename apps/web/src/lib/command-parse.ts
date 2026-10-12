// The command timer's typed shorthand (prototype `parseCommand`): `@activity` picks an
// activity by the start of its name, and a trailing duration such as `45m`, `1h` or `1.5h`
// logs a finished block ending now instead of starting the timer. `#tags` are owned by the
// description's inline tag input, so they are not parsed here.

export type CommandActivity = { id: string; name: string };

export type ParsedCommand = {
  description: string;
  categoryId: string | null;
  durationSeconds: number | null;
};

/** The longest block a typed duration can log: one day. */
export const MAX_COMMAND_DURATION_SECONDS = 24 * 60 * 60;

const DURATION = /(^|\s)(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\s*$/i;
const MENTION = /(^|\s)@([\p{L}\p{N}_-]+)/gu;

function squash(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, "");
}

/** The activity a typed `@word` names: an exact name first, then the first name it starts. */
function activityForMention<T extends CommandActivity>(word: string, activities: readonly T[]) {
  const wanted = squash(word);
  return activities.find((candidate) => squash(candidate.name) === wanted)
    ?? activities.find((candidate) => squash(candidate.name).startsWith(wanted))
    ?? null;
}

/**
 * Only the `@activity` part of the shorthand: the last activity named wins and every matched
 * mention leaves the text. Used while a block is running, where a trailing duration means nothing.
 */
export function parseActivityMention(text: string, activities: readonly CommandActivity[]) {
  const { categoryId, rest } = takeMentions(text, activities);
  return { categoryId, description: rest.replace(/\s+/g, " ").trim() };
}

function takeMentions(text: string, activities: readonly CommandActivity[]) {
  let categoryId: string | null = null;
  const rest = text.replace(MENTION, (match, space: string, word: string) => {
    const activity = activityForMention(word, activities);
    if (!activity) return match;
    categoryId = activity.id;
    return space;
  });
  return { categoryId: categoryId as string | null, rest };
}

export type ActiveMention = { start: number; end: number; query: string };

const MENTION_CHAR = /[\p{L}\p{N}_-]/u;

/**
 * The `@word` the caret is in or just after (as `findActiveHashtag` does for `#tags`): it opens
 * the Activities list. An `@` only starts a mention at the start of the text or after a space, so
 * an email address never does.
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
 * The activities an `@query` offers, best first: names that start with it, then names that
 * contain it (spaces ignored, as the parser does). An empty query offers every activity.
 */
export function activitiesForMention<T extends CommandActivity>(query: string, activities: readonly T[]): T[] {
  const wanted = squash(query);
  if (!wanted) return [...activities];
  const starts = activities.filter((activity) => squash(activity.name).startsWith(wanted));
  const contains = activities.filter((activity) => !starts.includes(activity) && squash(activity.name).includes(wanted));
  return [...starts, ...contains];
}

export function parseCommand(text: string, activities: readonly CommandActivity[]): ParsedCommand {
  const mentions = takeMentions(text, activities);
  const categoryId = mentions.categoryId;
  let rest = mentions.rest;

  let durationSeconds: number | null = null;
  rest = rest.replace(DURATION, (match, space: string, amount: string, unit: string) => {
    const seconds = Math.round(Number(amount) * (unit[0].toLowerCase() === "h" ? 3600 : 60));
    if (!Number.isFinite(seconds) || seconds < 60 || seconds > MAX_COMMAND_DURATION_SECONDS) return match;
    durationSeconds = seconds;
    return space;
  });

  return { description: rest.replace(/\s+/g, " ").trim(), categoryId, durationSeconds };
}
