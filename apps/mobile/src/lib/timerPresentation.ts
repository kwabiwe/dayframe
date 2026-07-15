import type { RecentActivitySuggestion } from "@dayframe/shared";
import type { MobileBootstrap, TimeEntryUpdatePatch } from "./api";

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

type ActiveTimerElapsedEntry = Pick<
  NonNullable<ActiveTimerEntry>,
  "durationSeconds" | "startedAt"
>;

type RunningTimerSuggestionUpdater = (
  entryId: string,
  patch: TimeEntryUpdatePatch
) => Promise<unknown>;

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

export function activeTimerElapsedSeconds(
  entry: ActiveTimerElapsedEntry | null | undefined,
  nowMs: number
) {
  if (!entry) return 0;
  const startedAtMs = Date.parse(entry.startedAt);
  if (!Number.isFinite(startedAtMs)) return Math.max(0, entry.durationSeconds);
  return Math.max(
    0,
    entry.durationSeconds,
    Math.floor((nowMs - startedAtMs) / 1000)
  );
}

export function runningTimerSheetElapsedSeconds(input: {
  activeElapsedSeconds: number;
  nowMs: number;
  previewStartAt: Date | null;
  startTimeEdited: boolean;
}) {
  if (!input.startTimeEdited || !input.previewStartAt) {
    return input.activeElapsedSeconds;
  }
  const previewStartMs = input.previewStartAt.getTime();
  if (!Number.isFinite(previewStartMs) || previewStartMs > input.nowMs) {
    return input.activeElapsedSeconds;
  }
  return Math.max(0, Math.floor((input.nowMs - previewStartMs) / 1000));
}

export async function applySuggestionToRunningTimer(input: {
  entryId: string;
  suggestion: Pick<RecentActivitySuggestion, "categoryId" | "description">;
  updateEntry: RunningTimerSuggestionUpdater;
}) {
  const patch: TimeEntryUpdatePatch = {
    categoryId: input.suggestion.categoryId,
    description: input.suggestion.description
  };
  await input.updateEntry(input.entryId, patch);
  return patch;
}

export function buildMobileQuickActions(
  data: Pick<MobileBootstrap, "categories" | "categoryUsage"> | null
): MobileQuickAction[] {
  if (!data) return [];

  return sortMobileCategoriesByUsage(data.categories, data.categoryUsage)
    .filter(({ category }) => category.isPinned)
    .map(({ category }) => ({
      color: category.color ?? null,
      id: category.id,
      isUncategorized: false,
      key: `category:${category.id}`,
      name: category.name,
      subtitle: null
    }));
}

export function sortMobileCategoriesByUsage(
  categories: MobileBootstrap["categories"],
  categoryUsage: MobileBootstrap["categoryUsage"] = []
) {
  const usageByCategory = new Map((categoryUsage ?? []).map((rank) => [rank.categoryId, rank]));

  return categories
    .map((category, index) => ({ category, index, usage: usageByCategory.get(category.id) }))
    .sort((a, b) =>
      (b.usage?.score ?? 0) - (a.usage?.score ?? 0) ||
      (b.usage?.useCount ?? 0) - (a.usage?.useCount ?? 0) ||
      Date.parse(b.usage?.lastSeenAt ?? "1970-01-01T00:00:00.000Z") -
        Date.parse(a.usage?.lastSeenAt ?? "1970-01-01T00:00:00.000Z") ||
      a.index - b.index ||
      a.category.name.localeCompare(b.category.name)
    );
}
