import { normalizeTagName } from "@dayframe/shared";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

export type TimerDraft = {
  categoryId: string;
  description: string;
  tagNames: string[];
};

export type TimerDraftInput = Partial<TimerDraft>;

export type TimerMutationGate = ReturnType<typeof createTimerMutationGate>;

export type EntryContinuationDecision =
  | { ok: true; draft: TimerDraft }
  | { ok: false; error: string };

export function createTimerMutationGate() {
  let active = false;

  return {
    isActive() {
      return active;
    },
    async run<T>(mutation: () => Promise<T>) {
      if (active) return { ran: false as const };
      active = true;
      try {
        return { ran: true as const, value: await mutation() };
      } finally {
        active = false;
      }
    }
  };
}

export function timerDraftForEntry(entry: TimeEntryRow | null | undefined): TimerDraft {
  return {
    categoryId: entry?.categoryId ?? "",
    description: entry?.description ?? "",
    tagNames: entry?.tagNames ?? []
  };
}

export function entryContinuationDecision(
  entry: TimeEntryRow
): EntryContinuationDecision {
  const description = entry.description?.trim() ?? "";
  if (!entry.categoryId && !description) {
    return {
      ok: false,
      error: "This entry does not have a task or category to start."
    };
  }

  return {
    ok: true,
    draft: {
      categoryId: entry.categoryId ?? "",
      description,
      tagNames: [...entry.tagNames]
    }
  };
}

export function timerStartErrorMessage(error: unknown) {
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return "Unable to start right now. Check your connection and try again.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unable to start the timer.";
}

export function applyOptimisticTimerStart(
  data: BootstrapData,
  draft: TimerDraft,
  startedAt: string,
  id: string
) {
  const replacementBase = data.activeEntry
    ? applyOptimisticTimerStop(data, startedAt)
    : data;
  const category = replacementBase.categories.find((item) => item.id === draft.categoryId) ?? null;
  const tags = draft.tagNames.map((name) => {
    const normalizedName = normalizeTagName(name).normalizedName;
    const existing = replacementBase.tags.find((tag) => tag.normalizedName === normalizedName);
    return {
      id: existing?.id ?? `optimistic-tag:${normalizedName}`,
      name: existing?.name ?? name,
      normalizedName
    };
  });
  const entry: TimeEntryRow = {
    id,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
    categoryColor: category?.color ?? null,
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: draft.description.trim() || null,
    startedAt,
    stoppedAt: null,
    durationSeconds: 0,
    tagNames: draft.tagNames,
    tags
  };

  return replaceEntryCollections({ ...replacementBase, activeEntry: entry }, entry);
}

export function applyOptimisticTimerStop(data: BootstrapData, stoppedAt: string) {
  if (!data.activeEntry) return data;
  const durationSeconds = Math.max(
    data.activeEntry.durationSeconds,
    Math.floor((new Date(stoppedAt).getTime() - new Date(data.activeEntry.startedAt).getTime()) / 1000)
  );
  const entry = { ...data.activeEntry, stoppedAt, durationSeconds };
  return replaceEntryCollections({ ...data, activeEntry: null }, entry);
}

export function applyOptimisticActiveEntryPatch(
  data: BootstrapData,
  draft: TimerDraft,
  startedAt = data.activeEntry?.startedAt
) {
  if (!data.activeEntry) return data;
  const category = data.categories.find((item) => item.id === draft.categoryId) ?? null;
  const entry: TimeEntryRow = {
    ...data.activeEntry,
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
    categoryColor: category?.color ?? null,
    description: draft.description.trim() || null,
    startedAt: startedAt ?? data.activeEntry.startedAt,
    durationSeconds: startedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
      : data.activeEntry.durationSeconds,
    tagNames: draft.tagNames,
    tags: draft.tagNames.map((name) => {
      const normalizedName = normalizeTagName(name).normalizedName;
      const existing = data.tags.find((tag) => tag.normalizedName === normalizedName);
      return {
        id: existing?.id ?? `optimistic-tag:${normalizedName}`,
        name: existing?.name ?? name,
        normalizedName
      };
    })
  };
  return replaceEntryCollections({ ...data, activeEntry: entry }, entry);
}

function replaceEntryCollections(data: BootstrapData, entry: TimeEntryRow) {
  return {
    ...data,
    entries: replaceEntry(data.entries, entry),
    historyEntries: replaceEntry(data.historyEntries, entry),
    dayEntries: entryOverlaps(entry, data.dateRange.dayStart, data.dateRange.dayEnd)
      ? replaceEntry(data.dayEntries, entry)
      : data.dayEntries.filter((item) => item.id !== entry.id),
    weekEntries: entryOverlaps(entry, data.dateRange.weekStart, data.dateRange.weekEnd)
      ? replaceEntry(data.weekEntries, entry)
      : data.weekEntries.filter((item) => item.id !== entry.id)
  };
}

function replaceEntry(entries: TimeEntryRow[], entry: TimeEntryRow) {
  const withoutEntry = entries.filter((item) => item.id !== entry.id);
  return [entry, ...withoutEntry].sort(
    (left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
  );
}

function entryOverlaps(entry: TimeEntryRow, rangeStart: string, rangeEnd: string) {
  const startedAt = new Date(entry.startedAt).getTime();
  const stoppedAt = entry.stoppedAt ? new Date(entry.stoppedAt).getTime() : Date.now();
  return startedAt < new Date(rangeEnd).getTime() && stoppedAt > new Date(rangeStart).getTime();
}
