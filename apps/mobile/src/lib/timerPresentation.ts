import type { MobileBootstrap } from "./api";

type ActiveTimerEntry = MobileBootstrap["activeEntry"];

export type MobileQuickAction = {
  color: string | null;
  id: string | null;
  isUncategorized: boolean;
  name: string;
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

export function buildMobileQuickActions(data: Pick<MobileBootstrap, "categories"> | null): MobileQuickAction[] {
  const pinned = data
    ? data.categories
        .filter((category) => category.isPinned)
        .slice(0, 8)
        .map((category) => ({
          color: category.color ?? null,
          id: category.id,
          isUncategorized: false,
          name: category.name
        }))
    : [];

  return [
    {
      color: null,
      id: null,
      isUncategorized: true,
      name: "Uncategorized"
    },
    ...pinned
  ];
}
