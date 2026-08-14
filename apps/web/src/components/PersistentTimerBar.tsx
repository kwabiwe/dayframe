"use client";

import type {
  CSSProperties,
  FormEvent,
  InputHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeTagName, paletteCssColorFor } from "@dayframe/shared";
import { CalendarDays, Clock3, Ellipsis, Play, Plus, Square, Trash2 } from "lucide-react";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { CategoryPicker, type CreateCategoryOutcome } from "@/components/CategoryPicker";
import { InlineTagInput } from "@/components/InlineTagInput";
import { DayframeDateTimePicker } from "@/components/DayframeDateTimePicker";
import { OverlapNotice } from "@/components/OverlapNotice";
import { TaskSuggestionsPanel } from "@/components/TaskSuggestionsPanel";
import { Button, Field, IconButton, ModalDialog } from "@/components/ui/Primitives";
import { calendarEntryLocalDayOffset, formatCalendarEntryCompactDuration } from "@/lib/calendar-entry-compact-editor";
import { timeEntryAccentColor } from "@/lib/display";
import { dateTimeLocalInputToIso, formatClockDuration, formatTime } from "@/lib/format";
import { validateManualTimeEntryWindow } from "@/lib/manual-time-entry";
import type { BootstrapData } from "@/lib/queries";
import { shouldStartTimerFromEntrySubmit } from "@/lib/timer-entry-draft";
import { quickActionTimerDraft } from "@/lib/timer-runtime";

const TASK_SUGGESTION_LIMIT = 5;

export function PersistentTimerBar({ workspaceMode = false }: { workspaceMode?: boolean }) {
  const {
    clearTimerError,
    closeManualEntry,
    createCategory,
    createManualEntry,
    deleteActiveTimer,
    isManualEntryOpen,
    isTimerBusy,
    openManualEntry,
    setTimerDraft,
    shellData: data,
    startTimer,
    stopTimer,
    timerDraft,
    timerError,
    updateActiveDetails,
    updateActiveStartTime
  } = useAppShellRuntime();
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [hashtagSuggestionsOpen, setHashtagSuggestionsOpen] = useState(false);
  const [startEditorOpen, setStartEditorOpen] = useState(false);
  const [timerActionsOpen, setTimerActionsOpen] = useState(false);
  const [startDateDraft, setStartDateDraft] = useState("");
  const [startTimeDraft, setStartTimeDraft] = useState("");
  const [startEditError, setStartEditError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const descriptionInputRef = useRef<HTMLInputElement | null>(null);
  const suppressSuggestionFocusRef = useRef(false);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const startDateInputRef = useRef<HTMLInputElement | null>(null);
  const startTimeInputRef = useRef<HTMLInputElement | null>(null);
  const startEditorRef = useRef<HTMLDivElement | null>(null);
  const startEditorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const timerActionsRef = useRef<HTMLDivElement | null>(null);
  const timerActionsTriggerRef = useRef<HTMLButtonElement | null>(null);

  const active = data?.activeEntry ?? null;
  const selectedCategory = data?.categories.find((category) => category.id === timerDraft.categoryId) ?? null;
  const activeStartedAtMs = active ? new Date(active.startedAt).getTime() : 0;
  const lastStoppedAt = useMemo(() => {
    if (!data) return null;
    return data.entries
      .filter((entry) => entry.id !== active?.id && entry.stoppedAt)
      .map((entry) => entry.stoppedAt as string)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  }, [active?.id, data]);
  const durationSeconds = active
    ? Math.max(active.durationSeconds, Math.floor((now - activeStartedAtMs) / 1000))
    : 0;
  const taskSuggestions = useMemo(() => data?.taskSuggestions ?? [], [data?.taskSuggestions]);
  const visibleTaskSuggestions = useMemo(() => {
    const query = timerDraft.description.trim().toLocaleLowerCase();
    if (!query) return taskSuggestions.slice(0, TASK_SUGGESTION_LIMIT);
    return taskSuggestions
      .filter((suggestion) => [suggestion.description, suggestion.categoryName ?? ""]
        .some((value) => value.toLocaleLowerCase().includes(query)))
      .slice(0, TASK_SUGGESTION_LIMIT);
  }, [taskSuggestions, timerDraft.description]);
  const quickActions = useMemo(() => data ? buildLearnedQuickActions(data) : [], [data]);
  const activeAccent = active
    ? timeEntryAccentColor({
        ...active,
        categoryName: timerDraft.categoryId ? selectedCategory?.name ?? active.categoryName : null,
        categoryColor: timerDraft.categoryId ? selectedCategory?.color ?? active.categoryColor : null,
        description: timerDraft.description.trim() || active.description
      })
    : undefined;

  useEffect(() => {
    if (!active) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    const nextCategoryId = timerDraft.categoryId || null;
    const nextDescription = timerDraft.description.trim() || null;
    const draftTags = timerDraft.tagNames.map((name) => normalizeTagName(name).normalizedName).sort();
    const activeTags = (active.tags?.map((tag) => tag.normalizedName)
      ?? active.tagNames.map((name) => normalizeTagName(name).normalizedName)).sort();
    if (
      nextCategoryId === active.categoryId &&
      nextDescription === (active.description ?? null) &&
      JSON.stringify(draftTags) === JSON.stringify(activeTags)
    ) return undefined;

    const handle = window.setTimeout(() => {
      void updateActiveDetails(timerDraft);
    }, 650);
    return () => window.clearTimeout(handle);
  }, [active, timerDraft, updateActiveDetails]);

  useEffect(() => {
    if (!suggestionsOpen) return undefined;
    function close(event: MouseEvent) {
      if (!suggestionsRef.current?.contains(event.target as Node)) setSuggestionsOpen(false);
    }
    function closeWithKeyboard(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (suggestionsOpen) setSuggestionsOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeWithKeyboard);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeWithKeyboard);
    };
  }, [suggestionsOpen]);

  useEffect(() => {
    if (!startEditorOpen) return undefined;
    const focusHandle = window.requestAnimationFrame(() => startDateInputRef.current?.focus());
    function closeOnOutside(event: MouseEvent) {
      if (!startEditorRef.current?.contains(event.target as Node)) setStartEditorOpen(false);
    }
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setStartEditorOpen(false);
      startEditorTriggerRef.current?.focus();
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusHandle);
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [startEditorOpen]);

  useEffect(() => {
    if (!timerActionsOpen) return undefined;
    function closeOnOutside(event: MouseEvent) {
      if (!timerActionsRef.current?.contains(event.target as Node)) setTimerActionsOpen(false);
    }
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setTimerActionsOpen(false);
      timerActionsTriggerRef.current?.focus();
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [timerActionsOpen]);

  if (!data) return null;

  async function submitTimer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shouldStartTimerFromEntrySubmit({ hasActiveTimer: Boolean(active), isBusy: isTimerBusy })) return;
    setSuggestionsOpen(false);
    await startTimer();
  }

  function startFromEnter(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!shouldStartTimerFromEntrySubmit({ hasActiveTimer: Boolean(active), isBusy: isTimerBusy })) return;
    setSuggestionsOpen(false);
    void startTimer();
  }

  async function chooseTimerSuggestion(suggestion: BootstrapData["taskSuggestions"][number]) {
    const suggestionDraft = {
      categoryId: suggestion.categoryId ?? "",
      description: suggestion.description,
      tagNames: suggestion.tagNames
    };
    setTimerDraft(suggestionDraft);
    setSuggestionsOpen(false);
    if (!active) {
      await startTimer(suggestionDraft);
      return;
    }
    suppressSuggestionFocusRef.current = true;
    window.requestAnimationFrame(() => {
      descriptionInputRef.current?.focus({ preventScroll: true });
      window.setTimeout(() => {
        suppressSuggestionFocusRef.current = false;
      }, 0);
    });
  }

  function openStartEditor() {
    if (!active) return;
    const startedAt = new Date(active.startedAt);
    setStartDateDraft(dateKey(startedAt));
    setStartTimeDraft(`${startedAt.getHours().toString().padStart(2, "0")}:${startedAt.getMinutes().toString().padStart(2, "0")}`);
    setStartEditError(null);
    setStartEditorOpen(true);
  }

  async function saveStartTime() {
    const startedAt = dateTimeLocalInputToIso(`${startDateDraft}T${startTimeDraft}`);
    if (!startedAt) {
      setStartEditError("Use a valid start date and time.");
      return;
    }
    if (new Date(startedAt).getTime() > Date.now()) {
      setStartEditError("Start time cannot be in the future.");
      return;
    }
    const outcome = await updateActiveStartTime(startedAt);
    if (outcome.ok) {
      setStartEditorOpen(false);
      window.requestAnimationFrame(() => startEditorTriggerRef.current?.focus());
    } else setStartEditError(outcome.error);
  }

  return (
    <section
      className={[
        "swiss-panel swiss-current-timer swiss-persistent-timer",
        active ? "is-running" : "is-idle",
        workspaceMode ? "is-workspace" : ""
      ].filter(Boolean).join(" ")}
      data-testid="persistent-timer"
      style={activeAccent ? ({ "--timer-accent": activeAccent } as CSSProperties) : undefined}
    >
      <form className="swiss-persistent-timer-form" onSubmit={submitTimer}>
        <label className="swiss-timer-field-label swiss-timer-description-label" htmlFor="persistent-timer-description">
          Task description
        </label>
        <span className="swiss-timer-field-label swiss-timer-category-label" id="persistent-timer-category-label">
          Category
        </span>

        <div className="swiss-work-input swiss-timer-description-control" ref={suggestionsRef}>
          <InlineTagInput
            ariaLabel="Task description"
            className="swiss-timer-inline-tags"
            inputId="persistent-timer-description"
            inputRef={descriptionInputRef}
            name="timer-description"
            onChange={(description) => {
              setTimerDraft((current) => ({ ...current, description }));
              setSuggestionsOpen(true);
            }}
            onClick={() => setSuggestionsOpen(true)}
            onEnter={startFromEnter}
            onFocus={() => {
              if (suppressSuggestionFocusRef.current) {
                suppressSuggestionFocusRef.current = false;
                return;
              }
              setSuggestionsOpen(true);
            }}
            onHashtagPanelChange={(open) => {
              setHashtagSuggestionsOpen(open);
              if (open) setSuggestionsOpen(false);
            }}
            onInputKeyDown={(event) => {
              if (!suggestionsOpen || hashtagSuggestionsOpen || !visibleTaskSuggestions.length) return;
              if (event.key === "Escape") {
                event.preventDefault();
                setSuggestionsOpen(false);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                suggestionsRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus();
              }
            }}
            onSelectedTagNamesChange={(tagNames) => setTimerDraft((current) => ({ ...current, tagNames }))}
            placeholder={active ? "Add a task description" : "What are you working on?"}
            selectedTagNames={timerDraft.tagNames}
            tags={data.tags}
            value={timerDraft.description}
          />
          {visibleTaskSuggestions.length ? (
            <TaskSuggestionsPanel
              isBusy={isTimerBusy}
              isOpen={suggestionsOpen && !hashtagSuggestionsOpen}
              onSelect={(suggestion) => void chooseTimerSuggestion(suggestion)}
              suggestions={visibleTaskSuggestions}
            />
          ) : null}
        </div>

        <CategoryPicker
          ariaLabelledBy="persistent-timer-category-label"
          categories={data.categories}
          className="swiss-timer-category-control"
          menuId="persistent-timer-category-menu"
          onBeforeOpen={() => setSuggestionsOpen(false)}
          onCreateCategory={createCategory}
          onOpenChange={setCategoryMenuOpen}
          onSelect={(categoryId) => {
            setTimerDraft((current) => ({ ...current, categoryId }));
            setSuggestionsOpen(false);
          }}
          open={categoryMenuOpen}
          portal
          selectedId={timerDraft.categoryId}
          variant="timer"
        />

        <div className="swiss-timer-time-control" ref={startEditorRef}>
          {active ? (
            <button
              aria-controls="persistent-timer-start-editor"
              aria-expanded={startEditorOpen}
              aria-haspopup="dialog"
              className="swiss-persistent-time-button"
              type="button"
              aria-label={`Edit start date and time. Started ${formatTime(active.startedAt)}. Elapsed ${formatClockDuration(durationSeconds)}`}
              onClick={() => {
                if (startEditorOpen) setStartEditorOpen(false);
                else openStartEditor();
              }}
              ref={startEditorTriggerRef}
            >
              <span>{formatClockDuration(durationSeconds)}</span>
              <small>Started {formatTime(active.startedAt)}</small>
            </button>
          ) : (
            <span className="swiss-persistent-time-placeholder" aria-label="Timer is idle. Elapsed time 00:00.">
              {formatClockDuration(0)}
            </span>
          )}

          {active ? (
            <section
              aria-hidden={!startEditorOpen}
              aria-label="Start date and time"
              className={`ui-floating-surface swiss-start-time-popover${startEditorOpen ? " is-open" : ""}`}
              id="persistent-timer-start-editor"
              inert={!startEditorOpen}
              role="dialog"
            >
              <header className="swiss-start-time-popover-header">
                <strong>Start date and time</strong>
              </header>
              <div
                className="swiss-compact-time-editor"
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  if (!(event.target instanceof HTMLInputElement)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  void saveStartTime();
                }}
              >
                <Field htmlFor="active-start-date" label="Start date">
                  <NativePickerControl
                    icon={<CalendarDays size={16} aria-hidden="true" />}
                    inputRef={startDateInputRef}
                    inputProps={{
                      id: "active-start-date",
                      type: "date",
                      value: startDateDraft,
                      onChange: (event) => {
                        setStartDateDraft(event.target.value);
                        setStartEditError(null);
                      },
                      required: true
                    }}
                    label="Open start date picker"
                  />
                </Field>
                <Field htmlFor="active-start-time" label="Start time">
                  <NativePickerControl
                    icon={<Clock3 size={16} aria-hidden="true" />}
                    inputRef={startTimeInputRef}
                    inputProps={{
                      id: "active-start-time",
                      type: "time",
                      value: startTimeDraft,
                      onChange: (event) => {
                        setStartTimeDraft(event.target.value);
                        setStartEditError(null);
                      },
                      required: true
                    }}
                    label="Open start time picker"
                  />
                  {lastStoppedAt ? (
                    <button
                      className="edit-entry-last-stop"
                      type="button"
                      onClick={() => {
                        const stopped = new Date(lastStoppedAt);
                        setStartDateDraft([
                          stopped.getFullYear(),
                          String(stopped.getMonth() + 1).padStart(2, "0"),
                          String(stopped.getDate()).padStart(2, "0")
                        ].join("-"));
                        setStartTimeDraft([
                          String(stopped.getHours()).padStart(2, "0"),
                          String(stopped.getMinutes()).padStart(2, "0")
                        ].join(":"));
                        setStartEditError(null);
                      }}
                    >
                      Set to last stop time
                      <span className="tabular">{formatTime(lastStoppedAt)}</span>
                    </button>
                  ) : null}
                </Field>
                {startEditError ? <p className="swiss-inline-error" role="alert">{startEditError}</p> : null}
                <div className="ui-dialog-actions">
                  <Button
                    type="button"
                    disabled={isTimerBusy}
                    onClick={() => {
                      setStartEditorOpen(false);
                      startEditorTriggerRef.current?.focus();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="button" variant="primary" disabled={isTimerBusy} onClick={() => void saveStartTime()}>Save</Button>
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <div className="swiss-timer-actions">
          <button
            className={["swiss-command-play", active ? "is-active" : ""].filter(Boolean).join(" ")}
            type={active ? "button" : "submit"}
            disabled={isTimerBusy}
            aria-busy={isTimerBusy || undefined}
            aria-label={active ? "Stop timer" : "Start timer"}
            onClick={() => {
              if (active) void stopTimer();
            }}
          >
            {active ? <Square size={14} fill="currentColor" /> : <Play size={18} fill="currentColor" strokeWidth={0} />}
          </button>
        </div>

        <div className="swiss-timer-secondary-actions" ref={timerActionsRef}>
          {active ? (
            <>
              <IconButton
                aria-expanded={timerActionsOpen}
                aria-haspopup="menu"
                className="swiss-timer-more"
                disabled={isTimerBusy}
                label="More timer actions"
                onClick={() => setTimerActionsOpen((open) => !open)}
                ref={timerActionsTriggerRef}
              >
                <Ellipsis size={18} />
              </IconButton>
              <div
                aria-hidden={!timerActionsOpen}
                className={`ui-floating-surface swiss-timer-actions-menu${timerActionsOpen ? " is-open" : ""}`}
                inert={!timerActionsOpen}
                role="menu"
              >
                <button
                  className="is-danger"
                  onClick={() => {
                    setTimerActionsOpen(false);
                    void deleteActiveTimer();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={16} />
                  Delete running task
                </button>
              </div>
            </>
          ) : (
            <IconButton
              className="swiss-manual-entry-action"
              disabled={isTimerBusy}
              label="Add time manually"
              onClick={openManualEntry}
            >
              <Plus size={18} />
            </IconButton>
          )}
        </div>
      </form>

      {timerError ? (
        <p className="swiss-inline-error" role="alert">
          {timerError}
          <button type="button" onClick={clearTimerError}>Dismiss</button>
        </p>
      ) : null}

      {quickActions.length ? (
        <div className="swiss-quick-actions-strip" aria-label="Quick actions">
          {!workspaceMode ? <span>Quick actions</span> : null}
          <div className="swiss-quick-actions-rail">
            {quickActions.map((action) => (
              <button
                key={action.key}
                type="button"
                disabled={isTimerBusy}
                onClick={() => {
                  const draft = quickActionTimerDraft(action.categoryId);
                  setCategoryMenuOpen(false);
                  setSuggestionsOpen(false);
                  setTimerDraft(draft);
                  void startTimer(draft);
                }}
              >
                <Play size={13} fill="currentColor" strokeWidth={0} />
                <i style={{ backgroundColor: action.color }} />
                <span><b>{action.label}</b></span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {workspaceMode ? <div className="swiss-timer-workspace-divider" aria-hidden="true" /> : null}

      {isManualEntryOpen ? (
        <ManualEntryDialog
          data={data}
          isBusy={isTimerBusy}
          onClose={closeManualEntry}
          onCreateCategory={createCategory}
          onCreate={createManualEntry}
        />
      ) : null}
    </section>
  );
}

function ManualEntryDialog({
  data,
  isBusy,
  onClose,
  onCreateCategory,
  onCreate
}: {
  data: BootstrapData;
  isBusy: boolean;
  onClose: () => void;
  onCreateCategory: (name: string) => Promise<CreateCategoryOutcome>;
  onCreate: (input: {
    categoryId?: string;
    description?: string;
    tagNames: string[];
    startedAt: string;
    stoppedAt: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [tagPanelOpen, setTagPanelOpen] = useState(false);
  const [tagNames, setTagNames] = useState<string[]>([]);
  const descriptionInputRef = useRef<HTMLInputElement | null>(null);
  const suppressSuggestionFocusRef = useRef(false);
  const descriptionInteractionRef = useRef<HTMLDivElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const defaults = useMemo(() => manualEntryDefaults(data.dateRange.selectedDate), [data.dateRange.selectedDate]);
  const [startedAtDraft, setStartedAtDraft] = useState(defaults.start);
  const [stoppedAtDraft, setStoppedAtDraft] = useState(defaults.finish);
  const durationLabel = useMemo(() => {
    const startedAt = dateTimeLocalInputToIso(startedAtDraft);
    const stoppedAt = dateTimeLocalInputToIso(stoppedAtDraft);
    if (!startedAt || !stoppedAt) return "—";
    const seconds = Math.floor((Date.parse(stoppedAt) - Date.parse(startedAt)) / 1_000);
    return seconds > 0 ? formatCalendarEntryCompactDuration(seconds) : "—";
  }, [startedAtDraft, stoppedAtDraft]);
  const finishDayOffset = useMemo(() => calendarEntryLocalDayOffset(
    startedAtDraft.slice(0, 10),
    stoppedAtDraft.slice(0, 10)
  ), [startedAtDraft, stoppedAtDraft]);
  const visibleTaskSuggestions = useMemo(() => {
    const query = description.trim().toLocaleLowerCase();
    if (!query) return data.taskSuggestions.slice(0, TASK_SUGGESTION_LIMIT);
    return data.taskSuggestions
      .filter((suggestion) => [suggestion.description, suggestion.categoryName ?? ""]
        .some((value) => value.toLocaleLowerCase().includes(query)))
      .slice(0, TASK_SUGGESTION_LIMIT);
  }, [data.taskSuggestions, description]);
  const formId = "persistent-manual-entry-form";

  useEffect(() => {
    if (!suggestionsOpen) return undefined;
    function closeOnOutside(event: MouseEvent) {
      if (!descriptionInteractionRef.current?.contains(event.target as Node)) setSuggestionsOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, [suggestionsOpen]);

  function chooseSuggestion(suggestion: BootstrapData["taskSuggestions"][number]) {
    setDescription(suggestion.description);
    setCategoryId(suggestion.categoryId ?? "");
    setTagNames(suggestion.tagNames);
    setSuggestionsOpen(false);
    suppressSuggestionFocusRef.current = true;
    window.requestAnimationFrame(() => {
      descriptionInputRef.current?.focus({ preventScroll: true });
      window.setTimeout(() => {
        suppressSuggestionFocusRef.current = false;
      }, 0);
    });
  }

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
    let validatedWindow: { startedAt: string; stoppedAt: string };
    try {
      validatedWindow = validateManualTimeEntryWindow({
        now: new Date(),
        startedAt,
        stoppedAt
      });
    } catch (validationError) {
      setFormError(validationError instanceof Error ? validationError.message : "Check the time values.");
      return;
    }
    const outcome = await onCreate({
      categoryId: categoryId || undefined,
      description: description.trim() || undefined,
      tagNames,
      startedAt: validatedWindow.startedAt,
      stoppedAt: validatedWindow.stoppedAt
    });
    if (outcome.ok) onClose();
    else setFormError(outcome.error);
  }

  return (
    <ModalDialog
      busy={isBusy}
      className="manual-entry-dialog"
      contentClassName="manual-entry-dialog-content"
      initialFocusRef={descriptionInputRef}
      onClose={onClose}
      title="Add Time"
      footer={(
        <>
          <OverlapNotice
            compact
            candidate={{
              startedAt: dateTimeLocalInputToIso(startedAtDraft) ?? "invalid",
              stoppedAt: dateTimeLocalInputToIso(stoppedAtDraft)
            }}
            entries={data.entries}
          />
          <Button className="calendar-compact-cancel" onClick={onClose} disabled={isBusy}>Cancel</Button>
          <Button className="calendar-compact-save" variant="primary" type="submit" form={formId} disabled={isBusy}>Add time</Button>
        </>
      )}
    >
      <form id={formId} className="calendar-compact-editor-fields manual-entry-form" onSubmit={submit}>
        <div className="calendar-compact-editor-description manual-entry-description">
          <label htmlFor="manual-entry-description">Description</label>
          <div ref={descriptionInteractionRef}>
            <InlineTagInput
              ariaLabel="Manual time entry description"
              className="manual-entry-inline-tags time-entry-quick-tags"
              inputId="manual-entry-description"
              inputRef={descriptionInputRef}
              name="manual-description"
              onChange={(value) => {
                setDescription(value);
                setSuggestionsOpen(true);
              }}
              onClick={() => setSuggestionsOpen(true)}
              onFocus={() => {
                if (suppressSuggestionFocusRef.current) {
                  suppressSuggestionFocusRef.current = false;
                  return;
                }
                setSuggestionsOpen(true);
              }}
              onHashtagPanelChange={(open) => {
                setTagPanelOpen(open);
                if (open) setSuggestionsOpen(false);
              }}
              onInputKeyDown={(event) => {
                if (!suggestionsOpen || tagPanelOpen || !visibleTaskSuggestions.length) return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSuggestionsOpen(false);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  chooseSuggestion(visibleTaskSuggestions[0]);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  suggestionsRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus();
                }
              }}
              onSelectedTagNamesChange={setTagNames}
              placeholder="What did you work on?"
              selectedTagNames={tagNames}
              tags={data.tags}
              value={description}
            />
            {visibleTaskSuggestions.length ? (
              <TaskSuggestionsPanel
                isBusy={isBusy}
                isOpen={suggestionsOpen && !tagPanelOpen}
                onSelect={chooseSuggestion}
                panelRef={suggestionsRef}
                suggestions={visibleTaskSuggestions}
              />
            ) : null}
          </div>
        </div>
        <CategoryPicker
          categories={data.categories}
          className="manual-entry-category"
          label="Category"
          menuId="manual-entry-category-menu"
          onBeforeOpen={() => setSuggestionsOpen(false)}
          onCreateCategory={onCreateCategory}
          onOpenChange={setCategoryMenuOpen}
          onSelect={setCategoryId}
          open={categoryMenuOpen}
          portal
          selectedId={categoryId}
          triggerId="manual-entry-category"
          variant="quick"
        />
        <div className="calendar-compact-temporal-fields manual-entry-temporal-fields">
          <div className="calendar-compact-moment-field">
            <span className="calendar-compact-field-label">Start</span>
            <DayframeDateTimePicker
              compact
              id="manual-entry-start"
              label="Start"
              name="startedAt"
              defaultValue={defaults.start}
              onChange={setStartedAtDraft}
              required
            />
          </div>
          <div className="calendar-compact-moment-field">
            <span className="calendar-compact-field-label">Finish</span>
            <DayframeDateTimePicker
              compact
              dayOffset={finishDayOffset}
              id="manual-entry-finish"
              label="Finish"
              name="stoppedAt"
              defaultValue={defaults.finish}
              onChange={setStoppedAtDraft}
              required
            />
          </div>
          <div className="calendar-compact-duration-field">
            <span className="calendar-compact-field-label">Duration</span>
            <div className="calendar-compact-duration is-readonly" aria-label="Duration">
              <span className="tabular">{durationLabel}</span>
            </div>
          </div>
        </div>
        {formError ? <p className="swiss-inline-error" role="alert">{formError}</p> : null}
      </form>
    </ModalDialog>
  );
}

type QuickAction = {
  categoryId: string | null;
  color: string;
  key: string;
  label: string;
};

function NativePickerControl({
  icon,
  inputProps,
  inputRef,
  label
}: {
  icon: ReactNode;
  inputProps: InputHTMLAttributes<HTMLInputElement>;
  inputRef: RefObject<HTMLInputElement | null>;
  label: string;
}) {
  return (
    <span className="swiss-native-picker-control">
      <input {...inputProps} className="ui-control" ref={inputRef} />
      <button
        aria-label={label}
        className="swiss-native-picker-button"
        onClick={() => {
          try {
            inputRef.current?.showPicker();
          } catch {
            inputRef.current?.focus();
          }
        }}
        tabIndex={-1}
        type="button"
      >
        {icon}
      </button>
    </span>
  );
}

function buildLearnedQuickActions(data: BootstrapData): QuickAction[] {
  const usageByCategory = new Map((data.categoryUsage ?? []).map((rank) => [rank.categoryId, rank]));
  return data.categories
    .map((category, index) => ({ category, index, usage: usageByCategory.get(category.id) }))
    .filter(({ category }) => category.isPinned)
    .sort((left, right) =>
      (right.usage?.score ?? 0) - (left.usage?.score ?? 0) ||
      (right.usage?.useCount ?? 0) - (left.usage?.useCount ?? 0) ||
      left.index - right.index
    )
    .slice(0, 6)
    .map(({ category }) => ({
      categoryId: category.id,
      color: paletteCssColorFor(category.color, category.name),
      key: `category:${category.id}`,
      label: category.name
    }));
}

function manualEntryDefaults(selectedDate: string) {
  const [year, month, day] = selectedDate.split("-").map(Number);
  const today = new Date();
  if (dateKey(today) === selectedDate) {
    const finish = new Date(today);
    finish.setSeconds(0, 0);
    const start = new Date(finish.getTime() - 60 * 60 * 1000);
    return { start: dateTimeLocal(start), finish: dateTimeLocal(finish) };
  }
  const start = new Date(year, month - 1, day, 9, 0, 0, 0);
  const finish = new Date(start.getTime() + 60 * 60 * 1000);
  return { start: dateTimeLocal(start), finish: dateTimeLocal(finish) };
}

function dateTimeLocal(date: Date) {
  return `${dateKey(date)}T${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    `${date.getMonth() + 1}`.padStart(2, "0"),
    `${date.getDate()}`.padStart(2, "0")
  ].join("-");
}
