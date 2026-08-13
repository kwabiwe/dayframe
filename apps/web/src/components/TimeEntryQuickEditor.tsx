"use client";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Play, Trash2, X } from "lucide-react";
import { CategoryPicker, type CreateCategoryOutcome } from "@/components/CategoryPicker";
import { DatePickerPopover } from "@/components/DatePickerPopover";
import { InlineTagInput } from "@/components/InlineTagInput";
import { OverlapNotice } from "@/components/OverlapNotice";
import {
  buildCalendarEntryCompactCreatePlan,
  buildCalendarEntryCompactSavePlan,
  calendarEntryCompactCreateInitialDraft,
  calendarEntryCompactDraftsHaveChanges,
  calendarEntryCompactInitialDraft,
  calendarEntryLocalDayOffset,
  emptyCalendarEntryCompactDirty,
  formatCalendarEntryCompactDuration,
  isCalendarEntryCompactTimeInputReadyToSynchronize,
  isCompleteCalendarEntryCompactDurationInput,
  synchronizeCalendarEntryCompactDraft,
  trySynchronizeCalendarEntryCompactDraft,
  type CalendarEntryCompactCreatePlan,
  type CalendarEntryCompactCreateSource,
  type CalendarEntryCompactDirty,
  type CalendarEntryCompactDraft,
  type CalendarEntryCompactEditableKey,
  type CalendarEntryCompactSavePlan
} from "@/lib/calendar-entry-compact-editor";
import { maskTimeInput } from "@/lib/calendar-grid";
import { clientFetch } from "@/lib/client-auth-fetch";
import { dateTimeLocal } from "@/lib/format";
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
  const descriptionRef = useRef<HTMLInputElement | null>(null);
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
  const preview = useMemo(() => {
    try {
      return {
        error: null,
        plan: entry
          ? buildCalendarEntryCompactSavePlan({ draft, dirty, entry, now })
          : buildCalendarEntryCompactCreatePlan({
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
  }, [createSource, dirty, draft, entry, now]);
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
    setDraft((current) => {
      const next = { ...current, [key]: value, temporalOwner: owner };
      const isComplete = commit || (owner === "duration"
        ? isCompleteCalendarEntryCompactDurationInput(value)
        : isCalendarEntryCompactTimeInputReadyToSynchronize(value));
      if (!isComplete) return next;
      return trySynchronizeCalendarEntryCompactDraft({ ...temporalSource, draft: next, owner }) ?? next;
    });
    setDirty((current) => ({ ...current, [key]: true }));
    setError(null);
  }, [temporalSource]);

  const commitTemporalField = useCallback((owner: "start" | "finish" | "duration") => {
    if (busyRef.current) return;
    setActiveTemporalOwner(null);
    setDraft((current) => {
      if (current.temporalOwner !== owner) return current;
      try {
        return synchronizeCalendarEntryCompactDraft({ ...temporalSource, draft: current, owner });
      } catch {
        return { ...current, temporalOwner: owner };
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
  }, [attemptDismiss, cancelDiscardPrompt, isCategoryOpen, openDatePicker, tagPanelOpen]);

  async function save() {
    if (busyRef.current || saveBlockedByTimer) return;
    let plan: CalendarEntryCompactSavePlan | CalendarEntryCompactCreatePlan;
    try {
      const saveNow = new Date();
      plan = props.mode === "entry"
        ? buildCalendarEntryCompactSavePlan({ draft, dirty, entry: props.entry, now: saveNow })
        : buildCalendarEntryCompactCreatePlan({ draft, now: saveNow, source: props.source });
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
      outcome = { ok: false, error: "Unable to save this entry. Check your connection and try again." };
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
      outcome = { ok: false, error: "Unable to start this entry again. Check your connection and try again." };
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
      recoverMutation("Unable to delete this entry. Check your connection and try again.");
    }
  }

  const title = entry
    ? entry.description?.trim() || entry.categoryName?.trim() || "Untitled entry"
    : draft.description.trim() || selectedCategory?.name || "Uncategorized";
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

  return {
    attemptDismiss,
    busyAction,
    cancelDiscardPrompt,
    categoryButtonRef,
    commitTemporalField,
    confirmDiscard,
    controlsDisabled,
    deleteEntry,
    descriptionRef,
    discardBackRef,
    discardPrompt,
    dismissTagPanelsSignal,
    displayError,
    draft,
    feedbackMode,
    finishDayOffset,
    finishIsInvalid,
    handleDescriptionEnter,
    hasUnsavedChanges,
    isBusy,
    isCategoryOpen,
    isEntered,
    isExiting,
    isRunning,
    panelRef,
    preview,
    save,
    saveBlockedByTimer,
    setIsCategoryOpen,
    setOpenDatePicker,
    setTagPanelOpen,
    startAgain,
    startIsInvalid,
    today,
    temporalErrorId,
    title,
    updateField,
    updateTemporalField,
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
  const entry = props.mode === "entry" ? props.entry : null;
  const {
    busyAction,
    categoryButtonRef,
    commitTemporalField,
    controlsDisabled,
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
    panelRef,
    preview,
    saveBlockedByTimer,
    startIsInvalid,
    temporalErrorId,
    today,
    title
  } = controller;
  const finishDescription = finishDayOffset === 1
    ? "Finish time, one day after Start"
    : finishDayOffset > 1
      ? `Finish time, ${finishDayOffset} days after Start`
      : "Finish time";

  function saveButton() {
    return (
      <button
        type="button"
        className="calendar-compact-save"
        aria-busy={busyAction === "save" || undefined}
        disabled={isBusy || saveBlockedByTimer || !preview.plan}
        onClick={() => void controller.save()}
      >
        Save
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
      aria-label={entry ? `Edit ${title}` : "Create Calendar entry"}
      aria-busy={isBusy || undefined}
      aria-modal={surface === "modal"}
    >
      {busyAction ? (
        <span className="sr-only" role="status" aria-live="polite">
          {busyAction === "delete" ? "Deleting entry…" : busyAction === "start" ? "Starting entry…" : "Saving entry…"}
        </span>
      ) : null}
      <div className="calendar-compact-editor-header">
        <div>
          <strong>Calendar Entry</strong>
        </div>
        <div className="calendar-compact-editor-icons">
          {entry?.stoppedAt && props.mode === "entry" && props.onStartAgain ? (
            <button
              className="calendar-compact-icon-action"
              type="button"
              aria-label={`Start ${title} again`}
              aria-busy={busyAction === "start" || undefined}
              disabled={controlsDisabled || props.isTimerBusy}
              onClick={() => void controller.startAgain()}
            >
              <Play size={16} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          ) : null}
          {props.mode === "entry" && props.onDelete ? (
            <button
              className="calendar-compact-icon-action is-danger"
              type="button"
              aria-label={`Delete ${title}`}
              aria-busy={busyAction === "delete" || undefined}
              disabled={controlsDisabled}
              onClick={() => void controller.deleteEntry()}
            >
              <Trash2 size={17} aria-hidden="true" />
            </button>
          ) : null}
          <button
            className="calendar-compact-icon-action"
            type="button"
            aria-label="Close editor"
            disabled={controlsDisabled}
            onClick={() => controller.attemptDismiss(true)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="calendar-compact-editor-fields">
        <div className="calendar-compact-editor-description">
          <label htmlFor="time-entry-quick-description">Description</label>
          <InlineTagInput
            ariaLabel="Time entry description"
            className="time-entry-quick-tags"
            closeSignal={controller.dismissTagPanelsSignal}
            disabled={controlsDisabled}
            inputId="time-entry-quick-description"
            inputRef={descriptionRef}
            onChange={(value) => controller.updateField("description", value)}
            onHashtagPanelChange={controller.setTagPanelOpen}
            onEnter={controller.handleDescriptionEnter}
            onSelectedTagNamesChange={(tagNames) => controller.updateField("tagNames", tagNames)}
            placeholder="Enter task description"
            portal
            selectedTagNames={draft.tagNames}
            tags={props.tags}
            value={draft.description}
          />
        </div>

        <CategoryPicker
          categories={props.categories}
          disabled={controlsDisabled}
          label="Category"
          menuId="time-entry-quick-category-menu"
          onCreateCategory={props.onCreateCategory}
          onOpenChange={controller.setIsCategoryOpen}
          onSelect={(categoryId) => controller.updateField("categoryId", categoryId)}
          open={isCategoryOpen}
          portal={Boolean(props.onCreateCategory)}
          selectedId={draft.categoryId}
          triggerRef={categoryButtonRef}
          variant="quick"
        />

        <div className="calendar-compact-temporal-fields">
          <div className="calendar-compact-moment-field">
            <span className="calendar-compact-field-label">Start</span>
            <div className="calendar-compact-date-time-controls">
              <input
                aria-describedby={feedbackMode === "error" && startIsInvalid ? temporalErrorId : undefined}
                aria-invalid={startIsInvalid || undefined}
                aria-label="Start time"
                disabled={controlsDisabled}
                inputMode="numeric"
                onBlur={() => commitTemporalField("start")}
                onChange={(event) => controller.updateTemporalField("startedAtTime", maskTimeInput(event.target.value), "start")}
                placeholder="08:30"
                type="text"
                value={draft.startedAtTime}
              />
              <DatePickerPopover
                ariaLabel={`Choose Start date, currently ${formatAccessibleDate(draft.startedAtDate)}`}
                className="calendar-compact-date-picker"
                disabled={controlsDisabled}
                iconOnly
                label={formatAccessibleDate(draft.startedAtDate)}
                onChange={(date) => controller.updateTemporalField("startedAtDate", date, "start", true)}
                onOpenChange={(open) => controller.setOpenDatePicker((current) => open ? "start" : current === "start" ? null : current)}
                panelClassName="calendar-compact-date-picker-panel time-entry-quick-editor-nested-surface"
                panelLabel="Choose Start date"
                portal
                today={today}
                triggerClassName="calendar-compact-date-trigger"
                value={draft.startedAtDate}
              />
            </div>
          </div>

          <div className="calendar-compact-moment-field">
            <span className="calendar-compact-field-label">Finish</span>
            {isRunning ? (
              <div className="calendar-compact-running-value">Running</div>
            ) : (
              <div className="calendar-compact-date-time-controls">
                <input
                  aria-describedby={feedbackMode === "error" && finishIsInvalid ? temporalErrorId : undefined}
                  aria-invalid={finishIsInvalid || undefined}
                  aria-label={finishDescription}
                  disabled={controlsDisabled}
                  inputMode="numeric"
                  onBlur={() => commitTemporalField("finish")}
                  onChange={(event) => controller.updateTemporalField("stoppedAtTime", maskTimeInput(event.target.value), "finish")}
                  placeholder="09:15"
                  type="text"
                  value={draft.stoppedAtTime}
                />
                {finishDayOffset > 0 ? (
                  <span className="calendar-compact-day-offset" aria-hidden="true" title={finishDescription}>+{finishDayOffset}</span>
                ) : null}
                <DatePickerPopover
                  ariaLabel={`Choose Finish date, currently ${formatAccessibleDate(draft.stoppedAtDate)}`}
                  className="calendar-compact-date-picker"
                  disabled={controlsDisabled}
                  iconOnly
                  label={formatAccessibleDate(draft.stoppedAtDate)}
                  onChange={(date) => controller.updateTemporalField("stoppedAtDate", date, "finish", true)}
                  onOpenChange={(open) => controller.setOpenDatePicker((current) => open ? "finish" : current === "finish" ? null : current)}
                  panelClassName="calendar-compact-date-picker-panel time-entry-quick-editor-nested-surface"
                  panelLabel="Choose Finish date"
                  portal
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
                <strong className="tabular">
                  {preview.plan ? formatCalendarEntryCompactDuration(preview.plan.durationSeconds) : "—"}
                </strong>
              </div>
            </div>
          ) : (
            <label className="calendar-compact-duration-input">
              <span>Duration</span>
              <input
                aria-describedby={feedbackMode === "error" && controller.durationIsInvalid ? temporalErrorId : undefined}
                aria-invalid={controller.durationIsInvalid || undefined}
                aria-label="Duration in hours and minutes"
                disabled={controlsDisabled}
                inputMode="numeric"
                onBlur={() => commitTemporalField("duration")}
                onChange={(event) => controller.updateTemporalField("duration", event.target.value.replace(/[^\dhm:\s]/gi, ""), "duration")}
                placeholder="00:30"
                type="text"
                value={draft.duration}
              />
            </label>
          )}
        </div>
      </div>

      <div
        className={[
          "calendar-compact-editor-footer",
          feedbackMode === "discard" ? "is-confirming-discard" : "",
          feedbackMode === "error" || feedbackMode === "overlap" ? "is-showing-feedback" : ""
        ].join(" ")}
        data-feedback-mode={feedbackMode}
      >
        <div className="calendar-compact-editor-default-actions" aria-hidden={feedbackMode !== "default"} inert={feedbackMode !== "default"}>
          {entry && !entry.stoppedAt ? <span>Running timer</span> : null}
          {cancelButton()}
          {saveButton()}
        </div>
        <div
          className="calendar-compact-feedback-actions"
          aria-hidden={feedbackMode !== "error" && feedbackMode !== "overlap"}
          inert={feedbackMode !== "error" && feedbackMode !== "overlap"}
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
          {cancelButton()}
          {saveButton()}
        </div>
        <div
          className="calendar-compact-discard-confirmation"
          role="alertdialog"
          aria-label="Discard changes?"
          aria-hidden={!discardPrompt}
          aria-modal="false"
          inert={!discardPrompt}
        >
          <strong>Discard changes?</strong>
          <button ref={discardBackRef} type="button" className="calendar-compact-discard-back" onClick={controller.cancelDiscardPrompt}>
            Go back
          </button>
          <button type="button" className="calendar-compact-discard-confirm" onClick={controller.confirmDiscard}>
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

export function TimeEntryQuickEditorModal(props: Omit<Extract<TimeEntryQuickEditorProps, { mode: "entry" }>, "mode" | "onDismiss"> & {
  onClose: () => void;
}) {
  const modalProps: TimeEntryQuickEditorProps = { ...props, mode: "entry", onDismiss: props.onClose };
  const controller = useTimeEntryQuickEditor(modalProps);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => controller.descriptionRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previouslyFocusedRef.current?.focus({ preventScroll: true });
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
      )]).filter((element) => element.offsetParent !== null);
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
      let message = `Unable to save this entry: ${response.status}`;
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
    return { ok: false, error: "Unable to save this entry. Check your connection and try again." } as const;
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
