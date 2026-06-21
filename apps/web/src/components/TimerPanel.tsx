"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { paletteColorFor } from "@dayframe/shared";
import { Play, Square, RotateCcw } from "lucide-react";
import type { BootstrapData, CategoryRow, PlaceRow, ProjectRow, TimeEntryRow } from "@/lib/queries";
import { formatClockDuration, formatTime } from "@/lib/format";

export function TimerPanel({
  activeEntry,
  projects,
  categories,
  places,
  recentEntries,
  onSynced
}: {
  activeEntry: TimeEntryRow | null;
  projects: ProjectRow[];
  categories: CategoryRow[];
  places: PlaceRow[];
  recentEntries: TimeEntryRow[];
  onSynced?: (data: BootstrapData) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projectId, projects]
  );
  const [categoryId, setCategoryId] = useState(selectedProject?.categoryId ?? "");
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
  }, [activeEntry?.id]);

  async function refreshClientData() {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to refresh timer state: ${response.status}`);
    const data = (await response.json()) as BootstrapData;
    onSynced?.(data);
  }

  async function submit(mode: "start" | "stop") {
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
                projectId,
                categoryId: categoryId || selectedProject?.categoryId,
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
    setProjectId(entry.projectId ?? "");
    setCategoryId(entry.categoryId ?? "");
    setDescription(entry.description ?? "");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "start",
          projectId: entry.projectId,
          categoryId: entry.categoryId,
          description: entry.description ? `Continue: ${entry.description}` : undefined
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
          ? paletteColorFor(activeEntry.projectColor, activeEntry.projectName ?? activeEntry.id)
          : undefined
      }}
    >
      <div className="border-b border-[var(--line)] px-4 py-3">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <h2 className="text-base font-semibold">Time entry</h2>
          <p className="text-xs text-[var(--muted)]">
            {activeEntry
              ? `${activeEntry.projectName ?? "Unassigned"} since ${formatTime(activeEntry.startedAt)}`
              : "No timer is running."}
          </p>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(220px,1fr)_180px_150px_150px_140px]">
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
          <span className="industrial-field-label">Project</span>
          <select
            className="focus-ring industrial-field"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              const nextProject = projects.find((project) => project.id === event.target.value);
              setCategoryId(nextProject?.categoryId ?? "");
            }}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>

        <label className="border-b border-[var(--line)] p-4 lg:border-b-0 lg:border-r">
          <span className="industrial-field-label">Category</span>
          <select
            className="focus-ring industrial-field"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Project default</option>
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
              disabled={!projectId || isBusy}
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
              className="focus-ring motion-row flex w-full items-center justify-between border border-[var(--line)] bg-[var(--surface-inset)] px-3 py-2 text-left text-sm hover:border-[var(--accent)] hover:text-[var(--accent)]"
              style={{ borderLeftWidth: 4, borderLeftColor: paletteColorFor(entry.projectColor, entry.projectName ?? entry.id) }}
              type="button"
              disabled={!entry.projectId || isBusy}
              onClick={() => continueEntry(entry)}
            >
              <span>
                <span className="block font-medium">{entry.projectName ?? "Unassigned"}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {entry.description ?? entry.categoryName ?? "No description"}
                </span>
              </span>
              <RotateCcw size={15} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
