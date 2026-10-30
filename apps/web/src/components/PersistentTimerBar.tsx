"use client";

import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DAYFRAME_APP_ICONS, previousEndOffer, resolveActivityIcon, type ClockFormat, type DayframeGlyph, type DayframePaletteKey, type PreviousEndOffer } from "@dayframe/shared";
import { Ellipsis, Plus } from "lucide-react";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { BlocksToast } from "@/components/blocks/BlocksToast";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { focusQuietly } from "@/components/blocks/TooltipHost";
import { ErrorBanner } from "@/components/blocks/ErrorBanner";
import { Odometer } from "@/components/blocks/Odometer";
import { CategoryPicker, type CreateCategoryOutcome } from "@/components/CategoryPicker";
import { FLOATING_LIST_HINTS } from "@/components/FloatingList";
import { InlineTagInput, type ActivityChoiceTrigger } from "@/components/InlineTagInput";
import { DatePickerPopover } from "@/components/DatePickerPopover";
import { TaskSuggestionsPanel } from "@/components/TaskSuggestionsPanel";
import { useKeyboardFocusRing } from "@/components/useKeyboardFocusRing";
import { IconButton } from "@/components/ui/Primitives";
import type { CalendarEntryCompactCreatePlan } from "@/lib/calendar-entry-compact-editor";
import { TimeEntryQuickCreateModal } from "@/components/TimeEntryQuickEditor";
import { RunningSplitDialog } from "@/components/RunningSplitDialog";
import { displayTypedTime, maskTimeInput, parseTimeInput } from "@/lib/calendar-grid";
import { useClockFormat } from "@/components/ClockFormat";
import { timeEntryAccentColor, timeEntryTitle } from "@/lib/display";
import { dateTimeLocalInputToIso, formatClockDuration, formatDuration, formatTime } from "@/lib/format";
import { validateManualTimeEntryWindow } from "@/lib/manual-time-entry";
import type { BootstrapData } from "@/lib/queries";
import { searchTaskSuggestions } from "@/lib/task-suggestion-search";
import { shouldStartTimerFromEntrySubmit } from "@/lib/timer-entry-draft";
import { DISCARD_RESTORE_REFUSALS, discardedBlockRestoreBlocker, quickActionTimerDraft } from "@/lib/timer-runtime";
import { newBlockCommandId, runningSplitBounds } from "@/lib/time-entry-split";
import { blockStyle } from "@/lib/block-style";
import { alreadyRecordingToastMessage, switchedToastCopy } from "@/lib/blocks-toast-copy";
import { parseCommand } from "@/lib/command-parse";
import { hasOpenDialog, isTypingTarget } from "@/lib/keyboard-ownership";
import { runningTabTitle, useRunningTabTitle } from "@/lib/running-tab-title";
import { useUiNext } from "@/components/UiNextToggle";

const TASK_SUGGESTION_LIMIT = 5;
const NOTICE_MS = 5_000;
const NOTICE_EXIT_MS = 160;

type TimerNotice = {
  /**
   * An Undo for the notice: a discarded running block's (WUI-008), shown only while nothing runs, or a split
   * running block's, shown while its second part runs (`whileRunning`).
   */
  action?: { label: string; onAction: () => void; whileRunning?: boolean };
  detail?: string | null;
  exiting: boolean;
  label: string;
  swatch?: CSSProperties;
  token: number;
};

/**
 * The idle description's placeholder is the example the old "Try …" line under the field gave
 * (owner design B1, 13 Oct 2026); the `@`/`#` keys are explained in the Suggestions footer (B2).
 * Phones get a shorter one so it is not cut off beside the activity block and Start.
 */
export const COMMAND_PLACEHOLDER = "Try “Write report @work #client”";
/** The block started, but the end the chip offered is no longer the last one: it stays at now. */
export const PREVIOUS_END_CHANGED_NOTICE = "Started now: an earlier block ends later than that, so the start wasn't moved.";
export const COMMAND_PLACEHOLDER_NARROW = "Try “Call @work”";

export function PersistentTimerBar({ workspaceMode = false, onToday = false }: { workspaceMode?: boolean; onToday?: boolean }) {
  const clock = useClockFormat();
  // While typing, the start time shows exactly what was typed (Codex r2 on #446).
  const [startTimeTyping, setStartTimeTyping] = useState(false);
  const {
    clearTimerError,
    closeManualEntry,
    createCategory,
    createManualEntry,
    deleteActiveTimer,
    joinSplitTimer,
    splitActiveTimer,
    isManualEntryOpen,
    isStopPending,
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
  const uiNext = useUiNext();
  const [timerActionsOpen, setTimerActionsOpen] = useState(false);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [startDateDraft, setStartDateDraft] = useState("");
  const [startTimeDraft, setStartTimeDraft] = useState("");
  const [startDatePickerOpen, setStartDatePickerOpen] = useState(false);
  const [startEditError, setStartEditError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  // Idle: the minute clock for the "← From 10:15" offer (a start of minute, set after
  // hydration so the server render has no offer; no per-second work).
  const [idleMinute, setIdleMinute] = useState(0);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const descriptionInputRef = useRef<HTMLInputElement | null>(null);
  const addTimeButtonRef = useRef<HTMLButtonElement | null>(null);
  const suppressSuggestionFocusRef = useRef(false);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  // Trello 213: the Description's neutral perimeter shows for keyboard focus only, never a click.
  const descriptionFocusRing = useKeyboardFocusRing();
  const startDatePickerOpenRef = useRef(false);
  startDatePickerOpenRef.current = startDatePickerOpen;
  const startTimeInputRef = useRef<HTMLInputElement | null>(null);
  const startEditorRef = useRef<HTMLDivElement | null>(null);
  const startEditorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const timerActionsRef = useRef<HTMLDivElement | null>(null);
  const timerActionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const timerActionsFirstItemRef = useRef<HTMLButtonElement | null>(null);

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
  useRunningTabTitle(active ? runningTabTitle(durationSeconds) : null);
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
    // The date trigger first, as the native date input was.
    const focusHandle = window.requestAnimationFrame(() =>
      startEditorRef.current?.querySelector<HTMLButtonElement>(".df-start-date-trigger")?.focus());
    function closeOnOutside(event: MouseEvent) {
      const target = event.target as Node;
      // The date picker is portalled (its panel, or its phone sheet and scrim): a press there is inside.
      if (target instanceof Element && target.closest(".time-entry-quick-editor-nested-surface")) return;
      if (!startEditorRef.current?.contains(target)) setStartEditorOpen(false);
    }
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      // Escape closes the open date picker first (its own listener), never the panel with it.
      if (event.key !== "Escape" || startDatePickerOpenRef.current) return;
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
    // A menu takes focus on its first item when it opens (WUI-008), so the keyboard is in it.
    const frame = window.requestAnimationFrame(() => timerActionsFirstItemRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
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
        const copy = switchedToastCopy(action.label, outcome.replaced, Date.parse(outcome.switchedAt));
        announce(copy.message, swatch, copy.detail);
      }
    });
  }

  // "← From 10:15" (after Write report): the usual Start, then the same start-time edit as the start
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

  function announce(label: string, swatch?: CSSProperties, detail?: string | null) {
    setNotice({ detail, exiting: false, label, swatch, token: ++noticeSequence.current });
  }

  /**
   * "Discard running block" (web UI audit WUI-008, owner 17 Oct 2026): the block goes at once, as
   * Today's Delete does, and the toast offers Undo for its five seconds, which starts the same
   * block again at its own start (activity, description, tags) while nothing else is running.
   */
  async function discardRunningBlock() {
    const discarded = active;
    if (!discarded) return;
    const restoreDraft = { ...timerDraft };
    const name = timeEntryTitle({
      ...discarded,
      description: restoreDraft.description.trim() || discarded.description,
      categoryName: restoreDraft.categoryId ? selectedCategory?.name ?? discarded.categoryName : discarded.categoryName
    });
    const swatchCategory = restoreDraft.categoryId ? selectedCategory : null;
    const swatch = swatchCategory ? blockStyle(swatchCategory.color, swatchCategory.name) : undefined;
    const outcome = await deleteActiveTimer();
    if (!outcome.ok) return;
    // Undo restarts it at its own start, checked inside the timer's queue against what is there
    // then (nothing running, nothing covering that time); a failed restore offers Try again with
    // the same start, so the discarded time is never lost to a later retry (Codex r1 on #469).
    const restore = async () => {
      const outcome = await startTimer(restoreDraft, {
        guard: (snapshot) => discardedBlockRestoreBlocker(snapshot, discarded),
        startedAt: discarded.startedAt
      });
      if (outcome.ok) return;
      const refused = (DISCARD_RESTORE_REFUSALS as readonly string[]).includes(outcome.error);
      setNotice({
        action: refused ? undefined : { label: "Try again", onAction: () => void restore() },
        detail: refused ? null : outcome.error,
        exiting: false,
        label: refused ? outcome.error : `Couldn't bring back ${name}.`,
        swatch,
        token: ++noticeSequence.current
      });
    };
    const token = ++noticeSequence.current;
    setNotice({
      action: {
        label: "Undo",
        onAction: () => {
          setNotice((current) => (current?.token === token ? { ...current, exiting: true } : current));
          void restore();
        }
      },
      exiting: false,
      label: `Discarded ${name}`,
      swatch,
      token
    });
  }

  /**
   * Split for the running block (owner 28 Oct 2026, as Toggl): it ends at the chosen minute and its second
   * part keeps running with the same activity, description, tags and place. The toast offers Undo for its
   * five seconds, which puts the two back as one running block. Resolves with an error for the dialog.
   */
  async function splitRunningBlock(atMs: number): Promise<string | null> {
    if (!active) return "There is no running block to split.";
    const name = timeEntryTitle({
      ...active,
      description: timerDraft.description.trim() || active.description,
      categoryName: timerDraft.categoryId ? selectedCategory?.name ?? active.categoryName : active.categoryName
    });
    const swatch = selectedCategory ? blockStyle(selectedCategory.color, selectedCategory.name) : undefined;
    const outcome = await splitActiveTimer(atMs);
    if (!outcome.ok) {
      // Nothing runs any more (the block went meanwhile): the dialog goes with it, so the reason is a notice.
      if (!readShellData()?.activeEntry) {
        setSplitDialogOpen(false);
        announce(outcome.error);
      }
      return outcome.error;
    }
    setSplitDialogOpen(false);
    // Back to "…" without its tip or ring, so at phone width the tip never covers Stop (owner, 28 Oct 2026).
    window.requestAnimationFrame(() => focusQuietly(timerActionsTriggerRef.current));
    // One command id for this Undo, Try again included: a repeat of one that was done is answered as done.
    const split = { entryId: outcome.entryId, newEntryId: outcome.newEntryId, commandId: newBlockCommandId("join") };
    const token = ++noticeSequence.current;
    const undo = async () => {
      setNotice((current) => (current?.token === token ? { ...current, exiting: true } : current));
      const joined = await joinSplitTimer(split);
      if (joined.ok) return;
      setNotice({
        action: { label: "Try again", onAction: () => void undo(), whileRunning: true },
        detail: joined.error,
        exiting: false,
        label: `Couldn't put ${name} back together.`,
        swatch,
        token: ++noticeSequence.current
      });
    };
    setNotice({
      action: { label: "Undo", onAction: () => void undo(), whileRunning: true },
      exiting: false,
      label: `Split ${name} at ${formatTime(new Date(atMs), clock)}`,
      swatch,
      token
    });
    return null;
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
    setStartDatePickerOpen(false);
    setStartEditorOpen(true);
  }

  async function saveStartTime() {
    const time = parseTimeInput(startTimeDraft);
    const startedAt = time ? dateTimeLocalInputToIso(`${startDateDraft}T${time}`) : null;
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
        workspaceMode ? "is-workspace" : "",
        // Phones show quick start on Today only (UI review decision C).
        onToday ? "is-today" : ""
      ].filter(Boolean).join(" ")}
      data-clock={clock}
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
            tagButtonFirst={uiNext}
            tags={data.tags}
            value={timerDraft.description}
          />
          {visibleTaskSuggestions.length ? (
            <TaskSuggestionsPanel
              anchorRef={suggestionsRef}
              hints={active ? FLOATING_LIST_HINTS.suggestionsUse : FLOATING_LIST_HINTS.suggestionsStart}
              // Recording, a pick only changes the bar's draft (saved by the usual autosave), so the
              // rows stay usable while an autosave is in flight: disabling them then left ↓ nothing
              // to move to and the list unusable from the keyboard (owner bug, 15 Oct). Idle, a pick
              // starts a block, so it waits for a busy timer.
              isBusy={isTimerBusy && !active}
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
              aria-label={`Edit start date and time. Started ${formatTime(active.startedAt, clock)}. Elapsed ${formatClockDuration(durationSeconds)}`}
              onClick={() => {
                if (startEditorOpen) setStartEditorOpen(false);
                else openStartEditor();
              }}
              ref={startEditorTriggerRef}
            >
              {/* Proposed (round 2): "since 07:36" sits in a fixed slot left of the digits, on their baseline. */}
              {uiNext ? <small className="df-cmd-slot">since {formatTime(active.startedAt, clock)}</small> : null}
              <Odometer value={formatClockDuration(durationSeconds)} />
              {uiNext ? null : <small>Started {formatTime(active.startedAt, clock)}</small>}
            </button>
          ) : uiNext ? (
            // Proposed (round 2, owner 30 Oct 2026): one line in every state. "From 07:51" is a small text button in the
            // same fixed slot "since" uses, then the idle clock in the same face, so nothing moves on Start or Stop.
            <div className="df-cmd-idle">
              <span className="df-cmd-slot">
                {previousEnd ? (
                  <button
                    aria-label={`Start from ${formatTime(previousEnd.startedAt, clock)}, after ${previousEnd.previousName}`}
                    className="df-cmd-from-text"
                    disabled={isTimerBusy}
                    onClick={() => void startFromPreviousEnd(previousEnd)}
                    type="button"
                  >
                    From <span className="tabular">{formatTime(previousEnd.startedAt, clock)}</span>
                  </button>
                ) : null}
              </span>
              <span className="df-cmd-clock is-idle" aria-label="Nothing is recording. Elapsed time 00:00.">
                {formatClockDuration(0)}
              </span>
            </div>
          ) : (
            <div className="df-cmd-idle">
              <span className="df-cmd-clock is-idle" aria-label="Nothing is recording. Elapsed time 00:00.">
                {formatClockDuration(0)}
              </span>
              {previousEnd ? (
                <button
                  aria-label={`Start from ${formatTime(previousEnd.startedAt, clock)}, after ${previousEnd.previousName}`}
                  className="df-cmd-from"
                  disabled={isTimerBusy}
                  onClick={() => void startFromPreviousEnd(previousEnd)}
                  type="button"
                >
                  {/* The same compact pill as the iPhone sheet (owner, 15 Oct 2026): the previous
                      block's name is in the label only. */}
                  <DayframeIcon glyph={DAYFRAME_APP_ICONS.startFromPreviousEnd} size={12} />
                  <span>From <span className="tabular">{formatTime(previousEnd.startedAt, clock)}</span></span>
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
              {/* The #391 floating-panel language (owner, 15 Oct 2026): a small uppercase head,
                  inset fields without outlines and neutral focus, the shared date picker instead
                  of the native date input, and a Blocks button pair. */}
              <header className="df-flist-head swiss-start-time-popover-header">
                <span>Start date and time</span>
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
                <div className="df-start-fields">
                  <div className="df-start-field">
                    <span className="df-start-field-label" id="active-start-date-label">Date</span>
                    <DatePickerPopover
                      ariaLabel={`Start date, ${formatStartDateLabel(startDateDraft)}. Choose start date`}
                      className="df-start-date-picker"
                      disabled={isTimerBusy}
                      label={formatStartDateLabel(startDateDraft)}
                      max={dateKey(new Date())}
                      onChange={(date) => {
                        setStartDateDraft(date);
                        setStartEditError(null);
                      }}
                      onOpenChange={setStartDatePickerOpen}
                      open={startDatePickerOpen}
                      panelClassName="time-entry-quick-editor-nested-surface df-start-date-panel"
                      panelLabel="Choose start date"
                      portal
                      today={dateKey(new Date())}
                      triggerClassName="df-start-date-trigger"
                      // Before the first opening the draft is empty: the picker needs a real day.
                      value={startDateDraft || dateKey(new Date())}
                    />
                  </div>
                  <label className="df-start-field" htmlFor="active-start-time">
                    <span className="df-start-field-label">Time</span>
                    <input
                      aria-describedby={startEditError ? "active-start-time-error" : undefined}
                      aria-invalid={startEditError ? true : undefined}
                      autoComplete="off"
                      className="df-start-time-input"
                      disabled={isTimerBusy}
                      id="active-start-time"
                      inputMode={clock === "12h" ? "text" : "numeric"}
                      onBlur={() => {
                        setStartTimeTyping(false);
                        const parsed = parseTimeInput(startTimeDraft);
                        if (parsed) setStartTimeDraft(parsed);
                      }}
                      onChange={(event) => {
                        setStartTimeTyping(true);
                        setStartTimeDraft(maskTimeInput(event.target.value));
                        setStartEditError(null);
                      }}
                      placeholder={displayTypedTime("09:00", clock)}
                      ref={startTimeInputRef}
                      type="text"
                      value={startTimeTyping ? startTimeDraft : displayTypedTime(startTimeDraft, clock)}
                    />
                  </label>
                </div>
                {lastStoppedAt ? (
                  <button
                    className="edit-entry-last-stop"
                    disabled={isTimerBusy}
                    type="button"
                    onClick={() => {
                      const stopped = new Date(lastStoppedAt);
                      setStartDateDraft(dateKey(stopped));
                      setStartTimeDraft([
                        String(stopped.getHours()).padStart(2, "0"),
                        String(stopped.getMinutes()).padStart(2, "0")
                      ].join(":"));
                      setStartEditError(null);
                    }}
                  >
                    Set to last stop time · <span className="tabular">{formatTime(lastStoppedAt, clock)}</span>
                  </button>
                ) : null}
                {startEditError ? <p className="ui-field-error" id="active-start-time-error" role="alert">{startEditError}</p> : null}
                <div className="df-start-actions">
                  <button
                    className="df-rbtn df-rbtn--ghost"
                    disabled={isTimerBusy}
                    onClick={() => {
                      setStartEditorOpen(false);
                      startEditorTriggerRef.current?.focus();
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button className="df-rbtn df-rbtn--live" disabled={isTimerBusy} onClick={() => void saveStartTime()} type="button">
                    Save
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </div>

        {/* Always type="button": Stop re-renders this same button as Start before the browser's
            default click action runs, so a submit type would start a new block straight after
            every Stop (production since 1 Sep, fixed 13 Oct). Start submits the form explicitly.
            Never disabled: a Stop during an autosave or a Start waits for it in the runtime's
            gate (a few seconds at most behind a save) and then stops the block with every typed
            edit (stability audit WEB-UI-10). While it waits the button says so: "Stopping…",
            aria-busy and a dimmed square, in the same slot (Codex r1 on #539). */}
        <button
          className={`df-cmd-go${active ? " is-stop" : ""}${active && isStopPending ? " is-pending" : ""}`}
          type="button"
          aria-busy={(Boolean(active) && isStopPending) || undefined}
          aria-label={active ? (isStopPending ? "Stopping…" : "Stop recording") : parsedCommand?.durationSeconds ? `${goLabel} ending now` : "Start a block"}
          // Proposed (round 2): Play and Stop are one round button, so it never moves; Start's words move to its tip.
          title={active && isStopPending ? "Stopping…" : uiNext && !active ? `${goLabel}${parsedCommand?.durationSeconds ? "" : " (Space)"}` : undefined}
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
                {/* Split beside Discard (owner 28 Oct 2026): the running block's split dialog. A block under two
                    minutes has nowhere to split yet. */}
                <button
                  aria-disabled={!runningSplitBounds(active, Date.now()) || undefined}
                  onClick={() => {
                    if (!runningSplitBounds(active, Date.now())) return;
                    setTimerActionsOpen(false);
                    setSplitDialogOpen(true);
                  }}
                  ref={timerActionsFirstItemRef}
                  role="menuitem"
                  title={runningSplitBounds(active, Date.now()) ? undefined : "Split needs a block of two minutes or more"}
                  type="button"
                >
                  <DayframeIcon glyph="scissors" size={16}/>
                  Split
                </button>
                <button
                  className="is-danger"
                  onClick={() => {
                    setTimerActionsOpen(false);
                    void discardRunningBlock();
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
              ref={addTimeButtonRef}
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
                <span className="df-cmd-chip">{commandRangeLabel(parsedCommand.durationSeconds, clock)}</span>
                <span className="df-cmd-hint">logs a finished block ending now</span>
              </>
            ) : (
              <span className="df-cmd-hint">Enter starts a block</span>
            )}
          </>
        ) : null}
      </div>

      {timerError ? (
        <ErrorBanner message={timerError} onDismiss={clearTimerError} />
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
        <BlocksToast
          actionLabel={notice.action && Boolean(active) === Boolean(notice.action.whileRunning) ? notice.action.label : undefined}
          detail={notice.detail}
          exiting={notice.exiting}
          key={notice.token}
          message={notice.label}
          onAction={notice.action && Boolean(active) === Boolean(notice.action.whileRunning) ? notice.action.onAction : undefined}
          swatchStyle={notice.swatch}
        />
      ) : null}

      {splitDialogOpen && active ? (
        <RunningSplitDialog
          clock={clock}
          color={selectedCategory?.color ?? active.categoryColor}
          colorName={selectedCategory?.name ?? active.categoryName}
          entry={active}
          onClose={() => setSplitDialogOpen(false)}
          onSplit={splitRunningBlock}
        />
      ) : null}

      {isManualEntryOpen ? (
        <ManualEntryEditor
          data={data}
          fallbackFocus={() => addTimeButtonRef.current ?? descriptionInputRef.current}
          isBusy={isTimerBusy}
          onClose={closeManualEntry}
          onCreateCategory={createCategory}
          onCreate={createManualEntry}
        />
      ) : null}
    </section>
  );
}

/**
 * Add time (web UI audit WUI-025, owner 17 Oct 2026): the shared block editor's "New block", as a
 * modal, instead of a separate dialog with its own date-time picker and activity dropdown. It
 * opens on the hour ending now (or 9–10 on an earlier day Calendar shows) and keeps Add time's
 * rules on save: nothing after today (D2) and a valid manual window.
 */
function ManualEntryEditor({
  data,
  fallbackFocus,
  isBusy,
  onClose,
  onCreateCategory,
  onCreate
}: {
  data: BootstrapData;
  /** Focus on close when what opened Add time is gone (the palette). */
  fallbackFocus: () => HTMLElement | null;
  isBusy: boolean;
  onClose: () => void;
  onCreateCategory: (name: string, color?: DayframePaletteKey, icon?: string) => Promise<CreateCategoryOutcome>;
  onCreate: (input: {
    categoryId?: string;
    description?: string;
    tagNames: string[];
    startedAt: string;
    stoppedAt: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  // Fixed for this opening, so a re-render never moves the draft under the person.
  const [capturedNow] = useState(() => new Date());
  const [source] = useState(() => manualEntrySource(data.dateRange.selectedDate));

  async function save(plan: CalendarEntryCompactCreatePlan) {
    const { startedAt, stoppedAt } = plan.input;
    // No day after today (owner decision D2), however Start or Finish was set (Codex r1 on #422).
    const todayKey = dateKey(new Date());
    if (dateKey(new Date(startedAt)) > todayKey || dateKey(new Date(stoppedAt)) > todayKey) {
      return { ok: false, error: "Add time can't go past today." } as const;
    }
    let validatedWindow: { startedAt: string; stoppedAt: string };
    try {
      validatedWindow = validateManualTimeEntryWindow({ now: new Date(), startedAt, stoppedAt });
    } catch (validationError) {
      return { ok: false, error: validationError instanceof Error ? validationError.message : "Check the time values." } as const;
    }
    return onCreate({ ...plan.input, ...validatedWindow });
  }

  return (
    <TimeEntryQuickCreateModal
      allowLaterToday
      capturedNow={capturedNow}
      categories={data.categories}
      fallbackFocus={fallbackFocus}
      isTimerBusy={isBusy}
      onClose={onClose}
      onCreateCategory={onCreateCategory}
      onSave={save}
      peerEntries={data.entries}
      source={source}
      tags={data.tags}
      taskSuggestionCandidates={data.taskSuggestionCandidates}
      taskSuggestions={data.taskSuggestions}
    />
  );
}

type QuickAction = {
  categoryId: string | null;
  color: string | null;
  glyph: DayframeGlyph;
  key: string;
  label: string;
};

function commandRangeLabel(durationSeconds: number, clock: ClockFormat) {
  const stoppedAt = new Date();
  stoppedAt.setSeconds(0, 0);
  const startedAt = new Date(stoppedAt.getTime() - durationSeconds * 1000);
  return `${formatTime(startedAt.toISOString(), clock)}–${formatTime(stoppedAt.toISOString(), clock)}`;
}

/** The start panel's date field: "Thu 15 Oct" (the year only when it is not this year). */
function formatStartDateLabel(dateText: string) {
  const date = new Date(`${dateText}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Choose a date";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" })
  }).format(date);
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

/** Add time's opening window: the hour ending now on today (or a later day Calendar shows; D2), or
 *  9–10 on an earlier day. */
function manualEntrySource(selectedDate: string) {
  const [year, month, day] = selectedDate.split("-").map(Number);
  const today = new Date();
  if (dateKey(today) <= selectedDate) {
    const finish = new Date(today);
    finish.setSeconds(0, 0);
    const start = new Date(finish.getTime() - 60 * 60 * 1000);
    return { startedAt: start.toISOString(), stoppedAt: finish.toISOString() };
  }
  const start = new Date(year, month - 1, day, 9, 0, 0, 0);
  const finish = new Date(start.getTime() + 60 * 60 * 1000);
  return { startedAt: start.toISOString(), stoppedAt: finish.toISOString() };
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
