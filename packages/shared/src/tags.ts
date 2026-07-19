import { z } from "zod";

export const TAG_DISPLAY_NAME_MAX_LENGTH = 48;
export const TAG_TOKEN_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export type NormalizedTagName = {
  name: string;
  normalizedName: string;
};

export type ParsedHashtagToken = {
  end: number;
  normalizedName: string;
  start: number;
  token: string;
};

export type ActiveHashtagQuery = {
  end: number;
  query: string;
  start: number;
};

export const TagNameSchema = z.string().superRefine((value, context) => {
  try {
    normalizeTagName(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid tag name"
    });
  }
});

export const TagRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  normalizedName: z.string(),
  usageCount: z.number().int().nonnegative().optional()
});

export const TagMutationSchema = z.object({
  name: TagNameSchema
});

export const TimeEntryTagsPatchSchema = z.object({
  tagNames: z.array(TagNameSchema).max(24)
});

/**
 * Tag names are ASCII for v1. Display labels may contain spaces, while their
 * inline representation is a stable lowercase slug using letters, numbers,
 * hyphens, and underscores. Whitespace becomes a hyphen. Identity is the slug.
 */
export function normalizeTagName(value: string): NormalizedTagName {
  const withoutHash = value.trim().replace(/^#/, "");
  const name = withoutHash.replace(/\s+/g, " ");

  if (!name) throw new Error("Enter a tag name");
  if (name.length > TAG_DISPLAY_NAME_MAX_LENGTH) {
    throw new Error(`Tag names must be ${TAG_DISPLAY_NAME_MAX_LENGTH} characters or fewer`);
  }
  if (!/^[A-Za-z0-9]+(?:[ _-]+[A-Za-z0-9]+)*$/.test(name)) {
    throw new Error("Use letters, numbers, spaces, hyphens, or underscores");
  }

  const normalizedName = name
    .toLowerCase()
    .replace(/[ -]+/g, "-")
    .replace(/_+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "");

  if (!TAG_TOKEN_PATTERN.test(normalizedName) || normalizedName.length > TAG_DISPLAY_NAME_MAX_LENGTH) {
    throw new Error("Tag name cannot be represented as a hashtag");
  }

  return { name, normalizedName };
}

export function isValidHashtagBoundary(text: string, hashIndex: number) {
  if (hashIndex === 0) return true;
  const previous = text[hashIndex - 1] ?? "";
  if (/\s/.test(previous)) return true;
  // Punctuation can begin a token, but URL/email delimiters cannot.
  return !/[A-Za-z0-9_@/.:?=&%#+-]/.test(previous);
}

export function findActiveHashtag(text: string, caret: number): ActiveHashtagQuery | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const beforeCaret = text.slice(0, safeCaret);
  const match = /#([A-Za-z0-9_-]*)$/.exec(beforeCaret);
  if (!match || match.index < 0 || !isValidHashtagBoundary(text, match.index)) return null;

  let end = safeCaret;
  while (end < text.length && /[A-Za-z0-9_-]/.test(text[end] ?? "")) end += 1;

  return {
    end,
    query: match[1] ?? "",
    start: match.index
  };
}

export function parseHashtagTokens(text: string): ParsedHashtagToken[] {
  const tokens: ParsedHashtagToken[] = [];
  const seen = new Set<string>();
  const matcher = /#([A-Za-z0-9_-]*)/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    const start = match.index;
    const token = match[1] ?? "";
    if (!token || !isValidHashtagBoundary(text, start)) continue;

    const normalizedName = token.toLowerCase();
    if (!TAG_TOKEN_PATTERN.test(normalizedName) || seen.has(normalizedName)) continue;

    seen.add(normalizedName);
    tokens.push({
      end: start + token.length + 1,
      normalizedName,
      start,
      token
    });
  }

  return tokens;
}

export function replaceActiveHashtag(
  text: string,
  active: ActiveHashtagQuery,
  tagName: string
) {
  const { normalizedName } = normalizeTagName(tagName);
  const prefix = text.slice(0, active.start);
  const suffix = text.slice(active.end);
  const appendSpace = suffix.length === 0;
  const inserted = `#${normalizedName}${appendSpace ? " " : ""}`;

  return {
    caret: prefix.length + inserted.length,
    text: `${prefix}${inserted}${suffix}`
  };
}

/** Removes a temporary hashtag command while preserving readable surrounding text. */
export function consumeActiveHashtag(text: string, active: ActiveHashtagQuery) {
  const prefix = text.slice(0, active.start);
  const suffix = text.slice(active.end);

  if (!prefix) {
    const next = suffix.replace(/^\s+/, "");
    return { caret: 0, text: next };
  }
  if (!suffix) {
    const next = prefix.replace(/\s+$/, "");
    return { caret: next.length, text: next };
  }
  if (/\s$/.test(prefix) && /^\s/.test(suffix)) {
    const nextSuffix = suffix.replace(/^\s+/, "");
    return { caret: prefix.length, text: `${prefix}${nextSuffix}` };
  }

  return { caret: prefix.length, text: `${prefix}${suffix}` };
}

/** Inserts the mobile tag-entry shortcut at the caret without disturbing existing copy. */
export function insertHashtagStarter(
  text: string,
  selection: { start: number; end: number }
) {
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));
  const prefix = text.slice(0, start);
  const suffix = text.slice(end);
  const spacer = prefix && !isValidHashtagBoundary(`${prefix}#`, prefix.length) ? " " : "";
  const inserted = `${spacer}#`;
  return {
    caret: prefix.length + inserted.length,
    text: `${prefix}${inserted}${suffix}`
  };
}

export function tagNamesFromDescription(
  description: string,
  availableTags: Array<{ name: string; normalizedName: string }>
) {
  const byNormalizedName = new Map(
    availableTags.map((tag) => [tag.normalizedName.toLowerCase(), tag.name])
  );

  return parseHashtagTokens(description)
    .map((token) => byNormalizedName.get(token.normalizedName) ?? token.token)
    .filter((name, index, names) => {
      const normalizedName = normalizeTagName(name).normalizedName;
      return names.findIndex((candidate) => normalizeTagName(candidate).normalizedName === normalizedName) === index;
    });
}
