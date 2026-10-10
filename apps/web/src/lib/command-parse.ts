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

export function parseCommand(text: string, activities: readonly CommandActivity[]): ParsedCommand {
  let categoryId: string | null = null;
  let rest = text.replace(MENTION, (match, space: string, word: string) => {
    const wanted = squash(word);
    const activity = activities.find((candidate) => squash(candidate.name) === wanted)
      ?? activities.find((candidate) => squash(candidate.name).startsWith(wanted));
    if (!activity) return match;
    categoryId = activity.id;
    return space;
  });

  let durationSeconds: number | null = null;
  rest = rest.replace(DURATION, (match, space: string, amount: string, unit: string) => {
    const seconds = Math.round(Number(amount) * (unit[0].toLowerCase() === "h" ? 3600 : 60));
    if (!Number.isFinite(seconds) || seconds < 60 || seconds > MAX_COMMAND_DURATION_SECONDS) return match;
    durationSeconds = seconds;
    return space;
  });

  return { description: rest.replace(/\s+/g, " ").trim(), categoryId, durationSeconds };
}
