export const TAG_DISPLAY_MAX_VISIBLE = 3;
export const TAG_DISPLAY_CHARACTER_BUDGET = 40;
export const TAG_SELECTION_MAX_COUNT = 24;

type TagDisplayOptions = {
  availableWidth?: number;
  characterBudget?: number;
  maxVisible?: number;
  overflowWidth?: number;
  tagWidths?: number[];
};

export type TagDisplaySelection = {
  hiddenCount: number;
  visible: string[];
};

/**
 * Selects a stable prefix for compact UI. Count and character limits work in
 * SSR/tests; measured widths further reduce the prefix in constrained fields.
 */
export function selectVisibleTags(
  tagNames: string[],
  options: TagDisplayOptions = {}
): TagDisplaySelection {
  const maxVisible = options.maxVisible ?? TAG_DISPLAY_MAX_VISIBLE;
  const characterBudget = options.characterBudget ?? TAG_DISPLAY_CHARACTER_BUDGET;
  const visible: string[] = [];
  let usedCharacters = 0;

  for (const name of tagNames) {
    const nextCharacters = usedCharacters + 1 + name.length + (visible.length ? 1 : 0);
    if (visible.length >= maxVisible || nextCharacters > characterBudget) break;
    visible.push(name);
    usedCharacters = nextCharacters;
  }

  if (
    options.availableWidth !== undefined &&
    options.tagWidths?.length
  ) {
    const overflowWidth = options.overflowWidth ?? 34;
    while (visible.length) {
      const width = options.tagWidths
        .slice(0, visible.length)
        .reduce((sum, item) => sum + item, 0);
      const reserve = visible.length < tagNames.length ? overflowWidth : 0;
      if (width + reserve <= options.availableWidth) break;
      visible.pop();
    }
  }

  return { visible, hiddenCount: Math.max(0, tagNames.length - visible.length) };
}
