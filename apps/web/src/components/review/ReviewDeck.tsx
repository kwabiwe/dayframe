"use client";

import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { formatClockTime, type DayframeGlyph } from "@dayframe/shared";
import { useClockFormat } from "@/components/ClockFormat";
import Link from "next/link";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { validReviewAcknowledgement, type ReviewMutationEnvelope } from "@dayframe/shared";
import { useAppShellRuntime, useRuntimePageData } from "@/components/AppShellRuntime";
import { BlocksToast } from "@/components/blocks/BlocksToast";
import { LocationReviewPanel } from "@/components/location/LocationReviewPanel";
import { OverlapLine } from "@/components/OverlapNotice";
import { ReviewVisual } from "@/components/review/ReviewVisual";
import { useIsHydrated } from "@/components/useHydrationSafeNow";
import { blockStyle } from "@/lib/block-style";
import { prefersReducedMotion, springTransition } from "@/lib/blocks-motion";
import { clientFetch } from "@/lib/client-auth-fetch";
import { hasOpenDialog, isTypingTarget } from "@/lib/keyboard-ownership";
import { onBeforeSessionChange } from "@/lib/session-change";
import type { BootstrapData, CategoryRow, ReviewItemRow, TimeEntryRow } from "@/lib/queries";
import {
  ReviewDecisionController,
  initialReviewDecisionState,
  type ReviewDecisionState
} from "@/lib/review-decision-controller";
import {
  activeDraft,
  adjacentV2StayReviewId,
  formatReviewDuration,
  hasV2Evidence,
  nextAfterDecision,
  reviewCardCategory,
  reviewConfidence,
  reviewDefaultName,
  reviewMutationFor,
  reviewPicture,
  reviewProposalSignature,
  reviewReason,
  reviewRoute,
  reviewSourceLabel,
  reviewTitle,
  reviewWhen,
  outingMutationFor,
  outingSummary,
  reviewOutings,
  reviewWindow,
  stepSelection,
  type ReviewDecisionKind,
  type ReviewLogAsDraft,
  type ReviewPicture
} from "@/lib/review-deck";

const GHOST_MS = 260;
const DONE_BLOCKS_MAX = 12;

/**
 * Review (Blocks parity step 13): the queue beside one card with its picture, "Log as" name and
 * activity, the reason and Log it (Y) / Skip (N) / Edit name (E), ↑ ↓ through the queue, Undo on
 * the Blocks toast and "All framed" when nothing is left. Decisions are held for Undo before they
 * are sent (`ReviewDecisionController`); Location visits keep the evidence editor behind
 * "Edit before logging".
 */
export function ReviewDeck({ initialData }: { initialData: BootstrapData }) {
  const clock = useClockFormat();
  const data = useRuntimePageData(initialData);
  const hydrated = useIsHydrated();
  const { refresh } = useAppShellRuntime();
  const categories = data.categories;

  const openItems = useMemo(() => data.reviewItems.filter((item) => item.status === "open"), [data.reviewItems]);
  const entries = useMemo(
    () => Array.from(new Map(
      [...data.historyEntries, ...data.weekEntries, ...data.entries].map((entry) => [entry.id, entry])
    ).values()) as TimeEntryRow[],
    [data.entries, data.historyEntries, data.weekEntries]
  );

  // A refused outing's canonical statuses (from the server's conflict answer): only its open cards return,
  // and no kept copy of a card the server says is decided stays on the deck (Codex r2/r3 on #466).
  const outingConflictStatuses = useRef(new Map<string, Record<string, string>>());
  // Each mark remembers the data it was made over: only a newer snapshot listing the card open lifts it
  // (Codex r4/r5 on #466).
  const [closedByServer, setClosedByServer] = useState<ReadonlyMap<string, unknown>>(() => new Map());
  const openItemsAtConflict = useRef<unknown>(openItems);
  useLayoutEffect(() => {
    openItemsAtConflict.current = openItems;
  }, [openItems]);
  const onOutingConflict = useCallback((stayId: string, statuses: Record<string, string>) => {
    outingConflictStatuses.current.set(stayId, statuses);
    const closed = Object.entries(statuses).filter(([, status]) => status !== "open").map(([id]) => id);
    const over = openItemsAtConflict.current;
    if (closed.length) setClosedByServer((current) => new Map([...current, ...closed.map((id) => [id, over] as const)]));
  }, []);
  const { state, decide, undo, clearError } = useReviewDecisions(openItems, refresh, onOutingConflict);
  // Cards the deck keeps although the loaded data (the newest 100) no longer lists them: the card
  // whose evidence editor is open, and a card Undo or a failed save brought back (iPhone keeps the
  // copy the deck showed the same way).
  const [editorSnapshot, setEditorSnapshot] = useState<ReviewItemRow | null>(null);
  const [revived, setRevived] = useState<ReadonlyMap<string, ReviewItemRow>>(() => new Map());
  const decidedSnapshots = useRef(new Map<string, ReviewItemRow>());
  const [evidenceOpenId, setEvidenceOpenId] = useState<string | null>(null);
  const loadedIds = useMemo(() => new Set(openItems.map((item) => item.id)), [openItems]);
  // A revived card the data lists again is the data's card from then on.
  if ([...revived.keys()].some((id) => loadedIds.has(id))) {
    setRevived(new Map([...revived].filter(([id]) => !loadedIds.has(id))));
  }
  // Newer data listing a card open again lifts the server's earlier "decided" for it (Codex r4/r5 on #466).
  const reopened = (id: string, over: unknown) => over !== openItems && loadedIds.has(id);
  if ([...closedByServer].some(([id, over]) => reopened(id, over))) {
    setClosedByServer(new Map([...closedByServer].filter(([id, over]) => !reopened(id, over))));
  }
  const deckItems = useMemo(() => {
    const extra = [...revived.values()].filter((item) => !loadedIds.has(item.id) && !closedByServer.has(item.id));
    if (evidenceOpenId && editorSnapshot?.id === evidenceOpenId && !loadedIds.has(evidenceOpenId) && !revived.has(evidenceOpenId)) {
      extra.push(editorSnapshot);
    }
    return extra.length ? [...openItems, ...extra] : openItems;
  }, [closedByServer, editorSnapshot, evidenceOpenId, loadedIds, openItems, revived]);
  // One card per outing (PRD D19): a Move card that belongs to an unknown Stay's card on the deck is
  // folded into it (also while that card's decision is held), and comes back on its own otherwise.
  const outings = useMemo(() => reviewOutings(deckItems), [deckItems]);
  // An outing's held, saving or saved decision keeps all of its Moves folded away, whatever a refresh
  // lists meanwhile (Codex r1 on #466): the decision owns every member until it settles.
  // Each decided outing keeps its members' snapshots, so Undo or a refused save brings the whole
  // outing back even when a refresh no longer lists some of it (Codex r2 on #466).
  const [heldOutings, setHeldOutings] = useState<ReadonlyMap<string, readonly ReviewItemRow[]>>(() => new Map());
  const heldOutingsRef = useRef(heldOutings);
  useLayoutEffect(() => {
    heldOutingsRef.current = heldOutings;
  }, [heldOutings]);
  const outingMemberIds = useMemo(() => new Set([
    ...[...outings.values()].flatMap((outing) => outing.members.map((member) => member.id)),
    ...[...heldOutings].filter(([anchorId]) => state.hiddenIds.has(anchorId)).flatMap(([, members]) => members.map((member) => member.id))
  ]), [heldOutings, outings, state.hiddenIds]);
  const visible = useMemo(
    () => deckItems.filter((item) => !state.hiddenIds.has(item.id) && !outingMemberIds.has(item.id)),
    [deckItems, outingMemberIds, state.hiddenIds]
  );
  const visibleIds = useMemo(() => visible.map((item) => item.id), [visible]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A palette or Calendar link's moment that is not in the loaded queue (decided already, or
  // older than the newest 100): said plainly instead of silently opening another card.
  const [missingTargetId, setMissingTargetId] = useState<string | null>(null);
  // "All framed" celebrates only when this visit's own decision emptied the queue.
  const [emptiedByDecision, setEmptiedByDecision] = useState(false);
  const [drafts, setDrafts] = useState<ReadonlyMap<string, ReviewLogAsDraft>>(() => new Map());
  const [ghost, setGhost] = useState<ReviewGhost | null>(null);
  const [enter, setEnter] = useState<{ itemId: string; from: "decision" | "undo" | "select"; dir: 1 | -1; key: number } | null>(null);
  const enterSequence = useRef(0);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  // A refresh or decision can leave one moment (or the evidence editor opens): the focused ‹ ›
  // button is then disabled, so focus moves to the card's first action rather than the page.
  const navDisabled = visible.length < 2 || evidenceOpenId !== null;
  // Whether focus is in the bar, remembered until focus lands somewhere else: a browser that blurs
  // a button as it is disabled has already moved focus to the page by the time the effect runs.
  const navHadFocus = useRef(false);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      navHadFocus.current = Boolean(navRef.current && event.target instanceof Node && navRef.current.contains(event.target));
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);
  useEffect(() => {
    if (!navDisabled || !navHadFocus.current) return;
    const active = document.activeElement;
    const inBar = active instanceof Node && navRef.current?.contains(active);
    if (active && active !== document.body && !inBar) return;
    navHadFocus.current = false;
    cardRef.current?.querySelector<HTMLElement>(".df-ractions button:not(:disabled)")?.focus();
  }, [navDisabled]);

  // The card whose evidence editor is open stays the card, whatever the queue order becomes.
  const selected = visible.find((item) => item.id === (evidenceOpenId ?? selectedId)) ?? visible[0] ?? null;
  // The page has shown a card this visit (focus can then be lost when the queue empties).
  const [hadCard, setHadCard] = useState(false);
  if (selected && !hadCard) setHadCard(true);
  // A refill (refresh, Undo) ends this visit's "emptied" state; a later empty queue is not ours.
  if (emptiedByDecision && visible.length > 0) setEmptiedByDecision(false);
  // A decided card's copy flies only where it started (card slot or empty state): once the deck
  // leaves that branch (Undo, a refill, a refresh that empties it) the copy is gone for good, so
  // coming back to the branch later never starts its flight again.
  if (ghost && ghost.overEmpty !== !selected) setGhost(null);
  const openIdsRef = useRef<ReadonlySet<string>>(new Set());
  useLayoutEffect(() => {
    openIdsRef.current = new Set(openItems.map((item) => item.id));
  }, [openItems]);
  const selectedRef = useRef(selected);
  useLayoutEffect(() => {
    selectedRef.current = selected;
  });
  const nowMs = useMinuteClock(hydrated);

  // A palette or Calendar link names the moment to open: /review#review-<id>.
  useEffect(() => {
    if (!hydrated) return;
    const fromHash = () => {
      const match = /^#review-(.+)$/.exec(window.location.hash);
      if (!match) return;
      const id = decodeURIComponent(match[1]);
      setSelectedId(id);
      setMissingTargetId(openIdsRef.current.has(id) ? null : id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [hydrated]);

  // Undo, or a save that failed or found the suggestion changed, brings the card back on top —
  // unless another card's evidence editor is open: its draft stays, and the card returns to the
  // queue only.
  const lastRestored = useRef(0);
  const evidenceOpenRef = useRef<string | null>(null);
  // Each opening of the evidence editor is its own session: a late save from an earlier opening
  // (of this card or another) never closes or clears the one open now.
  const [editorSession, setEditorSession] = useState(0);
  const editorSessionRef = useRef(0);
  useLayoutEffect(() => {
    editorSessionRef.current = editorSession;
  }, [editorSession]);
  useLayoutEffect(() => {
    evidenceOpenRef.current = evidenceOpenId;
  }, [evidenceOpenId]);
  useEffect(() => {
    if (!state.restored || state.restored.sequence === lastRestored.current) return;
    lastRestored.current = state.restored.sequence;
    const restoredId = state.restored.itemId;
    const snapshot = decidedSnapshots.current.get(restoredId);
    // An outing comes back whole: its Stay and every member the data no longer lists, except cards a
    // refused save says are no longer open.
    const statuses = outingConflictStatuses.current.get(restoredId);
    outingConflictStatuses.current.delete(restoredId);
    const stillOpen = (id: string) => !statuses || statuses[id] === undefined || statuses[id] === "open";
    const members = (heldOutingsRef.current.get(restoredId) ?? [])
      .filter((member) => !openIdsRef.current.has(member.id) && stillOpen(member.id));
    if ((!openIdsRef.current.has(restoredId) && snapshot) || members.length) {
      setRevived((current) => {
        const next = new Map(current);
        if (!openIdsRef.current.has(restoredId) && snapshot) next.set(restoredId, snapshot);
        for (const member of members) next.set(member.id, member);
        return next;
      });
    }
    if (evidenceOpenRef.current && evidenceOpenRef.current !== restoredId) return;
    setSelectedId(state.restored.itemId);
    setMissingTargetId(null);
    setEmptiedByDecision(false);
    setEnter({ itemId: state.restored.itemId, from: "undo", dir: 1, key: ++enterSequence.current });
    // The card is back: its outgoing copy (still flying) goes at once rather than overlapping it.
    setGhost((current) => (current?.item.id === restoredId ? null : current));
    // Undo pressed from the keyboard leaves focus on a toast that is about to go: the card's
    // first action takes it.
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && !active.closest(".df-toast-host")) return;
      cardRef.current?.querySelector<HTMLButtonElement>(".df-ractions button:not(:disabled)")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [state.restored]);

  // Any save from the evidence editor (confirm, split, merge…) changes the server's queue, so every
  // copy the deck kept of a card retires and fresh data decides — except the card whose editor is
  // open now (a later opening than the one that saved), which retires when that editor closes.
  // A retired card that is still open on the server returns when the queue reaches it again.
  const retireOnCloseRef = useRef(new Set<string>());
  const resolveEvidence = useCallback((session: number) => {
    const current = editorSessionRef.current === session;
    if (current) setEditorSnapshot(null);
    const keep = current ? null : evidenceOpenRef.current;
    if (keep) retireOnCloseRef.current.add(keep);
    setRevived((revivedNow) => {
      if (!revivedNow.size) return revivedNow;
      const kept = keep ? revivedNow.get(keep) : undefined;
      return kept ? new Map([[keep!, kept]]) : new Map();
    });
  }, []);

  // Every way an editor closes (its own Close or save, the toggle, picking another card).
  const endEvidence = useCallback(() => {
    const closingId = evidenceOpenRef.current;
    if (closingId && retireOnCloseRef.current.delete(closingId)) {
      setRevived((revivedNow) => {
        if (!revivedNow.has(closingId)) return revivedNow;
        const next = new Map(revivedNow);
        next.delete(closingId);
        return next;
      });
    }
    setEvidenceOpenId(null);
  }, []);

  const select = useCallback((id: string | null) => {
    if (!id) return;
    setSelectedId(id);
    setMissingTargetId(null);
    endEvidence();
    setEnter({ itemId: id, from: "select", dir: 1, key: ++enterSequence.current });
  }, [endEvidence]);

  const draftFor = useCallback(
    (item: ReviewItemRow) => activeDraft(drafts.get(item.id), categories),
    [categories, drafts]
  );

  const setDraft = useCallback((itemId: string, patch: ReviewLogAsDraft) => {
    setDrafts((current) => {
      const next = new Map(current);
      next.set(itemId, { ...current.get(itemId), ...patch });
      return next;
    });
  }, []);

  const decideCurrent = useCallback((kind: ReviewDecisionKind) => {
    const item = selectedRef.current;
    if (!item) return;
    // The evidence editor owns an open card: its own actions decide it.
    if (evidenceOpenId === item.id) return;
    if (kind === "log" && !reviewWindow(item)) return;
    const draft = activeDraft(drafts.get(item.id), categories);
    const category = reviewCardCategory(item, draft, categories);
    const span = reviewWindow(item);
    const name = draft?.name?.trim() || reviewDefaultName(item);
    const outing = outings.get(item.id);
    const outingMs = outing ? outing.members.reduce((sum, member) => {
      const memberSpan = reviewWindow(member);
      return sum + (memberSpan ? memberSpan.stopMs - memberSpan.startMs : 0);
    }, 0) : 0;
    decidedSnapshots.current.set(item.id, item);
    if (outing) setHeldOutings((current) => new Map(current).set(item.id, outing.members));
    const held = decide({
      itemId: item.id,
      kind,
      mutation: outing ? outingMutationFor(outing, kind, draft) : reviewMutationFor(item, kind, draft),
      signature: reviewProposalSignature(item),
      label: kind === "log" ? `Logged ${name}` : `Skipped ${reviewTitle(item)}`,
      durationMs: (span ? span.stopMs - span.startMs : 0) + outingMs,
      color: category?.color ?? null,
      colorName: category?.name ?? ""
    });
    if (!held) return;
    if (revived.has(item.id)) {
      setRevived((current) => {
        const next = new Map(current);
        next.delete(item.id);
        return next;
      });
    }
    // A decision removes the focused queue row, card action or toast: focus moves to the next
    // card's first action (or the empty state's heading) instead of falling to the page.
    const focusWasInDeck = Boolean(document.activeElement?.closest(".df-review-page, .df-toast-host"));
    if (focusWasInDeck) {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        (cardRef.current?.querySelector<HTMLElement>(".df-ractions button:not(:disabled)") ??
          document.getElementById("df-done-title"))?.focus();
      });
    }
    const dir = kind === "log" ? 1 : -1;
    const next = nextAfterDecision(visibleIds, item.id);
    setSelectedId(next);
    setMissingTargetId(null);
    setEvidenceOpenId(null);
    setEmptiedByDecision(next === null);
    if (next) setEnter({ itemId: next, from: "decision", dir, key: ++enterSequence.current });
    if (!prefersReducedMotion()) {
      // Where the card is now: the ghost leaves from exactly there, also when the deck empties and
      // the ghost is drawn over the empty state (UIA-315: the phone queue bar sits above it).
      const box = cardRef.current?.getBoundingClientRect();
      setGhost({ key: ++enterSequence.current, item, draft, dir, origin: box ? { top: box.top, left: box.left, width: box.width } : undefined, overEmpty: next === null });
    }
  }, [categories, decide, drafts, evidenceOpenId, outings, revived, visibleIds]);

  // An editor's close is fenced to the opening it belongs to. Focus inside the closing editor
  // moves to the card.
  const closeEvidence = useCallback((session: number) => {
    if (editorSessionRef.current !== session || evidenceOpenRef.current === null) return;
    const active = document.activeElement;
    const focusInEditor = !active || active === document.body || Boolean(active.closest(".df-revidence"));
    endEvidence();
    if (!focusInEditor) return;
    requestAnimationFrame(() => {
      const now = document.activeElement;
      if (now && now !== document.body && now.isConnected) return;
      cardRef.current?.querySelector<HTMLElement>(".df-ractions button:not(:disabled)")?.focus();
    });
  }, [endEvidence]);

  // Y / N / E / ↑ ↓ (prototype keys). Window capture runs before the shell's own keys (N focuses
  // the command bar elsewhere), so the deck owns them while a card is showing.
  useEffect(() => {
    if (!hydrated) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTypingTarget(event.target) || hasOpenDialog()) return;
      if (!selectedRef.current) return;
      const key = event.key;
      const letter = key.toLowerCase();
      if (evidenceOpenId) {
        // The evidence editor owns the page: deck keys (and the shell's N) do nothing there.
        if (!event.shiftKey && (letter === "y" || letter === "n" || letter === "e")) event.preventDefault();
        return;
      }
      if (event.shiftKey) return;
      if (key === "ArrowUp" || key === "ArrowDown") {
        // The activity chips use the arrows themselves (radio group).
        if (event.target instanceof Element && event.target.closest("[role='radiogroup']")) return;
        event.preventDefault();
        select(stepSelection(visibleIds, selectedRef.current.id, key === "ArrowDown" ? 1 : -1));
        return;
      }
      if (letter !== "y" && letter !== "n" && letter !== "e") return;
      event.preventDefault();
      if (event.repeat) return;
      if (letter === "e") {
        const input = nameInputRef.current;
        input?.focus();
        input?.select();
        return;
      }
      decideCurrent(letter === "y" ? "log" : "skip");
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [decideCurrent, evidenceOpenId, hydrated, select, visibleIds]);

  // A toast leaving with focus on its Undo hands focus to the card (or the empty state's heading).
  useEffect(() => {
    if (!state.notice?.isExiting) return;
    const active = document.activeElement;
    if (!active?.closest(".df-toast-host")) return;
    const target = cardRef.current?.querySelector<HTMLElement>(".df-ractions button:not(:disabled)")
      ?? document.getElementById("df-done-title");
    target?.focus();
  }, [state.notice?.isExiting]);

  // ⌘Z / Ctrl+Z takes back the held decision while its toast is up.
  useEffect(() => {
    if (!state.notice || state.notice.isExiting || evidenceOpenId) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (isTypingTarget(event.target) || hasOpenDialog()) return;
      event.preventDefault();
      undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [evidenceOpenId, state.notice, undo]);

  // The card that replaces a decided one lands from the side the decision left; a queue pick
  // rises in place; Undo brings the card back from the right. One Web Animation on the card.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!enter || !card || enter.itemId !== selected?.id || typeof card.animate !== "function") return;
    const reduced = prefersReducedMotion();
    const spring = springTransition(enter.from === "select" ? "sheet" : "land");
    const from = reduced
      ? { opacity: 0.6 }
      : enter.from === "select"
        ? { opacity: 0.4, transform: "translateY(6px)" }
        : { opacity: 0, transform: `translateX(${enter.from === "undo" ? 40 : -enter.dir * 30}px) scale(0.98)` };
    const animation = card.animate([from, { opacity: 1, transform: "none" }], {
      duration: reduced ? 140 : spring.durationMs,
      easing: reduced ? "ease-out" : spring.easing
    });
    return () => animation.cancel();
  }, [enter, selected?.id]);

  if (!hydrated || nowMs === null) {
    return (
      <div className="df-review-page" aria-busy="true">
        <ReviewHead count={null} />
        <div className="df-review">
          <section className="df-card df-review-queue df-review-placeholder" />
          <section className="df-card df-rcard df-review-placeholder" />
        </div>
      </div>
    );
  }

  // Moments past the newest 100 the page loaded: the queue refills from them after a refresh.
  // Cards the deck keeps itself are among the unloaded remainder already: never count them twice.
  // Held or saving decisions for cards the newest 100 no longer list are not available either.
  const deckIds = new Set(deckItems.map((item) => item.id));
  const heldUnlisted = [...state.hiddenIds].filter((id) => !deckIds.has(id)).length;
  const beyondLoaded = Math.max(0, data.stats.reviewCount - deckItems.length - heldUnlisted);
  const total = visible.length + beyondLoaded;
  const toast = state.notice ? (
    <BlocksToast
      actionLabel="Undo"
      exiting={state.notice.isExiting}
      key={state.notice.token}
      message={state.notice.label}
      onAction={undo}
      swatchStyle={state.notice.color ? blockStyle(state.notice.color, state.notice.colorName) : undefined}
    />
  ) : null;
  const errorLine = state.error ? (
    <p className="df-review-error" role="alert">
      <span>{state.error}</span>
      <button className="df-icon-action" type="button" aria-label="Dismiss" onClick={clearError}>
        <X size={15} aria-hidden="true" />
      </button>
    </p>
  ) : null;

  const missingLine = missingTargetId ? (
    <p className="df-review-error" role="status">
      <span>That moment isn’t waiting here: it was already decided, or it’s older than the newest 100 shown.</span>
      <button className="df-icon-action" type="button" aria-label="Dismiss" onClick={() => setMissingTargetId(null)}>
        <X size={15} aria-hidden="true" />
      </button>
    </p>
  ) : null;

  if (!selected) {
    return (
      <div className="df-review-page">
        <ReviewHead count={beyondLoaded} />
        {errorLine}
        {missingLine}
        <AllFramed
          celebrate={emptiedByDecision}
          decided={state.decided}
          moreComing={beyondLoaded > 0}
          takeFocus={hadCard}
        />
        {ghost?.overEmpty ? <GhostCard atOrigin ghost={ghost} categories={categories} nowMs={nowMs} onDone={() => setGhost(null)} /> : null}
        {toast}
      </div>
    );
  }

  const draft = draftFor(selected);
  const span = reviewWindow(selected);
  const category = reviewCardCategory(selected, draft, categories);
  const v2 = hasV2Evidence(selected);
  const evidenceOpen = evidenceOpenId === selected.id;

  return (
    <div className="df-review-page">
      <ReviewHead count={total} />
      {errorLine}
      {missingLine}
      <div className="df-review">
        <section className="df-card df-review-queue" aria-label="Queue">
          {visible.map((item) => {
            const itemCategory = reviewCardCategory(item, draftFor(item), categories);
            const itemWindow = reviewWindow(item);
            return (
              <button
                aria-current={item.id === selected.id ? "true" : undefined}
                className="df-qrow"
                key={item.id}
                onClick={() => select(item.id)}
                type="button"
              >
                <i
                  aria-hidden="true"
                  className={itemCategory ? "df-block" : "df-qrow-none"}
                  style={itemCategory ? blockStyle(itemCategory.color, itemCategory.name) : undefined}
                />
                <span className="df-qrow-text">
                  <b>{reviewTitle(item)}</b>
                  <span className="df-tnum">{reviewWhen(item, nowMs, clock) ?? "No times"}</span>
                </span>
                {itemWindow ? <small className="df-tnum">{formatReviewDuration(itemWindow.stopMs - itemWindow.startMs)}</small> : null}
              </button>
            );
          })}
        </section>

        {/* Phones (UIA-315): where this card sits in the queue, with ‹ › to step through it (the
            full queue follows the card there). A sibling of the card slot, so the card (and a
            decided card's ghost) keeps its origin; shown whenever a card is, so deciding down to
            one moment never moves the card. Hidden on wider screens, where ↑ ↓ step through the
            queue beside the card. */}
        <nav aria-label="Queue position" className="df-rnav" ref={navRef}>
          <button
            aria-label="Previous moment"
            className="df-rnav-btn"
            disabled={evidenceOpen || visible.length < 2}
            onClick={() => select(stepSelection(visibleIds, selected.id, -1))}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <span aria-atomic="true" aria-live="polite" className="df-rnav-pos df-tnum">
            {visible.findIndex((item) => item.id === selected.id) + 1} of {visible.length}{visible.length < (total ?? 0) ? " shown" : ""}
          </span>
          <button
            aria-label="Next moment"
            className="df-rnav-btn"
            disabled={evidenceOpen || visible.length < 2}
            onClick={() => select(stepSelection(visibleIds, selected.id, 1))}
            type="button"
          >
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </nav>
        <div className="df-rcard-slot">
          <section
            aria-labelledby="df-rcard-title"
            className="df-card df-rcard"
            ref={cardRef}
            style={category ? blockStyle(category.color, category.name) : undefined}
          >
            <CardFace
              categories={categories}
              draft={draft}
              item={selected}
              locked={evidenceOpen}
              nameInputRef={nameInputRef}
              nowMs={nowMs}
              onDecide={decideCurrent}
              onDraft={(patch) => setDraft(selected.id, patch)}
              outing={outings.get(selected.id) ? outingSummary(outings.get(selected.id)!) : undefined}
              overlap={span ? (
                <OverlapLine
                  candidate={{ startedAt: new Date(span.startMs).toISOString(), stoppedAt: new Date(span.stopMs).toISOString() }}
                  entries={entries}
                  nowMs={nowMs}
                />
              ) : null}
              titleId="df-rcard-title"
            />
            <div className="df-ractions">
              <button className="df-rbtn df-rbtn--live" disabled={!span || evidenceOpen} onClick={() => decideCurrent("log")} onKeyDown={ignoreRepeatedActivation} type="button">
                <Check size={16} aria-hidden="true" />
                Log it
                <span className="df-kbd" aria-hidden="true">Y</span>
              </button>
              <button className="df-rbtn" disabled={evidenceOpen} onClick={() => decideCurrent("skip")} onKeyDown={ignoreRepeatedActivation} type="button">
                <X size={16} aria-hidden="true" />
                Skip
                <span className="df-kbd" aria-hidden="true">N</span>
              </button>
              {span ? (
                <button
                  className="df-rbtn df-rbtn--ghost"
                  disabled={evidenceOpen}
                  onClick={() => {
                    nameInputRef.current?.focus();
                    nameInputRef.current?.select();
                  }}
                  type="button"
                >
                  <DayframeIcon glyph="pencil" size={15}/>
                  Edit name
                  <span className="df-kbd" aria-hidden="true">E</span>
                </button>
              ) : null}
              {v2 ? (
                <button
                  aria-expanded={evidenceOpen}
                  className="df-rbtn df-rbtn--ghost"
                  onClick={() => {
                    setEditorSnapshot(selected);
                    if (evidenceOpen) {
                      endEvidence();
                      return;
                    }
                    setEditorSession((current) => current + 1);
                    setEvidenceOpenId(selected.id);
                  }}
                  type="button"
                >
                  <DayframeIcon glyph="map-pin" size={15} />
                  Edit before logging
                </button>
              ) : null}
            </div>
            {evidenceOpen ? (
              <div className="df-revidence">
                <LocationReviewPanel
                  adjacentReviewItemId={adjacentV2StayReviewId(selected, visible)}
                  categories={categories}
                  entries={entries}
                  // The editor starts from the card's "Log as" choices.
                  initialCategoryId={draft?.categoryId !== undefined ? draft.categoryId : selected.suggestedCategoryId}
                  initialDescription={draft?.name?.trim() || undefined}
                  key={editorSession}
                  onClose={() => closeEvidence(editorSession)}
                  onResolved={() => resolveEvidence(editorSession)}
                  reviewItemId={selected.id}
                />
              </div>
            ) : null}
          </section>
          {ghost && !ghost.overEmpty ? <GhostCard ghost={ghost} categories={categories} nowMs={nowMs} onDone={() => setGhost(null)} /> : null}
        </div>
      </div>
      {toast}
    </div>
  );
}

/** A held Enter on Log it / Skip decides once: the button stays focused as the next card arrives. */
function ignoreRepeatedActivation(event: ReactKeyboardEvent<HTMLButtonElement>) {
  if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
}

function ReviewHead({ count }: { count: number | null }) {
  return (
    <div className="df-review-head">
      <h1>Review</h1>
      <p>
        {count === null
          ? "Moments Dayframe noticed but didn’t log."
          : count === 0
            ? "Nothing waiting. Nothing is added until you say so."
            : `${count} moment${count === 1 ? "" : "s"} Dayframe noticed but didn’t log. Nothing is added until you say so.`}
      </p>
    </div>
  );
}

// The source pill's glyph, from the registry (a plain suggestion is the circle-dot, as on iPhone).
const SOURCE_GLYPH: Record<ReviewPicture, DayframeGlyph> = {
  place: "map-pin",
  commute: "route",
  workout: "footprints",
  sleep: "moon",
  suggestion: "circle-dot"
};

/** The card's content: picture, pills, title, when, "Log as" and the reason. */
function CardFace({
  categories,
  draft,
  inert = false,
  item,
  locked = false,
  nameInputRef,
  nowMs,
  onDecide,
  onDraft,
  outing,
  overlap,
  titleId
}: {
  categories: readonly CategoryRow[];
  draft: ReviewLogAsDraft | undefined;
  inert?: boolean;
  item: ReviewItemRow;
  /** The evidence editor is open: "Log as" is read-only and cannot decide. */
  locked?: boolean;
  nameInputRef?: React.RefObject<HTMLInputElement | null>;
  nowMs: number;
  onDecide?: (kind: ReviewDecisionKind) => void;
  onDraft?: (patch: ReviewLogAsDraft) => void;
  /** The top card's overlap line, shown under the time. */
  overlap?: React.ReactNode;
  /** One card per outing (PRD D19): the travel line of the Moves folded into this Stay's card. */
  outing?: string;
  titleId?: string;
}) {
  const clock = useClockFormat();
  const picture = reviewPicture(item);
  const confidence = reviewConfidence(item.confidence);
  const span = reviewWindow(item);
  const when = reviewWhen(item, nowMs, clock);
  const selectedCategoryId = draft?.categoryId !== undefined ? draft.categoryId : item.suggestedCategoryId;
  const checkedIndex = Math.max(0, categories.findIndex((category) => category.id === selectedCategoryId));
  const reason = reviewReason(item);
  const route = reviewRoute(item);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onChipKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step || !categories.length) return;
    event.preventDefault();
    const next = (index + step + categories.length) % categories.length;
    onDraft?.({ categoryId: categories[next].id });
    chipRefs.current[next]?.focus();
  };

  return (
    <>
      <div className="df-rvis">
        <ReviewVisual
          picture={picture}
          startLabel={span ? formatClockTime(span.startMs, clock) : undefined}
          stopLabel={span ? formatClockTime(span.stopMs, clock) : undefined}
        />
        <div className="df-rsrc">
          <span className="df-rpill">
            <DayframeIcon glyph={SOURCE_GLYPH[picture]} size={14} />
            {reviewSourceLabel(picture)}
          </span>
          {confidence.score > 0 ? (
            <span className="df-rpill" aria-label={`Confidence: ${confidence.label}, ${confidence.score} of 5`} role="img">
              <span className="df-conf" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((dot) => <i className={dot <= confidence.score ? "is-on" : undefined} key={dot} />)}
              </span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="df-rbody">
        <h2 id={titleId}>{reviewTitle(item)}</h2>
        {when ? (
          <p className="df-rwhen df-tnum">
            {when}
            {span ? ` · ${formatReviewDuration(span.stopMs - span.startMs)}` : ""}
            {route ? ` · ${route}` : ""}
          </p>
        ) : null}
        {overlap}
        {outing ? <p className="df-rwhen df-routing">{outing}</p> : null}
        {span ? (
          <div className="df-logas">
            <label htmlFor={inert ? undefined : "df-logas-name"}>Log as</label>
            <input
              autoComplete="off"
              id={inert ? undefined : "df-logas-name"}
              maxLength={500}
              onChange={(event) => onDraft?.({ name: event.target.value })}
              onKeyDown={(event) => {
                const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
                // Enter that confirms an input-method candidate is not a decision.
                if (event.key === "Enter" && plain && !locked && !event.repeat && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.preventDefault();
                  onDecide?.("log");
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              readOnly={inert || locked}
              ref={inert ? undefined : nameInputRef}
              type="text"
              value={draft?.name ?? reviewDefaultName(item)}
            />
            {categories.length ? (
              <div className="df-rchips" role="radiogroup" aria-label="Activity">
                {categories.map((category, index) => {
                  const checked = category.id === selectedCategoryId;
                  return (
                    <button
                      aria-checked={checked}
                      className={`df-rchip${checked ? " is-checked df-block" : ""}`}
                      key={category.id}
                      disabled={locked}
                      onClick={() => onDraft?.({ categoryId: category.id })}
                      onKeyDown={(event) => onChipKeyDown(event, index)}
                      ref={(element) => {
                        chipRefs.current[index] = element;
                      }}
                      role="radio"
                      style={blockStyle(category.color, category.name)}
                      tabIndex={index === checkedIndex ? 0 : -1}
                      type="button"
                    >
                      <i aria-hidden="true" />
                      {category.name}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="df-rreason">No start and end time to log. Skip it, or it stays here.</p>
        )}
        {reason ? <p className="df-rreason">{reason}</p> : null}
      </div>
    </>
  );
}

/** The decided card flying out (prototype throw): a still copy, inert and hidden from assistive tech. */
type ReviewGhost = {
  key: number;
  item: ReviewItemRow;
  draft?: ReviewLogAsDraft;
  dir: 1 | -1;
  /** The card's viewport bounds when it was decided. */
  origin?: { top: number; left: number; width: number };
  /**
   * Drawn over the empty state (the last card was decided) rather than in the card slot. The copy
   * flies only where it started: if the deck switches between card and empty state mid-flight (Undo
   * brings the card back), the copy is dropped, never restarted from the card's place.
   */
  overEmpty: boolean;
};

function GhostCard({
  atOrigin = false,
  categories,
  ghost,
  nowMs,
  onDone
}: {
  categories: readonly CategoryRow[];
  ghost: ReviewGhost;
  nowMs: number;
  onDone: () => void;
  /** Drawn over the empty state (not inside the card slot): placed at the card's last bounds. */
  atOrigin?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const doneRef = useRef(onDone);
  useLayoutEffect(() => {
    doneRef.current = onDone;
  });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof element.animate !== "function") {
      doneRef.current();
      return;
    }
    const animation = element.animate(
      [
        { transform: "none", opacity: 1 },
        { transform: `translate(${ghost.dir * 120}px, -14px) rotate(${ghost.dir * 6}deg)`, opacity: 0 }
      ],
      { duration: GHOST_MS, easing: "cubic-bezier(.3, .6, .4, 1)", fill: "forwards" }
    );
    animation.onfinish = () => doneRef.current();
    // A throttled (hidden) page may never finish the flight: the copy never outstays it.
    const fallback = setTimeout(() => doneRef.current(), GHOST_MS + 200);
    return () => {
      clearTimeout(fallback);
      animation.cancel();
    };
  }, [ghost.key, ghost.dir]);
  const category = reviewCardCategory(ghost.item, ghost.draft, categories);
  return (
    <div
      aria-hidden="true"
      className="df-card df-rcard df-rcard-ghost"
      inert
      key={ghost.key}
      ref={ref}
      style={{
        ...(category ? blockStyle(category.color, category.name) : {}),
        ...(atOrigin && ghost.origin
          ? { top: ghost.origin.top, left: ghost.origin.left, width: ghost.origin.width, marginLeft: 0, right: "auto" }
          : {})
      }}
    >
      <CardFace categories={categories} draft={ghost.draft} inert item={ghost.item} nowMs={nowMs} />
    </div>
  );
}

function AllFramed({
  celebrate: emptiedHere,
  decided,
  moreComing,
  takeFocus
}: {
  celebrate: boolean;
  decided: ReviewDecisionState["decided"];
  moreComing: boolean;
  /** Cards were on screen this visit: whatever emptied the queue, focus lands on the heading. */
  takeFocus: boolean;
}) {
  const logged = decided.filter((decision) => decision.kind === "log");
  const loggedMs = logged.reduce((sum, decision) => sum + decision.durationMs, 0);
  // Blocks drop in only when this visit's own decision emptied the queue.
  const celebrate = emptiedHere && !moreComing && !prefersReducedMotion();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  // The decided card's buttons are gone: the heading takes focus so Tab continues from here.
  useEffect(() => {
    if (!takeFocus) return;
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus();
  }, [takeFocus]);
  if (moreComing) {
    return (
      <section aria-labelledby="df-done-title" className="df-card df-done">
        <h2 id="df-done-title" ref={headingRef} tabIndex={-1}>More to review</h2>
        <p>Older moments are on their way.</p>
      </section>
    );
  }
  const land = springTransition("land");
  const pop = springTransition("pop");
  const blocks = logged.length ? logged.slice(-DONE_BLOCKS_MAX) : [];
  return (
    <section
      aria-labelledby="df-done-title"
      className={`df-card df-done${celebrate ? " is-celebrating" : ""}`}
      style={{ "--df-land": land.easing, "--df-land-ms": `${land.durationMs}ms`, "--df-pop": pop.easing, "--df-pop-ms": `${pop.durationMs}ms` } as CSSProperties}
    >
      <div className="df-done-blocks" aria-hidden="true">
        {blocks.length
          ? blocks.map((decision, index) => (
            <span
              className={decision.color ? "df-block" : "df-done-none"}
              key={decision.token}
              style={{
                ...(decision.color ? blockStyle(decision.color, decision.colorName) : {}),
                height: 44 + ((index * 41) % 80),
                animationDelay: `${60 + index * 80}ms`
              }}
            />
          ))
          : <span className="df-done-none" style={{ height: 44 }} />}
      </div>
      <h2 id="df-done-title" ref={headingRef} tabIndex={-1}>All framed</h2>
      <p>
        {decided.length
          ? `${logged.length} moment${logged.length === 1 ? "" : "s"} logged${loggedMs >= 60_000 ? `, ${formatReviewDuration(loggedMs)} added to your days` : ""}. New suggestions will appear here.`
          : "Nothing to review. New suggestions from Location and Apple Health will appear here."}
      </p>
      <Link className="df-rbtn df-rbtn--live" href="/">Back to Today</Link>
    </section>
  );
}

/** The browser's clock for day words and "N moments", after hydration; ticks each minute. */
function useMinuteClock(hydrated: boolean) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, [hydrated]);
  return nowMs;
}

function useReviewDecisions(
  openItems: readonly ReviewItemRow[], refresh: () => Promise<unknown>,
  onOutingConflict: (stayId: string, statuses: Record<string, string>) => void
) {
  const [state, setState] = useState<ReviewDecisionState>(initialReviewDecisionState);
  const [controller] = useState(() => new ReviewDecisionController(setState));
  // The save reads the newest data: a held suggestion a refresh changed is not what the user
  // decided about. One a refresh no longer lists (decided elsewhere, or past the newest 100) is
  // still sent, and the server says.
  useEffect(() => {
    const items = new Map(openItems.map((item) => [item.id, item]));
    controller.setCommit(async (decision, options) => {
      const current = items.get(decision.itemId);
      if (current && reviewProposalSignature(current) !== decision.signature) return "changed";
      const envelope: ReviewMutationEnvelope = { clientMutationId: decision.clientMutationId, mutation: decision.mutation };
      const response = await clientFetch(`/api/review/${decision.itemId}`, {
        body: JSON.stringify(envelope),
        headers: { "Content-Type": "application/json" },
        keepalive: options.keepalive,
        method: "POST"
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      // An outing that changed (one of its cards decided elsewhere or retired) saved nothing: its Stay
      // comes back with the reason, and the next data shows whatever is still open (Codex r1 on #466).
      const outingAction = decision.mutation.action === "confirm_outing" || decision.mutation.action === "ignore_outing";
      if (outingAction && response.status === 409 && body.code === "resolution_conflict") {
        void refresh().catch(() => undefined);
        // The server says which cards are still open (Codex r2 on #466): a Stay decided elsewhere is
        // gone (its open Moves then show on their own); otherwise the outing comes back, open cards only.
        const statuses = body.canonicalReviewStatuses && typeof body.canonicalReviewStatuses === "object"
          ? body.canonicalReviewStatuses as Record<string, string> : null;
        if (statuses) onOutingConflict(decision.itemId, statuses);
        if (statuses && statuses[decision.itemId] !== undefined && statuses[decision.itemId] !== "open") return "gone";
        return "changed";
      }
      // Decided elsewhere (another device or tab): nothing to save and nothing to bring back.
      if (
        response.status === 404 ||
        (response.status === 409 && body.code === "resolution_conflict") ||
        (response.ok && body.alreadyResolved === true)
      ) {
        void refresh().catch(() => undefined);
        return "gone";
      }
      if (!response.ok) {
        const message = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : null;
        throw new Error(message ?? "Couldn’t save that decision.");
      }
      if (!validReviewAcknowledgement(body, envelope, decision.itemId)) {
        throw new Error("Couldn’t confirm that decision was saved.");
      }
      void refresh().catch(() => undefined);
      return "saved";
    });
  }, [controller, onOutingConflict, openItems, refresh]);

  useEffect(() => onBeforeSessionChange(() => controller.flushAndSettle()), [controller]);

  useEffect(() => {
    const flush = () => controller.flush();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      // Leaving Review saves a held decision at once (a remount after this keeps working).
      controller.flush();
    };
  }, [controller]);

  useEffect(() => {
    controller.reconcileItemIds(new Set(openItems.map((item) => item.id)));
  }, [controller, openItems]);

  return {
    state,
    decide: useCallback((request: Parameters<ReviewDecisionController["decide"]>[0]) => controller.decide(request), [controller]),
    undo: useCallback(() => controller.undo(), [controller]),
    clearError: useCallback(() => controller.clearError(), [controller])
  };
}
