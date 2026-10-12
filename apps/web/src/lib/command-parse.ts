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
/** Any `@word` command token, a bare `@` included. */
const MENTION_TOKEN = /(^|\s)(@[\p{L}\p{N}_-]*)/gu;

function squash(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, "");
}

/**
 * The one resolver for a typed `@word`, shared by the parser and the `@` Activities list: the
 * list shows `activitiesForMention`, and the parser takes its first row, so what Enter starts is
 * always what the list highlighted first.
 */
function activityForMention<T extends CommandActivity>(word: string, activities: readonly T[]) {
  return word ? activitiesForMention(word, activities)[0] ?? null : null;
}

/** How many times each `@word` occurs in `text` (the literal ones a parse leaves alone). */
function mentionCounts(text: string) {
  const counts = new Map<string, number>();
  for (const [, , token] of text.matchAll(MENTION_TOKEN)) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

/**
 * The `@activity` shorthand: the last activity named wins and every matched mention leaves the
 * text. `@words` that `literal` already holds (text kept when an activity was picked from the
 * list) stay as text and never pick an activity.
 */
function takeMentions(text: string, activities: readonly CommandActivity[], literal = "") {
  const kept = mentionCounts(literal);
  let categoryId: string | null = null;
  const rest = text.replace(MENTION, (match, space: string, word: string) => {
    const left = kept.get(`@${word}`) ?? 0;
    if (left > 0) {
      kept.set(`@${word}`, left - 1);
      return match;
    }
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
 * The activities an `@query` offers, best first: the exact name, then names that start with it,
 * then names that contain it (case and spaces ignored). The parser resolves `@query` to the
 * first of these. An empty query offers every activity.
 */
export function activitiesForMention<T extends CommandActivity>(query: string, activities: readonly T[]): T[] {
  const wanted = squash(query);
  if (!wanted) return [...activities];
  const exact = activities.filter((activity) => squash(activity.name) === wanted);
  const starts = activities.filter((activity) => !exact.includes(activity) && squash(activity.name).startsWith(wanted));
  const contains = activities.filter((activity) => !exact.includes(activity) && !starts.includes(activity) && squash(activity.name).includes(wanted));
  return [...exact, ...starts, ...contains];
}


/**
 * A running block's description without the `@…` commands typed into it: every `@word` (or bare
 * `@`) at the start or after a space is removed, except those the saved description already had
 * (a block named "Call @mum" elsewhere keeps it). Unchanged text comes back as it was.
 */
/** Whether `text` still holds every `@word` of `literal` (else the literal set no longer applies). */
export function keepsMentions(text: string, literal: string) {
  const present = mentionCounts(text);
  return [...mentionCounts(literal)].every(([token, count]) => (present.get(token) ?? 0) >= count);
}

export function withoutPendingMentions(text: string, saved = "") {
  return takePendingMentions(text, saved, []).description;
}

/**
 * Enter on a running block's description: the last newly typed `@word` that names an activity
 * switches to it, and the new `@…` leave the text. `@words` the saved description already had are
 * literal text: they never switch and are never removed.
 */
export function pendingMentionActivity(text: string, saved: string, activities: readonly CommandActivity[]) {
  return takePendingMentions(text, saved, activities);
}

function takePendingMentions(text: string, saved: string, activities: readonly CommandActivity[]) {
  const kept = mentionCounts(saved);
  let removed = false;
  let categoryId: string | null = null;
  const next = text.replace(MENTION_TOKEN, (match, space: string, token: string) => {
    const left = kept.get(token) ?? 0;
    if (left > 0) {
      kept.set(token, left - 1);
      return match;
    }
    removed = true;
    categoryId = activityForMention(token.slice(1), activities)?.id ?? categoryId;
    return space;
  });
  return {
    categoryId: categoryId as string | null,
    description: removed ? next.replace(/\s+/g, " ").trim() : text
  };
}

export function parseCommand(text: string, activities: readonly CommandActivity[], literal = ""): ParsedCommand {
  const mentions = takeMentions(text, activities, literal);
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
