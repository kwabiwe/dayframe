"use client";

import type { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeTagName, paletteCssColorFor } from "@dayframe/shared";
import { CheckCircle2, ChevronDown, Ellipsis, Play, Plus, Square, Trash2 } from "lucide-react";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { InlineTagInput } from "@/components/InlineTagInput";
import { Button, Field, IconButton, ModalDialog, SelectField } from "@/components/ui/Primitives";
import { timeEntryAccentColor } from "@/lib/display";
import { dateTimeLocalInputToIso, formatClockDuration, formatTime } from "@/lib/format";
import type { BootstrapData } from "@/lib/queries";
import { shouldStartTimerFromEntrySubmit } from "@/lib/timer-entry-draft";

export function PersistentTimerBar() {
  const {
    clearTimerError,
    closeManualEntry,
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
  const categoryMenuRef = useRef<HTMLDivElement | null>(null);
  const categoryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const descriptionInputRef = useRef<HTMLInputElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const startDateInputRef = useRef<HTMLInputElement | null>(null);
  const startEditorRef = useRef<HTMLDivElement | null>(null);
  const startEditorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const timerActionsRef = useRef<HTMLDivElement | null>(null);
  const timerActionsTriggerRef = useRef<HTMLButtonElement | null>(null);

  const active = data?.activeEntry ?? null;
  const selectedCategory = data?.categories.find((category) => category.id === timerDraft.categoryId) ?? null;
  const selectedCategoryName = timerDraft.categoryId
    ? selectedCategory?.name ?? active?.categoryName ?? "Category"
    : "Uncategorized";
  const activeStartedAtMs = active ? new Date(active.startedAt).getTime() : 0;
  const durationSeconds = active
    ? Math.max(active.durationSeconds, Math.floor((now - activeStartedAtMs) / 1000))
    : 0;
  const taskSuggestions = useMemo(() => data?.taskSuggestions ?? [], [data?.taskSuggestions]);
  const visibleTaskSuggestions = useMemo(() => {
    const query = timerDraft.description.trim().toLocaleLowerCase();
    if (!query) return taskSuggestions.slice(0, 6);
    return taskSuggestions
      .filter((suggestion) => [suggestion.description, suggestion.categoryName ?? ""]
        .some((value) => value.toLocaleLowerCase().includes(query)))
      .slice(0, 6);
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
    if (!categoryMenuOpen && !suggestionsOpen) return undefined;
    function close(event: MouseEvent) {
      if (!categoryMenuRef.current?.contains(event.target as Node)) setCategoryMenuOpen(false);
      if (!suggestionsRef.current?.contains(event.target as Node)) setSuggestionsOpen(false);
    }
    function closeWithKeyboard(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (categoryMenuOpen) {
        event.preventDefault();
        setCategoryMenuOpen(false);
        categoryTriggerRef.current?.focus();
        return;
      }
      if (suggestionsOpen) setSuggestionsOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeWithKeyboard);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeWithKeyboard);
    };
  }, [categoryMenuOpen, suggestionsOpen]);

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

  function chooseCategory(categoryId: string) {
    setTimerDraft((current) => ({ ...current, categoryId }));
    setCategoryMenuOpen(false);
    setSuggestionsOpen(false);
    window.requestAnimationFrame(() => categoryTriggerRef.current?.focus());
  }

  function focusCategoryOption(position: "first" | "last" | "selected") {
    window.requestAnimationFrame(() => {
      const options = [...(categoryMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
      if (!options.length) return;
      const target = position === "selected"
        ? options.find((option) => option.getAttribute("aria-selected") === "true") ?? options[0]
        : position === "last"
          ? options.at(-1)
          : options[0];
      target?.focus();
    });
  }

  function moveCategoryFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    const options = [...(categoryMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    if (!options.length) return;
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
    if (event.key === "ArrowUp") nextIndex = currentIndex < 0 ? options.length - 1 : (currentIndex - 1 + options.length) % options.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = options.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      options[nextIndex]?.focus();
    }
  }

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

  async function startSuggestion(suggestion: BootstrapData["taskSuggestions"][number]) {
    setTimerDraft({
      categoryId: suggestion.categoryId ?? "",
      description: suggestion.description,
      tagNames: suggestion.tagNames
    });
    setSuggestionsOpen(false);
    await startTimer({
      categoryId: suggestion.categoryId ?? "",
      description: suggestion.description,
      tagNames: suggestion.tagNames
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

  async function saveStartTime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      className={["swiss-panel swiss-current-timer swiss-persistent-timer", active ? "is-running" : "is-idle"].join(" ")}
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
              if (!active) setSuggestionsOpen(true);
            }}
            onClick={() => {
              if (!active) setSuggestionsOpen(true);
            }}
            onEnter={startFromEnter}
            onFocus={() => {
              if (!active) setSuggestionsOpen(true);
            }}
            onHashtagPanelChange={(open) => {
              setHashtagSuggestionsOpen(open);
              if (open) setSuggestionsOpen(false);
            }}
            onSelectedTagNamesChange={(tagNames) => setTimerDraft((current) => ({ ...current, tagNames }))}
            placeholder={active ? "Add a task description" : "What are you working on?"}
            selectedTagNames={timerDraft.tagNames}
            tags={data.tags}
            value={timerDraft.description}
          />
          {!active && visibleTaskSuggestions.length ? (
            <TaskSuggestionsPanel
              isBusy={isTimerBusy}
              isOpen={suggestionsOpen && !hashtagSuggestionsOpen}
              onSelect={(suggestion) => void startSuggestion(suggestion)}
              suggestions={visibleTaskSuggestions}
            />
          ) : null}
        </div>

        <div
          className="swiss-category-field swiss-timer-category-control"
          ref={categoryMenuRef}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setCategoryMenuOpen(false);
          }}
        >
          <button
            className="swiss-category-trigger"
            type="button"
            aria-haspopup="listbox"
            aria-expanded={categoryMenuOpen}
            aria-controls="persistent-timer-category-menu"
            aria-labelledby="persistent-timer-category-label persistent-timer-category-value"
            ref={categoryTriggerRef}
            onClick={() => {
              setSuggestionsOpen(false);
              setCategoryMenuOpen((current) => !current);
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              setSuggestionsOpen(false);
              setCategoryMenuOpen(true);
              focusCategoryOption(event.key === "ArrowUp" ? "last" : "selected");
            }}
          >
            <span className="swiss-category-trigger-value">
              <span
                className={["swiss-focus-dot", selectedCategory ? "" : "is-muted"].filter(Boolean).join(" ")}
                style={{
                  backgroundColor: selectedCategory
                    ? paletteCssColorFor(selectedCategory.color, selectedCategory.name)
                    : "transparent"
                }}
              />
              <span id="persistent-timer-category-value">{selectedCategoryName}</span>
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          <div
            aria-hidden={!categoryMenuOpen}
            aria-label="Categories"
            className={`ui-floating-surface swiss-category-menu${categoryMenuOpen ? " is-open" : ""}`}
            id="persistent-timer-category-menu"
            inert={!categoryMenuOpen}
            onKeyDown={moveCategoryFocus}
            role="listbox"
          >
              <CategoryOption
                categoryId=""
                color={null}
                isSelected={!timerDraft.categoryId}
                label="Uncategorized"
                onSelect={chooseCategory}
              />
              {data.categories.map((category) => (
                <CategoryOption
                  key={category.id}
                  categoryId={category.id}
                  color={paletteCssColorFor(category.color, category.name)}
                  isSelected={category.id === timerDraft.categoryId}
                  label={category.name}
                  onSelect={chooseCategory}
                />
              ))}
          </div>
        </div>

        <IconButton
          className="swiss-manual-entry-action"
          disabled={isTimerBusy}
          label="Add time manually"
          onClick={openManualEntry}
        >
          <Plus size={18} />
        </IconButton>

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
              <form className="swiss-compact-time-editor" onSubmit={saveStartTime}>
                <Field htmlFor="active-start-date" label="Start date">
                  <input
                    className="ui-control"
                    id="active-start-date"
                    type="date"
                    value={startDateDraft}
                    onChange={(event) => {
                      setStartDateDraft(event.target.value);
                      setStartEditError(null);
                    }}
                    ref={startDateInputRef}
                    required
                  />
                </Field>
                <Field htmlFor="active-start-time" label="Start time">
                  <input
                    className="ui-control"
                    id="active-start-time"
                    type="time"
                    value={startTimeDraft}
                    onChange={(event) => {
                      setStartTimeDraft(event.target.value);
                      setStartEditError(null);
                    }}
                    required
                  />
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
                  <Button type="submit" variant="primary" disabled={isTimerBusy}>Save</Button>
                </div>
              </form>
            </section>
          ) : null}
        </div>

        <div className="swiss-timer-actions" ref={timerActionsRef}>
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
          ) : null}
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
          <span>Quick actions</span>
          <div>
            {quickActions.map((action) => (
              <button
                key={action.key}
                type="button"
                disabled={isTimerBusy}
                onClick={() => {
                  setCategoryMenuOpen(false);
                  setSuggestionsOpen(false);
                  setTimerDraft((current) => ({ ...current, categoryId: action.categoryId ?? "" }));
                  void startTimer({ categoryId: action.categoryId ?? "" });
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

      {isManualEntryOpen ? (
        <ManualEntryDialog
          data={data}
          isBusy={isTimerBusy}
          onClose={closeManualEntry}
          onCreate={createManualEntry}
        />
      ) : null}
    </section>
  );
}

function CategoryOption({
  categoryId,
  color,
  isSelected,
  label,
  onSelect
}: {
  categoryId: string;
  color: string | null;
  isSelected: boolean;
  label: string;
  onSelect: (categoryId: string) => void;
}) {
  return (
    <button
      className={["swiss-category-option", color ? "" : "is-muted", isSelected ? "is-selected" : ""]
        .filter(Boolean)
        .join(" ")}
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={() => onSelect(categoryId)}
    >
      <span className={["swiss-focus-dot", color ? "" : "is-muted"].filter(Boolean).join(" ")} style={color ? { backgroundColor: color } : undefined} />
      <span>{label}</span>
      {isSelected ? <CheckCircle2 size={14} aria-hidden="true" /> : null}
    </button>
  );
}

function TaskSuggestionsPanel({
  isBusy,
  isOpen,
  onSelect,
  suggestions
}: {
  isBusy: boolean;
  isOpen: boolean;
  onSelect: (suggestion: BootstrapData["taskSuggestions"][number]) => void;
  suggestions: BootstrapData["taskSuggestions"];
}) {
  return (
    <div
      aria-hidden={!isOpen}
      aria-label="Suggestions"
      className={`ui-floating-surface swiss-task-suggestions${isOpen ? " is-open" : ""}`}
      inert={!isOpen}
      role="listbox"
    >
      <div className="swiss-task-suggestions-header"><span>Suggestions</span></div>
      <div className="swiss-task-suggestions-list">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.key}
            type="button"
            role="option"
            aria-selected={false}
            disabled={isBusy}
            onClick={() => onSelect(suggestion)}
          >
            <span>
              <b>{suggestion.description}</b>
              <small>
                <i style={{ backgroundColor: paletteCssColorFor(suggestion.categoryColor ?? "steel", suggestion.categoryName ?? "Category") }} />
                {suggestion.categoryName ?? "Uncategorized"}
                {suggestion.tagNames.length ? ` · ${suggestion.tagNames.map((tag) => `#${tag}`).join(" ")}` : ""}
              </small>
            </span>
            <Play size={14} fill="currentColor" strokeWidth={0} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

function ManualEntryDialog({
  data,
  isBusy,
  onClose,
  onCreate
}: {
  data: BootstrapData;
  isBusy: boolean;
  onClose: () => void;
  onCreate: (input: {
    categoryId?: string;
    description?: string;
    tagNames: string[];
    startedAt: string;
    stoppedAt: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [tagNames, setTagNames] = useState<string[]>([]);
  const defaults = useMemo(() => manualEntryDefaults(data.dateRange.selectedDate), [data.dateRange.selectedDate]);
  const formId = "persistent-manual-entry-form";

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
    const outcome = await onCreate({
      categoryId: String(formData.get("categoryId") || "") || undefined,
      description: description.trim() || undefined,
      tagNames,
      startedAt,
      stoppedAt
    });
    if (outcome.ok) onClose();
    else setFormError(outcome.error);
  }

  return (
    <ModalDialog
      busy={isBusy}
      onClose={onClose}
      title="Add time"
      footer={(
        <>
          <Button onClick={onClose} disabled={isBusy}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={isBusy}>Add time</Button>
        </>
      )}
    >
      <form id={formId} className="swiss-form-grid" onSubmit={submit}>
        <SelectField
          id="manual-entry-category"
          name="categoryId"
          label="Category"
          defaultValue=""
          options={[
            { value: "", label: "Uncategorized" },
            ...data.categories.map((category) => ({ value: category.id, label: category.name }))
          ]}
        />
        <Field className="swiss-form-wide" htmlFor="manual-entry-description" label="Description">
          <InlineTagInput
            ariaLabel="Manual time entry description"
            inputClassName="ui-control"
            inputId="manual-entry-description"
            name="manual-description"
            onChange={setDescription}
            onSelectedTagNamesChange={setTagNames}
            placeholder="What did you work on?"
            selectedTagNames={tagNames}
            tags={data.tags}
            value={description}
          />
        </Field>
        <Field htmlFor="manual-entry-start" label="Start">
          <input className="ui-control" id="manual-entry-start" type="datetime-local" name="startedAt" defaultValue={defaults.start} required />
        </Field>
        <Field htmlFor="manual-entry-finish" label="Finish">
          <input className="ui-control" id="manual-entry-finish" type="datetime-local" name="stoppedAt" defaultValue={defaults.finish} required />
        </Field>
        {formError ? <p className="swiss-inline-error swiss-form-wide" role="alert">{formError}</p> : null}
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
  const start = new Date(year, month - 1, day, 9, 0, 0, 0);
  const today = new Date();
  if (dateKey(today) === selectedDate) {
    start.setHours(today.getHours(), 0, 0, 0);
  }
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
