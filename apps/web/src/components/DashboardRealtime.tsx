"use client";

import Link from "next/link";
import type {
  CSSProperties,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { paletteColorFor } from "@dayframe/shared";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Edit3,
  Folder,
  HelpCircle,
  Laptop,
  MapPin,
  Play,
  Plus,
  Search,
  Square,
  Tag,
  Trash2,
  Users,
  Utensils
} from "lucide-react";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";
import {
  dateTimeLocal,
  formatClockDuration,
  formatDuration,
  formatEventLabel,
  formatSourceLabel,
  formatTime
} from "@/lib/format";

const dayStartHour = 7;
const dayEndHour = 21;
const resizeSnapMinutes = 15;
const minEntryMinutes = 15;
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
  const [now, setNow] = useState(() => Date.now());
  const [isBusy, setIsBusy] = useState(false);
  const [description, setDescription] = useState(data.activeEntry?.description ?? "");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectId, setProjectId] = useState(data.activeEntry?.projectId ?? data.projects[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(
    data.activeEntry?.categoryId ?? data.projects[0]?.categoryId ?? data.categories[0]?.id ?? ""
  );
  const activeDetailsSyncRef = useRef("");
  const active = data.activeEntry;
  const selectedProject = data.projects.find((project) => project.id === projectId) ?? null;
  const selectedCategory = data.categories.find((category) => category.id === categoryId) ?? null;
  const durationSeconds = active
    ? Math.max(active.durationSeconds, Math.floor((now - new Date(active.startedAt).getTime()) / 1000))
    : 0;
  const filteredProjects = data.projects.filter((project) => {
    const query = projectQuery.trim().toLowerCase();
    if (!query) return true;
    return `${project.name} ${project.clientName ?? ""} ${project.categoryName ?? ""}`.toLowerCase().includes(query);
  });
  const groupedProjects = filteredProjects.reduce((groups, project) => {
    const group = project.clientName ?? "No client";
    const existing = groups.get(group) ?? [];
    existing.push(project);
    groups.set(group, existing);
    return groups;
  }, new Map<string, typeof data.projects>());
  const quickActions = useMemo(() => buildLearnedQuickActions(data), [data]);

  useEffect(() => {
    if (!active) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);

  useEffect(() => {
    if (!active) {
      activeDetailsSyncRef.current = "";
      return undefined;
    }

    const nextProjectId = selectedProject?.id ?? active.projectId;
    const nextCategoryId = categoryId || null;
    const nextDescription = description.trim() || null;
    const nextSyncKey = JSON.stringify([
      active.id,
      nextProjectId,
      nextCategoryId,
      nextDescription
    ]);

    if (
      nextProjectId === active.projectId &&
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
          projectId: nextProjectId,
          categoryId: nextCategoryId,
          placeId: active.placeId,
          description: nextDescription,
          startedAt: active.startedAt,
          stoppedAt: active.stoppedAt
        })
      });
    }, 650);

    return () => window.clearTimeout(syncHandle);
  }, [active, categoryId, description, selectedProject?.id]);

  async function refresh() {
    const response = await fetch(`/api/bootstrap?date=${data.dateRange.selectedDate}`, {
      cache: "no-store"
    });
    if (response.ok) onSynced((await response.json()) as BootstrapData);
  }

  async function timerAction(
    mode: "start" | "stop",
    override?: { projectId?: string | null; categoryId?: string | null; description?: string | null }
  ) {
    const nextProjectId = override?.projectId ?? selectedProject?.id;
    const nextCategoryId =
      override && "categoryId" in override
        ? (override.categoryId ?? undefined)
        : categoryId || selectedProject?.categoryId || undefined;
    const nextDescription =
      override && "description" in override
        ? (override.description ?? undefined)
        : description.trim() || undefined;

    if (mode === "start" && !nextProjectId) return;
    setIsBusy(true);
    try {
      const response = await fetch("/api/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "start"
            ? {
                mode,
                projectId: nextProjectId,
                categoryId: nextCategoryId,
                description: nextDescription
              }
            : { mode }
        )
      });
      if (!response.ok) throw new Error(`Timer action failed: ${response.status}`);
      await refresh();
    } finally {
      setIsBusy(false);
    }
  }

  function selectProject(nextProjectId: string) {
    const nextProject = data.projects.find((project) => project.id === nextProjectId) ?? null;
    setProjectId(nextProjectId);
    if (nextProject?.categoryId) setCategoryId(nextProject.categoryId);
    setProjectPickerOpen(false);
    setProjectQuery("");
  }

  async function startQuickAction(action: LearnedQuickAction) {
    setProjectId(action.projectId);
    setCategoryId(action.categoryId ?? "");
    await timerAction("start", {
      projectId: action.projectId,
      categoryId: action.categoryId,
      description: description.trim() || null
    });
  }

  return (
    <section className="swiss-panel swiss-current-timer">
      <div className="swiss-timer-entrybar">
        <label className="swiss-work-input">
          <span>What are you working on?</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe the task"
            aria-label="What are you working on?"
          />
        </label>
        <div className="swiss-entrybar-actions">
          <button
            type="button"
            className="swiss-project-trigger"
            aria-expanded={projectPickerOpen}
            onClick={() => setProjectPickerOpen((current) => !current)}
          >
            <Folder size={17} />
            <span>{selectedProject?.name ?? "No project"}</span>
            <ChevronDown size={14} />
          </button>
          <label className="swiss-category-trigger">
            <Tag size={16} />
            <span
              className="swiss-focus-dot"
              style={{
                backgroundColor: paletteColorFor(selectedCategory?.color, selectedCategory?.name ?? "Focus")
              }}
            />
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">No category</option>
              {data.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <span className="swiss-entrybar-clock">{formatClockDuration(durationSeconds)}</span>
          <button
            className="swiss-command-play"
            type="button"
            disabled={isBusy || (!active && !selectedProject?.id)}
            aria-label={active ? "Stop timer" : "Start timer"}
            onClick={() => timerAction(active ? "stop" : "start")}
          >
            {active ? <Square size={16} fill="currentColor" /> : <Play size={24} fill="currentColor" strokeWidth={0} />}
          </button>
        </div>
        {projectPickerOpen ? (
          <div className="swiss-project-picker" role="dialog" aria-label="Choose project">
            <label className="swiss-project-search">
              <Search size={16} />
              <input
                autoFocus
                value={projectQuery}
                onChange={(event) => setProjectQuery(event.target.value)}
                placeholder="Search by project, task or client"
              />
            </label>
            <button
              type="button"
              className="swiss-project-option muted"
              onClick={() => {
                setProjectId("");
                setProjectPickerOpen(false);
              }}
            >
              <span className="swiss-color-dot muted" />
              No project
            </button>
            {[...groupedProjects.entries()].map(([clientName, projects]) => (
              <div key={clientName} className="swiss-project-group">
                <strong>{clientName}</strong>
                {projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className={project.id === projectId ? "swiss-project-option is-selected" : "swiss-project-option"}
                    onClick={() => selectProject(project.id)}
                  >
                    <span
                      className="swiss-color-dot"
                      style={{ backgroundColor: paletteColorFor(project.color, project.name) }}
                    />
                    <span>
                      {project.name}
                      {project.categoryName ? <small>{project.categoryName}</small> : null}
                    </span>
                  </button>
                ))}
              </div>
            ))}
            <Link href="/projects" className="swiss-create-project">
              <Plus size={15} />
              Create a new project
            </Link>
          </div>
        ) : null}
      </div>

      {active ? (
        <div className="swiss-timer-actions">
          <button
            className="swiss-primary-action"
            type="button"
            disabled={isBusy}
            onClick={() => timerAction("stop")}
          >
            <Square size={13} fill="currentColor" />
            Stop
          </button>
        </div>
      ) : null}

      {quickActions.length > 0 ? (
        <div className="swiss-quick-actions-strip" aria-label="Frequent quick actions">
          <span>Frequent</span>
          <div>
            {quickActions.map((action) => (
              <button
                key={action.projectId}
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
  projectId: string;
  categoryId: string | null;
  label: string;
  detail: string | null;
  color: string;
};

function buildLearnedQuickActions(data: BootstrapData): LearnedQuickAction[] {
  const projectsById = new Map(data.projects.map((project) => [project.id, project]));
  const scored = new Map<string, { count: number; seconds: number; lastSeen: number }>();

  for (const entry of data.entries) {
    if (!entry.projectId) continue;
    const current = scored.get(entry.projectId) ?? { count: 0, seconds: 0, lastSeen: 0 };
    current.count += 1;
    current.seconds += entry.durationSeconds;
    current.lastSeen = Math.max(current.lastSeen, new Date(entry.startedAt).getTime());
    scored.set(entry.projectId, current);
  }

  const learned = [...scored.entries()]
    .map(([projectId, score]) => ({ projectId, score, project: projectsById.get(projectId) }))
    .filter((item): item is { projectId: string; score: { count: number; seconds: number; lastSeen: number }; project: NonNullable<ReturnType<typeof projectsById.get>> } =>
      Boolean(item.project)
    )
    .sort((a, b) => b.score.count - a.score.count || b.score.lastSeen - a.score.lastSeen)
    .map(({ project }) => project);
  const fallback = data.projects.filter((project) => !scored.has(project.id));

  return [...learned, ...fallback].slice(0, 6).map((project) => ({
    projectId: project.id,
    categoryId: project.categoryId,
    label: project.name,
    detail: project.clientName ?? project.categoryName,
    color: paletteColorFor(project.color, project.name)
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
  const needsClassification = openItems.filter((item) => !item.projectName).length;
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
      return {
        key: `${minutes}`,
        label: formatAxisMinutes(minutes),
        major: minutes % 60 === 0,
        top: ((minutes - timelineStartMinutes) / 60) * zoom.pixelsPerHour
      };
    });
  }, [timelineEndMinutes, timelineStartMinutes, zoom.intervalMinutes, zoom.pixelsPerHour]);
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
        projectId: entry.projectId,
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
    let finalDraft: ResizeDraft | null = null;

    setResizingId(entry.id);
    setResizeError(null);
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

    const stopResize = async () => {
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", cancelResize);
      setResizingId(null);

      if (!finalDraft) {
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

    const moveResize = (moveEvent: PointerEvent) => updateDraft(moveEvent.clientY);

    updateDraft(event.clientY);
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
              <div
                key={mark.key}
                className={mark.major ? "is-major" : "is-minor"}
                style={{ top: mark.top }}
              >
                {mark.label}
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
        <EditEntryDialog
          data={data}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSynced={async () => {
            setEditingEntry(null);
            await onEntryUpdated();
          }}
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
  const end = draft?.stoppedAt ? new Date(draft.stoppedAt) : entry.stoppedAt ? new Date(entry.stoppedAt) : new Date();
  const top =
    ((start.getHours() * 60 + start.getMinutes() - dayStartHour * 60) / 60) * pixelsPerHour;
  const height = Math.max(30, ((end.getTime() - start.getTime()) / 3_600_000) * pixelsPerHour);
  const color = pastelFor(entry);
  const durationSeconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
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
      aria-label={`Time block ${entry.projectName ?? "Unassigned"} ${formatDuration(durationSeconds)}`}
      className={[
        "swiss-time-block",
        isResizing ? "is-resizing" : "",
        isSelected ? "is-selected" : "",
        viewMode === "week" ? "is-compact" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onDoubleClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === "Enter") onEdit();
      }}
      style={{
        top: Math.max(0, top),
        height,
        background: color.background,
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
            aria-label={`Resize start of ${entry.projectName ?? "time block"}`}
            onDoubleClick={onEdit}
            onPointerDown={(event) => onResizeStart(entry, "start", event)}
          />
          <button
            type="button"
            className="swiss-resize-handle bottom"
            aria-label={`Resize end of ${entry.projectName ?? "time block"}`}
            onDoubleClick={onEdit}
            onPointerDown={(event) => onResizeStart(entry, "end", event)}
          />
        </>
      ) : null}
      <div>
        <strong>{entry.description || entry.projectName || "Unassigned"}</strong>
        <span>{entry.projectName ?? entry.clientName ?? entry.categoryName ?? formatSourceLabel(entry.source)}</span>
      </div>
      <div>
        <EntryIcon entry={entry} />
        <b>{formatDuration(durationSeconds)}</b>
      </div>
    </article>
  );
}

function EditEntryDialog({
  data,
  entry,
  onClose,
  onSynced
}: {
  data: BootstrapData;
  entry: TimeEntryRow;
  onClose: () => void;
  onSynced: () => Promise<void>;
}) {
  const [isBusy, setIsBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    try {
      const formData = new FormData(event.currentTarget);
      const response = await fetch(`/api/time-entries/${entry.id}`, {
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
      if (!response.ok) throw new Error(`Unable to update entry: ${response.status}`);
      await onSynced();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="swiss-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="swiss-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-entry-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="swiss-dialog-header">
          <h2 id="edit-entry-title">Edit time block</h2>
          <button type="button" onClick={onClose} aria-label="Close edit time block">
            x
          </button>
        </div>
        <form className="swiss-form-grid" onSubmit={submit}>
          <label>
            Project
            <select name="projectId" defaultValue={entry.projectId ?? ""} required>
              <option value="" disabled>
                Choose project
              </option>
              {data.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select name="categoryId" defaultValue={entry.categoryId ?? ""}>
              <option value="">No category</option>
              {data.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Place
            <select name="placeId" defaultValue={entry.placeId ?? ""}>
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
            <input name="description" defaultValue={entry.description ?? ""} placeholder="What are you working on?" />
          </label>
          <label>
            Start
            <input type="datetime-local" name="startedAt" defaultValue={dateTimeLocal(new Date(entry.startedAt))} required />
          </label>
          <label>
            Finish
            <input
              type="datetime-local"
              name="stoppedAt"
              defaultValue={entry.stoppedAt ? dateTimeLocal(new Date(entry.stoppedAt)) : ""}
            />
          </label>
          <div className="swiss-dialog-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="swiss-primary-action" disabled={isBusy}>
              Save changes
            </button>
          </div>
        </form>
      </section>
    </div>
  );
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
                {item.projectName ?? item.type} ·{" "}
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
                <strong>{event.projectName ?? formatEventLabel(event.eventType)}</strong>
                <small>{event.placeName ?? formatSourceLabel(event.source)}</small>
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
  const defaultProject = data.projects[0]?.id ?? "";
  const selectedDate = parseDateKey(data.dateRange.selectedDate);
  selectedDate.setHours(9, 0, 0, 0);
  const defaultStart = dateTimeLocal(selectedDate);
  selectedDate.setHours(10, 0, 0, 0);
  const defaultStop = dateTimeLocal(selectedDate);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    try {
      const formData = new FormData(event.currentTarget);
      const response = await fetch("/api/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "manual",
          projectId: formData.get("projectId"),
          categoryId: formData.get("categoryId") || undefined,
          placeId: formData.get("placeId") || undefined,
          description: formData.get("description") || undefined,
          startedAt: formData.get("startedAt"),
          stoppedAt: formData.get("stoppedAt")
        })
      });
      if (!response.ok) throw new Error(`Unable to add entry: ${response.status}`);
      const refresh = await fetch(`/api/bootstrap?date=${data.dateRange.selectedDate}`, {
        cache: "no-store"
      });
      if (refresh.ok) onSynced((await refresh.json()) as BootstrapData);
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
            Project
            <select name="projectId" defaultValue={defaultProject} required>
              {data.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select name="categoryId" defaultValue="">
              <option value="">Project default</option>
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
            Stop
            <input type="datetime-local" name="stoppedAt" defaultValue={defaultStop} required />
          </label>
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
  const key = `${entry.projectColor ?? ""}-${entry.projectName ?? ""}`.toLowerCase();
  if (key.includes("lime") || key.includes("green") || key.includes("gym") || key.includes("family")) {
    return {
      background: "var(--block-mint-bg)",
      border: "var(--block-mint-border)",
      text: "var(--block-text)"
    };
  }
  if (key.includes("amber") || key.includes("admin") || key.includes("orange")) {
    return {
      background: "var(--block-sun-bg)",
      border: "var(--block-sun-border)",
      text: "var(--block-text)"
    };
  }
  if (key.includes("violet") || key.includes("purple") || key.includes("town")) {
    return {
      background: "var(--block-lavender-bg)",
      border: "var(--block-lavender-border)",
      text: "var(--block-text)"
    };
  }
  if (key.includes("coral") || key.includes("red") || key.includes("client")) {
    return {
      background: "var(--block-coral-bg)",
      border: "var(--block-coral-border)",
      text: "var(--block-text)"
    };
  }
  return {
    background: "var(--block-sky-bg)",
    border: "var(--block-sky-border)",
    text: "var(--block-text)"
  };
}

function EntryIcon({ entry }: { entry: TimeEntryRow }) {
  const label = `${entry.projectName ?? ""} ${entry.categoryName ?? ""} ${entry.placeName ?? ""}`.toLowerCase();
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
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
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
  const date = parseDateKey(dateValue);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date.toISOString();
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}
