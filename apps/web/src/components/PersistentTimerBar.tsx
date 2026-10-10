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
import { normalizeTagName, resolveActivityIcon, type DayframeGlyph } from "@dayframe/shared";
import { CalendarDays, Clock3, Ellipsis, Plus, Trash2 } from "lucide-react";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { Odometer } from "@/components/blocks/Odometer";
import { CategoryPicker, type CreateCategoryOutcome } from "@/components/CategoryPicker";
import { InlineTagInput } from "@/components/InlineTagInput";
import { DayframeDateTimePicker } from "@/components/DayframeDateTimePicker";
import { OverlapNotice } from "@/components/OverlapNotice";
import { TaskSuggestionsPanel } from "@/components/TaskSuggestionsPanel";
import { Button, Field, IconButton, ModalDialog } from "@/components/ui/Primitives";
import { calendarEntryLocalDayOffset, formatCalendarEntryCompactDuration } from "@/lib/calendar-entry-compact-editor";
import { timeEntryAccentColor } from "@/lib/display";
import { dateTimeLocalInputToIso, formatClockDuration, formatDuration, formatTime } from "@/lib/format";
import { validateManualTimeEntryWindow } from "@/lib/manual-time-entry";
import type { BootstrapData } from "@/lib/queries";
import { shouldStartTimerFromEntrySubmit } from "@/lib/timer-entry-draft";
import { quickActionTimerDraft } from "@/lib/timer-runtime";
import { blockStyle } from "@/lib/block-style";
import { parseCommand } from "@/lib/command-parse";
import { hasOpenDialog, isTypingTarget } from "@/lib/keyboard-ownership";

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
  const [commandFocused, setCommandFocused] = useState(false);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
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
  const parsedCommand = useMemo(
    () => active ? null : parseCommand(timerDraft.description, data?.categories ?? []),
    [active, data?.categories, timerDraft.description]
  );
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

  useEffect(() => {
    if (!commandNotice) return undefined;
    const handle = window.setTimeout(() => setCommandNotice(null), 5000);
    return () => window.clearTimeout(handle);
  }, [commandNotice]);

  // Keys 1–6 start the pinned quick starts in the order shown (prototype; owner decision D2),
  // never while typing or while a popup, dialog or inline editor owns the keyboard.
  useEffect(() => {
    function startQuickActionFromKey(event: globalThis.KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented || event.repeat) return;
      if (!/^[1-6]$/.test(event.key) || isTypingTarget(event.target) || hasOpenDialog()) return;
      const action = quickActions[Number(event.key) - 1];
      if (!action) return;
      event.preventDefault();
      startQuickAction(action);
    }
    document.addEventListener("keydown", startQuickActionFromKey);
    return () => document.removeEventListener("keydown", startQuickActionFromKey);
  });

  if (!data) return null;

  async function submitTimer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shouldStartTimerFromEntrySubmit({
      hasActiveTimer: Boolean(active),
      isBusy: isTimerBusy && Boolean(active)
    })) return;
    setSuggestionsOpen(false);
    await runCommand();
  }

  function startFromEnter(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!shouldStartTimerFromEntrySubmit({
      hasActiveTimer: Boolean(active),
      isBusy: isTimerBusy && Boolean(active)
    })) return;
    setSuggestionsOpen(false);
    void runCommand();
  }

  // Idle Start: `@activity` picks the activity and a trailing duration logs a finished block
  // ending now (through the manual-entry path) instead of starting the timer.
  async function runCommand() {
    const submitted = timerDraft;
    const command = parseCommand(submitted.description, data!.categories);
    const categoryId = command.categoryId ?? submitted.categoryId;
    // Only the command that was sent is cleared or restored: text typed while it was in flight wins.
    const isUntouched = (current: typeof submitted) => current.description === submitted.description
      && current.categoryId === submitted.categoryId
      && current.tagNames.join("\u0000") === submitted.tagNames.join("\u0000");
    setCommandNotice(null);
    if (command.durationSeconds) {
      const stoppedAt = new Date();
      stoppedAt.setSeconds(0, 0);
      const startedAt = new Date(stoppedAt.getTime() - command.durationSeconds * 1000);
      const outcome = await createManualEntry({
        categoryId: categoryId || undefined,
        description: command.description || undefined,
        tagNames: submitted.tagNames,
        startedAt: startedAt.toISOString(),
        stoppedAt: stoppedAt.toISOString()
      });
      if (!outcome.ok) {
        setCommandNotice(outcome.error);
        return;
      }
      const activityName = data!.categories.find((category) => category.id === categoryId)?.name;
      setTimerDraft((current) => isUntouched(current) ? { categoryId: "", description: "", tagNames: [] } : current);
      setCommandNotice(`Added ${formatDuration(command.durationSeconds)}${activityName ? ` to ${activityName}` : ""}.`);
      return;
    }
    // A rejected Start keeps the started details (or anything typed meanwhile) in the bar.
    await startTimer({ categoryId, description: command.description, tagNames: submitted.tagNames });
  }

  function startQuickAction(action: QuickAction) {
    const draft = quickActionTimerDraft(action.categoryId);
    setCategoryMenuOpen(false);
    setSuggestionsOpen(false);
    setTimerDraft(draft);
    void startTimer(draft);
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

  const liveCategory = active ? data.categories.find((category) => category.id === (timerDraft.categoryId || active.categoryId)) ?? null : null;
  const previewCategory = parsedCommand?.categoryId
    ? data.categories.find((category) => category.id === parsedCommand.categoryId) ?? null
    : null;
  const commandHasShorthand = Boolean(parsedCommand && timerDraft.description.trim() && (parsedCommand.categoryId || parsedCommand.durationSeconds));
  const exampleActivity = data.categories.find((category) => category.isPinned)?.name ?? data.categories[0]?.name ?? "work";
  const goLabel = parsedCommand?.durationSeconds
    ? `Add ${formatDuration(parsedCommand.durationSeconds)}`
    : "Start";

  return (
    <section
      className={[
        "df-cmd-wrap",
        active ? "is-running" : "is-idle",
        workspaceMode ? "is-workspace" : ""
      ].filter(Boolean).join(" ")}
      data-testid="persistent-timer"
      style={activeAccent ? ({ "--timer-accent": activeAccent } as CSSProperties) : undefined}
    >
      <form
        className={`df-cmd${active ? " is-live" : ""}`}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setCommandFocused(false);
        }}
        onSubmit={submitTimer}
        style={liveCategory ? blockStyle(liveCategory.color, liveCategory.name) : undefined}
      >
        <label className="sr-only swiss-timer-description-label" htmlFor="persistent-timer-description">
          Task description
        </label>
        <span className="sr-only" id="persistent-timer-category-label">Activity</span>

        <CategoryPicker
          ariaLabelledBy="persistent-timer-category-label"
          categories={data.categories}
          className="df-cmd-activity-field"
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
          selectedId={parsedCommand?.categoryId ?? timerDraft.categoryId}
          variant="block"
        />

        <div className="df-cmd-field swiss-timer-description-control" ref={suggestionsRef}>
          <InlineTagInput
            ariaLabel="Task description"
            className="df-cmd-tags"
            inputId="persistent-timer-description"
            inputRef={descriptionInputRef}
            name="timer-description"
            onChange={(description) => {
              setCommandNotice(null);
              setTimerDraft((current) => ({ ...current, description }));
              setSuggestionsOpen(true);
            }}
            onClick={() => setSuggestionsOpen(true)}
            onEnter={startFromEnter}
            onFocus={() => {
              setCommandFocused(true);
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
            placeholder={active ? "Add a description" : "What are you working on?"}
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

        <div className="df-cmd-time" ref={startEditorRef}>
          {active ? (
            <button
              aria-controls="persistent-timer-start-editor"
              aria-expanded={startEditorOpen}
              aria-haspopup="dialog"
              className="df-cmd-clock"
              type="button"
              aria-label={`Edit start date and time. Started ${formatTime(active.startedAt)}. Elapsed ${formatClockDuration(durationSeconds)}`}
              onClick={() => {
                if (startEditorOpen) setStartEditorOpen(false);
                else openStartEditor();
              }}
              ref={startEditorTriggerRef}
            >
              <Odometer value={formatClockDuration(durationSeconds)} />
              <small>Started {formatTime(active.startedAt)}</small>
            </button>
          ) : (
            <span className="df-cmd-clock is-idle" aria-label="Timer is idle. Elapsed time 00:00.">
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

        <button
          className={`df-cmd-go${active ? " is-stop" : ""}`}
          type={active ? "button" : "submit"}
          disabled={Boolean(active) && isTimerBusy}
          aria-busy={(Boolean(active) && isTimerBusy) || undefined}
          aria-label={active ? "Stop timer" : parsedCommand?.durationSeconds ? `${goLabel} ending now` : "Start timer"}
          onClick={() => {
            if (active) void stopTimer();
          }}
        >
          {active ? (
            <DayframeIcon glyph="square" size={18} />
          ) : (
            <>
              <DayframeIcon glyph={parsedCommand?.durationSeconds ? "plus" : "play"} size={18} />
              <span className="df-cmd-go-label">{goLabel}</span>
              {parsedCommand?.durationSeconds ? null : <kbd>Space</kbd>}
            </>
          )}
        </button>

        <div className="df-cmd-secondary" ref={timerActionsRef}>
          {active ? (
            <>
              <IconButton
                aria-expanded={timerActionsOpen}
                aria-haspopup="menu"
                className="df-cmd-icon"
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
              className="df-cmd-icon"
              disabled={isTimerBusy}
              label="Add time manually"
              onClick={openManualEntry}
            >
              <Plus size={18} />
            </IconButton>
          )}
        </div>
      </form>

      <div className="df-cmd-parse" aria-live="polite">
        {commandNotice ? (
          <span className="df-cmd-hint">{commandNotice}</span>
        ) : commandHasShorthand && parsedCommand ? (
          <>
            {previewCategory ? (
              <span className="df-cmd-chip df-block" style={blockStyle(previewCategory.color, previewCategory.name)}>
                {previewCategory.name}
              </span>
            ) : null}
            {parsedCommand.durationSeconds ? (
              <>
                <span className="df-cmd-chip">{commandRangeLabel(parsedCommand.durationSeconds)}</span>
                <span className="df-cmd-hint">logs a finished block ending now</span>
              </>
            ) : (
              <span className="df-cmd-hint">Enter starts the timer</span>
            )}
          </>
        ) : !active && commandFocused && !timerDraft.description ? (
          <>
            <span className="df-cmd-hint">Try</span>
            <span className="df-cmd-chip">Write proposal @{exampleActivity.replace(/\s+/g, "").toLocaleLowerCase()} 45m</span>
            <span className="df-cmd-hint">@ picks an activity, # adds tags, a trailing duration logs time you already spent.</span>
          </>
        ) : null}
      </div>

      {timerError ? (
        <p className="swiss-inline-error" role="alert">
          {timerError}
          <button type="button" onClick={clearTimerError}>Dismiss</button>
        </p>
      ) : null}

      {quickActions.length ? (
        <div className="df-quick" role="group" aria-label="Quick start">
          {quickActions.map((action, index) => {
            const recording = Boolean(active && active.categoryId === action.categoryId);
            return (
              <button
                key={action.key}
                aria-label={`${recording ? "Recording" : "Start"} ${action.label} (${index + 1})`}
                className={`df-quick-button df-block${recording ? " is-recording" : ""}`}
                onClick={() => startQuickAction(action)}
                style={blockStyle(action.color, action.label)}
                type="button"
              >
                <DayframeIcon glyph={action.glyph} size={15} />
                <span>{action.label}</span>
                <kbd>{index + 1}</kbd>
              </button>
            );
          })}
        </div>
      ) : null}

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
          label="Activity"
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
  color: string | null;
  glyph: DayframeGlyph;
  key: string;
  label: string;
};

function commandRangeLabel(durationSeconds: number) {
  const stoppedAt = new Date();
  stoppedAt.setSeconds(0, 0);
  const startedAt = new Date(stoppedAt.getTime() - durationSeconds * 1000);
  return `${formatTime(startedAt.toISOString())}–${formatTime(stoppedAt.toISOString())}`;
}

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
      color: category.color,
      glyph: resolveActivityIcon(category).glyph,
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
