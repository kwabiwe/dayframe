import { normalizeTagName, TagNameSchema } from "@dayframe/shared";
import { z } from "zod";

/**
 * Optimistic concurrency for a block's details (web timer autosave, 13 Oct 2026). A PATCH may
 * carry `expectedDetails`: for each detail field it changes, the value its edit was based on. If
 * the stored value of any of those fields is different now (another window or device changed it
 * since), the PATCH is refused with 409 and the current block, instead of overwriting the newer
 * change. Optional: a PATCH without it (mobile, older web clients) behaves as before.
 */
export const ExpectedDetailsSchema = z.object({
  categoryId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  tagNames: z.array(TagNameSchema).max(24).optional()
}).strict();

export type ExpectedDetails = z.infer<typeof ExpectedDetailsSchema>;

export type StoredDetails = {
  categoryId: string | null;
  description: string | null;
  /** Normalized names of the block's tags. */
  tagNormalizedNames: string[];
};

/** Whether any field named in `expected` now holds a different value (as the server stores it). */
export function detailsChangedSince(stored: StoredDetails, expected: ExpectedDetails) {
  if (expected.categoryId !== undefined && (expected.categoryId || null) !== (stored.categoryId ?? null)) {
    return true;
  }
  if (expected.description !== undefined && (expected.description?.trim() || null) !== (stored.description?.trim() || null)) {
    return true;
  }
  if (expected.tagNames !== undefined) {
    const expectedTags = uniqueSorted(expected.tagNames.map((name) => normalizeTagName(name).normalizedName));
    const storedTags = uniqueSorted(stored.tagNormalizedNames);
    if (expectedTags.length !== storedTags.length || expectedTags.some((name, index) => name !== storedTags[index])) {
      return true;
    }
  }
  return false;
}

function uniqueSorted(names: string[]) {
  return [...new Set(names)].sort();
}
