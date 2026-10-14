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
import { previousEndOffer, resolveActivityIcon, type DayframeGlyph, type PreviousEndOffer } from "@dayframe/shared";
import { Clock3, Ellipsis, Plus } from "lucide-react";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { BlocksToast } from "@/components/blocks/BlocksToast";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { Odometer } from "@/components/blocks/Odometer";
import { CategoryPicker, type CreateCategoryOutcome } from "@/components/CategoryPicker";
import { FLOATING_LIST_HINTS } from "@/components/FloatingList";
import { InlineTagInput, type ActivityChoiceTrigger } from "@/components/InlineTagInput";
import { DayframeDateTimePicker } from "@/components/DayframeDateTimePicker";
import { OverlapNotice } from "@/components/OverlapNotice";
import { TaskSuggestionsPanel } from "@/components/TaskSuggestionsPanel";
import { useKeyboardFocusRing } from "@/components/useKeyboardFocusRing";
import { Button, Field, IconButton, ModalDialog } from "@/components/ui/Primitives";
import { calendarEntryLocalDayOffset } from "@/lib/calendar-entry-compact-editor";
import { timeEntryAccentColor } from "@/lib/display";
import { dateTimeLocalInputToIso, formatClockDuration, formatDuration, formatTime } from "@/lib/format";
import { validateManualTimeEntryWindow } from "@/lib/manual-time-entry";
import type { BootstrapData } from "@/lib/queries";
import { searchTaskSuggestions } from "@/lib/task-suggestion-search";
import { shouldStartTimerFromEntrySubmit } from "@/lib/timer-entry-draft";
import { quickActionTimerDraft } from "@/lib/timer-runtime";
import { blockStyle } from "@/lib/block-style";
import { alreadyRecordingToastMessage, SWITCHED_TOAST_LEAD, switchedToastMessage } from "@/lib/blocks-toast-copy";
import { parseCommand } from "@/lib/command-parse";
import { hasOpenDialog, isTypingTarget } from "@/lib/keyboard-ownership";

const TASK_SUGGESTION_LIMIT = 5;
const NOTICE_MS = 5_000;
const NOTICE_EXIT_MS = 160;

type TimerNotice = { exiting: boolean; label: string; parts?: { lead: string; name: string }; swatch?: CSSProperties; token: number };

/**
 * The idle description's placeholder is the example the old "Try …" line under the field gave
 * (owner design B1, 13 Oct 2026); the `@`/`#` keys are explained in the Suggestions footer (B2).
 * Phones get a shorter one so it is not cut off beside the activity block and Start.
 */
export const COMMAND_PLACEHOLDER = "Try “Write report @work #client”";
/** The block started, but the end the chip offered is no longer the last one: it stays at now. */
export const PREVIOUS_END_CHANGED_NOTICE = "Started now: an earlier block ends later than that, so the start wasn't moved.";
export const COMMAND_PLACEHOLDER_NARROW = "Try “Call @work”";

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
    readShellData,
    setTimerDraft,
    shellData: data,
    startTimer,
    stopTimer,
    timerDraft,
    timerDraftEdited,
    timerDraftScope,
    timerError,
    updateActiveDetails,
    updateActiveStartTime
  } = useAppShellRuntime();
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  // "Switched to …" / "Already recording …" after a quick start (UIA-209; no Undo: no un-switch).
  const [notice, setNotice] = useState<TimerNotice | null>(null);
  const noticeSequence = useRef(0);
  // Phones get the shorter idle prompt (UIA-210); measured after hydration.
  const [narrowCommand, setNarrowCommand] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [hashtagSuggestionsOpen, setHashtagSuggestionsOpen] = useState(false);
  const [startEditorOpen, setStartEditorOpen] = useState(false);
  const [timerActionsOpen, setTimerActionsOpen] = useState(false);
  const [startDateDraft, setStartDateDraft] = useState("");
  const [startTimeDraft, setStartTimeDraft] = useState("");
  const [startEditError, setStartEditError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  // Idle: the minute clock for the "From 10:15 · after …" offer (a start of minute, set after
  // hydration so the server render has no offer; no per-second work).
  const [idleMinute, setIdleMinute] = useState(0);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const descriptionInputRef = useRef<HTMLInputElement | null>(null);
  const suppressSuggestionFocusRef = useRef(false);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  // Trello 213: the Description's neutral perimeter shows for keyboard focus only, never a click.
  const descriptionFocusRing = useKeyboardFocusRing();
  const startDateInputRef = useRef<HTMLInputElement | null>(null);
  const startTimeInputRef = useRef<HTMLInputElement | null>(null);
  const startEditorRef = useRef<HTMLDivElement | null>(null);
  const startEditorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const timerActionsRef = useRef<HTMLDivElement | null>(null);
  const timerActionsTriggerRef = useRef<HTMLButtonElement | null>(null);

  const active = data?.activeEntry ?? null;
  const idle = !active;
  const selectedCategory = data?.categories.find((category) => category.id === timerDraft.categoryId) ?? null;
  const activeStartedAtMs = active ? new Date(active.startedAt).getTime() : 0;
  const lastStoppedAt = useMemo(() => {
    if (!data) return null;
    return data.entries
      .filter((entry) => entry.id !== active?.id && entry.stoppedAt)
      .map((entry) => entry.stoppedAt as string)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  }, [active?.id, data]);
  // Owner idea 1 (14 Oct 2026; PRD D16): idle, with today's last block ended 1 min–4 h ago, offer
  // to start from its end. Only the blocks already loaded, worked out once a minute (owner: no new
  // query, field or per-second work). Not beside a trailing duration (that adds a finished block).
  const entries = data?.entries;
  const durationShorthand = Boolean(timerDraft.description.trim() && parseCommand(timerDraft.description).durationSeconds);
  const previousEnd = useMemo(
    () => (idle && idleMinute && entries && !durationShorthand
      ? previousEndOffer(entries, { dayStartMs: localDayStartMs(idleMinute), startMs: idleMinute })
      : null),
    [durationShorthand, entries, idle, idleMinute]
  );
  const durationSeconds = active
    ? Math.max(active.durationSeconds, Math.floor((now - activeStartedAtMs) / 1000))
    : 0;
  const taskSuggestions = useMemo(() => data?.taskSuggestions ?? [], [data?.taskSuggestions]);
  const taskSuggestionCandidates = data?.taskSuggestionCandidates;
  const visibleTaskSuggestions = useMemo(() => {
    const query = timerDraft.description.trim();
    if (!query) return taskSuggestions.slice(0, TASK_SUGGESTION_LIMIT);
    // A typed query searches the whole recent pool, not only the contextual top 6.
    return searchTaskSuggestions(taskSuggestionCandidates, taskSuggestions, query, TASK_SUGGESTION_LIMIT);
  }, [taskSuggestionCandidates, taskSuggestions, timerDraft.description]);
  const quickActions = useMemo(() => data ? buildLearnedQuickActions(data) : [], [data]);
  // The block the description's `#`/`@` lists belong to (the runtime's draft scope: the running
  // block, or idle, kept across an accepted Start's optimistic-to-real handoff). A different block
  // closes them, even when the text reads the same.
  const completionScope = timerDraftScope ?? active?.id ?? "idle";
  const parsedCommand = useMemo(
    () => active ? null : parseCommand(timerDraft.description),
    [active, timerDraft.description]
  );
  const activeAccent = active
    ? timeEntryAccentColor({
        ...active,
        categoryName: timerDraft.categoryId ? selectedCategory?.name ?? active.categoryName : null,
        categoryColor: timerDraft.categoryId ? selectedCategory?.color ?? active.categoryColor : null,
        description: timerDraft.description.trim() || active.description
      })
    : undefined;

  // The toast's own lifetime: it leaves after five seconds (160 ms exit), or when replaced.
  useEffect(() => {
    if (!notice || notice.exiting) return undefined;
    const token = notice.token;
    const leave = setTimeout(() => {
      setNotice((current) => (current?.token === token ? { ...current, exiting: true } : current));
    }, NOTICE_MS);
    return () => clearTimeout(leave);
  }, [notice]);
  useEffect(() => {
    if (!notice?.exiting) return undefined;
    const token = notice.token;
    const gone = setTimeout(() => setNotice((current) => (current?.token === token ? null : current)), NOTICE_EXIT_MS);
    return () => clearTimeout(gone);
  }, [notice]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(max-width: 560px)");
    const update = () => setNarrowCommand(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);

  useEffect(() => {
    if (!idle) return undefined;
    const tick = () => setIdleMinute(Math.floor(Date.now() / 60_000) * 60_000);
    let interval = 0;
    const first = window.setTimeout(tick, 0);
    const aligned = window.setTimeout(() => {
      tick();
      interval = window.setInterval(tick, 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(aligned);
      window.clearInterval(interval);
    };
  }, [idle]);

  // Autosave sends the description exactly as shown, on its usual debounce, whether or not a list
  // is open: nothing is parsed, stripped or held. A half-typed `@wri` may be saved for a moment;
  // picking an activity then removes it and the next autosave sends the cleaned text. The runtime
  // saves to the block's real id, including a just-started block still shown optimistically.
  // It runs only for an edit made in this tab (`timerDraftEdited`: the draft against the server
  // copy the edit was based on), never because a newer server copy differs from the bar, and the
  // runtime sends only the edited fields, so a second tab never writes stale details back.
  // (A newer copy of the block re-arms the debounce, so an edit a busy save turned away is retried.)
  useEffect(() => {
    if (!active || !timerDraftEdited) return undefined;
    const handle = window.setTimeout(() => {
      void updateActiveDetails(timerDraft);
    }, 650);
    return () => window.clearTimeout(handle);
  }, [active, timerDraft, timerDraftEdited, updateActiveDetails]);

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
    // While recording, Enter with no list open changes nothing: the description autosaves as
    // written. (With the `@` list open, the list takes Enter and switches the activity.)
    if (active) return;
    if (!shouldStartTimerFromEntrySubmit({
      hasActiveTimer: Boolean(active),
      isBusy: isTimerBusy && Boolean(active)
    })) return;
    setSuggestionsOpen(false);
    void runCommand();
  }

  // Idle Start: a trailing duration logs a finished block ending now (through the manual-entry
  // path) instead of starting the timer. The description is otherwise sent as written.
  async function runCommand(submitted = timerDraft) {
    const command = parseCommand(submitted.description);
    const categoryId = submitted.categoryId;
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

  // An activity chosen from the description's `@` list: the only way typed `@` text leaves the
  // description (exactly the `@query` the list was open for; every other `@word` is text).
  // Recording: the running block's activity changes in place through the usual debounced
  // autosave, never a Stop or new block. Idle: Enter also starts the block; Tab, a click or a tap
  // only picks the activity.
  function chooseActivity(categoryId: string, description: string, trigger: ActivityChoiceTrigger, scope: string) {
    // A pick only ever changes the block the list was opened for.
    if (scope !== completionScope) return;
    setCommandNotice(null);
    setSuggestionsOpen(false);
    if (trigger === "enter" && !active) {
      const draft = { ...timerDraft, categoryId, description };
      setTimerDraft(draft);
      void runCommand(draft);
      return;
    }
    setTimerDraft((current) => ({ ...current, categoryId, description }));
  }

  function startQuickAction(action: QuickAction) {
    const draft = quickActionTimerDraft(action.categoryId);
    // The Activities list is not closed here: a press on a quick start is a press outside it (which
    // closes it unless a Create is saving), and the new block's scope closes it the same way, so a
    // saving Create keeps its form and outcome (Codex r4 on #402). Keys 1–6 never run while it is open.
    setSuggestionsOpen(false);
    const swatch = action.categoryId ? blockStyle(action.color, action.label) : undefined;
    // The Start decides when it runs (a queued Start can run after earlier ones settle): asking for
    // exactly the running block changes nothing and says so; a switch names the block it actually
    // replaced, timed to the switch. A Start superseded by a later one announces nothing. It is
    // asked for before the bar shows its draft, so the runtime keeps the outgoing block's edits.
    const started = startTimer(draft, { dedupeRunning: true });
    setTimerDraft(draft);
    void started.then((outcome) => {
      if (!outcome.ok || !outcome.own) return;
      if (outcome.alreadyRunning) {
        if (outcome.unchanged) announce(alreadyRecordingToastMessage(outcome.unchanged), swatch);
      } else if (outcome.replaced) {
        announce(switchedToastMessage(action.label), swatch, { lead: SWITCHED_TOAST_LEAD, name: action.label });
      }
    });
  }

  // "From 10:15 · after Write report": the usual Start, then the same start-time edit as the start
  // editor's "Set to last stop time" (owner: one path). Before the edit the loaded blocks are checked
  // again: if a newer block has ended since, or the Start did not run, the block stays at now and
  // the bar says so. Another device's change the bar hasn't loaded yet is not seen (accepted, as
  // for the existing button).
  async function startFromPreviousEnd(offer: PreviousEndOffer) {
    setCommandNotice(null);
    setSuggestionsOpen(false);
    const command = parseCommand(timerDraft.description);
    const outcome = await startTimer({ categoryId: timerDraft.categoryId, description: command.description, tagNames: timerDraft.tagNames });
    if (!outcome.ok || !outcome.own || outcome.alreadyRunning || !outcome.startedEntryId) return;
    // The runtime's blocks now (the render's `data` predates the Start and its refresh; Codex r5).
    const current = readShellData();
    const running = current?.activeEntry;
    if (!current || !running) return;
    const runningStartMs = Date.parse(running.startedAt);
    const still = previousEndOffer(current.entries, {
      dayStartMs: localDayStartMs(runningStartMs),
      excludeId: running.id,
      startMs: runningStartMs
    });
    if (still?.startedAt !== offer.startedAt) {
      setCommandNotice(PREVIOUS_END_CHANGED_NOTICE);
      return;
    }
    // Only the block this Start created: never one that replaced it meanwhile (Codex r5).
    await updateActiveStartTime(offer.startedAt, {
      expectedEntryIds: [outcome.startedEntryId, ...(outcome.startedServerId ? [outcome.startedServerId] : [])]
    });
  }

  function announce(label: string, swatch?: CSSProperties, parts?: { lead: string; name: string }) {
    setNotice({ exiting: false, label, parts, swatch, token: ++noticeSequence.current });
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
  // The preview line shows the activity the block will log to (chosen with the block or the `@`
  // list) beside a trailing duration.
  const previewCategory = parsedCommand?.durationSeconds ? selectedCategory : null;
  const commandHasShorthand = Boolean(parsedCommand && timerDraft.description.trim() && parsedCommand.durationSeconds);
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
        onSubmit={submitTimer}
        style={liveCategory ? blockStyle(liveCategory.color, liveCategory.name) : undefined}
      >
        <label className="sr-only swiss-timer-description-label" htmlFor="persistent-timer-description">
          Description
        </label>
        <span className="sr-only" id="persistent-timer-category-label">Activity</span>

        {/* The activity block opens the same Activities list as `@`, under the Description. */}
        <CategoryPicker
          anchorRef={suggestionsRef}
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
          scope={completionScope}
          selectedId={timerDraft.categoryId}
          variant="block"
        />

        <div
          className="df-cmd-field swiss-timer-description-control"
          data-focus-ring={descriptionFocusRing.focusRing}
          ref={suggestionsRef}
          {...descriptionFocusRing.handlers}
        >
          <InlineTagInput
            activities={data.categories}
            ariaLabel="Description"
            className="df-cmd-tags"
            inputId="persistent-timer-description"
            inputRef={descriptionInputRef}
            name="timer-description"
            onActivityChoose={chooseActivity}
            completionScope={completionScope}
            onChange={(description) => {
              setCommandNotice(null);
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
                // Suggestions' first row (the Tags button's list shares this wrapper).
                suggestionsRef.current?.querySelector<HTMLButtonElement>('.swiss-task-suggestions [role="option"]')?.focus();
              }
            }}
            onSelectedTagNamesChange={(tagNames) => setTimerDraft((current) => ({ ...current, tagNames }))}
            placeholder={active ? "Add a description" : narrowCommand ? COMMAND_PLACEHOLDER_NARROW : COMMAND_PLACEHOLDER}
            selectedTagNames={timerDraft.tagNames}
            tags={data.tags}
            value={timerDraft.description}
          />
          {visibleTaskSuggestions.length ? (
            <TaskSuggestionsPanel
              anchorRef={suggestionsRef}
              hints={active ? FLOATING_LIST_HINTS.suggestionsUse : FLOATING_LIST_HINTS.suggestionsStart}
              isBusy={isTimerBusy}
              isOpen={suggestionsOpen && !hashtagSuggestionsOpen}
              onClose={() => setSuggestionsOpen(false)}
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
            <div className="df-cmd-idle">
              <span className="df-cmd-clock is-idle" aria-label="Nothing is recording. Elapsed time 00:00.">
                {formatClockDuration(0)}
              </span>
              {previousEnd ? (
                <button
                  aria-label={`Start from ${formatTime(previousEnd.startedAt)}, after ${previousEnd.previousName}`}
                  className="df-cmd-from"
                  disabled={isTimerBusy}
                  onClick={() => void startFromPreviousEnd(previousEnd)}
                  type="button"
                >
                  <span className="df-cmd-from-lead">From <span className="tabular">{formatTime(previousEnd.startedAt)}</span> · after</span>
                  <span className="df-cmd-from-name">{previousEnd.previousName}</span>
                </button>
              ) : null}
            </div>
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
                    icon={<DayframeIcon glyph="calendar-days" size={16}/>}
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

        {/* Always type="button": Stop re-renders this same button as Start before the browser's
            default click action runs, so a submit type would start a new block straight after
            every Stop (production since 1 Sep, fixed 13 Oct). Start submits the form explicitly. */}
        <button
          className={`df-cmd-go${active ? " is-stop" : ""}`}
          type="button"
          disabled={Boolean(active) && isTimerBusy}
          aria-busy={(Boolean(active) && isTimerBusy) || undefined}
          aria-label={active ? "Stop recording" : parsedCommand?.durationSeconds ? `${goLabel} ending now` : "Start a block"}
          onClick={(event) => {
            if (active) {
              void stopTimer();
              return;
            }
            event.currentTarget.form?.requestSubmit();
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
                label="More block actions"
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
                  <DayframeIcon glyph="trash-2" size={16}/>
                  Discard running block
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
              <span className="df-cmd-hint">Enter starts a block</span>
            )}
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

      {notice ? (
        <BlocksToast exiting={notice.exiting} key={notice.token} lead={notice.parts?.lead} message={notice.parts?.name ?? notice.label} swatchStyle={notice.swatch} />
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
    // A read-only label, so the one Dayframe duration (the field itself takes H:MM).
    return seconds > 0 ? formatDuration(seconds) : "—";
  }, [startedAtDraft, stoppedAtDraft]);
  const finishDayOffset = useMemo(() => calendarEntryLocalDayOffset(
    startedAtDraft.slice(0, 10),
    stoppedAtDraft.slice(0, 10)
  ), [startedAtDraft, stoppedAtDraft]);
  const visibleTaskSuggestions = useMemo(() => {
    const query = description.trim();
    if (!query) return data.taskSuggestions.slice(0, TASK_SUGGESTION_LIMIT);
    return searchTaskSuggestions(data.taskSuggestionCandidates, data.taskSuggestions, query, TASK_SUGGESTION_LIMIT);
  }, [data.taskSuggestionCandidates, data.taskSuggestions, description]);
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
              ariaLabel="Manual block description"
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
                anchorRef={descriptionInteractionRef}
                isOpen={suggestionsOpen && !tagPanelOpen}
                onClose={() => setSuggestionsOpen(false)}
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

/** Midnight starting the viewer's local day containing `ms`. */
function localDayStartMs(ms: number) {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    `${date.getMonth() + 1}`.padStart(2, "0"),
    `${date.getDate()}`.padStart(2, "0")
  ].join("-");
}
