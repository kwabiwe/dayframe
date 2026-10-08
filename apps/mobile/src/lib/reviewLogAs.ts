// Blocks parity step 5c-1: the Review card's live "Log as" name and activity. Logging sends
// edit_and_confirm only when the user really changed something; otherwise the plain confirm/accept
// keeps the item's own source and confidence (an edit is stored as a manual entry).

export type ReviewLogAsEdit = {
  categoryId: string | null;
  description?: string;
  startedAt: string;
  stoppedAt: string;
};

export function reviewLogAsEdit(input: {
  /** What the user typed, or undefined when the field was never edited. */
  draftName: string | undefined;
  /** The activity picked on the card, or undefined when the chip was never changed. */
  draftCategoryId: string | undefined;
  /** The name the card shows by default (the suggestion's title). */
  defaultName: string;
  suggestedCategoryId: string | null;
  /** Location V2 items keep the server's own naming when the name is unchanged. */
  isLocationV2: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
}): ReviewLogAsEdit | null {
  const typed = input.draftName?.trim();
  const nameChanged = typed !== undefined && typed !== "" && typed !== input.defaultName.trim();
  const categoryChanged = input.draftCategoryId !== undefined && input.draftCategoryId !== input.suggestedCategoryId;
  if (!nameChanged && !categoryChanged) return null;
  if (!input.startedAt || !input.stoppedAt) return null;
  if (Number.isNaN(Date.parse(input.startedAt)) || Number.isNaN(Date.parse(input.stoppedAt))) return null;
  if (Date.parse(input.stoppedAt) <= Date.parse(input.startedAt)) return null;
  // A generic entry is stored with exactly this description, so an activity-only change keeps the
  // name the card shows; a Location visit derives its own name when none is sent.
  const description = nameChanged ? typed : input.isLocationV2 ? undefined : input.defaultName.trim() || undefined;
  return {
    categoryId: input.draftCategoryId ?? input.suggestedCategoryId ?? null,
    ...(description ? { description } : {}),
    startedAt: input.startedAt,
    stoppedAt: input.stoppedAt
  };
}
