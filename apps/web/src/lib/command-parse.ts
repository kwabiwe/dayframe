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
const MENTION_CHAR = /[\p{L}\p{N}_-]/u;

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

/** Every `@word` token in `text`, in order (a bare `@` included). */
export function mentionTokens(text: string): string[] {
  return mentionMarks(text).map((mark) => mark.token);
}

/**
 * A protected (literal) `@word`: one occurrence, by where it starts in the text it belongs to.
 * Protection belongs to that occurrence, never to its spelling: typing the same `@word` again
 * anywhere (before it included) is a new command, and the original stays literal.
 */
export type MentionMark = { start: number; token: string };

/** Every `@word` token in `text` with where it starts, in order. */
export function mentionMarks(text: string): MentionMark[] {
  return [...text.matchAll(MENTION_TOKEN)].map((match) => ({ start: match.index + match[1].length, token: match[2] }));
}

function isMarked(marks: readonly MentionMark[], start: number, token: string) {
  return marks.some((mark) => mark.start === start && mark.token === token);
}

/**
 * The one contiguous edit that turned `previous` into `next`: `[start, previousEnd)` of the old
 * text became `[start, nextEnd)` of the new one. `caret` (where the caret sits after the edit:
 * the end of what was typed, pasted or completed, or where a deletion happened) places an edit
 * the text alone leaves ambiguous, such as `@x ` typed before `@x @x`.
 */
function editSpan(previous: string, next: string, caret?: number) {
  let previousEnd = previous.length;
  let nextEnd = next.length;
  if (caret !== undefined && caret >= 0 && caret <= next.length) {
    const tail = next.length - caret;
    if (tail <= previous.length && previous.endsWith(next.slice(caret))) {
      previousEnd = previous.length - tail;
      nextEnd = caret;
    }
  }
  const limit = Math.min(previousEnd, nextEnd);
  let start = 0;
  while (start < limit && previous[start] === next[start]) start += 1;
  if (previousEnd === previous.length && nextEnd === next.length) {
    // No usable caret: the longest common suffix that does not overlap the common prefix.
    while (previousEnd > start && nextEnd > start && previous[previousEnd - 1] === next[nextEnd - 1]) {
      previousEnd -= 1;
      nextEnd -= 1;
    }
  }
  return { start, previousEnd, nextEnd };
}

/**
 * The protected occurrences after one edit of the text: those before the edit stay put, those
 * after it move with the text, and one the edit touched (deleted, changed or extended) is no
 * longer protected. The same array comes back when nothing changed.
 */
export function shiftMentionMarks(marks: readonly MentionMark[], previous: string, next: string, caret?: number): readonly MentionMark[] {
  if (!marks.length || previous === next) return marks;
  const { start, previousEnd, nextEnd } = editSpan(previous, next, caret);
  const delta = nextEnd - previousEnd;
  let changed = false;
  const kept: MentionMark[] = [];
  for (const mark of marks) {
    const end = mark.start + mark.token.length;
    const at = end <= start ? mark.start : mark.start >= previousEnd ? mark.start + delta : null;
    if (
      at === null
      || next.slice(at, at + mark.token.length) !== mark.token
      || MENTION_CHAR.test(next[at + mark.token.length] ?? "")
    ) {
      changed = true;
      continue;
    }
    if (at !== mark.start) changed = true;
    kept.push(at === mark.start ? mark : { start: at, token: mark.token });
  }
  return changed ? kept : marks;
}

/**
 * Which `@word` occurrences in the command timer's description are literal, for the text they
 * belong to. Idle, they are the `@words` left when an activity was picked from the list (set by
 * the owner). Recording (`scope` is the running block), they are the occurrences the saved
 * description already had: they follow every edit by position, so a new `@word` typed before or
 * after them, even with the same spelling, is a command and the saved one stays text.
 */
export type MentionGuard = { scope: string | null; saved: string; text: string; marks: readonly MentionMark[] };

export function mentionGuardFor(scope: string | null, saved: string, text: string): MentionGuard {
  return { scope, saved, text, marks: scope === null ? [] : shiftMentionMarks(mentionMarks(saved), saved, text) };
}

/**
 * The guard after the description, the running block or its saved description changed. An edit
 * with a known caret goes through `shiftMentionMarks` directly; this follows every other change.
 * The same guard comes back when nothing changed.
 */
export function syncMentionGuard(guard: MentionGuard, scope: string | null, saved: string, text: string): MentionGuard {
  if (guard.scope === scope && guard.saved === saved && guard.text === text) return guard;
  if (guard.scope !== scope) return mentionGuardFor(scope, saved, text);
  const marks = shiftMentionMarks(guard.marks, guard.text, text);
  if (guard.saved === saved) return { scope, saved, text, marks };
  // The running block's saved description changed. When the tracked occurrences are still exactly
  // its `@words` (this bar's own autosave landed), they stay; otherwise the new saved text decides.
  const savedTokens = mentionTokens(saved);
  const same = marks.length === savedTokens.length && marks.every((mark, index) => mark.token === savedTokens[index]);
  return same ? { scope, saved, text, marks } : mentionGuardFor(scope, saved, text);
}

/**
 * The `@activity` shorthand: the last activity named wins and every matched mention leaves the
 * text. Protected occurrences (`literal`: text kept when an activity was picked from the list)
 * stay as text and never pick an activity.
 */
function takeMentions(text: string, activities: readonly CommandActivity[], literal: readonly MentionMark[] = []) {
  let categoryId: string | null = null;
  const rest = text.replace(MENTION, (match, space: string, word: string, offset: number) => {
    if (isMarked(literal, offset + space.length, `@${word}`)) return match;
    const activity = activityForMention(word, activities);
    if (!activity) return match;
    categoryId = activity.id;
    return space;
  });
  return { categoryId: categoryId as string | null, rest };
}

export type ActiveMention = { start: number; end: number; query: string };

/**
 * The `@word` the caret is in or just after (as `findActiveHashtag` does for `#tags`): it opens
 * the Activities list. An `@` only starts a mention at the start of the text or after a space, so
 * an email address never does. A protected (literal) occurrence is never a mention: it opens
 * no list, and Enter, Tab and Escape leave it alone. Another `@word` spelled the same is.
 */
export function findActiveMention(text: string, caret: number, protectedMarks: readonly MentionMark[] = []): ActiveMention | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const match = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(text.slice(0, safeCaret));
  if (!match) return null;
  const start = match.index + match[1].length;
  let end = safeCaret;
  while (end < text.length && MENTION_CHAR.test(text[end] ?? "")) end += 1;
  if (isMarked(protectedMarks, start, text.slice(start, end))) return null;
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
 * `@`) at the start or after a space is removed, except the protected occurrences `saved` marks
 * (the ones the saved description already had: a block named "Call @mum" keeps it). Unchanged
 * text comes back as it was.
 */
export function withoutPendingMentions(text: string, saved: readonly MentionMark[] = []) {
  return takePendingMentions(text, saved, []).description;
}

/**
 * Enter on a running block's description: the last newly typed `@word` that names an activity
 * switches to it, and the new `@…` leave the text. The protected occurrences `saved` marks are
 * literal text: they never switch and are never removed. `marks` are the protected occurrences
 * in the returned description.
 */
export function pendingMentionActivity(text: string, saved: readonly MentionMark[], activities: readonly CommandActivity[]) {
  return takePendingMentions(text, saved, activities);
}

function takePendingMentions(text: string, saved: readonly MentionMark[], activities: readonly CommandActivity[]) {
  let removed = false;
  let categoryId: string | null = null;
  const next = text.replace(MENTION_TOKEN, (match, space: string, token: string, offset: number) => {
    if (isMarked(saved, offset + space.length, token)) return match;
    removed = true;
    categoryId = activityForMention(token.slice(1), activities)?.id ?? categoryId;
    return space;
  });
  const description = removed ? next.replace(/\s+/g, " ").trim() : text;
  // Every `@word` left is one that was protected, so all of them still are.
  return {
    categoryId: categoryId as string | null,
    description,
    marks: removed ? mentionMarks(description) : saved
  };
}

export function parseCommand(text: string, activities: readonly CommandActivity[], literal: readonly MentionMark[] = []): ParsedCommand {
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
