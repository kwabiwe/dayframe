"use client";

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Play, Trash2, X } from "lucide-react";
import { OverlapNotice } from "@/components/OverlapNotice";
import {
  buildCalendarEntryCompactCreatePlan,
  buildCalendarEntryCompactSavePlan,
  calculateCalendarEditorPosition,
  calendarEditorPointerIsInside,
  calendarEditorRectIsVisible,
  calendarEntryCompactCreateDraftHasChanges,
  calendarEntryCompactCreateInitialDraft,
  calendarEntryCompactDraftHasChanges,
  calendarEntryCompactInitialDraft,
  emptyCalendarEntryCompactDirty,
  type CalendarEditorPosition,
  type CalendarEntryCompactCreatePlan,
  type CalendarEntryCompactCreateSource,
  type CalendarEntryCompactDirty,
  type CalendarEntryCompactDraft,
  type CalendarEntryCompactSavePlan
} from "@/lib/calendar-entry-compact-editor";
import { maskTimeInput } from "@/lib/calendar-grid";
import { dateTimeLocal, formatClockDuration, formatDate } from "@/lib/format";
import { overlapNoticeForCandidate } from "@/lib/overlap-notice";
import type { CategoryRow, TimeEntryRow } from "@/lib/queries";

type MutationOutcome = { ok: true } | { ok: false; error: string };

type CalendarEntryCompactEditorSharedProps = {
  anchor: HTMLElement;
  capturedNow: Date;
  categories: CategoryRow[];
  focusOnOpen: boolean;
  isTimerBusy: boolean;
  onDismiss: (options: { restoreFocus: boolean }) => void;
  onOutsidePointerDown?: (pointer: { pointerId: number; pointerDownTimeStamp: number }) => void;
  peerEntries: TimeEntryRow[];
  positionKey: string;
  scrollContainer: HTMLElement | null;
};

type CalendarEntryCompactEditorProps = CalendarEntryCompactEditorSharedProps & (
  | {
      mode: "entry";
      entry: TimeEntryRow;
      onDelete: () => void;
      onSave: (plan: CalendarEntryCompactSavePlan) => Promise<MutationOutcome>;
      onStartAgain: () => Promise<MutationOutcome>;
    }
  | {
      mode: "create";
      source: CalendarEntryCompactCreateSource;
      onDraftChange: (plan: CalendarEntryCompactCreatePlan | null) => void;
      onSave: (plan: CalendarEntryCompactCreatePlan) => Promise<MutationOutcome>;
    }
);

export function CalendarEntryCompactEditor(props: CalendarEntryCompactEditorProps) {
  const {
    anchor,
    capturedNow,
    categories,
    focusOnOpen,
    isTimerBusy,
    onDismiss,
    onOutsidePointerDown,
    peerEntries,
    positionKey,
    scrollContainer
  } = props;
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
  const [categoryIndex, setCategoryIndex] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [isEntered, setIsEntered] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [now, setNow] = useState(capturedNow);
  const [position, setPosition] = useState<CalendarEditorPosition | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const descriptionRef = useRef<HTMLInputElement | null>(null);
  const categoryButtonRef = useRef<HTMLButtonElement | null>(null);
  const discardBackRef = useRef<HTMLButtonElement | null>(null);
  const discardFocusRestorePendingRef = useRef(false);
  const discardPromptRef = useRef(false);
  const discardReturnFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false);
  const closeTokenRef = useRef(0);
  const exitTimeoutRef = useRef<number | null>(null);
  const onDraftChangeRef = useRef(onCreateDraftChange);
  const selectedCategory = categories.find((category) => category.id === draft.categoryId) ?? null;
  const categoryOptions = useMemo(() => [null, ...categories] as Array<CategoryRow | null>, [categories]);
  const preview = useMemo(() => {
    try {
      return {
        error: null,
        plan: entry
          ? buildCalendarEntryCompactSavePlan({ draft, dirty, entry, now })
          : buildCalendarEntryCompactCreatePlan({ draft, source: createSource as CalendarEntryCompactCreateSource })
      };
    } catch (previewError) {
      return {
        error: previewError instanceof Error ? previewError.message : "Check the time values.",
        plan: null
      };
    }
  }, [createSource, dirty, draft, entry, now]);
  const hasUnsavedChanges = useMemo(
    () => entry
      ? calendarEntryCompactDraftHasChanges(entry, draft)
      : calendarEntryCompactCreateDraftHasChanges(createSource as CalendarEntryCompactCreateSource, draft),
    [createSource, draft, entry]
  );
  const controlsDisabled = isBusy || discardPrompt;

  const updateField = useCallback(<Key extends keyof CalendarEntryCompactDraft,>(
    key: Key,
    value: CalendarEntryCompactDraft[Key]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty((current) => ({ ...current, [key]: true }));
    setError(null);
  }, []);

  const finishDismiss = useCallback((restoreFocus: boolean) => {
    if (exitTimeoutRef.current !== null) {
      window.clearTimeout(exitTimeoutRef.current);
      exitTimeoutRef.current = null;
    }
    closeTokenRef.current += 1;
    onDismiss({ restoreFocus });
  }, [onDismiss]);

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
      if (closeTokenRef.current === token) onDismiss({ restoreFocus });
    }, 90);
  }, [finishDismiss, onDismiss]);

  const showDiscardPrompt = useCallback(() => {
    if (discardPromptRef.current) return;
    const panel = panelRef.current;
    const activeElement = document.activeElement;
    discardReturnFocusRef.current = panel && activeElement instanceof HTMLElement && panel.contains(activeElement)
      ? activeElement
      : descriptionRef.current;
    discardPromptRef.current = true;
    setIsCategoryOpen(false);
    setDiscardPrompt(true);
    window.requestAnimationFrame(() => discardBackRef.current?.focus());
  }, []);

  const cancelDiscardPrompt = useCallback(() => {
    discardPromptRef.current = false;
    discardFocusRestorePendingRef.current = true;
    setDiscardPrompt(false);
  }, []);

  const confirmDiscard = useCallback(() => {
    discardPromptRef.current = false;
    setDiscardPrompt(false);
    requestDismiss(false);
  }, [requestDismiss]);

  const attemptDismiss = useCallback((restoreFocus: boolean) => {
    if (hasUnsavedChanges) {
      showDiscardPrompt();
      return;
    }
    requestDismiss(restoreFocus);
  }, [hasUnsavedChanges, requestDismiss, showDiscardPrompt]);

  useEffect(() => () => {
    closeTokenRef.current += 1;
    discardPromptRef.current = false;
    if (exitTimeoutRef.current !== null) window.clearTimeout(exitTimeoutRef.current);
  }, []);

  useEffect(() => {
    onDraftChangeRef.current = onCreateDraftChange;
  }, [onCreateDraftChange]);

  useEffect(() => {
    if (!createSource) return;
    onDraftChangeRef.current?.(preview.plan as CalendarEntryCompactCreatePlan | null);
  }, [
    createSource,
    preview.plan
  ]);

  useLayoutEffect(() => {
    if (discardPrompt || !discardFocusRestorePendingRef.current) return;
    discardFocusRestorePendingRef.current = false;
    const returnTarget = discardReturnFocusRef.current;
    if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
  }, [discardPrompt]);

  const updatePosition = useCallback(() => {
    const panel = panelRef.current;
    if (!panel || !anchor.isConnected) {
      finishDismiss(false);
      return;
    }
    const visualViewport = window.visualViewport;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportWidth = visualViewport?.width ?? window.innerWidth;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;
    const anchorRect = anchor.getBoundingClientRect();
    const scrollerRect = scrollContainer?.getBoundingClientRect() ?? null;
    const viewportRect = {
      bottom: viewportTop + viewportHeight,
      left: viewportLeft,
      right: viewportLeft + viewportWidth,
      top: viewportTop
    };
    if (!calendarEditorRectIsVisible(anchorRect, viewportRect, scrollerRect)) {
      finishDismiss(false);
      return;
    }
    const panelRect = panel.getBoundingClientRect();
    const next = calculateCalendarEditorPosition({
      anchor: {
        bottom: anchorRect.bottom - viewportTop,
        height: anchorRect.height,
        left: anchorRect.left - viewportLeft,
        right: anchorRect.right - viewportLeft,
        top: anchorRect.top - viewportTop,
        width: anchorRect.width
      },
      panelHeight: panelRect.height,
      panelWidth: panelRect.width || 360,
      viewportHeight,
      viewportWidth
    });
    setPosition({ ...next, left: next.left + viewportLeft, top: next.top + viewportTop });
  }, [anchor, finishDismiss, scrollContainer]);

  useLayoutEffect(() => {
    updatePosition();
    const panel = panelRef.current;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(updatePosition);
    observer?.observe(anchor);
    if (panel) observer?.observe(panel);
    if (scrollContainer) observer?.observe(scrollContainer);
    mutationObserver?.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      observer?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [anchor, positionKey, scrollContainer, updatePosition]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setIsEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!focusOnOpen) return;
    const frame = window.requestAnimationFrame(() => descriptionRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [focusOnOpen]);

  useEffect(() => {
    if (!entry || entry.stoppedAt) return undefined;
    const interval = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(interval);
  }, [entry]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const panel = panelRef.current;
      if (busyRef.current || !panel || calendarEditorPointerIsInside(event.composedPath(), panel, anchor)) return;
      onOutsidePointerDown?.({
        pointerId: event.pointerId,
        pointerDownTimeStamp: event.timeStamp
      });
      if (hasUnsavedChanges) {
        event.preventDefault();
        event.stopPropagation();
        showDiscardPrompt();
        return;
      }
      requestDismiss(false);
    };
    const handleClick = (event: MouseEvent) => {
      const panel = panelRef.current;
      if (
        !discardPromptRef.current ||
        !panel ||
        calendarEditorPointerIsInside(event.composedPath(), panel, anchor)
      ) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const timeout = window.setTimeout(() => {
      document.addEventListener("pointerdown", handlePointerDown, true);
      document.addEventListener("click", handleClick, true);
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, [anchor, hasUnsavedChanges, onOutsidePointerDown, requestDismiss, showDiscardPrompt]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (discardPrompt) {
        event.preventDefault();
        cancelDiscardPrompt();
        return;
      }
      if (isCategoryOpen) {
        event.preventDefault();
        setIsCategoryOpen(false);
        categoryButtonRef.current?.focus();
        return;
      }
      event.preventDefault();
      attemptDismiss(Boolean(entry));
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [attemptDismiss, cancelDiscardPrompt, discardPrompt, entry, isCategoryOpen]);

  async function save() {
    if (busyRef.current || isTimerBusy) return;
    if (!preview.plan) {
      setError(preview.error);
      return;
    }
    if (entry && Object.keys((preview.plan as CalendarEntryCompactSavePlan).payload).length === 0) {
      finishDismiss(true);
      return;
    }
    busyRef.current = true;
    setIsBusy(true);
    setError(null);
    const outcome = props.mode === "entry"
      ? await props.onSave(preview.plan as CalendarEntryCompactSavePlan)
      : await props.onSave(preview.plan as CalendarEntryCompactCreatePlan);
    if (!outcome.ok) {
      setError(outcome.error);
      busyRef.current = false;
      setIsBusy(false);
      return;
    }
    finishDismiss(Boolean(entry));
  }

  async function startAgain() {
    if (props.mode !== "entry" || busyRef.current || isTimerBusy) return;
    busyRef.current = true;
    setIsBusy(true);
    setError(null);
    const outcome = await props.onStartAgain();
    if (!outcome.ok) {
      setError(outcome.error);
      busyRef.current = false;
      setIsBusy(false);
      return;
    }
    finishDismiss(false);
  }

  function openCategoryMenu() {
    const selectedIndex = categoryOptions.findIndex((category) => (category?.id ?? "") === draft.categoryId);
    setCategoryIndex(Math.max(0, selectedIndex));
    setIsCategoryOpen((open) => !open);
  }

  function handleCategoryKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setCategoryIndex((current) => (current + direction + categoryOptions.length) % categoryOptions.length);
      setIsCategoryOpen(true);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setCategoryIndex(event.key === "Home" ? 0 : categoryOptions.length - 1);
      setIsCategoryOpen(true);
    } else if (event.key === "Enter" && isCategoryOpen) {
      event.preventDefault();
      const category = categoryOptions[categoryIndex];
      updateField("categoryId", category?.id ?? "");
      setIsCategoryOpen(false);
    }
  }

  const title = entry
    ? entry.description?.trim() || entry.categoryName?.trim() || "Untitled entry"
    : draft.description.trim() || selectedCategory?.name || "Uncategorized";
  const displayedStartedAt = entry?.startedAt ?? createSource?.startedAt ?? null;
  const displayedStoppedAt = entry?.stoppedAt ?? createSource?.stoppedAt ?? null;
  const datesDiffer = Boolean(
    displayedStartedAt &&
    displayedStoppedAt &&
    dateTimeLocal(displayedStartedAt).slice(0, 10) !== dateTimeLocal(displayedStoppedAt).slice(0, 10)
  );
  const displayError = error ?? preview.error;
  const startIsInvalid = Boolean(preview.error && /start time/i.test(preview.error));
  const finishIsInvalid = Boolean(preview.error && /finish time/i.test(preview.error));
  const overlap = preview.plan
    ? overlapNoticeForCandidate({
        candidate: {
          startedAt: preview.plan.resolved.startedAt,
          stoppedAt: preview.plan.resolved.stoppedAt
        },
        entries: peerEntries,
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

  function saveButton() {
    return (
      <button
        type="button"
        className="calendar-compact-save"
        disabled={isBusy || isTimerBusy || !preview.plan}
        onClick={() => void save()}
      >
        Save
      </button>
    );
  }

  return createPortal(
    <div
      ref={panelRef}
      className={[
        "calendar-compact-editor",
        isEntered ? "is-entered" : "",
        isExiting ? "is-exiting" : "",
        position?.placement === "above" ? "is-above" : "",
        position?.placement === "phone" ? "is-phone" : ""
      ].join(" ")}
      data-testid="calendar-compact-editor"
      role="dialog"
      aria-label={entry ? `Edit ${title}` : "Create Calendar entry"}
      aria-busy={isBusy || undefined}
      aria-modal="false"
      style={{
        left: position?.left ?? 12,
        maxHeight: position?.maxHeight,
        top: position?.top ?? 12,
        visibility: position ? "visible" : "hidden",
        width: position?.width
      } as CSSProperties}
    >
      <div className="calendar-compact-editor-header">
        <div>
          <span className="calendar-compact-editor-kicker">{entry ? "Calendar entry" : "New Calendar entry"}</span>
          <strong>{title}</strong>
        </div>
        <div className="calendar-compact-editor-icons">
          {entry?.stoppedAt && props.mode === "entry" ? (
            <button
              className="calendar-compact-icon-action"
              type="button"
              aria-label={`Start ${title} again`}
              disabled={controlsDisabled || isTimerBusy}
              onClick={() => void startAgain()}
            >
              <Play size={16} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          ) : null}
          {props.mode === "entry" ? (
            <button className="calendar-compact-icon-action is-danger" type="button" aria-label={`Delete ${title}`} disabled={controlsDisabled} onClick={props.onDelete}>
              <Trash2 size={17} aria-hidden="true" />
            </button>
          ) : null}
          <button className="calendar-compact-icon-action" type="button" aria-label="Close editor" disabled={controlsDisabled} onClick={() => attemptDismiss(Boolean(entry))}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="calendar-compact-editor-fields">
        <label className="calendar-compact-editor-description">
          <span>Description</span>
          <input
            ref={descriptionRef}
            type="text"
            value={draft.description}
            placeholder="Enter task description"
            disabled={controlsDisabled}
            onChange={(event) => updateField("description", event.target.value)}
          />
        </label>

        <div className="calendar-compact-category-field">
          <span className="calendar-compact-field-label">Category</span>
          <button
            ref={categoryButtonRef}
            type="button"
            aria-expanded={isCategoryOpen}
            aria-haspopup="listbox"
            disabled={controlsDisabled}
            onClick={openCategoryMenu}
            onKeyDown={handleCategoryKeyDown}
          >
            <span
              className="calendar-compact-category-dot"
              style={{ background: selectedCategory?.color ?? "var(--muted)" }}
              aria-hidden="true"
            />
            <span>{selectedCategory?.name ?? (entry ? "No category" : "Uncategorized")}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          {isCategoryOpen ? (
            <div className="calendar-compact-category-menu" role="listbox" aria-label="Categories">
              {categoryOptions.map((category, index) => {
                const value = category?.id ?? "";
                const selected = value === draft.categoryId;
                return (
                  <button
                    key={category?.id ?? "no-category"}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={index === categoryIndex ? "is-active" : ""}
                    onMouseEnter={() => setCategoryIndex(index)}
                    onClick={() => {
                      updateField("categoryId", value);
                      setIsCategoryOpen(false);
                      categoryButtonRef.current?.focus();
                    }}
                  >
                    <span
                      className="calendar-compact-category-dot"
                      style={{ background: category?.color ?? "var(--muted)" }}
                      aria-hidden="true"
                    />
                    <span>{category?.name ?? (entry ? "No category" : "Uncategorized")}</span>
                    {selected ? <Check size={15} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="calendar-compact-time-row">
          <label>
            <span>Start</span>
            <input
              inputMode="numeric"
              type="text"
              value={draft.startedAt}
              placeholder="08:30"
              aria-describedby={startIsInvalid ? "calendar-compact-time-error" : undefined}
              aria-invalid={startIsInvalid || undefined}
              disabled={controlsDisabled}
              onChange={(event) => updateField("startedAt", maskTimeInput(event.target.value))}
            />
          </label>
          {entry?.stoppedAt || createSource ? (
            <label>
              <span>Finish</span>
              <input
                inputMode="numeric"
                type="text"
                value={draft.stoppedAt}
                placeholder="09:15"
                aria-describedby={finishIsInvalid ? "calendar-compact-time-error" : undefined}
                aria-invalid={finishIsInvalid || undefined}
                disabled={controlsDisabled}
                onChange={(event) => updateField("stoppedAt", maskTimeInput(event.target.value))}
              />
            </label>
          ) : null}
          <div className="calendar-compact-duration" aria-label={entry?.stoppedAt || createSource ? "Duration" : "Elapsed time"}>
            <span>{entry?.stoppedAt || createSource ? "Duration" : "Elapsed"}</span>
            <strong className="tabular">
              {preview.plan
                ? entry
                  ? formatClockDuration(preview.plan.durationSeconds)
                  : formatFullClockDuration(preview.plan.durationSeconds)
                : "—"}
            </strong>
          </div>
        </div>
        {datesDiffer ? (
          <p className="calendar-compact-date-context">
            Start {formatDate(displayedStartedAt as string)} · Finish {formatDate(displayedStoppedAt as string)}
          </p>
        ) : null}
      </div>

      <div
        className={[
          "calendar-compact-editor-footer",
          feedbackMode === "discard" ? "is-confirming-discard" : "",
          feedbackMode === "error" || feedbackMode === "overlap" ? "is-showing-feedback" : ""
        ].join(" ")}
        data-feedback-mode={feedbackMode}
      >
        <div
          className="calendar-compact-editor-default-actions"
          aria-hidden={feedbackMode !== "default"}
          inert={feedbackMode !== "default"}
        >
          {entry && !entry.stoppedAt ? <span>Running timer</span> : null}
          {saveButton()}
        </div>
        <div
          className="calendar-compact-feedback-actions"
          aria-hidden={feedbackMode !== "error" && feedbackMode !== "overlap"}
          inert={feedbackMode !== "error" && feedbackMode !== "overlap"}
        >
          <div className={`calendar-compact-feedback-copy${feedbackMode === "error" ? " is-error" : ""}`}>
            {feedbackMode === "error" && displayError ? (
              <p id="calendar-compact-time-error" role="alert" aria-atomic="true" aria-live="assertive">{displayError}</p>
            ) : null}
            {feedbackMode === "overlap" && preview.plan ? (
              <OverlapNotice
                compact
                candidate={{
                  startedAt: preview.plan.resolved.startedAt,
                  stoppedAt: preview.plan.resolved.stoppedAt
                }}
                entries={peerEntries}
                excludeEntryId={entry?.id ?? null}
              />
            ) : null}
          </div>
          {saveButton()}
        </div>
        <div
          className="calendar-compact-discard-confirmation"
          role="alertdialog"
          aria-label="Discard unsaved changes?"
          aria-hidden={!discardPrompt}
          aria-modal="false"
          inert={!discardPrompt}
        >
          <strong>Discard unsaved changes?</strong>
          <button ref={discardBackRef} type="button" className="calendar-compact-discard-back" onClick={cancelDiscardPrompt}>
            Go back
          </button>
          <button type="button" className="calendar-compact-discard-confirm" onClick={confirmDiscard}>
            Discard
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function formatFullClockDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
