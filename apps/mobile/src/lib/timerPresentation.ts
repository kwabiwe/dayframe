import type { RecentActivitySuggestion } from "@dayframe/shared";
import type { MobileBootstrap, TimeEntryUpdatePatch } from "./api";

type ActiveTimerEntry = MobileBootstrap["activeEntry"];
type MobileTimeEntry = MobileBootstrap["entries"][number];

export const OPTIMISTIC_TIMER_ID_PREFIX = "optimistic-active-timer:";

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

export function optimisticPatchTimeEntry(
  data: MobileBootstrap | null,
  entryId: string,
  patch: TimeEntryUpdatePatch
) {
  if (!data) return data;
  const patchEntry = (entry: MobileTimeEntry) =>
    entry.id === entryId ? patchedMobileTimeEntry(entry, patch, data.categories) : entry;
  return {
    ...data,
    activeEntry: data.activeEntry ? patchEntry(data.activeEntry) : null,
    entries: data.entries.map(patchEntry),
    dayEntries: data.dayEntries?.map(patchEntry),
    weekEntries: data.weekEntries?.map(patchEntry)
  };
}

export function optimisticDeleteTimeEntry(data: MobileBootstrap | null, entryId: string) {
  if (!data) return data;
  const keepOtherEntry = (entry: MobileTimeEntry) => entry.id !== entryId;
  return {
    ...data,
    activeEntry: data.activeEntry?.id === entryId ? null : data.activeEntry,
    entries: data.entries.filter(keepOtherEntry),
    historyEntries: data.historyEntries?.filter(keepOtherEntry),
    dayEntries: data.dayEntries?.filter(keepOtherEntry),
    weekEntries: data.weekEntries?.filter(keepOtherEntry)
  };
}

export function optimisticRestoreTimeEntries(
  data: MobileBootstrap | null,
  snapshot: MobileBootstrap | null,
  entryIds: string[]
) {
  if (!data || !snapshot) return data;
  const restoreIds = new Set(entryIds);
  const restoreFrom = (current: MobileTimeEntry[], previous: MobileTimeEntry[] | undefined) => {
    const restored = previous?.filter((entry) => restoreIds.has(entry.id)) ?? [];
    return dedupeMobileEntries([...current, ...restored]);
  };
  return {
    ...data,
    activeEntry: data.activeEntry ?? (
      snapshot.activeEntry && restoreIds.has(snapshot.activeEntry.id) ? snapshot.activeEntry : null
    ),
    entries: restoreFrom(data.entries, snapshot.entries),
    historyEntries: data.historyEntries
      ? restoreFrom(data.historyEntries, snapshot.historyEntries)
      : data.historyEntries,
    dayEntries: data.dayEntries ? restoreFrom(data.dayEntries, snapshot.dayEntries) : data.dayEntries,
    weekEntries: data.weekEntries ? restoreFrom(data.weekEntries, snapshot.weekEntries) : data.weekEntries
  };
}

export function optimisticStopActiveTimer(data: MobileBootstrap | null, stoppedAt: string) {
  if (!data?.activeEntry) return data;
  const completed = patchedMobileTimeEntry(data.activeEntry, { stoppedAt }, data.categories);
  return {
    ...data,
    activeEntry: null,
    entries: upsertMobileEntry(data.entries, completed),
    dayEntries: data.dayEntries ? upsertMobileEntry(data.dayEntries, completed) : data.dayEntries,
    weekEntries: data.weekEntries ? upsertMobileEntry(data.weekEntries, completed) : data.weekEntries
  };
}

export function optimisticStartTimer(data: MobileBootstrap | null, pendingEntry: MobileTimeEntry) {
  if (!data) return data;
  const replaced = data.activeEntry
    ? patchedMobileTimeEntry(data.activeEntry, { stoppedAt: pendingEntry.startedAt }, data.categories)
    : null;
  const withReplacement = (entries: MobileTimeEntry[]) => {
    const next = replaced ? upsertMobileEntry(entries, replaced) : entries;
    return upsertMobileEntry(next, pendingEntry);
  };
  return {
    ...data,
    activeEntry: pendingEntry,
    entries: withReplacement(data.entries),
    dayEntries: data.dayEntries ? withReplacement(data.dayEntries) : data.dayEntries,
    weekEntries: data.weekEntries ? withReplacement(data.weekEntries) : data.weekEntries
  };
}

export function replaceOptimisticTimeEntryId(
  data: MobileBootstrap | null,
  optimisticId: string,
  persistedId: string
) {
  if (!data) return data;
  const replaceId = (entry: MobileTimeEntry) =>
    entry.id === optimisticId ? { ...entry, id: persistedId } : entry;
  return {
    ...data,
    activeEntry: data.activeEntry ? replaceId(data.activeEntry) : null,
    entries: dedupeMobileEntries(data.entries.map(replaceId)),
    dayEntries: data.dayEntries ? dedupeMobileEntries(data.dayEntries.map(replaceId)) : data.dayEntries,
    weekEntries: data.weekEntries ? dedupeMobileEntries(data.weekEntries.map(replaceId)) : data.weekEntries
  };
}

export function mobileTimeEntryById(data: MobileBootstrap | null, entryId: string) {
  if (!data) return null;
  if (data.activeEntry?.id === entryId) return data.activeEntry;
  return [...data.entries, ...(data.dayEntries ?? []), ...(data.weekEntries ?? [])]
    .find((entry) => entry.id === entryId) ?? null;
}

function patchedMobileTimeEntry(
  entry: MobileTimeEntry,
  patch: TimeEntryUpdatePatch,
  categories: MobileBootstrap["categories"]
): MobileTimeEntry {
  const next: MobileTimeEntry = { ...entry, ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, "categoryId")) {
    const category = patch.categoryId
      ? categories.find((candidate) => candidate.id === patch.categoryId)
      : null;
    next.categoryId = patch.categoryId ?? null;
    next.categoryName = category?.name ?? null;
    next.categoryColor = category?.color ?? null;
  }
  const startedAtMs = Date.parse(next.startedAt);
  const stoppedAtMs = next.stoppedAt ? Date.parse(next.stoppedAt) : NaN;
  if (Number.isFinite(startedAtMs) && Number.isFinite(stoppedAtMs)) {
    next.durationSeconds = Math.max(0, Math.floor((stoppedAtMs - startedAtMs) / 1000));
  }
  return next;
}

function upsertMobileEntry(entries: MobileTimeEntry[], nextEntry: MobileTimeEntry) {
  const existingIndex = entries.findIndex((entry) => entry.id === nextEntry.id);
  if (existingIndex < 0) return [nextEntry, ...entries];
  return entries.map((entry, index) => index === existingIndex ? nextEntry : entry);
}

function dedupeMobileEntries(entries: MobileTimeEntry[]) {
  const byId = new Map<string, MobileTimeEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  return [...byId.values()];
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
