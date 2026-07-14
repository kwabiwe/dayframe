import { buildRecentActivitySuggestions } from "@dayframe/shared";
import type { MobileBootstrap } from "./api";

type ActiveTimerEntry = MobileBootstrap["activeEntry"];

export type MobileQuickAction = {
  color: string | null;
  description?: string | null;
  id: string | null;
  isUncategorized: boolean;
  key: string;
  name: string;
  subtitle?: string | null;
};

export function displayTimerDescription(entry: Pick<NonNullable<ActiveTimerEntry>, "description"> | null | undefined) {
  if (!entry?.description) return null;
  return entry.description === "Start activity" ? null : entry.description;
}

export function activeTimerPresentation(entry: ActiveTimerEntry) {
  if (!entry) {
    return {
      categoryLabel: null,
      title: "Start task below"
    };
  }

  const description = displayTimerDescription(entry);
  return {
    categoryLabel: entry.categoryName ?? "Uncategorized",
    title: description ?? "Add a task description"
  };
}

export function buildMobileQuickActions(
  data: (Pick<MobileBootstrap, "categories"> & Partial<Pick<MobileBootstrap, "entries">>) | null
): MobileQuickAction[] {
  if (!data) return [];

  const categoriesById = new Map(data.categories.map((category) => [category.id, category]));
  const recent = buildRecentActivitySuggestions(data.entries ?? [], { limit: 4 })
    .map((suggestion) => {
      const category = suggestion.categoryId ? categoriesById.get(suggestion.categoryId) : null;
      return {
        color: suggestion.categoryColor ?? category?.color ?? null,
        description: suggestion.description,
        id: suggestion.categoryId,
        isUncategorized: !suggestion.categoryId,
        key: `recent:${suggestion.key}`,
        name: suggestion.description,
        subtitle: suggestion.categoryName ?? category?.name ?? "Uncategorized"
      };
    });

  const pinned = data.categories
    .filter((category) => category.isPinned)
    .map((category) => ({
      color: category.color ?? null,
      id: category.id,
      isUncategorized: false,
      key: `category:${category.id}`,
      name: category.name,
      subtitle: null
    }));

  return [...recent, ...pinned].slice(0, 8);
}
