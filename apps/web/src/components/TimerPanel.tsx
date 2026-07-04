"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { paletteColorFor } from "@dayframe/shared";
import { Play, Square } from "lucide-react";
import type { BootstrapData, CategoryRow, PlaceRow, TimeEntryRow } from "@/lib/queries";
import { formatClockDuration, formatTime } from "@/lib/format";

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
  const [now, setNow] = useState(() => Date.now());
  const [categoryId, setCategoryId] = useState(activeEntry?.categoryId ?? categories[0]?.id ?? "");
  const [placeId, setPlaceId] = useState("");
  const [description, setDescription] = useState("");
  const isBusy = isPending || isSubmitting;
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

  async function refreshClientData() {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to refresh timer state: ${response.status}`);
    const data = (await response.json()) as BootstrapData;
    onSynced?.(data);
  }

  async function submit(mode: "start" | "stop") {
    if (mode === "start" && !categoryId) return;
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/time-entries", {
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
      if (mode === "start") setDescription("");

      if (onSynced) await refreshClientData();
      else startTransition(() => router.refresh());
    } finally {
      setIsSubmitting(false);
    }
  }

  async function continueEntry(entry: TimeEntryRow) {
    setCategoryId(entry.categoryId ?? "");
    setDescription(entry.description ?? "");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/time-entries", {
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
          ? paletteColorFor(activeEntry.categoryColor, activeEntry.categoryName ?? activeEntry.id)
          : undefined
      }}
    >
      <div className="border-b border-[var(--line)] px-4 py-3">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <h2 className="text-base font-semibold">Time entry</h2>
          <p className="text-xs text-[var(--muted)]">
            {activeEntry
              ? `${activeEntry.description ?? activeEntry.categoryName ?? "Timer"} since ${formatTime(activeEntry.startedAt)}`
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
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What are you working on?"
          />
        </label>

        <label className="border-b border-[var(--line)] p-4 lg:border-b-0 lg:border-r">
          <span className="industrial-field-label">Category</span>
          <select
            className="focus-ring industrial-field"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            required
          >
            {categories.length === 0 ? <option value="">Create a category first</option> : null}
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
            onChange={(event) => setPlaceId(event.target.value)}
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
            <div className="tabular text-3xl font-semibold leading-none text-[var(--accent)]">
              {formatClockDuration(activeDurationSeconds)}
            </div>
          </div>
          {activeEntry ? (
            <button
              className="industrial-button-danger focus-ring mt-3 w-full text-sm disabled:opacity-50"
              type="button"
              disabled={isBusy}
              onClick={() => submit("stop")}
            >
              <Square size={16} />
              Stop
            </button>
          ) : (
            <button
              className="industrial-button-primary focus-ring mt-3 w-full text-sm disabled:opacity-50"
              type="button"
              disabled={isBusy || !categoryId}
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
              className="focus-ring motion-row flex w-full items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--surface-inset)] px-3 py-2 text-left text-sm hover:border-[var(--accent)] hover:text-[var(--accent)]"
              style={{ borderLeftWidth: 4, borderLeftColor: paletteColorFor(entry.categoryColor, entry.categoryName ?? entry.id) }}
              type="button"
              disabled={isBusy}
              onClick={() => continueEntry(entry)}
            >
              <span>
                <span className="block font-medium">{entry.description ?? entry.categoryName ?? "Untitled task"}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {entry.categoryName ?? "No category"}
                </span>
              </span>
              <Play size={15} fill="currentColor" strokeWidth={0} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
