"use client";

import Link from "next/link";
import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { paletteColorFor } from "@dayframe/shared";
import { DestructiveConfirmationDialog } from "@/components/DestructiveConfirmationDialog";
import { EditTimeEntryDialog } from "@/components/EditTimeEntryDialog";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Edit3,
  HelpCircle,
  Laptop,
  MapPin,
  Play,
  Plus,
  Square,
  Trash2,
  Users,
  Utensils
} from "lucide-react";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";
import {
  timeEntryAccentColor,
  timeEntryContextLabel,
  timeEntryTitle
} from "@/lib/display";
import {
  dateTimeLocal,
  dateTimeLocalInputToIso,
  formatClockDuration,
  formatDuration,
  formatEventLabel,
  formatSourceLabel,
  formatTime
} from "@/lib/format";
import {
  TIMER_FOCUS_EVENT,
  TIMER_SHORTCUT_EVENT,
  type TimerShortcutEventDetail
} from "@/lib/timer-shortcut";
import {
  emptyTimerEntryDraft,
  shouldStartTimerFromEntrySubmit
} from "@/lib/timer-entry-draft";
import {
  getTimeBlockDensity,
  minimumTimeBlockHeight,
  resizeDragThresholdPx,
  timeBlockDensityClassNames
} from "@/lib/time-block-display";

const dayStartHour = 7;
const dayEndHour = 21;
const resizeSnapMinutes = 15;
const minEntryMinutes = 15;
const timelineAxisLabelHeight = 22;
const timelineZooms = {
  hour: { label: "1h", intervalMinutes: 60, pixelsPerHour: 64 },
  half: { label: "30m", intervalMinutes: 30, pixelsPerHour: 92 },
  quarter: { label: "15m", intervalMinutes: 15, pixelsPerHour: 128 }
} as const;

type TimelineZoom = keyof typeof timelineZooms;

export function DashboardRealtime({ initialData }: { initialData: BootstrapData }) {
  const [data, setData] = useState(initialData);
  const [manualOpen, setManualOpen] = useState(false);

  const refreshData = useCallback(async () => {
    try {
      const response = await fetch(`/api/bootstrap?date=${data.dateRange.selectedDate}`, {
        cache: "no-store"
      });
      if (!response.ok) return;
      setData((await response.json()) as BootstrapData);
    } catch {
      // Navigation can interrupt polling; the next visible tick will retry.
    }
  }, [data.dateRange.selectedDate]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshData();
    }, 1000);

    return () => window.clearInterval(interval);
  }, [refreshData]);

  useEffect(() => {
    function openManualEntry() {
      setManualOpen(true);
    }

    window.addEventListener("dayframe-add-time-block", openManualEntry);
    return () => window.removeEventListener("dayframe-add-time-block", openManualEntry);
  }, []);

  const selectedDate = useMemo(
    () => parseDateKey(data.dateRange.selectedDate),
    [data.dateRange.selectedDate]
  );
  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long"
  }).format(selectedDate);
  const totalLogged = data.dayEntries.reduce((sum, entry) => sum + entry.durationSeconds, 0);

  return (
    <div className="swiss-dashboard">
      <CurrentTimerPanel key={data.activeEntry?.id ?? "inactive"} data={data} onSynced={setData} />
      <section className="swiss-top-grid">
        <MetricCard
          title="Today"
          value={formatDuration(data.stats.todaySeconds)}
          caption="Total time"
          goalLabel="Goal 8:00"
          progress={data.stats.todaySeconds / (8 * 3600)}
          series={data.todaySeries.map((point) => point.seconds)}
        />
        <MetricCard
          title="This week"
          value={formatDuration(data.stats.weekSeconds)}
          caption="Total time"
          goalLabel="Goal 40:00"
          progress={data.stats.weekSeconds / (40 * 3600)}
          series={data.weekSeries.map((point) => point.seconds)}
        />
        <ReviewSummaryCard items={data.reviewItems} />
        <StreakCard series={data.weekSeries.map((point) => point.seconds)} />
      </section>

      <section className="swiss-dashboard-grid">
        <DayTimeline
          dateLabel={dayLabel}
          data={data}
          entries={data.dayEntries}
          weekEntries={data.weekEntries}
          selectedDate={data.dateRange.selectedDate}
          totalLogged={totalLogged}
          onAddEntry={() => setManualOpen(true)}
          onEntryUpdated={refreshData}
        />
        <aside className="swiss-side-stack">
          <DashboardReviewInbox items={data.reviewItems} onSynced={refreshData} />
          <RecentActivityPanel data={data} />
        </aside>
      </section>

      {manualOpen ? (
        <ManualEntryDialog
          data={data}
          onClose={() => setManualOpen(false)}
          onSynced={(nextData) => {
            setData(nextData);
            setManualOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

export function CurrentTimerPanel({
  data,
  onSynced
}: {
  data: BootstrapData;
  onSynced: (data: BootstrapData) => void;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const [timerError, setTimerError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [description, setDescription] = useState(data.activeEntry?.description ?? "");
  const [categoryId, setCategoryId] = useState(data.activeEntry?.categoryId ?? "");
  const [isEditingStartedAt, setIsEditingStartedAt] = useState(false);
  const [startedAtDraft, setStartedAtDraft] = useState(() => timeInputValue(data.activeEntry?.startedAt));
  const [startEditError, setStartEditError] = useState<string | null>(null);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const activeDetailsSyncRef = useRef("");
  const clearDraftAfterStopRef = useRef(false);
  const timerActionInFlightRef = useRef(false);
  const categoryMenuRef = useRef<HTMLDivElement | null>(null);
  const descriptionInputRef = useRef<HTMLInputElement | null>(null);
  const active = data.activeEntry;
  const [now, setNow] = useState(() =>
    active ? new Date(active.startedAt).getTime() + active.durationSeconds * 1000 : 0
  );
  const selectedCategory = data.categories.find((category) => category.id === categoryId) ?? null;
  const activeStartedAtMs = active ? new Date(active.startedAt).getTime() : 0;
  const activeBaselineNow = active ? activeStartedAtMs + active.durationSeconds * 1000 : 0;
  const effectiveNow = active ? Math.max(now, activeBaselineNow) : now;
  const durationSeconds = active
    ? Math.max(active.durationSeconds, Math.floor((effectiveNow - activeStartedAtMs) / 1000))
    : 0;
  const quickActions = useMemo(() => buildLearnedQuickActions(data), [data]);
  const activeAccent = active
    ? timeEntryAccentColor({
        ...active,
        categoryName: categoryId ? selectedCategory?.name ?? active.categoryName : active.categoryName,
        categoryColor: categoryId ? selectedCategory?.color ?? active.categoryColor : active.categoryColor,
        description: description.trim() || active.description
      })
    : undefined;

  useEffect(() => {
    if (!active?.id) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active?.id]);

  useEffect(() => {
    if (!categoryMenuOpen) return undefined;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!categoryMenuRef.current?.contains(event.target as Node)) {
        setCategoryMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setCategoryMenuOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [categoryMenuOpen]);

  useEffect(() => {
    if (!active) {
      activeDetailsSyncRef.current = "";
      if (clearDraftAfterStopRef.current) {
        clearDraftAfterStopRef.current = false;
        const emptyDraft = emptyTimerEntryDraft();
        setDescription(emptyDraft.description);
        setCategoryId(emptyDraft.categoryId);
      }
      return undefined;
    }

    const nextCategoryId = categoryId || null;
    const nextDescription = description.trim() || null;
    const nextSyncKey = JSON.stringify([
      active.id,
      nextCategoryId,
      nextDescription
    ]);

    if (
      nextCategoryId === active.categoryId &&
      nextDescription === (active.description ?? null)
    ) {
      activeDetailsSyncRef.current = nextSyncKey;
      return undefined;
    }

    if (activeDetailsSyncRef.current === nextSyncKey) return undefined;

    const syncHandle = window.setTimeout(async () => {
      activeDetailsSyncRef.current = nextSyncKey;
      await fetch(`/api/time-entries/${active.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: nextCategoryId,
          placeId: active.placeId,
          description: nextDescription
        })
      });
    }, 650);

    return () => window.clearTimeout(syncHandle);
  }, [active, categoryId, description]);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/bootstrap?date=${data.dateRange.selectedDate}`, {
      cache: "no-store"
    });
    if (response.ok) onSynced((await response.json()) as BootstrapData);
  }, [data.dateRange.selectedDate, onSynced]);

  const timerAction = useCallback(async (
    mode: "start" | "stop",
    override?: { categoryId?: string | null; description?: string | null }
  ) => {
    if (timerActionInFlightRef.current) return;

    const nextCategoryId =
      override && "categoryId" in override
        ? (override.categoryId ?? undefined)
        : categoryId || undefined;
    const nextDescription =
      override && "description" in override
        ? (override.description ?? undefined)
        : description.trim() || undefined;

    timerActionInFlightRef.current = true;
    setIsBusy(true);
    setTimerError(null);
    try {
      if (mode === "stop" && active) {
        const updateResponse = await fetch(`/api/time-entries/${active.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categoryId: nextCategoryId ?? null,
            placeId: active.placeId,
            description: nextDescription ?? null,
            startedAt: active.startedAt,
            stoppedAt: active.stoppedAt
          })
        });
        if (!updateResponse.ok) throw new Error(`Unable to save timer details: ${updateResponse.status}`);
      }

      const response = await fetch("/api/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "start"
            ? {
                mode,
                categoryId: nextCategoryId,
                description: nextDescription
              }
            : { mode }
        )
      });
      if (!response.ok) {
        let errorMessage = `Timer action failed: ${response.status}`;
        try {
          const payload = (await response.json()) as { error?: string };
          errorMessage = payload.error ?? errorMessage;
        } catch {
          // Deployed runtime failures may not return a JSON body.
        }
        throw new Error(errorMessage);
      }
      if (mode === "stop") clearDraftAfterStopRef.current = true;
      await refresh();
    } catch (error) {
      setTimerError(error instanceof Error ? error.message : "Unable to update the timer.");
    } finally {
      timerActionInFlightRef.current = false;
      setIsBusy(false);
    }
  }, [active, categoryId, description, refresh]);

  const deleteActiveTimer = useCallback(async () => {
    if (!active || timerActionInFlightRef.current) return;

    timerActionInFlightRef.current = true;
    setIsBusy(true);
    setTimerError(null);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/time-entries/${active.id}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        let errorMessage = `Unable to delete timer: ${response.status}`;
        try {
          const payload = (await response.json()) as { error?: string };
          errorMessage = payload.error ?? errorMessage;
        } catch {
          // Some deployed failures do not return a JSON body.
        }
        throw new Error(errorMessage);
      }
      setIsDeleteDialogOpen(false);
      clearDraftAfterStopRef.current = true;
      await refresh();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Unable to delete the running timer.");
    } finally {
      timerActionInFlightRef.current = false;
      setIsBusy(false);
    }
  }, [active, refresh]);

  async function startQuickAction(action: LearnedQuickAction) {
    setCategoryId(action.categoryId ?? "");
    setCategoryMenuOpen(false);
    await timerAction("start", {
      categoryId: action.categoryId,
      description: description.trim() || null
    });
  }

  function chooseCategory(nextCategoryId: string) {
    setCategoryId(nextCategoryId);
    setCategoryMenuOpen(false);
  }

  async function submitTimerEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shouldStartTimerFromEntrySubmit({ hasActiveTimer: Boolean(active), isBusy })) return;
    await timerAction("start");
  }

  function startTimerFromDescriptionKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!shouldStartTimerFromEntrySubmit({ hasActiveTimer: Boolean(active), isBusy })) return;
    void timerAction("start");
  }

  useEffect(() => {
    function focusTimerInput() {
      descriptionInputRef.current?.focus();
    }

    function toggleFromShortcut(event: Event) {
      const shortcutEvent = event as CustomEvent<TimerShortcutEventDetail>;
      shortcutEvent.detail.handled = true;
      if (isBusy || timerActionInFlightRef.current) return;

      if (active) {
        shortcutEvent.detail.action = timerAction("stop");
        return;
      }

      if (categoryId || description.trim()) {
        shortcutEvent.detail.action = timerAction("start");
        return;
      }

      focusTimerInput();
    }

    window.addEventListener(TIMER_FOCUS_EVENT, focusTimerInput);
    window.addEventListener(TIMER_SHORTCUT_EVENT, toggleFromShortcut);
    return () => {
      window.removeEventListener(TIMER_FOCUS_EVENT, focusTimerInput);
      window.removeEventListener(TIMER_SHORTCUT_EVENT, toggleFromShortcut);
    };
  }, [active, categoryId, description, isBusy, timerAction]);

  async function saveActiveStartTime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;

    const nextStart = dateWithTime(active.startedAt, startedAtDraft);
    if (!nextStart) {
      setStartEditError("Use a valid time, for example 17:15.");
      return;
    }

    const nowDate = new Date();
    if (nextStart.getTime() > nowDate.getTime()) {
      setStartEditError("Start time cannot be in the future.");
      return;
    }

    const nextCategoryId = categoryId || null;
    const nextDescription = description.trim() || null;

    setIsBusy(true);
    setTimerError(null);
    setStartEditError(null);
    try {
      const response = await fetch(`/api/time-entries/${active.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: nextCategoryId,
          placeId: active.placeId,
          description: nextDescription,
          startedAt: nextStart.toISOString(),
          stoppedAt: active.stoppedAt
        })
      });
      if (!response.ok) {
        let errorMessage = `Unable to update start time: ${response.status}`;
        try {
          const payload = (await response.json()) as { error?: string };
          errorMessage = payload.error ?? errorMessage;
        } catch {
          // Some runtime failures do not return a JSON body.
        }
        throw new Error(errorMessage);
      }

      activeDetailsSyncRef.current = JSON.stringify([
        active.id,
        nextCategoryId,
        nextDescription
      ]);
      setNow(Date.now());
      setIsEditingStartedAt(false);
      await refresh();
    } catch (error) {
      setStartEditError(error instanceof Error ? error.message : "Unable to update the start time.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section
      className="swiss-panel swiss-current-timer"
      style={activeAccent ? ({ "--timer-accent": activeAccent } as CSSProperties) : undefined}
    >
      <div className="swiss-timer-entrybar">
        <form className="swiss-timer-entry-form" onSubmit={submitTimerEntry}>
          <label className="swiss-work-input">
            <span>Task description</span>
            <input
              ref={descriptionInputRef}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onKeyDown={startTimerFromDescriptionKey}
              placeholder="Describe the task"
              aria-label="Task description"
            />
          </label>
          <div className="swiss-entrybar-actions">
            <div className="swiss-category-field" ref={categoryMenuRef}>
              <span>Category</span>
              <button
                className="swiss-category-trigger"
                type="button"
                aria-haspopup="listbox"
                aria-expanded={categoryMenuOpen}
                aria-label="Choose category"
                onClick={() => setCategoryMenuOpen((current) => !current)}
              >
                <span className="swiss-category-trigger-value">
                  <span
                    className={["swiss-focus-dot", selectedCategory ? "" : "is-muted"].filter(Boolean).join(" ")}
                    style={{
                      backgroundColor: selectedCategory
                        ? paletteColorFor(selectedCategory.color, selectedCategory.name)
                        : "transparent"
                    }}
                  />
                  <span>{selectedCategory?.name ?? "Uncategorized"}</span>
                </span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              {categoryMenuOpen ? (
                <div className="swiss-category-menu" role="listbox" aria-label="Categories">
                  <button
                    className={["swiss-category-option", "is-muted", !categoryId ? "is-selected" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    type="button"
                    role="option"
                    aria-selected={!categoryId}
                    onClick={() => chooseCategory("")}
                  >
                    <span className="swiss-focus-dot is-muted" />
                    <span>Uncategorized</span>
                    {!categoryId ? <CheckCircle2 size={14} aria-hidden="true" /> : null}
                  </button>
                  {data.categories.map((category) => {
                    const isSelected = category.id === categoryId;
                    return (
                      <button
                        key={category.id}
                        className={["swiss-category-option", isSelected ? "is-selected" : ""]
                          .filter(Boolean)
                          .join(" ")}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => chooseCategory(category.id)}
                      >
                        <span
                          className="swiss-focus-dot"
                          style={{ backgroundColor: paletteColorFor(category.color, category.name) }}
                        />
                        <span>{category.name}</span>
                        {isSelected ? <CheckCircle2 size={14} aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <span className="swiss-entrybar-clock">{formatClockDuration(durationSeconds)}</span>
            <div className="swiss-timer-control-group">
              <button
                className={["swiss-command-play", active ? "is-active" : ""].filter(Boolean).join(" ")}
                type={active ? "button" : "submit"}
                disabled={isBusy}
                aria-label={active ? "Stop timer" : "Start timer"}
                onClick={() => {
                  if (active) void timerAction("stop");
                }}
              >
                {active ? (
                  <>
                    <Square size={15} fill="currentColor" />
                    <span>Stop</span>
                  </>
                ) : (
                  <Play size={24} fill="currentColor" strokeWidth={0} />
                )}
              </button>
              {active ? (
                <button
                  className="swiss-command-delete"
                  type="button"
                  disabled={isBusy}
                  aria-label="Delete running timer"
                  title="Delete running timer"
                  onClick={() => {
                    setTimerError(null);
                    setDeleteError(null);
                    setIsDeleteDialogOpen(true);
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        </form>
        {active ? (
          <div className="swiss-active-timer-meta">
            {isEditingStartedAt ? (
              <form className="swiss-start-time-editor" onSubmit={saveActiveStartTime}>
                <label>
                  <span>Running since</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{2}:[0-9]{2}"
                    placeholder="17:15"
                    value={startedAtDraft}
                    onChange={(event) => setStartedAtDraft(event.target.value)}
                    aria-label="Active timer start time"
                  />
                </label>
                <button
                  className="swiss-start-time-save"
                  type="submit"
                  disabled={isBusy}
                  aria-label="Save active timer start time"
                >
                  <CheckCircle2 size={13} />
                  Save
                </button>
                <button
                  className="swiss-start-time-cancel"
                  type="button"
                  disabled={isBusy}
                  aria-label="Cancel editing active timer start time"
                  onClick={() => {
                    setStartedAtDraft(timeInputValue(active.startedAt));
                    setIsEditingStartedAt(false);
                    setStartEditError(null);
                  }}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                className="swiss-active-start-edit"
                type="button"
                aria-label={`Edit active timer start time. Running since ${formatTime(active.startedAt)}`}
                onClick={() => {
                  setStartedAtDraft(timeInputValue(active.startedAt));
                  setIsEditingStartedAt(true);
                  setStartEditError(null);
                }}
              >
                <span>Running since {formatTime(active.startedAt)}</span>
                <Edit3 size={13} />
              </button>
            )}
            {startEditError ? (
              <span className="swiss-start-time-error" role="alert">
                {startEditError}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {timerError ? <p className="swiss-inline-error">{timerError}</p> : null}

      {isDeleteDialogOpen ? (
        <DestructiveConfirmationDialog
          body="This removes the entry instead of stopping it."
          dialogId="delete-running-timer"
          error={deleteError}
          isBusy={isBusy}
          onCancel={() => setIsDeleteDialogOpen(false)}
          onConfirm={() => void deleteActiveTimer()}
          title="Delete running timer?"
        />
      ) : null}

      {quickActions.length > 0 ? (
        <div className="swiss-quick-actions-strip" aria-label="Frequent quick actions">
          <span>Frequent</span>
          <div>
            {quickActions.map((action) => (
              <button
                key={action.categoryId ?? action.label}
                type="button"
                disabled={isBusy}
                onClick={() => startQuickAction(action)}
              >
                <Play size={13} fill="currentColor" strokeWidth={0} />
                <i style={{ backgroundColor: action.color }} />
                <b>{action.label}</b>
                {action.detail ? <small>{action.detail}</small> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

type LearnedQuickAction = {
  categoryId: string | null;
  label: string;
  detail: string | null;
  color: string;
};

function buildLearnedQuickActions(data: BootstrapData): LearnedQuickAction[] {
  const categoriesById = new Map(data.categories.map((category) => [category.id, category]));
  const scored = new Map<string, { count: number; seconds: number; lastSeen: number }>();

  for (const entry of data.entries) {
    if (!entry.categoryId) continue;
    const current = scored.get(entry.categoryId) ?? { count: 0, seconds: 0, lastSeen: 0 };
    current.count += 1;
    current.seconds += entry.durationSeconds;
    current.lastSeen = Math.max(current.lastSeen, new Date(entry.startedAt).getTime());
    scored.set(entry.categoryId, current);
  }

  const learned = [...scored.entries()]
    .map(([categoryId, score]) => ({ categoryId, score, category: categoriesById.get(categoryId) }))
    .filter((item): item is { categoryId: string; score: { count: number; seconds: number; lastSeen: number }; category: NonNullable<ReturnType<typeof categoriesById.get>> } =>
      Boolean(item.category)
    )
    .sort((a, b) => b.score.count - a.score.count || b.score.lastSeen - a.score.lastSeen)
    .map(({ category }) => category);
  const pinned = data.categories.filter((category) => category.isPinned);
  const usedIds = new Set(pinned.map((category) => category.id));
  const learnedUnpinned = learned.filter((category) => !usedIds.has(category.id));
  for (const category of learnedUnpinned) usedIds.add(category.id);
  const fallback = data.categories.filter((category) => !usedIds.has(category.id));

  return [...pinned, ...learnedUnpinned, ...fallback].slice(0, 6).map((category) => ({
    categoryId: category.id,
    label: category.name,
    detail: category.isPinned ? "Pinned" : null,
    color: paletteColorFor(category.color, category.name)
  }));
}

function MetricCard({
  title,
  value,
  caption,
  goalLabel,
  progress,
  series
}: {
  title: string;
  value: string;
  caption: string;
  goalLabel: string;
  progress: number;
  series: number[];
}) {
  return (
    <section className="swiss-panel swiss-metric-card">
      <div className="swiss-panel-label">{title}</div>
      <div className="swiss-metric-value">{value}</div>
      <p>{caption}</p>
      <MiniBars values={series} />
      <div className="swiss-progress-row">
        <span>{goalLabel}</span>
        <span>{Math.round(Math.min(1, Math.max(0, progress)) * 100)}%</span>
      </div>
    </section>
  );
}

function ReviewSummaryCard({ items }: { items: BootstrapData["reviewItems"] }) {
  const openItems = items.filter((item) => item.status === "open");
  const needsClassification = openItems.filter((item) => !item.categoryName).length;
  const needsDuration = openItems.filter((item) => !item.suggestedStoppedAt).length;
  const overlapDetected = openItems.filter((item) => item.type.includes("overlap")).length;

  return (
    <section className="swiss-panel swiss-review-summary">
      <div className="swiss-panel-label">Review</div>
      <div className="swiss-metric-value">{openItems.length}</div>
      <p>Items</p>
      <div className="swiss-review-breakdown">
        <span>{needsClassification} Needs classification</span>
        <span>{needsDuration} Needs duration</span>
        <span>{overlapDetected} Overlap detected</span>
      </div>
      <Link href="/review">
        Open review inbox <ArrowRight size={15} />
      </Link>
    </section>
  );
}

function StreakCard({ series }: { series: number[] }) {
  const activeDays = series.filter((seconds) => seconds > 0).length;
  const labels = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <section className="swiss-panel swiss-streak-card">
      <div className="swiss-panel-label">Streak</div>
      <div className="swiss-metric-value">{activeDays}</div>
      <p>Days</p>
      <div className="swiss-streak-grid" aria-label="Tracked days this week">
        {labels.map((label, index) => (
          <span key={`${label}-${index}`} className={series[index] > 0 ? "is-active" : ""}>
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}

function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="swiss-mini-bars" aria-hidden="true">
      {values.map((value, index) => (
        <span key={`${index}-${value}`} style={{ height: `${Math.max(18, (value / max) * 58)}px` }} />
      ))}
    </div>
  );
}

function DayTimeline({
  dateLabel,
  data,
  entries,
  weekEntries,
  selectedDate,
  totalLogged,
  onAddEntry,
  onEntryUpdated
}: {
  dateLabel: string;
  data: BootstrapData;
  entries: TimeEntryRow[];
  weekEntries: TimeEntryRow[];
  selectedDate: string;
  totalLogged: number;
  onAddEntry: () => void;
  onEntryUpdated: () => Promise<void>;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [resizeDraft, setResizeDraft] = useState<ResizeDraft | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [resizeError, setResizeError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"day" | "week">("day");
  const [zoomLevel, setZoomLevel] = useState<TimelineZoom>("hour");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<EntryContextMenu | null>(null);
  const [editingEntry, setEditingEntry] = useState<TimeEntryRow | null>(null);
  const [dateJumpOpen, setDateJumpOpen] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const selectedDay = useMemo(() => parseDateKey(selectedDate), [selectedDate]);
  const weekDays = useMemo(() => getWeekDays(startOfWeek(selectedDay)), [selectedDay]);
  const zoom = timelineZooms[zoomLevel];
  const timelineStartMinutes = dayStartHour * 60;
  const timelineEndMinutes = (dayEndHour + 1) * 60;
  const timelineHeight = ((timelineEndMinutes - timelineStartMinutes) / 60) * zoom.pixelsPerHour;
  const visibleEntries = useMemo(
    () =>
      viewMode === "day"
        ? entries
        : weekEntries.filter((entry) =>
            weekDays.some((day) => dateKey(day) === dateKey(new Date(entry.startedAt)))
          ),
    [entries, viewMode, weekDays, weekEntries]
  );
  const sorted = [...visibleEntries].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );
  const axisMarks = useMemo(() => {
    const totalMinutes = timelineEndMinutes - timelineStartMinutes;
    const markCount = Math.floor(totalMinutes / zoom.intervalMinutes);
    return Array.from({ length: markCount + 1 }, (_, index) => {
      const minutes = timelineStartMinutes + index * zoom.intervalMinutes;
      const top = ((minutes - timelineStartMinutes) / 60) * zoom.pixelsPerHour;
      return {
        key: `${minutes}`,
        label: formatAxisMinutes(minutes),
        labelTop: clampAxisLabelTop(top, timelineHeight),
        major: minutes % 60 === 0,
        top
      };
    });
  }, [timelineEndMinutes, timelineHeight, timelineStartMinutes, zoom.intervalMinutes, zoom.pixelsPerHour]);
  const isToday = viewMode === "day" && selectedDate === dateKey(new Date());
  const now = new Date();
  const currentTop =
    ((now.getHours() * 60 + now.getMinutes() - dayStartHour * 60) / 60) * zoom.pixelsPerHour;
  const displayedTotal =
    viewMode === "day" ? totalLogged : sorted.reduce((sum, entry) => sum + entry.durationSeconds, 0);
  const averageDuration = sorted.length > 0 ? displayedTotal / sorted.length : 0;
  const zoomKeys = Object.keys(timelineZooms) as TimelineZoom[];
  const zoomIndex = zoomKeys.indexOf(zoomLevel);
  const titlePrefix = viewMode === "day" ? "Today" : "Week";
  const headerLabel =
    viewMode === "day"
      ? dateLabel
      : `${formatShortDate(weekDays[0])} - ${formatShortDate(weekDays[6])}`;

  const deleteEntry = useCallback(
    async (entryId: string) => {
      setResizeError(null);
      const response = await fetch(`/api/time-entries/${entryId}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        setResizeError("Unable to delete the selected time block.");
        return;
      }
      setSelectedEntryId(null);
      setContextMenu(null);
      await onEntryUpdated();
    },
    [onEntryUpdated]
  );

  useEffect(() => {
    function deleteSelected(event: KeyboardEvent) {
      if (!selectedEntryId || isTypingTarget(event.target)) return;
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      event.preventDefault();
      void deleteEntry(selectedEntryId);
    }

    window.addEventListener("keydown", deleteSelected);
    return () => window.removeEventListener("keydown", deleteSelected);
  }, [deleteEntry, selectedEntryId]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [contextMenu]);

  async function saveResize(entry: TimeEntryRow, draft: ResizeDraft) {
    const response = await fetch(`/api/time-entries/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId: entry.categoryId,
        placeId: entry.placeId,
        description: entry.description,
        startedAt: draft.startedAt,
        stoppedAt: draft.stoppedAt
      })
    });

    if (!response.ok) {
      throw new Error(`Unable to resize entry: ${response.status}`);
    }

    await onEntryUpdated();
  }

  function startResize(
    entry: TimeEntryRow,
    edge: ResizeEdge,
    event: ReactPointerEvent<HTMLButtonElement>
  ) {
    if (!entry.stoppedAt || !canvasRef.current) return;
    event.preventDefault();
    event.stopPropagation();

    const canvasRect = canvasRef.current.getBoundingClientRect();
    const originalStart = minutesFromDate(new Date(entry.startedAt));
    const originalEnd = minutesFromDate(new Date(entry.stoppedAt));
    const entryDate = dateKey(new Date(entry.startedAt));
    const ranges = sorted
      .filter(
        (candidate) =>
          candidate.id !== entry.id &&
          candidate.stoppedAt &&
          dateKey(new Date(candidate.startedAt)) === entryDate
      )
      .map((candidate) => ({
        start: minutesFromDate(new Date(candidate.startedAt)),
        end: minutesFromDate(new Date(candidate.stoppedAt as string))
      }))
      .sort((a, b) => a.start - b.start);
    const previousEnd = Math.max(
      timelineStartMinutes,
      ...ranges.filter((range) => range.end <= originalStart).map((range) => range.end)
    );
    const nextStart = Math.min(
      timelineEndMinutes,
      ...ranges.filter((range) => range.start >= originalEnd).map((range) => range.start)
    );
    const startClientY = event.clientY;
    let finalDraft: ResizeDraft | null = null;
    let hasStartedResize = false;

    event.currentTarget.setPointerCapture(event.pointerId);

    const updateDraft = (clientY: number) => {
      const relativeY = clientY - canvasRect.top;
      const rawMinutes = timelineStartMinutes + (relativeY / zoom.pixelsPerHour) * 60;
      const snappedMinutes = clamp(
        snapMinutes(rawMinutes),
        timelineStartMinutes,
        timelineEndMinutes
      );
      const nextStartMinutes =
        edge === "start"
          ? clamp(snappedMinutes, previousEnd, originalEnd - minEntryMinutes)
          : originalStart;
      const nextEndMinutes =
        edge === "end"
          ? clamp(snappedMinutes, originalStart + minEntryMinutes, nextStart)
          : originalEnd;
      finalDraft = {
        entryId: entry.id,
        startedAt: isoForDateMinutes(entryDate, nextStartMinutes),
        stoppedAt: isoForDateMinutes(entryDate, nextEndMinutes)
      };
      setResizeDraft(finalDraft);
    };

    const beginResize = () => {
      if (hasStartedResize) return;
      hasStartedResize = true;
      setResizingId(entry.id);
      setResizeError(null);
    };

    const stopResize = async () => {
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", cancelResize);
      setResizingId(null);

      if (!hasStartedResize || !finalDraft) {
        setResizeDraft(null);
        return;
      }

      try {
        await saveResize(entry, finalDraft);
      } catch {
        setResizeError("Unable to save the resized time block.");
      } finally {
        setResizeDraft(null);
      }
    };

    const cancelResize = () => {
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", cancelResize);
      setResizingId(null);
      setResizeDraft(null);
    };

    const moveResize = (moveEvent: PointerEvent) => {
      if (!hasStartedResize) {
        if (Math.abs(moveEvent.clientY - startClientY) < resizeDragThresholdPx) return;
        beginResize();
      }
      updateDraft(moveEvent.clientY);
    };

    window.addEventListener("pointermove", moveResize);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", cancelResize, { once: true });
  }

  return (
    <section className="swiss-panel swiss-day-panel">
      <div className="swiss-day-header">
        <h2>
          {titlePrefix} · {headerLabel}
        </h2>
        <div>
          <span className="swiss-view-switch" aria-label="Timeline view">
            <button
              type="button"
              className={viewMode === "day" ? "is-selected" : ""}
              onClick={() => setViewMode("day")}
            >
              Day
            </button>
            <button
              type="button"
              className={viewMode === "week" ? "is-selected" : ""}
              onClick={() => setViewMode("week")}
            >
              Week
            </button>
          </span>
          <span className="swiss-zoom-control" aria-label="Timeline zoom">
            <button
              type="button"
              disabled={zoomIndex === 0}
              aria-label="Zoom out"
              onClick={() => setZoomLevel(zoomKeys[Math.max(0, zoomIndex - 1)])}
            >
              -
            </button>
            <b>{zoom.label}</b>
            <button
              type="button"
              disabled={zoomIndex === zoomKeys.length - 1}
              aria-label="Zoom in"
              onClick={() => setZoomLevel(zoomKeys[Math.min(zoomKeys.length - 1, zoomIndex + 1)])}
            >
              +
            </button>
          </span>
          <span className="swiss-date-tools">
            <button
              type="button"
              aria-label="Jump to date"
              className={dateJumpOpen ? "is-selected" : ""}
              onClick={() => setDateJumpOpen((current) => !current)}
            >
              <CalendarDays size={16} />
            </button>
            {dateJumpOpen ? (
              <span className="swiss-date-jump">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => {
                    const nextDate = event.target.value;
                    if (nextDate) window.location.assign(`/?date=${nextDate}`);
                  }}
                />
              </span>
            ) : null}
          </span>
          <button
            type="button"
            aria-label="Toggle timeline summary"
            className={showSummary ? "is-selected" : ""}
            onClick={() => setShowSummary((current) => !current)}
          >
            <BarChart3 size={16} />
          </button>
        </div>
      </div>
      {viewMode === "week" ? (
        <div className="swiss-week-strip">
          {weekDays.map((day) => (
            <span key={dateKey(day)}>
              <b>{new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(day)}</b>
              {new Intl.DateTimeFormat("en-GB", { day: "2-digit" }).format(day)}
            </span>
          ))}
        </div>
      ) : null}
      {showSummary ? (
        <div className="swiss-timeline-summary">
          <span>
            <small>Blocks</small>
            <b>{sorted.length}</b>
          </span>
          <span>
            <small>Total</small>
            <b>{formatDuration(displayedTotal)}</b>
          </span>
          <span>
            <small>Average</small>
            <b>{formatDuration(averageDuration)}</b>
          </span>
        </div>
      ) : null}
      <div className="swiss-timeline-scroll">
        <div className="swiss-timeline-shell">
          <div className="swiss-time-axis" style={{ minHeight: timelineHeight }}>
            {axisMarks.map((mark) => (
              <div key={mark.key}>
                <span
                  aria-hidden="true"
                  className={mark.major ? "is-major swiss-time-axis-line" : "is-minor swiss-time-axis-line"}
                  style={{ top: mark.top }}
                />
                <span
                  className={mark.major ? "is-major swiss-time-axis-label" : "is-minor swiss-time-axis-label"}
                  style={{ top: mark.labelTop }}
                >
                  {mark.label}
                </span>
              </div>
            ))}
          </div>
          <div
            ref={canvasRef}
            className={["swiss-timeline-canvas", viewMode === "week" ? "is-week" : ""]
              .filter(Boolean)
              .join(" ")}
            style={{ minHeight: timelineHeight }}
          >
            {viewMode === "week" ? (
              <div className="swiss-week-column-grid" aria-hidden="true">
                {weekDays.map((day) => (
                  <span key={dateKey(day)} />
                ))}
              </div>
            ) : null}
            {axisMarks.map((mark) => (
              <span
                key={mark.key}
                className={["swiss-hour-line", mark.major ? "is-major" : "is-minor"].join(" ")}
                style={{ top: mark.top }}
              />
            ))}
            {isToday && currentTop >= 0 && currentTop <= timelineHeight ? (
              <div className="swiss-now-line" style={{ top: currentTop }}>
                <span />
              </div>
            ) : null}
            {sorted.map((entry) => {
              const dayIndex =
                viewMode === "week"
                  ? weekDays.findIndex((day) => dateKey(day) === dateKey(new Date(entry.startedAt)))
                  : 0;
              if (dayIndex < 0) return null;
              return (
                <TimelineBlock
                  key={entry.id}
                  columnCount={viewMode === "week" ? weekDays.length : 1}
                  dayIndex={dayIndex}
                  draft={resizeDraft?.entryId === entry.id ? resizeDraft : null}
                  entry={entry}
                  isResizing={resizingId === entry.id}
                  isSelected={selectedEntryId === entry.id}
                  pixelsPerHour={zoom.pixelsPerHour}
                  viewMode={viewMode}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSelectedEntryId(entry.id);
                    setContextMenu({
                      entry,
                      x: event.clientX,
                      y: event.clientY
                    });
                  }}
                  onEdit={() => setEditingEntry(entry)}
                  onResizeStart={startResize}
                  onSelect={() => setSelectedEntryId(entry.id)}
                />
              );
            })}
            {sorted.length === 0 ? (
              <div className="swiss-empty-timeline">
                <Clock3 size={18} />
                No entries for this {viewMode}.
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="swiss-day-footer">
        <button type="button" onClick={onAddEntry}>
          <Plus size={17} />
          Add time block
        </button>
        <span>Total logged: {formatDuration(displayedTotal)}</span>
        <button type="button" onClick={() => setShowSummary((current) => !current)}>
          {showSummary ? "Hide summary" : "Show summary"} <ChevronDown size={14} />
        </button>
      </div>
      {contextMenu ? (
        <div
          className="swiss-entry-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => setEditingEntry(contextMenu.entry)}>
            <Edit3 size={15} />
            Edit block
          </button>
          <button type="button" role="menuitem" onClick={() => void deleteEntry(contextMenu.entry.id)}>
            <Trash2 size={15} />
            Delete block
          </button>
        </div>
      ) : null}
      {editingEntry ? (
        <EditTimeEntryDialog
          categories={data.categories}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSaved={async () => {
            setEditingEntry(null);
            await onEntryUpdated();
          }}
          places={data.places}
        />
      ) : null}
      {resizeError ? <p className="swiss-resize-error">{resizeError}</p> : null}
    </section>
  );
}

type EntryContextMenu = {
  entry: TimeEntryRow;
  x: number;
  y: number;
};

type ResizeEdge = "start" | "end";

type ResizeDraft = {
  entryId: string;
  startedAt: string;
  stoppedAt: string;
};

function TimelineBlock({
  columnCount,
  dayIndex,
  draft,
  entry,
  isResizing,
  isSelected,
  pixelsPerHour,
  viewMode,
  onContextMenu,
  onEdit,
  onResizeStart,
  onSelect
}: {
  columnCount: number;
  dayIndex: number;
  draft: ResizeDraft | null;
  entry: TimeEntryRow;
  isResizing: boolean;
  isSelected: boolean;
  pixelsPerHour: number;
  viewMode: "day" | "week";
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onEdit: () => void;
  onResizeStart: (
    entry: TimeEntryRow,
    edge: ResizeEdge,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => void;
  onSelect: () => void;
}) {
  const start = new Date(draft?.startedAt ?? entry.startedAt);
  const end = draft?.stoppedAt
    ? new Date(draft.stoppedAt)
    : entry.stoppedAt
      ? new Date(entry.stoppedAt)
      : projectedEntryEnd(entry);
  const top =
    ((start.getHours() * 60 + start.getMinutes() - dayStartHour * 60) / 60) * pixelsPerHour;
  const rawHeight = ((end.getTime() - start.getTime()) / 3_600_000) * pixelsPerHour;
  const height = Math.max(minimumTimeBlockHeight(pixelsPerHour), rawHeight);
  const color = pastelFor(entry);
  const durationSeconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  const density = getTimeBlockDensity({ durationSeconds, height });
  const detailsLabel = timelineBlockDetailsLabel(entry, start, end, durationSeconds);
  const weekLeft = (dayIndex / columnCount) * 100;
  const weekWidth = 100 / columnCount;
  const positionStyle: CSSProperties =
    viewMode === "week"
      ? {
          left: `calc(${weekLeft}% + 5px)`,
          right: "auto",
          width: `calc(${weekWidth}% - 10px)`
        }
      : {};

  return (
    <article
      tabIndex={0}
      role="button"
      aria-label={detailsLabel}
      title={detailsLabel}
      className={[
        "swiss-time-block",
        isResizing ? "is-resizing" : "",
        isSelected ? "is-selected" : "",
        entry.stoppedAt ? "" : "is-running",
        ...timeBlockDensityClassNames(density),
        viewMode === "week" ? "is-compact" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onDoubleClick={(event) => {
        event.preventDefault();
        onEdit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") onEdit();
      }}
      onMouseDown={(event) => {
        if (event.detail > 1) event.preventDefault();
      }}
      style={{
        top: Math.round(Math.max(0, top)),
        height: Math.round(height),
        backgroundColor: color.background,
        borderColor: color.border,
        color: color.text,
        ...positionStyle
      }}
    >
      {entry.stoppedAt ? (
        <>
          <button
            type="button"
            className="swiss-resize-handle top"
            aria-label={`Resize start of ${timeEntryTitle(entry)}`}
            onDoubleClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => onResizeStart(entry, "start", event)}
          />
          <button
            type="button"
            className="swiss-resize-handle bottom"
            aria-label={`Resize end of ${timeEntryTitle(entry)}`}
            onDoubleClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => onResizeStart(entry, "end", event)}
          />
        </>
      ) : null}
      {density.showTitle ? (
        <div>
          <strong>{timeEntryTitle(entry)}</strong>
          {density.showContext ? <span>{timeEntryContextLabel(entry)}</span> : null}
        </div>
      ) : null}
      {density.showDuration ? (
        <div>
          {entry.stoppedAt ? <EntryIcon entry={entry} /> : null}
          <b>{formatDuration(durationSeconds)}</b>
        </div>
      ) : null}
    </article>
  );
}

function timelineBlockDetailsLabel(
  entry: TimeEntryRow,
  start: Date,
  end: Date,
  durationSeconds: number
) {
  const timeRange = `${formatTime(start)} - ${entry.stoppedAt ? formatTime(end) : "now"}`;
  const durationLabel = entry.stoppedAt
    ? formatDuration(durationSeconds)
    : `Running, ${formatDuration(durationSeconds)}`;
  return [timeEntryTitle(entry), timeEntryContextLabel(entry), timeRange, durationLabel].join(". ");
}

function DashboardReviewInbox({
  items,
  onSynced
}: {
  items: BootstrapData["reviewItems"];
  onSynced: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const openItems = items.filter((item) => item.status === "open").slice(0, 5);

  async function accept(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/review/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" })
      });
      await onSynced();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="swiss-panel swiss-list-panel">
      <div className="swiss-list-header">
        <h2>Review inbox</h2>
        <span>{items.filter((item) => item.status === "open").length} items</span>
      </div>
      <div className="swiss-review-list">
        {openItems.map((item) => (
          <button key={item.id} type="button" className="swiss-review-row" onClick={() => accept(item.id)}>
            <span className="swiss-checkbox">{busyId === item.id ? <CheckCircle2 size={13} /> : null}</span>
            <HelpCircle size={20} />
            <span>
              <strong>{item.title}</strong>
              <small>
                {item.categoryName ?? formatEventLabel(item.eventType ?? item.type)} ·{" "}
                {item.suggestedStartedAt ? formatTime(item.suggestedStartedAt) : "Needs time"}
              </small>
            </span>
            <b>
              {item.suggestedStartedAt && item.suggestedStoppedAt
                ? formatDuration(
                    Math.round(
                      (new Date(item.suggestedStoppedAt).getTime() -
                        new Date(item.suggestedStartedAt).getTime()) /
                        1000
                    )
                  )
                : "—"}
            </b>
            <ArrowRight size={16} />
          </button>
        ))}
        {openItems.length === 0 ? <p className="swiss-empty-list">No open review items.</p> : null}
      </div>
      <Link href="/review" className="swiss-panel-link">
        Open full review inbox <ArrowRight size={15} />
      </Link>
    </section>
  );
}

function RecentActivityPanel({ data }: { data: BootstrapData }) {
  return (
    <section className="swiss-panel swiss-list-panel">
      <div className="swiss-list-header">
        <h2>Recent activity</h2>
        <Link href="/entries">View all</Link>
      </div>
      <div className="swiss-activity-list">
        {data.activityEvents.slice(0, 5).map((event) => {
          const Icon = event.eventType.includes("timer")
            ? Clock3
            : event.eventType.includes("review")
              ? CheckCircle2
              : event.eventType.includes("delete")
                ? Trash2
                : Edit3;
          return (
            <div key={event.id} className="swiss-activity-row">
              <Icon size={22} />
              <span>
                <strong>{event.categoryName ?? event.placeName ?? formatEventLabel(event.eventType)}</strong>
                <small>
                  {[formatEventLabel(event.eventType), event.placeName, formatSourceLabel(event.source)]
                    .filter((part, index, parts) => part && parts.indexOf(part) === index)
                    .join(" · ")}
                </small>
              </span>
              <time>{formatTime(event.occurredAt)}</time>
            </div>
          );
        })}
        {data.activityEvents.length === 0 ? <p className="swiss-empty-list">No recent activity.</p> : null}
      </div>
    </section>
  );
}

function ManualEntryDialog({
  data,
  onClose,
  onSynced
}: {
  data: BootstrapData;
  onClose: () => void;
  onSynced: (data: BootstrapData) => void;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const selectedDate = parseDateKey(data.dateRange.selectedDate);
  selectedDate.setHours(9, 0, 0, 0);
  const defaultStart = dateTimeLocal(selectedDate);
  selectedDate.setHours(10, 0, 0, 0);
  const defaultStop = dateTimeLocal(selectedDate);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const formData = new FormData(event.currentTarget);
    const startedAt = dateTimeLocalInputToIso(formData.get("startedAt"));
    const stoppedAt = dateTimeLocalInputToIso(formData.get("stoppedAt"));

    if (!startedAt || !stoppedAt) {
      setFormError("Use valid start and finish times.");
      return;
    }

    if (new Date(startedAt).getTime() >= new Date(stoppedAt).getTime()) {
      setFormError("Finish time must be after start time.");
      return;
    }

    setIsBusy(true);
    try {
      const response = await fetch("/api/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "manual",
          categoryId: formData.get("categoryId") || undefined,
          placeId: formData.get("placeId") || undefined,
          description: formData.get("description") || undefined,
          startedAt,
          stoppedAt
        })
      });
      if (!response.ok) {
        let errorMessage = `Unable to add entry: ${response.status}`;
        try {
          const payload = (await response.json()) as { error?: string };
          errorMessage = payload.error ?? errorMessage;
        } catch {
          // Runtime failures may not return JSON.
        }
        throw new Error(errorMessage);
      }
      const refresh = await fetch(`/api/bootstrap?date=${data.dateRange.selectedDate}`, {
        cache: "no-store"
      });
      if (refresh.ok) onSynced((await refresh.json()) as BootstrapData);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to add this time block.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="swiss-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="swiss-dialog" role="dialog" aria-modal="true" aria-labelledby="manual-entry-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="swiss-dialog-header">
          <h2 id="manual-entry-title">Add time block</h2>
          <button type="button" onClick={onClose} aria-label="Close add time block">
            x
          </button>
        </div>
        <form className="swiss-form-grid" onSubmit={submit}>
          <label>
            Category
            <select name="categoryId" defaultValue="">
              <option value="">Uncategorized</option>
              {data.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Place
            <select name="placeId" defaultValue="">
              <option value="">No place</option>
              {data.places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          </label>
          <label className="swiss-form-wide">
            Description
            <input name="description" placeholder="What are you working on?" />
          </label>
          <label>
            Start
            <input type="datetime-local" name="startedAt" defaultValue={defaultStart} required />
          </label>
          <label>
            Finish
            <input type="datetime-local" name="stoppedAt" defaultValue={defaultStop} required />
          </label>
          {formError ? (
            <p className="swiss-inline-error swiss-form-wide" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="swiss-dialog-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="swiss-primary-action" disabled={isBusy}>
              Add time block
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function pastelFor(entry: TimeEntryRow) {
  const accent = timeEntryAccentColor(entry);
  return {
    background: `color-mix(in srgb, ${accent} 58%, var(--surface))`,
    border: accent,
    text: "var(--block-text)"
  };
}

function EntryIcon({ entry }: { entry: TimeEntryRow }) {
  const label = `${entry.description ?? ""} ${entry.categoryName ?? ""} ${entry.placeName ?? ""}`.toLowerCase();
  if (label.includes("gym") || label.includes("walk")) return <Users size={16} />;
  if (label.includes("lunch") || label.includes("food")) return <Utensils size={16} />;
  if (label.includes("town") || label.includes("place")) return <MapPin size={16} />;
  if (label.includes("admin")) return <Laptop size={16} />;
  return <Clock3 size={16} />;
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  next.setDate(next.getDate() - mondayOffset);
  next.setHours(0, 0, 0, 0);
  return next;
}

function getWeekDays(start: Date) {
  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(start);
    next.setDate(start.getDate() + index);
    return next;
  });
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short"
  }).format(date);
}

function formatAxisMinutes(minutes: number) {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function clampAxisLabelTop(top: number, height: number) {
  return Math.min(Math.max(0, height - timelineAxisLabelHeight), Math.max(0, top - timelineAxisLabelHeight / 2));
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

function minutesFromDate(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function snapMinutes(value: number) {
  return Math.round(value / resizeSnapMinutes) * resizeSnapMinutes;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isoForDateMinutes(dateValue: string, minutes: number) {
  const iso = dateTimeLocalInputToIso(`${dateValue}T${formatAxisMinutes(minutes)}`);
  if (!iso) throw new Error("Invalid timeline time.");
  return iso;
}

function timeInputValue(value?: string | Date | null) {
  const date = value ? new Date(value) : new Date();
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function dateWithTime(dateValue: string | Date, timeValue: string) {
  const [hoursText, minutesText] = timeValue.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function projectedEntryEnd(entry: TimeEntryRow) {
  return new Date(new Date(entry.startedAt).getTime() + entry.durationSeconds * 1000);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}
