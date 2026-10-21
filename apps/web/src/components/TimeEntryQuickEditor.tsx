"use client";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RecentActivitySuggestion, RecentActivitySuggestionCandidate } from "@dayframe/shared";
import { X } from "lucide-react";
import { ActivityChipGroup, editorChipCategories } from "@/components/blocks/ActivityChipGroup";
import { ConfirmDialog } from "@/components/blocks/ConfirmDialog";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { CategoryPicker, type CreateCategoryOutcome } from "@/components/CategoryPicker";
import { DatePickerPopover } from "@/components/DatePickerPopover";
import { InlineTagInput } from "@/components/InlineTagInput";
import { OverlapNotice } from "@/components/OverlapNotice";
import { TaskSuggestionsPanel } from "@/components/TaskSuggestionsPanel";
import { searchTaskSuggestions } from "@/lib/task-suggestion-search";
import {
  buildCalendarEntryCompactCreatePlan,
  buildCalendarEntryCompactSavePlan,
  calendarEntryCompactCreateInitialDraft,
  calendarEntryCompactDraftsHaveChanges,
  calendarEntryCompactInitialDraft,
  calendarEntryLocalDayOffset,
  emptyCalendarEntryCompactDirty,
  isCalendarEntryCompactTimeInputReadyToSynchronize,
  isCompleteCalendarEntryCompactDurationInput,
  keepTypedMeridiemTime,
  inferTypedFinishDate,
  LONG_BLOCK_NOTE_SECONDS,
  normalizeCalendarEntryCompactTypedTimes,
  synchronizeCalendarEntryCompactDraft,
  trySynchronizeCalendarEntryCompactDraft,
  type CalendarEntryCompactCreatePlan,
  type CalendarEntryCompactCreateSource,
  type CalendarEntryCompactDirty,
  type CalendarEntryCompactDraft,
  type CalendarEntryCompactEditableKey,
  type CalendarEntryCompactSavePlan
} from "@/lib/calendar-entry-compact-editor";
import { displayTypedTime, maskTimeInput } from "@/lib/calendar-grid";
import { useClockFormat } from "@/components/ClockFormat";
import { clientFetch } from "@/lib/client-auth-fetch";
import { dateTimeLocal, formatDuration, formatSourceLabel } from "@/lib/format";
import { overlapNoticeForCandidate } from "@/lib/overlap-notice";
import type { OverlapPeerEntry } from "@/lib/overlap-notice";
import type { CategoryRow, TagRow, TimeEntryRow } from "@/lib/queries";

export type TimeEntryQuickEditorMutationOutcome = { ok: true } | { ok: false; error: string };

type TimeEntryQuickEditorBusyAction = "delete" | "save" | "start";

type TimeEntryQuickEditorBaseProps = {
  capturedNow: Date;
  categories: CategoryRow[];
  isTimerBusy: boolean;
  onCreateCategory?: (name: string) => Promise<CreateCategoryOutcome>;
  onDismiss: (options: { restoreFocus: boolean }) => void;
  peerEntries: OverlapPeerEntry[];
  taskSuggestions?: RecentActivitySuggestion[];
  /** The bootstrap's recent pool a typed Description searches (see `searchTaskSuggestions`). */
  taskSuggestionCandidates?: RecentActivitySuggestionCandidate[];
  tags: TagRow[];
};

export type TimeEntryQuickEditorProps = TimeEntryQuickEditorBaseProps & (
  | {
      mode: "entry";
      entry: TimeEntryRow;
      onDelete?: () => Promise<TimeEntryQuickEditorMutationOutcome | void> | TimeEntryQuickEditorMutationOutcome | void;
      onSave: (plan: CalendarEntryCompactSavePlan) => Promise<TimeEntryQuickEditorMutationOutcome>;
      onStartAgain?: () => Promise<TimeEntryQuickEditorMutationOutcome>;
    }
  | {
      mode: "create";
      /** Add time: a window later today may be added (only a later day is refused, D2). */
      allowLaterToday?: boolean;
      source: CalendarEntryCompactCreateSource;
      onDraftChange: (plan: CalendarEntryCompactCreatePlan | null) => void;
      onSave: (plan: CalendarEntryCompactCreatePlan) => Promise<TimeEntryQuickEditorMutationOutcome>;
    }
);

export function useTimeEntryQuickEditor(props: TimeEntryQuickEditorProps) {
  const temporalErrorId = useId();
  const entry = props.mode === "entry" ? props.entry : null;
  const createSource = props.mode === "create" ? props.source : null;
  const onCreateDraftChange = props.mode === "create" ? props.onDraftChange : null;
  const [draft, setDraft] = useState<CalendarEntryCompactDraft>(() => (
    props.mode === "entry"
      ? calendarEntryCompactInitialDraft(props.entry)
      : calendarEntryCompactCreateInitialDraft(props.source)
  ));
  const [dirty, setDirty] = useState<CalendarEntryCompactDirty>(emptyCalendarEntryCompactDirty);
  const [error, setError] = useState<string | null>(null);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [openDatePicker, setOpenDatePicker] = useState<"start" | "finish" | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [tagPanelOpen, setTagPanelOpen] = useState(false);
  const [dismissTagPanelsSignal, setDismissTagPanelsSignal] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<TimeEntryQuickEditorBusyAction | null>(null);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [isEntered, setIsEntered] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [now, setNow] = useState(props.capturedNow);
  const [activeTemporalOwner, setActiveTemporalOwner] = useState<"start" | "finish" | "duration" | null>(null);
  const [initialDraft, setInitialDraft] = useState<CalendarEntryCompactDraft>(() => (
    props.mode === "entry"
      ? calendarEntryCompactInitialDraft(props.entry)
      : calendarEntryCompactCreateInitialDraft(props.source)
  ));
  const panelRef = useRef<HTMLDivElement | null>(null);
  // An End date chosen in the date picker always wins over the typed End time's inferred day.
  const finishDateChosenRef = useRef(false);
  const descriptionRef = useRef<HTMLInputElement | null>(null);
  const descriptionInteractionRef = useRef<HTMLDivElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const suppressSuggestionFocusRef = useRef(false);
  const categoryButtonRef = useRef<HTMLButtonElement | null>(null);
  const discardBackRef = useRef<HTMLButtonElement | null>(null);
  const discardPromptRef = useRef(false);
  const discardReturnFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false);
  const mutationReturnFocusRef = useRef<HTMLElement | null>(null);
  const closeTokenRef = useRef(0);
  const exitTimeoutRef = useRef<number | null>(null);
  const onDraftChangeRef = useRef(onCreateDraftChange);
  const previousStoppedAtRef = useRef(entry?.stoppedAt ?? null);
  const selectedCategory = props.categories.find((category) => category.id === draft.categoryId) ?? null;
  const taskSuggestions = useMemo(() => props.taskSuggestions ?? [], [props.taskSuggestions]);
  const taskSuggestionCandidates = props.taskSuggestionCandidates;
  const visibleTaskSuggestions = useMemo(() => {
    const query = draft.description.trim();
    if (!query) return taskSuggestions.slice(0, 5);
    return searchTaskSuggestions(taskSuggestionCandidates, taskSuggestions, query, 5);
  }, [draft.description, taskSuggestionCandidates, taskSuggestions]);
  const allowLaterToday = props.mode === "create" && Boolean(props.allowLaterToday);
  const preview = useMemo(() => {
    try {
      return {
        error: null,
        plan: entry
          ? buildCalendarEntryCompactSavePlan({ draft, dirty, entry, now })
          : buildCalendarEntryCompactCreatePlan({
              allowLaterToday,
              draft,
              now,
              source: createSource as CalendarEntryCompactCreateSource
            })
      };
    } catch (previewError) {
      return {
        error: previewError instanceof Error ? previewError.message : "Check the time values.",
        plan: null
      };
    }
  }, [allowLaterToday, createSource, dirty, draft, entry, now]);
  const hasUnsavedChanges = useMemo(
    () => calendarEntryCompactDraftsHaveChanges(initialDraft, draft, { running: Boolean(entry && !entry.stoppedAt) }),
    [draft, entry, initialDraft]
  );
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  useLayoutEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);
  const controlsDisabled = isBusy || discardPrompt;
  const mutationBlockedByTimer = props.mode === "create" || !entry?.stoppedAt;
  const saveBlockedByTimer = mutationBlockedByTimer && props.isTimerBusy;

  const beginMutation = useCallback((action: TimeEntryQuickEditorBusyAction) => {
    if (busyRef.current) return false;
    const activeElement = document.activeElement;
    mutationReturnFocusRef.current = activeElement instanceof HTMLElement && panelRef.current?.contains(activeElement)
      ? activeElement
      : descriptionRef.current;
    busyRef.current = true;
    setBusyAction(action);
    setIsBusy(true);
    setError(null);
    setIsCategoryOpen(false);
    setOpenDatePicker(null);
    setDismissTagPanelsSignal((value) => value + 1);
    return true;
  }, []);

  const recoverMutation = useCallback((message: string) => {
    setError(message);
    busyRef.current = false;
    setBusyAction(null);
    setIsBusy(false);
    window.requestAnimationFrame(() => {
      const returnTarget = mutationReturnFocusRef.current;
      const canRestoreReturnTarget = Boolean(
        returnTarget?.isConnected &&
        !returnTarget.matches(":disabled") &&
        !returnTarget.closest("[inert]")
      );
      (canRestoreReturnTarget ? returnTarget : descriptionRef.current)?.focus({ preventScroll: true });
    });
  }, []);

  const updateField = useCallback(<Key extends CalendarEntryCompactEditableKey,>(
    key: Key,
    value: CalendarEntryCompactDraft[Key]
  ) => {
    if (busyRef.current) return;
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty((current) => ({ ...current, [key]: true }));
    setError(null);
  }, []);

  const applyTaskSuggestion = useCallback((suggestion: RecentActivitySuggestion) => {
    if (busyRef.current) return;
    setDraft((current) => ({
      ...current,
      categoryId: suggestion.categoryId ?? "",
      description: suggestion.description,
      tagNames: suggestion.tagNames
    }));
    setDirty((current) => ({
      ...current,
      categoryId: true,
      description: true,
      tagNames: true
    }));
    setError(null);
    setSuggestionsOpen(false);
    setDismissTagPanelsSignal((value) => value + 1);
    suppressSuggestionFocusRef.current = true;
    window.requestAnimationFrame(() => {
      descriptionRef.current?.focus({ preventScroll: true });
      window.setTimeout(() => {
        suppressSuggestionFocusRef.current = false;
      }, 0);
    });
  }, []);

  const temporalSource = useMemo(() => ({
    originalStartedAt: entry?.startedAt ?? (createSource as CalendarEntryCompactCreateSource).startedAt,
    originalStoppedAt: entry?.stoppedAt ?? createSource?.stoppedAt ?? null
  }), [createSource, entry]);

  const updateTemporalField = useCallback((
    key: "startedAtDate" | "startedAtTime" | "stoppedAtDate" | "stoppedAtTime" | "duration",
    value: string,
    owner: "start" | "finish" | "duration",
    commit = false
  ) => {
    if (busyRef.current) return;
    setActiveTemporalOwner(commit ? null : owner);
    if (key === "stoppedAtDate") finishDateChosenRef.current = true;
    setDraft((current) => {
      const typed = { ...current, [key]: value, temporalOwner: owner };
      const next = key === "stoppedAtTime" && !finishDateChosenRef.current ? inferTypedFinishDate(typed) : typed;
      const isComplete = commit || (owner === "duration"
        ? isCompleteCalendarEntryCompactDurationInput(value)
        : isCalendarEntryCompactTimeInputReadyToSynchronize(value));
      if (!isComplete) return next;
      const synchronized = trySynchronizeCalendarEntryCompactDraft({ ...temporalSource, draft: next, owner });
      if (!synchronized) return next;
      return !commit && (key === "startedAtTime" || key === "stoppedAtTime")
        ? keepTypedMeridiemTime(synchronized, key, value)
        : synchronized;
    });
    setDirty((current) => ({ ...current, [key]: true }));
    setError(null);
  }, [temporalSource]);

  const commitTemporalField = useCallback((owner: "start" | "finish" | "duration") => {
    if (busyRef.current) return;
    setActiveTemporalOwner(null);
    setDraft((current) => {
      if (current.temporalOwner !== owner) return current;
      // Leaving a time field commits what the shared reader understands (`15:1` → 15:10).
      const normalized = owner === "duration" ? current : normalizeCalendarEntryCompactTypedTimes(current);
      const committed = owner === "finish" && !finishDateChosenRef.current ? inferTypedFinishDate(normalized) : normalized;
      try {
        return synchronizeCalendarEntryCompactDraft({ ...temporalSource, draft: committed, owner });
      } catch {
        return { ...committed, temporalOwner: owner };
      }
    });
    setError(null);
  }, [temporalSource]);

  const finishDismiss = useCallback((restoreFocus: boolean) => {
    if (exitTimeoutRef.current !== null) {
      window.clearTimeout(exitTimeoutRef.current);
      exitTimeoutRef.current = null;
    }
    closeTokenRef.current += 1;
    props.onDismiss({ restoreFocus });
  }, [props]);

  const requestDismiss = useCallback((restoreFocus: boolean) => {
    if (busyRef.current) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      finishDismiss(restoreFocus);
      return;
    }
    const token = ++closeTokenRef.current;
    setIsExiting(true);
    if (exitTimeoutRef.current !== null) window.clearTimeout(exitTimeoutRef.current);
    exitTimeoutRef.current = window.setTimeout(() => {
      exitTimeoutRef.current = null;
      if (closeTokenRef.current === token) props.onDismiss({ restoreFocus });
    }, 90);
  }, [finishDismiss, props]);

  const showDiscardPrompt = useCallback(() => {
    if (discardPromptRef.current) return;
    const panel = panelRef.current;
    const activeElement = document.activeElement;
    discardReturnFocusRef.current = panel && activeElement instanceof HTMLElement && panel.contains(activeElement)
      ? activeElement
      : descriptionRef.current;
    discardPromptRef.current = true;
    setIsCategoryOpen(false);
    setOpenDatePicker(null);
    setDismissTagPanelsSignal((value) => value + 1);
    setDiscardPrompt(true);
    window.requestAnimationFrame(() => discardBackRef.current?.focus());
  }, []);

  const cancelDiscardPrompt = useCallback(() => {
    discardPromptRef.current = false;
    setDiscardPrompt(false);
    window.requestAnimationFrame(() => {
      const returnTarget = discardReturnFocusRef.current;
      (returnTarget?.isConnected ? returnTarget : descriptionRef.current)?.focus({ preventScroll: true });
    });
  }, []);

  const confirmDiscard = useCallback(() => {
    discardPromptRef.current = false;
    setDiscardPrompt(false);
    requestDismiss(false);
  }, [requestDismiss]);

  const attemptDismiss = useCallback((restoreFocus: boolean) => {
    if (busyRef.current) return;
    if (hasUnsavedChangesRef.current) {
      showDiscardPrompt();
      return;
    }
    requestDismiss(restoreFocus);
  }, [requestDismiss, showDiscardPrompt]);

  useEffect(() => () => {
    closeTokenRef.current += 1;
    discardPromptRef.current = false;
    if (exitTimeoutRef.current !== null) window.clearTimeout(exitTimeoutRef.current);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setIsEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    onDraftChangeRef.current = onCreateDraftChange;
  }, [onCreateDraftChange]);

  useEffect(() => {
    const previousStoppedAt = previousStoppedAtRef.current;
    const nextStoppedAt = entry?.stoppedAt ?? null;
    previousStoppedAtRef.current = nextStoppedAt;
    if (!entry || previousStoppedAt || !nextStoppedAt) return;
    const stoppedDraft = calendarEntryCompactInitialDraft(entry);
    setDraft((current) => {
      const merged = {
        ...current,
        stoppedAtDate: stoppedDraft.stoppedAtDate,
        stoppedAtTime: stoppedDraft.stoppedAtTime,
        duration: stoppedDraft.duration,
        temporalOwner: "source" as const
      };
      const startWasEdited = current.startedAtDate !== stoppedDraft.startedAtDate ||
        current.startedAtTime !== stoppedDraft.startedAtTime;
      if (!startWasEdited) return merged;
      try {
        return synchronizeCalendarEntryCompactDraft({
          draft: { ...merged, temporalOwner: "finish" },
          originalStartedAt: entry.startedAt,
          originalStoppedAt: nextStoppedAt,
          owner: "finish"
        });
      } catch {
        return { ...merged, temporalOwner: "finish" };
      }
    });
    setInitialDraft((current) => ({
      ...current,
      stoppedAtDate: stoppedDraft.stoppedAtDate,
      stoppedAtTime: stoppedDraft.stoppedAtTime,
      duration: stoppedDraft.duration,
      durationSeconds: stoppedDraft.durationSeconds
    }));
  }, [entry]);

  useEffect(() => {
    if (!createSource) return;
    onDraftChangeRef.current?.(preview.plan as CalendarEntryCompactCreatePlan | null);
  }, [createSource, preview.plan]);

  useEffect(() => {
    if (!createSource && (!entry || entry.stoppedAt)) return undefined;
    const interval = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(interval);
  }, [createSource, entry]);

  useEffect(() => {
    if (!suggestionsOpen) return undefined;
    function closeOnOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !descriptionInteractionRef.current?.contains(target) &&
        !suggestionsRef.current?.contains(target)
      ) setSuggestionsOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, [suggestionsOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (busyRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (discardPromptRef.current) {
        event.preventDefault();
        cancelDiscardPrompt();
        return;
      }
      // Only a Suggestions list on screen takes Escape; an empty one (nothing to suggest) lets the
      // first Escape close the editor.
      if (suggestionsOpen && visibleTaskSuggestions.length) {
        event.preventDefault();
        setSuggestionsOpen(false);
        suppressSuggestionFocusRef.current = true;
        descriptionRef.current?.focus({ preventScroll: true });
        window.setTimeout(() => {
          suppressSuggestionFocusRef.current = false;
        }, 0);
        return;
      }
      if (openDatePicker || tagPanelOpen) return;
      if (isCategoryOpen) {
        event.preventDefault();
        setIsCategoryOpen(false);
        categoryButtonRef.current?.focus();
        return;
      }
      event.preventDefault();
      attemptDismiss(true);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [attemptDismiss, cancelDiscardPrompt, isCategoryOpen, openDatePicker, suggestionsOpen, tagPanelOpen, visibleTaskSuggestions.length]);

  function handleTaskSuggestionKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!suggestionsOpen || tagPanelOpen || !visibleTaskSuggestions.length) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setSuggestionsOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      suggestionsRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus();
    }
  }

  function handleTaskSuggestionFocus() {
    if (suppressSuggestionFocusRef.current) {
      suppressSuggestionFocusRef.current = false;
      return;
    }
    setSuggestionsOpen(true);
  }

  async function save() {
    if (busyRef.current || saveBlockedByTimer) return;
    let plan: CalendarEntryCompactSavePlan | CalendarEntryCompactCreatePlan;
    try {
      const saveNow = new Date();
      // Save commits typed times as leaving the field does (`15:1` → 15:10).
      const committed = normalizeCalendarEntryCompactTypedTimes(draft);
      plan = props.mode === "entry"
        ? buildCalendarEntryCompactSavePlan({ draft: committed, dirty, entry: props.entry, now: saveNow })
        : buildCalendarEntryCompactCreatePlan({ allowLaterToday: props.allowLaterToday, draft: committed, now: saveNow, source: props.source });
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "Check the time values.");
      return;
    }
    if (entry && Object.keys((plan as CalendarEntryCompactSavePlan).payload).length === 0) {
      finishDismiss(true);
      return;
    }
    if (!beginMutation("save")) return;
    let outcome: TimeEntryQuickEditorMutationOutcome;
    try {
      outcome = props.mode === "entry"
        ? await props.onSave(plan as CalendarEntryCompactSavePlan)
        : await props.onSave(plan as CalendarEntryCompactCreatePlan);
    } catch {
      outcome = { ok: false, error: "Unable to save this block. Check your connection and try again." };
    }
    if (!outcome.ok) {
      recoverMutation(outcome.error);
      return;
    }
    finishDismiss(true);
  }

  function handleDescriptionEnter(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      event.nativeEvent.isComposing || busyRef.current
    ) return;
    event.preventDefault();
    void save();
  }

  async function startAgain() {
    if (props.mode !== "entry" || !props.onStartAgain || busyRef.current || props.isTimerBusy) return;
    if (!beginMutation("start")) return;
    let outcome: TimeEntryQuickEditorMutationOutcome;
    try {
      outcome = await props.onStartAgain();
    } catch {
      outcome = { ok: false, error: "Unable to start this block again. Check your connection and try again." };
    }
    if (!outcome.ok) {
      recoverMutation(outcome.error);
      return;
    }
    finishDismiss(false);
  }

  async function deleteEntry() {
    if (props.mode !== "entry" || !props.onDelete || busyRef.current) return;
    if (!beginMutation("delete")) return;
    try {
      const outcome = await props.onDelete();
      if (outcome && !outcome.ok) {
        recoverMutation(outcome.error);
        return;
      }
      finishDismiss(false);
    } catch {
      recoverMutation("Unable to delete this block. Check your connection and try again.");
    }
  }

  const title = entry
    ? entry.description?.trim() || entry.categoryName?.trim() || "Untitled block"
    : draft.description.trim() || selectedCategory?.name || "No activity";
  const previewError = activeTemporalOwner ? null : preview.error;
  const displayError = error ?? previewError;
  const startIsInvalid = Boolean(displayError && (/^Start\b/i.test(displayError) || /valid start/i.test(displayError)));
  const finishIsInvalid = Boolean(displayError && (/^Finish\b/i.test(displayError) || /valid finish/i.test(displayError)));
  const durationIsInvalid = Boolean(displayError && /duration/i.test(displayError));
  const isRunning = Boolean(entry && (!entry.stoppedAt || !draft.stoppedAtDate));
  const today = dateTimeLocal(now.toISOString()).slice(0, 10);
  const overlap = preview.plan
    ? overlapNoticeForCandidate({
        candidate: {
          startedAt: preview.plan.resolved.startedAt,
          stoppedAt: preview.plan.resolved.stoppedAt
        },
        entries: props.peerEntries,
        excludeEntryId: entry?.id ?? null
      })
    : null;
  const feedbackMode = discardPrompt
    ? "discard"
    : displayError
      ? "error"
      : overlap?.overlapCount
        ? "overlap"
        : "default";
  const finishDayOffset = isRunning ? 0 : calendarEntryLocalDayOffset(draft.startedAtDate, draft.stoppedAtDate);
  const longBlockSeconds = preview.plan?.durationSeconds ?? draft.durationSeconds;

  return {
    activeTemporalOwner,
    attemptDismiss,
    applyTaskSuggestion,
    busyAction,
    cancelDiscardPrompt,
    categoryButtonRef,
    commitTemporalField,
    confirmDiscard,
    controlsDisabled,
    deleteEntry,
    descriptionRef,
    descriptionInteractionRef,
    discardBackRef,
    discardPrompt,
    dismissTagPanelsSignal,
    displayError,
    draft,
    feedbackMode,
    finishDayOffset,
    finishIsInvalid,
    handleDescriptionEnter,
    handleTaskSuggestionFocus,
    handleTaskSuggestionKeyDown,
    hasUnsavedChanges,
    isBusy,
    isCategoryOpen,
    isEntered,
    isExiting,
    isRunning,
    longBlockSeconds,
    panelRef,
    preview,
    save,
    saveBlockedByTimer,
    setIsCategoryOpen,
    setOpenDatePicker,
    setSuggestionsOpen,
    setTagPanelOpen,
    startAgain,
    startIsInvalid,
    today,
    temporalErrorId,
    title,
    updateField,
    updateTemporalField,
    suggestionsOpen,
    suggestionsRef,
    visibleTaskSuggestions,
    durationIsInvalid
  };
}

export type TimeEntryQuickEditorController = ReturnType<typeof useTimeEntryQuickEditor>;

export function TimeEntryQuickEditorPanel({
  controller,
  props,
  showCancel = false,
  surface
}: {
  controller: TimeEntryQuickEditorController;
  props: TimeEntryQuickEditorProps;
  showCancel?: boolean;
  surface: "anchored" | "modal";
}) {
  const clock = useClockFormat();
  const entry = props.mode === "entry" ? props.entry : null;
  const {
    busyAction,
    categoryButtonRef,
    commitTemporalField,
    controlsDisabled,
    descriptionInteractionRef,
    descriptionRef,
    discardBackRef,
    discardPrompt,
    displayError,
    draft,
    feedbackMode,
    finishDayOffset,
    finishIsInvalid,
    isBusy,
    isCategoryOpen,
    isRunning,
    longBlockSeconds,
    panelRef,
    preview,
    saveBlockedByTimer,
    startIsInvalid,
    suggestionsOpen,
    suggestionsRef,
    temporalErrorId,
    today,
    title,
    visibleTaskSuggestions
  } = controller;
  const finishDescription = finishDayOffset === 1
    ? "End time, one day after Start"
    : finishDayOffset > 1
      ? `End time, ${finishDayOffset} days after Start`
      : "End time";
  // Blocks editor head (prototype "Edit block"): an eyebrow with the day (or Recording) and the title.
  const editorHeading = props.mode === "entry" ? (isRunning ? "Running block" : "Edit block") : "New block";
  const editorEyebrow = isRunning ? "Recording" : formatEyebrowDate(draft.startedAtDate);
  // The chip set follows the last activity chosen, so clearing a chip chosen through "All
  // activities" keeps it (and keyboard focus) in place instead of removing it.
  const [chipAnchorId, setChipAnchorId] = useState(draft.categoryId);
  if (draft.categoryId && draft.categoryId !== chipAnchorId) setChipAnchorId(draft.categoryId);

  function saveButton() {
    return (
      <button
        type="button"
        className="calendar-compact-save"
        // "Add" on the button (it never wraps, WUI-004); the name keeps what is added.
        aria-label={entry ? undefined : "Add block"}
        aria-busy={busyAction === "save" || undefined}
        disabled={isBusy || saveBlockedByTimer || !preview.plan}
        onClick={() => void controller.save()}
      >
        {entry ? "Save" : "Add"}
      </button>
    );
  }

  function cancelButton() {
    return showCancel ? (
      <button
        type="button"
        className="calendar-compact-cancel"
        disabled={isBusy}
        onClick={() => controller.attemptDismiss(true)}
      >
        Cancel
      </button>
    ) : null;
  }

  return (
    <div
      ref={panelRef}
      className="calendar-compact-editor-panel"
      data-editor-surface={surface}
      data-testid="time-entry-quick-editor"
      role="dialog"
      aria-label={entry ? `Edit ${title}` : "New block"}
      aria-busy={isBusy || undefined}
      aria-modal={surface === "modal"}
      // While "Discard unsaved changes?" asks, only its two buttons can be reached.
      inert={discardPrompt || undefined}
    >
      {busyAction ? (
        <span className="sr-only" role="status" aria-live="polite">
          {busyAction === "delete" ? "Deleting block…" : busyAction === "start" ? "Starting block…" : "Saving block…"}
        </span>
      ) : null}
      <div className="calendar-compact-editor-header df-ed-head">
        <div>
          <p className="df-ed-eyebrow">{editorEyebrow}</p>
          <h2>{editorHeading}</h2>
          {/* Log automatically (PRD D17): where an auto-logged visit's block came from. */}
          {entry?.source === "location_auto_log" ? (
            <p className="df-ed-source" data-testid="time-entry-source">
              {formatSourceLabel(entry.source, { placeName: entry.placeName })}
            </p>
          ) : null}
        </div>
        {/* The block's own actions as icon buttons, top right (owner, 21 Oct 2026, superseding
            WUI-006's footer pills): ↺ Start again · trash Delete (Discard while running) · gap · ✕,
            with the registry glyphs and tooltips the List and Today rows use. */}
        <div className="calendar-compact-editor-icons">
          {entry?.stoppedAt && props.mode === "entry" && props.onStartAgain ? (
            <button
              className="calendar-compact-icon-action"
              type="button"
              aria-label={`Start again: ${title}`}
              aria-busy={busyAction === "start" || undefined}
              data-tip="Start again"
              disabled={controlsDisabled || props.isTimerBusy}
              onClick={() => void controller.startAgain()}
            >
              <DayframeIcon glyph="rotate-ccw" size={18} />
            </button>
          ) : null}
          {props.mode === "entry" && props.onDelete ? (
            <button
              className="calendar-compact-icon-action is-danger"
              type="button"
              // The tooltip's word leads the name (WCAG 2.5.3), then which block.
              aria-label={isRunning ? `Discard ${title}` : `Delete ${title}`}
              aria-busy={busyAction === "delete" || undefined}
              data-tip={isRunning ? "Discard" : "Delete"}
              disabled={controlsDisabled}
              onClick={() => void controller.deleteEntry()}
            >
              <DayframeIcon glyph="trash-2" size={18} />
            </button>
          ) : null}
          <button
            className="calendar-compact-icon-action is-close"
            type="button"
            aria-label="Close editor"
            data-tip="Close"
            disabled={controlsDisabled}
            onClick={() => controller.attemptDismiss(true)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="calendar-compact-editor-fields">
        <div className="calendar-compact-editor-description time-entry-quick-description">
          <label className="sr-only" htmlFor="time-entry-quick-description">Description</label>
          <div className="time-entry-quick-description-control" ref={descriptionInteractionRef}>
            <InlineTagInput
              ariaLabel="Description"
              className="time-entry-quick-tags"
              closeSignal={controller.dismissTagPanelsSignal}
              disabled={controlsDisabled}
              inputId="time-entry-quick-description"
              inputRef={descriptionRef}
              onChange={(value) => {
                controller.updateField("description", value);
                controller.setSuggestionsOpen(true);
              }}
              onClick={() => controller.setSuggestionsOpen(true)}
              onFocus={controller.handleTaskSuggestionFocus}
              onHashtagPanelChange={(open) => {
                controller.setTagPanelOpen(open);
                if (open) controller.setSuggestionsOpen(false);
              }}
              onInputKeyDown={controller.handleTaskSuggestionKeyDown}
              onEnter={controller.handleDescriptionEnter}
              onSelectedTagNamesChange={(tagNames) => controller.updateField("tagNames", tagNames)}
              placeholder={isRunning ? "What are you working on?" : "What did you work on?"}
              portal
              selectedTagNames={draft.tagNames}
              tags={props.tags}
              value={draft.description}
            />
            {visibleTaskSuggestions.length ? (
              <TaskSuggestionsPanel
                anchorRef={descriptionInteractionRef}
                isBusy={isBusy}
                isOpen={suggestionsOpen}
                onClose={() => controller.setSuggestionsOpen(false)}
                onSelect={controller.applyTaskSuggestion}
                panelRef={suggestionsRef}
                portal
                suggestions={visibleTaskSuggestions}
              />
            ) : null}
          </div>
        </div>

        <ActivityChipGroup
          categories={editorChipCategories(props.categories, chipAnchorId)}
          maxRows={2}
          disabled={controlsDisabled}
          onSelect={(categoryId) => controller.updateField("categoryId", categoryId)}
          selectedId={draft.categoryId}
          trailing={
            <CategoryPicker
              categories={props.categories}
              disabled={controlsDisabled}
              menuId="time-entry-quick-category-menu"
              onBeforeOpen={() => controller.setSuggestionsOpen(false)}
              onCreateCategory={props.onCreateCategory}
              onOpenChange={controller.setIsCategoryOpen}
              onSelect={(categoryId) => controller.updateField("categoryId", categoryId)}
              open={isCategoryOpen}
              portal={Boolean(props.onCreateCategory)}
              selectedId={draft.categoryId}
              triggerRef={categoryButtonRef}
              variant="more"
            />
          }
        />

        <div className="calendar-compact-temporal-fields" data-clock={clock}>
          <div className="calendar-compact-moment-field">
            <span className="calendar-compact-field-label">Start</span>
            <div className="calendar-compact-date-time-controls">
              <input
                aria-describedby={feedbackMode === "error" && startIsInvalid ? temporalErrorId : undefined}
                aria-invalid={startIsInvalid || undefined}
                aria-label="Start time"
                disabled={controlsDisabled}
                inputMode={clock === "12h" ? "text" : "numeric"}
                onBlur={() => commitTemporalField("start")}
                onChange={(event) => controller.updateTemporalField("startedAtTime", maskTimeInput(event.target.value), "start")}
                placeholder={displayTypedTime("08:30", clock)}
                type="text"
                // While typing, the field shows exactly what was typed; it reads in the device's format
                // once left (Codex r2 on #446: never append " AM" under the caret).
                value={controller.activeTemporalOwner === "start" ? draft.startedAtTime : displayTypedTime(draft.startedAtTime, clock)}
              />
              <DatePickerPopover
                ariaLabel={`Choose Start date, currently ${formatAccessibleDate(draft.startedAtDate)}`}
                className="calendar-compact-date-picker"
                disabled={controlsDisabled}
                iconOnly
                label={formatAccessibleDate(draft.startedAtDate)}
                onChange={(date) => controller.updateTemporalField("startedAtDate", date, "start", true)}
                onOpenChange={(open) => {
                  if (open) controller.setSuggestionsOpen(false);
                  controller.setOpenDatePicker((current) => open ? "start" : current === "start" ? null : current);
                }}
                panelClassName="calendar-compact-date-picker-panel time-entry-quick-editor-nested-surface"
                panelLabel="Choose Start date"
                portal
                max={today}
                today={today}
                triggerClassName="calendar-compact-date-trigger"
                value={draft.startedAtDate}
              />
            </div>
          </div>

          <div className="calendar-compact-moment-field">
            <span className="calendar-compact-field-label">End</span>
            {isRunning ? (
              <div className="calendar-compact-running-value">Running</div>
            ) : (
              <div className="calendar-compact-date-time-controls">
                <input
                  aria-describedby={feedbackMode === "error" && finishIsInvalid ? temporalErrorId : undefined}
                  aria-invalid={finishIsInvalid || undefined}
                  aria-label={finishDescription}
                  disabled={controlsDisabled}
                  inputMode={clock === "12h" ? "text" : "numeric"}
                  onBlur={() => commitTemporalField("finish")}
                  onChange={(event) => controller.updateTemporalField("stoppedAtTime", maskTimeInput(event.target.value), "finish")}
                  placeholder={displayTypedTime("09:15", clock)}
                  type="text"
                  value={controller.activeTemporalOwner === "finish" ? draft.stoppedAtTime : displayTypedTime(draft.stoppedAtTime, clock)}
                />
                {finishDayOffset > 0 ? (
                  <span className="calendar-compact-day-offset" aria-hidden="true" title={finishDescription}>+{finishDayOffset}</span>
                ) : null}
                <DatePickerPopover
                  ariaLabel={`Choose End date, currently ${formatAccessibleDate(draft.stoppedAtDate)}`}
                  className="calendar-compact-date-picker"
                  disabled={controlsDisabled}
                  iconOnly
                  label={formatAccessibleDate(draft.stoppedAtDate)}
                  onChange={(date) => controller.updateTemporalField("stoppedAtDate", date, "finish", true)}
                  onOpenChange={(open) => {
                    if (open) controller.setSuggestionsOpen(false);
                    controller.setOpenDatePicker((current) => open ? "finish" : current === "finish" ? null : current);
                  }}
                  panelClassName="calendar-compact-date-picker-panel time-entry-quick-editor-nested-surface"
                  panelLabel="Choose End date"
                  portal
                  max={today}
                  today={today}
                  triggerClassName="calendar-compact-date-trigger"
                  value={draft.stoppedAtDate}
                />
              </div>
            )}
          </div>

          {isRunning ? (
            <div className="calendar-compact-duration-field">
              <span className="calendar-compact-field-label">Duration</span>
              <div className="calendar-compact-duration is-readonly" aria-label="Elapsed time">
                <span className="tabular">
                  {preview.plan ? formatDuration(preview.plan.durationSeconds) : "—"}
                </span>
              </div>
            </div>
          ) : (
            <label className="calendar-compact-duration-input">
              <span>Duration</span>
              <input
                aria-describedby={feedbackMode === "error" && controller.durationIsInvalid ? temporalErrorId : undefined}
                aria-invalid={controller.durationIsInvalid || undefined}
                aria-label="Duration"
                disabled={controlsDisabled}
                inputMode="text"
                onBlur={() => commitTemporalField("duration")}
                onChange={(event) => controller.updateTemporalField("duration", event.target.value.replace(/[^\dhm:\s]/gi, ""), "duration")}
                placeholder="30m"
                type="text"
                value={draft.duration}
              />
            </label>
          )}
        </div>
        {!isRunning && longBlockSeconds > LONG_BLOCK_NOTE_SECONDS ? (
          // A gentle check on a long block (owner, 21 Oct 2026): muted, inline, never blocks Save.
          <p className="calendar-compact-long-note" role="status">
            Long block · {formatDuration(longBlockSeconds)}. Is the end right?
          </p>
        ) : null}
      </div>

      {/* Footer (prototype "Edit block", WUI-004): a note (an error or an overlap) on its own line
          above the actions, never squeezing them; then just Cancel and Save on the right. */}
      <div className="calendar-compact-editor-footer df-ed-foot" data-feedback-mode={feedbackMode}>
        <div
          className={`df-ed-note${feedbackMode === "error" || feedbackMode === "overlap" ? " is-shown" : ""}`}
          aria-hidden={feedbackMode !== "error" && feedbackMode !== "overlap"}
        >
          <div className={`calendar-compact-feedback-copy${feedbackMode === "error" ? " is-error" : ""}`}>
            {feedbackMode === "error" && displayError ? (
              <p id={temporalErrorId} role="alert" aria-atomic="true" aria-live="assertive">{displayError}</p>
            ) : null}
            {feedbackMode === "overlap" && preview.plan ? (
              <OverlapNotice
                compact
                candidate={{
                  startedAt: preview.plan.resolved.startedAt,
                  stoppedAt: preview.plan.resolved.stoppedAt
                }}
                entries={props.peerEntries}
                excludeEntryId={entry?.id ?? null}
              />
            ) : null}
          </div>
        </div>
        <div className="df-ed-actions">
          <div className="df-ed-actions-end">
            {cancelButton()}
            {saveButton()}
          </div>
        </div>
      </div>
      {/* Unsaved changes ask once, in the shared confirmation (WUI-005); it is part of the editor's
          interaction boundary, so pressing it never counts as a press outside the editor. */}
      <ConfirmDialog
        body="Your changes to this block will be lost."
        cancelLabel="Go back"
        cancelRef={discardBackRef}
        confirmLabel="Discard"
        onCancel={controller.cancelDiscardPrompt}
        onConfirm={controller.confirmDiscard}
        open={discardPrompt}
        surfaceClassName="time-entry-quick-editor-nested-surface"
        title="Discard unsaved changes?"
      />
    </div>
  );
}

export function TimeEntryQuickEditorModal(props: Omit<Extract<TimeEntryQuickEditorProps, { mode: "entry" }>, "mode" | "onDismiss"> & {
  onClose: () => void;
}) {
  return <QuickEditorModal modalProps={{ ...props, mode: "entry", onDismiss: props.onClose }} />;
}

/**
 * The same editor opened to add a finished block (web UI audit WUI-025, owner 17 Oct 2026): the
 * timer's Add time and the palette open this "New block" modal instead of a separate dialog.
 */
export function TimeEntryQuickCreateModal({ fallbackFocus, ...props }: Omit<Extract<TimeEntryQuickEditorProps, { mode: "create" }>, "mode" | "onDismiss" | "onDraftChange"> & {
  /**
   * Where focus goes on close when what had focus at opening is gone (the palette that opened
   * Add time closes as it does; Codex r1 on #468).
   */
  fallbackFocus?: () => HTMLElement | null;
  onClose: () => void;
}) {
  return (
    <QuickEditorModal
      fallbackFocus={fallbackFocus}
      modalProps={{ ...props, mode: "create", onDismiss: props.onClose, onDraftChange: ignoreDraftChange }}
    />
  );
}

function ignoreDraftChange() {
  // Only Calendar draws a live create preview.
}

function QuickEditorModal({
  fallbackFocus,
  modalProps
}: {
  fallbackFocus?: () => HTMLElement | null;
  modalProps: TimeEntryQuickEditorProps;
}) {
  const controller = useTimeEntryQuickEditor(modalProps);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const fallbackFocusRef = useRef(fallbackFocus);
  useLayoutEffect(() => {
    fallbackFocusRef.current = fallbackFocus;
  });

  useLayoutEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => controller.descriptionRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      const previous = previouslyFocusedRef.current;
      const target = previous && previous.isConnected && previous !== document.body ? previous : fallbackFocusRef.current?.();
      target?.focus({ preventScroll: true });
      // A Discard under Reduce Motion unmounts the editor while its confirmation still holds the
      // page inert, so that focus is refused; try once more when the page is interactive again
      // (Codex r2 on #469).
      if (target && target.closest("[inert]")) {
        window.requestAnimationFrame(() => {
          if (target.isConnected && !target.closest("[inert]") && (document.activeElement === document.body || !document.activeElement)) {
            target.focus({ preventScroll: true });
          }
        });
      }
    };
  }, [controller.descriptionRef]);

  useEffect(() => {
    function containFocus(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const roots = [
        controller.panelRef.current,
        ...document.querySelectorAll<HTMLElement>(".time-entry-quick-editor-nested-surface")
      ].filter((root): root is HTMLElement => Boolean(root));
      const focusable = roots.flatMap((root) => [...root.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([inert] *), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )]).filter((element) => element.offsetParent !== null && !element.closest("[inert]"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", containFocus);
    return () => document.removeEventListener("keydown", containFocus);
  }, [controller.panelRef]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="time-entry-quick-editor-modal-backdrop"
      data-testid="time-entry-quick-editor-modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) controller.attemptDismiss(false);
      }}
    >
      <div className={`time-entry-quick-editor-modal${controller.isEntered ? " is-entered" : ""}${controller.isExiting ? " is-exiting" : ""}`}>
        <TimeEntryQuickEditorPanel controller={controller} props={modalProps} showCancel surface="modal" />
      </div>
    </div>,
    document.body
  );
}

export async function saveTimeEntryQuickEdit(entryId: string, plan: CalendarEntryCompactSavePlan) {
  try {
    const response = await clientFetch(`/api/time-entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan.payload)
    });
    if (!response.ok) {
      let message = `Unable to save this block: ${response.status}`;
      try {
        const payload = (await response.json()) as { error?: string };
        message = payload.error ?? message;
      } catch {
        // Keep the status fallback when the response is not JSON.
      }
      return { ok: false, error: message } as const;
    }
    return { ok: true } as const;
  } catch {
    return { ok: false, error: "Unable to save this block. Check your connection and try again." } as const;
  }
}

function formatAccessibleDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(year, month - 1, day, 12));
}

function formatEyebrowDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date(year, month - 1, day, 12));
}
