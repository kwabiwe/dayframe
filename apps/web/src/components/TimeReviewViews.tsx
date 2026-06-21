"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { paletteColorFor } from "@dayframe/shared";
import { CalendarDays, ChevronLeft, ChevronRight, List, Pencil, RotateCcw, Table2, Trash2 } from "lucide-react";
import { EntriesTable } from "@/components/EntriesTable";
import type { CategoryRow, PlaceRow, ProjectRow, TimeEntryRow } from "@/lib/queries";
import { dateTimeLocal, formatDate, formatDuration, formatTime } from "@/lib/format";

type TimeView = "calendar" | "list" | "timesheet";
type CalendarMode = "week" | "day";

const viewItems: Array<{ id: TimeView; label: string; icon: React.ReactNode }> = [
  { id: "calendar", label: "Calendar", icon: <CalendarDays size={16} /> },
  { id: "list", label: "List", icon: <List size={16} /> },
  { id: "timesheet", label: "Timesheet", icon: <Table2 size={16} /> }
];

const startHour = 6;
const endHour = 22;
const rowHeight = 58;
const calendarHeight = (endHour - startHour) * rowHeight;

export function TimeReviewViews({
  entries,
  projects,
  categories,
  places
}: {
  entries: TimeEntryRow[];
  projects: ProjectRow[];
  categories: CategoryRow[];
  places: PlaceRow[];
}) {
  const [activeView, setActiveView] = useState<TimeView>(() => {
    if (typeof window === "undefined") return "calendar";
    const storedView = window.localStorage.getItem("dayframe.timeReviewView");
    return storedView === "calendar" || storedView === "list" || storedView === "timesheet"
      ? storedView
      : "calendar";
  });
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("week");
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(new Date()));

  function updateView(view: TimeView) {
    setActiveView(view);
    window.localStorage.setItem("dayframe.timeReviewView", view);
  }

  const weekDays = useMemo(() => getWeekDays(weekAnchor), [weekAnchor]);
  const weekEntries = useMemo(
    () => entries.filter((entry) => isInWeek(new Date(entry.startedAt), weekAnchor)),
    [entries, weekAnchor]
  );
  const weekTotal = weekEntries.reduce((sum, entry) => sum + entry.durationSeconds, 0);

  return (
    <section className="space-y-5">
      <div className="industrial-panel p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="focus-ring grid h-9 w-9 place-items-center border border-[var(--line-strong)] bg-[var(--surface-inset)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              type="button"
              aria-label="Previous week"
              onClick={() => setWeekAnchor(addDays(weekAnchor, -7))}
            >
              <ChevronLeft size={16} />
            </button>
            <div className="min-w-[220px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 py-2">
              <div className="text-sm font-semibold">This week</div>
              <div className="tabular mt-1 text-xs text-[var(--muted)]">
                {formatDate(weekDays[0])} - {formatDate(weekDays[6])}
              </div>
            </div>
            <button
              className="focus-ring grid h-9 w-9 place-items-center border border-[var(--line-strong)] bg-[var(--surface-inset)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              type="button"
              aria-label="Next week"
              onClick={() => setWeekAnchor(addDays(weekAnchor, 7))}
            >
              <ChevronRight size={16} />
            </button>
            <div className="border border-[var(--line)] bg-[var(--surface-inset)] px-3 py-2 text-sm">
              <span className="text-[var(--muted)]">Week total </span>
              <span className="tabular font-semibold">{formatDuration(weekTotal)}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 border border-[var(--line-strong)] bg-[var(--surface-inset)]">
            {viewItems.map((item) => {
              const selected = item.id === activeView;
              return (
                <button
                  key={item.id}
                  className={[
                    "focus-ring flex min-h-10 min-w-[116px] items-center justify-center gap-2 border-r border-[var(--line)] px-3 text-sm last:border-r-0",
                    selected ? "bg-[var(--accent)] text-black" : "text-[var(--foreground)] hover:text-[var(--accent)]"
                  ].join(" ")}
                  type="button"
                  onClick={() => updateView(item.id)}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {activeView === "calendar" ? (
        <CalendarReview
          calendarMode={calendarMode}
          categories={categories}
          entries={weekEntries}
          places={places}
          projects={projects}
          setCalendarMode={setCalendarMode}
          weekDays={weekDays}
        />
      ) : null}
      {activeView === "list" ? (
        <EntriesTable
          entries={entries}
          projects={projects}
          categories={categories}
          places={places}
          groupByDay
        />
      ) : null}
      {activeView === "timesheet" ? <TimesheetView entries={weekEntries} weekDays={weekDays} /> : null}
    </section>
  );
}

function CalendarReview({
  calendarMode,
  categories,
  entries,
  places,
  projects,
  setCalendarMode,
  weekDays
}: {
  calendarMode: CalendarMode;
  categories: CategoryRow[];
  entries: TimeEntryRow[];
  places: PlaceRow[];
  projects: ProjectRow[];
  setCalendarMode: (mode: CalendarMode) => void;
  weekDays: Date[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const today = new Date();
  const visibleDays =
    calendarMode === "day"
      ? [weekDays.find((day) => sameDay(day, today)) ?? today]
      : weekDays;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? null;

  async function remove(id: string) {
    await fetch(`/api/time-entries/${id}`, { method: "DELETE" });
    setSelectedEntryId(null);
    startTransition(() => router.refresh());
  }

  async function continueEntry(entry: TimeEntryRow) {
    await fetch("/api/time-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "start",
        projectId: entry.projectId,
        categoryId: entry.categoryId,
        description: entry.description ? `Continue: ${entry.description}` : undefined
      })
    });
    startTransition(() => router.refresh());
  }

  async function submitEdit(entry: TimeEntryRow, formData: FormData) {
    await fetch(`/api/time-entries/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: formData.get("projectId"),
        categoryId: formData.get("categoryId") || null,
        placeId: formData.get("placeId") || null,
        description: formData.get("description") || null,
        startedAt: formData.get("startedAt"),
        stoppedAt: formData.get("stoppedAt") || null
      })
    });
    setSelectedEntryId(null);
    startTransition(() => router.refresh());
  }

  return (
    <section className="industrial-panel">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Calendar</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Click a block to inspect it. Drag and resize are planned after v1.</p>
        </div>
        <div className="grid w-full max-w-[220px] grid-cols-2 border border-[var(--line-strong)] bg-[var(--surface-inset)]">
          {(["week", "day"] as CalendarMode[]).map((mode) => (
            <button
              key={mode}
              className={[
                "focus-ring px-3 py-2 text-sm capitalize",
                calendarMode === mode ? "bg-[var(--accent)] text-black" : "hover:text-[var(--accent)]"
              ].join(" ")}
              type="button"
              onClick={() => setCalendarMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[980px]"
          style={{ gridTemplateColumns: `72px repeat(${visibleDays.length}, minmax(130px, 1fr))` }}
        >
          <div className="border-b border-r border-[var(--line)] bg-[var(--surface-inset)] px-3 py-3 text-xs text-[var(--muted)]">
            Time
          </div>
          {visibleDays.map((day) => {
            const total = entries
              .filter((entry) => sameDay(new Date(entry.startedAt), day))
              .reduce((sum, entry) => sum + entry.durationSeconds, 0);
            return (
              <div
                key={day.toISOString()}
                className={[
                  "border-b border-r border-[var(--line)] px-3 py-3 last:border-r-0",
                  sameDay(day, today) ? "bg-[var(--surface-muted)]" : "bg-[var(--surface-inset)]"
                ].join(" ")}
              >
                <div className="text-sm font-semibold">{formatDate(day)}</div>
                <div className="tabular mt-1 text-xs text-[var(--muted)]">{formatDuration(total)}</div>
              </div>
            );
          })}

          <div className="relative border-r border-[var(--line)] bg-[var(--surface-inset)]" style={{ height: calendarHeight }}>
            {hours.map((hour) => (
              <div
                key={hour}
                className="tabular absolute left-0 right-0 border-t border-[var(--line)] px-2 pt-1 text-xs text-[var(--muted)]"
                style={{ top: (hour - startHour) * rowHeight }}
              >
                {hour.toString().padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {visibleDays.map((day) => (
            <div
              key={`${day.toISOString()}-body`}
              className="relative border-r border-[var(--line)] last:border-r-0"
              style={{
                height: calendarHeight,
                backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 57px, var(--line) 58px)"
              }}
            >
              {entries
                .filter((entry) => sameDay(new Date(entry.startedAt), day))
                .map((entry) => (
                  <button
                    key={entry.id}
                    className={[
                      "focus-ring absolute left-2 right-2 overflow-hidden border p-2 text-left text-xs text-black",
                      selectedEntryId === entry.id ? "outline outline-2 outline-offset-1 outline-[var(--foreground)]" : ""
                    ].join(" ")}
                    style={{
                      ...calendarBlockStyle(entry),
                      backgroundColor: paletteColorFor(entry.projectColor, entry.projectName ?? entry.id),
                      borderColor: "color-mix(in srgb, #000 35%, transparent)"
                    }}
                    type="button"
                    data-entry-id={entry.id}
                    title={`${entry.description ?? entry.projectName ?? "Unassigned"} ${formatTime(entry.startedAt)} - ${entry.stoppedAt ? formatTime(entry.stoppedAt) : "Running"}`}
                    onClick={() => setSelectedEntryId(entry.id)}
                  >
                    <span className="block truncate font-semibold">{entry.description ?? entry.projectName ?? "Unassigned"}</span>
                    <span className="block truncate opacity-80">{entry.clientName ?? entry.categoryName ?? entry.source}</span>
                    <span className="tabular block">{formatDuration(entry.durationSeconds)}</span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>
      {selectedEntry ? (
        <div className="border-t border-[var(--line)] p-4">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <Pencil size={16} />
                Edit calendar entry
              </h3>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {formatTime(selectedEntry.startedAt)} -{" "}
                {selectedEntry.stoppedAt ? formatTime(selectedEntry.stoppedAt) : "Running"} /{" "}
                {formatDuration(selectedEntry.durationSeconds)}
              </p>
            </div>
            <button
              className="industrial-button focus-ring self-start text-sm"
              type="button"
              onClick={() => setSelectedEntryId(null)}
            >
              Close
            </button>
          </div>
          <form action={(formData) => submitEdit(selectedEntry, formData)} className="grid gap-3 md:grid-cols-6">
            <SelectField
              name="projectId"
              label="Project"
              options={projects}
              defaultValue={selectedEntry.projectId ?? ""}
              required
            />
            <SelectField
              name="categoryId"
              label="Category"
              options={categories}
              defaultValue={selectedEntry.categoryId ?? ""}
            />
            <SelectField
              name="placeId"
              label="Place"
              options={places}
              defaultValue={selectedEntry.placeId ?? ""}
            />
            <TextField
              name="description"
              label="Description"
              defaultValue={selectedEntry.description ?? ""}
            />
            <DateField
              name="startedAt"
              label="Start"
              defaultValue={dateTimeLocal(selectedEntry.startedAt)}
            />
            <DateField
              name="stoppedAt"
              label="Stop"
              defaultValue={selectedEntry.stoppedAt ? dateTimeLocal(selectedEntry.stoppedAt) : ""}
            />
            <div className="flex flex-wrap gap-2 md:col-span-6">
              <button className="industrial-button-primary focus-ring text-sm" disabled={isPending}>
                Save
              </button>
              <button
                className="industrial-button focus-ring text-sm"
                type="button"
                disabled={!selectedEntry.projectId || isPending}
                onClick={() => continueEntry(selectedEntry)}
              >
                <RotateCcw size={15} />
                Continue
              </button>
              <button
                className="industrial-button-danger focus-ring text-sm"
                type="button"
                disabled={isPending}
                onClick={() => remove(selectedEntry.id)}
              >
                <Trash2 size={15} />
                Delete
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function TimesheetView({ entries, weekDays }: { entries: TimeEntryRow[]; weekDays: Date[] }) {
  const rows = Array.from(
    entries.reduce((totals, entry) => {
      const key = entry.projectId ?? `unassigned:${entry.projectName ?? "Unassigned"}`;
      const current = totals.get(key) ?? {
        id: key,
        name: key,
        label: entry.projectName ?? "Unassigned",
        clientName: entry.clientName,
        categoryName: entry.categoryName,
        color: paletteColorFor(entry.projectColor, entry.projectName ?? key),
        days: Array(7).fill(0) as number[],
        total: 0
      };
      const dayIndex = weekDays.findIndex((day) => sameDay(day, new Date(entry.startedAt)));
      if (dayIndex >= 0) current.days[dayIndex] += entry.durationSeconds;
      current.total += entry.durationSeconds;
      totals.set(key, current);
      return totals;
    }, new Map<string, { id: string; name: string; label: string; clientName: string | null; categoryName: string | null; color: string; days: number[]; total: number }>())
  )
    .map(([, row]) => row)
    .sort((a, b) => b.total - a.total);
  const dailyTotals = weekDays.map((_, dayIndex) =>
    rows.reduce((sum, row) => sum + row.days[dayIndex], 0)
  );

  return (
    <section className="industrial-panel overflow-x-auto">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-lg font-semibold">Timesheet</h2>
      </div>
      <table className="min-w-[980px] w-full border-collapse text-sm">
        <thead className="bg-[var(--surface-inset)] text-left text-xs text-[var(--muted)]">
          <tr>
            <th className="border-b border-r border-[var(--line)] px-3 py-3">Activity</th>
            {weekDays.map((day) => (
              <th key={day.toISOString()} className="border-b border-r border-[var(--line)] px-3 py-3 last:border-r-0">
                {formatDate(day)}
              </th>
            ))}
            <th className="border-b border-[var(--line)] px-3 py-3">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-4 py-6 text-sm text-[var(--muted)]">No time entries for this week.</td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-[var(--line)] last:border-b-0">
              <td className="border-r border-[var(--line)] px-3 py-3">
                <span className="flex items-center gap-2 font-semibold">
                  <span className="h-3 w-3 border border-[var(--line-strong)]" style={{ backgroundColor: row.color }} />
                  {row.label}
                </span>
                <span className="mt-1 block text-xs text-[var(--muted)]">{row.clientName ?? row.categoryName ?? "No client"}</span>
              </td>
              {row.days.map((seconds, index) => (
                <td key={`${row.id}-${index}`} className="tabular border-r border-[var(--line)] px-3 py-3 text-[var(--muted)] last:border-r-0">
                  {seconds > 0 ? formatDuration(seconds) : "-"}
                </td>
              ))}
              <td className="tabular px-3 py-3 font-semibold text-[var(--accent)]">{formatDuration(row.total)}</td>
            </tr>
          ))}
          <tr className="bg-[var(--surface-inset)] font-semibold">
            <td className="border-r border-[var(--line)] px-3 py-3">Daily total</td>
            {dailyTotals.map((seconds, index) => (
              <td key={weekDays[index].toISOString()} className="tabular border-r border-[var(--line)] px-3 py-3">
                {formatDuration(seconds)}
              </td>
            ))}
            <td className="tabular px-3 py-3 text-[var(--accent)]">
              {formatDuration(dailyTotals.reduce((sum, seconds) => sum + seconds, 0))}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function SelectField({
  name,
  label,
  options,
  defaultValue = "",
  required = false
}: {
  name: string;
  label: string;
  options: Array<{ id: string; name: string }>;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm">
      <span className="industrial-field-label">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="industrial-field focus-ring"
      >
        <option value="">{required ? "Select" : "None"}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextField({
  name,
  label,
  defaultValue = ""
}: {
  name: string;
  label: string;
  defaultValue?: string;
}) {
  return (
    <label className="text-sm">
      <span className="industrial-field-label">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        className="industrial-field focus-ring"
      />
    </label>
  );
}

function DateField({
  name,
  label,
  defaultValue
}: {
  name: string;
  label: string;
  defaultValue?: string;
}) {
  return (
    <label className="text-sm">
      <span className="industrial-field-label">{label}</span>
      <input
        type="datetime-local"
        name={name}
        defaultValue={defaultValue}
        required={name === "startedAt"}
        className="industrial-field focus-ring"
      />
    </label>
  );
}

function calendarBlockStyle(entry: TimeEntryRow) {
  const start = new Date(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? new Date(entry.stoppedAt) : new Date();
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const durationMinutes = Math.max(15, (stoppedAt.getTime() - start.getTime()) / 60_000);
  const top = Math.min(calendarHeight - 24, Math.max(0, ((startMinutes - startHour * 60) / 60) * rowHeight));
  const height = Math.min(calendarHeight - top, Math.max(36, (durationMinutes / 60) * rowHeight));
  return { top, height: Math.max(24, height) };
}

function startOfWeek(input: Date) {
  const date = new Date(input);
  const day = date.getDay();
  const offset = day === 0 ? 6 : day - 1;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - offset);
  return date;
}

function getWeekDays(weekStart: Date) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function addDays(input: Date, days: number) {
  const date = new Date(input);
  date.setDate(date.getDate() + days);
  return date;
}

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isInWeek(date: Date, weekStart: Date) {
  const weekEnd = addDays(weekStart, 7);
  return date >= weekStart && date < weekEnd;
}
