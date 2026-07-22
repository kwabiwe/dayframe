"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { paletteCssColorFor } from "@dayframe/shared";
import { Play, Square, Trash2 } from "lucide-react";
import { DestructiveConfirmationDialog } from "@/components/DestructiveConfirmationDialog";
import { clientFetch } from "@/lib/client-auth-fetch";
import { timeEntryCategoryColor, timeEntryCategoryLabel, timeEntryTitle } from "@/lib/display";
import type { BootstrapData, CategoryRow, PlaceRow, TimeEntryRow } from "@/lib/queries";
import { formatClockDuration, formatTime } from "@/lib/format";

type TimerDraft = {
  activeEntryId: string | null;
  categoryId: string;
  placeId: string;
  description: string;
};

function draftFromEntry(activeEntry: TimeEntryRow | null): TimerDraft {
  return {
    activeEntryId: activeEntry?.id ?? null,
    categoryId: activeEntry?.categoryId ?? "",
    placeId: activeEntry?.placeId ?? "",
    description: activeEntry?.description ?? ""
  };
}

export function TimerPanel({
  activeEntry,
  categories,
  places,
  recentEntries,
  onSynced
}: {
  activeEntry: TimeEntryRow | null;
  categories: CategoryRow[];
  places: PlaceRow[];
  recentEntries: TimeEntryRow[];
  onSynced?: (data: BootstrapData) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteDialogEntryId, setDeleteDialogEntryId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState<TimerDraft>(() => draftFromEntry(activeEntry));
  const syncedDraft = draft.activeEntryId === (activeEntry?.id ?? null) ? draft : draftFromEntry(activeEntry);
  const { categoryId, placeId, description } = syncedDraft;
  const isBusy = isPending || isSubmitting;
  const isDeleteDialogOpen = activeEntry ? deleteDialogEntryId === activeEntry.id : false;
  const activeDurationSeconds = activeEntry
    ? Math.max(
        activeEntry.durationSeconds,
        Math.floor((now - new Date(activeEntry.startedAt).getTime()) / 1000)
      )
    : 0;

  useEffect(() => {
    if (!activeEntry) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeEntry]);

  function updateDraft(patch: Partial<Omit<TimerDraft, "activeEntryId">>) {
    setDraft({ ...syncedDraft, ...patch });
  }

  async function refreshClientData() {
    const response = await clientFetch("/api/bootstrap", { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to refresh timer state: ${response.status}`);
    const data = (await response.json()) as BootstrapData;
    onSynced?.(data);
  }

  async function submit(mode: "start" | "stop") {
    setIsSubmitting(true);
    try {
      if (mode === "stop" && activeEntry) {
        const updateResponse = await clientFetch(`/api/time-entries/${activeEntry.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categoryId: categoryId || null,
            placeId: placeId || null,
            description: description.trim() || null,
            startedAt: activeEntry.startedAt,
            stoppedAt: activeEntry.stoppedAt
          })
        });
        if (!updateResponse.ok) throw new Error(`Unable to save timer details: ${updateResponse.status}`);
      }

      const response = await clientFetch("/api/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "stop"
            ? { mode: "stop" }
            : {
                mode: "start",
                categoryId: categoryId || undefined,
                placeId: placeId || undefined,
                description: description || undefined
              }
        )
      });
      if (!response.ok) throw new Error(`Timer action failed: ${response.status}`);
      if (mode === "start") updateDraft({ description: "" });

      if (onSynced) await refreshClientData();
      else startTransition(() => router.refresh());
    } finally {
      setIsSubmitting(false);
    }
  }

  async function deleteActiveEntry() {
    if (!activeEntry) return;

    setIsSubmitting(true);
    setDeleteError(null);
    try {
      const response = await clientFetch(`/api/time-entries/${activeEntry.id}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        let errorMessage = `Unable to delete timer: ${response.status}`;
        try {
          const payload = (await response.json()) as { error?: string };
          errorMessage = payload.error ?? errorMessage;
        } catch {
          // Runtime failures may not return JSON.
        }
        throw new Error(errorMessage);
      }

      setDeleteDialogEntryId(null);
      setDraft(draftFromEntry(null));
      if (onSynced) await refreshClientData();
      else startTransition(() => router.refresh());
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Unable to delete the running timer.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function continueEntry(entry: TimeEntryRow) {
    updateDraft({ categoryId: entry.categoryId ?? "", description: entry.description ?? "" });
    setIsSubmitting(true);
    try {
      const response = await clientFetch("/api/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "start",
          categoryId: entry.categoryId,
          description: entry.description ?? undefined
        })
      });
      if (!response.ok) throw new Error(`Continue action failed: ${response.status}`);

      if (onSynced) await refreshClientData();
      else startTransition(() => router.refresh());
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section
      className="industrial-panel"
      style={{
        borderColor: activeEntry
          ? paletteCssColorFor(activeEntry.categoryColor, activeEntry.categoryName ?? activeEntry.id)
          : undefined
      }}
    >
      <div className="border-b border-[var(--line)] px-4 py-3">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <h2 className="text-base font-semibold">Time entry</h2>
          <p className="text-xs text-[var(--muted)]">
            {activeEntry
              ? `${timeEntryTitle(activeEntry)} since ${formatTime(activeEntry.startedAt)}`
              : "No timer is running."}
          </p>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(220px,1fr)_180px_150px_140px]">
        <label className="border-b border-[var(--line)] p-4 lg:border-b-0 lg:border-r">
          <span className="industrial-field-label">Description</span>
          <input
            className="focus-ring industrial-field"
            value={description}
            onChange={(event) => updateDraft({ description: event.target.value })}
            placeholder="What are you working on?"
          />
        </label>

        <label className="border-b border-[var(--line)] p-4 lg:border-b-0 lg:border-r">
          <span className="industrial-field-label">Category</span>
          <select
            className="focus-ring industrial-field"
            value={categoryId}
            onChange={(event) => updateDraft({ categoryId: event.target.value })}
          >
            <option value="">Uncategorized</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label className="border-b border-[var(--line)] p-4 lg:border-b-0 lg:border-r">
          <span className="industrial-field-label">Place</span>
          <select
            className="focus-ring industrial-field"
            value={placeId}
            onChange={(event) => updateDraft({ placeId: event.target.value })}
          >
            <option value="">No place</option>
            {places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-[1fr_auto] items-end gap-3 p-4 lg:block">
          <div>
            <span className="industrial-field-label">Duration</span>
            <div className="tabular text-3xl font-semibold leading-none text-[var(--accent-text)]">
              {formatClockDuration(activeDurationSeconds)}
            </div>
          </div>
          {activeEntry ? (
            <div className="mt-3 flex items-center gap-2">
              <button
                className="industrial-button-danger focus-ring min-h-10 flex-1 text-sm disabled:opacity-50"
                type="button"
                disabled={isBusy}
                onClick={() => submit("stop")}
              >
                <Square size={16} />
                Stop
              </button>
              <button
                className="industrial-button-danger focus-ring h-11 w-11 shrink-0 px-0 text-sm disabled:opacity-50"
                type="button"
                disabled={isBusy}
                aria-label="Delete running timer"
                title="Delete running timer"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteDialogEntryId(activeEntry.id);
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ) : (
            <button
              className="industrial-button-primary focus-ring mt-3 w-full text-sm disabled:opacity-50"
              type="button"
              disabled={isBusy}
              onClick={() => submit("start")}
            >
              <Play size={16} />
              Start
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--line)] p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Continue</h3>
          <span className="text-xs text-[var(--muted)]">{recentEntries.slice(0, 4).length} entries</span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {recentEntries.slice(0, 4).map((entry) => (
            <button
              key={entry.id}
              className="fill-list-action focus-ring motion-row flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:text-[var(--accent-text)]"
              style={{ borderLeftWidth: 4, borderLeftColor: timeEntryCategoryColor(entry) }}
              type="button"
              disabled={isBusy}
              onClick={() => continueEntry(entry)}
            >
              <span>
                <span className="block font-medium">{timeEntryTitle(entry)}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {timeEntryCategoryLabel(entry)}
                </span>
              </span>
              <Play size={15} fill="currentColor" strokeWidth={0} />
            </button>
          ))}
        </div>
      </div>
      {isDeleteDialogOpen ? (
        <DestructiveConfirmationDialog
          body="This removes the entry instead of stopping it."
          dialogId="delete-running-timer"
          error={deleteError}
          isBusy={isBusy}
          onCancel={() => setDeleteDialogEntryId(null)}
          onConfirm={() => void deleteActiveEntry()}
          title="Delete running timer?"
        />
      ) : null}
    </section>
  );
}
