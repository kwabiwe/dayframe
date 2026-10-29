"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DAYFRAME_APP_ICONS, placeQuestion, timerTripClashQuestion, timerTripClashWords, type ClockFormat, type ListCheck, type LocationListRow } from "@dayframe/shared";
import { LocationMark, LocationRowButton, TripModesLine } from "@/components/location/LocationListRows";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { useReviewDecisions } from "@/components/review/useReviewDecisions";
import { clashStillAsks, type ClashBlocks } from "@/lib/calendar-checks";
import { formatDuration, formatTime } from "@/lib/format";
import type { CategoryRow, ReviewItemRow } from "@/lib/queries";
import {
  outingMutationFor,
  reviewCardCategory,
  hasV2Evidence,
  reviewDefaultName,
  reviewMutationFor,
  reviewOutings,
  reviewPicture,
  reviewProposalSignature,
  reviewSourceLabel,
  reviewTitle,
  reviewWindow,
  type ReviewDecisionKind
} from "@/lib/review-deck";

/**
 * Things to check in Calendar › List (location v4 step 14, design §6): each open suggestion is a "?"
 * on the row it is about, answered there. The answers are the Review deck's own (the same mutations,
 * held for Undo and saved by the same decision controller), so an answer here has the same effect.
 */

/** The segment an open suggestion names: a Location stay's or trip's client segment id, else none. */
function segmentOf(item: ReviewItemRow) {
  const id = item.rawPayload?.clientSegmentId;
  return typeof id === "string" && id ? id : null;
}

/** The workspace of an owner key ("workspace:user"). */
function workspaceOf(owner: string) {
  return owner.split(":")[0];
}

type CheckDecisionsInput = {
  /** The List's transition, which owns every change a "?" makes, restores included. Stable. */
  applyTransition: (update: () => void) => void;
  /**
   * The blocks loaded here, so a "block ran into your trip" stops asking at once when its block no longer runs into
   * the trip (a local edit, a Stop or a delete), before the server says (location v4 design §7).
   */
  blocks?: ClashBlocks;
  /** A saved answer's acknowledgement (End it that stopped the running block refreshes the timer). Stable. */
  onAcknowledged?: (body: Record<string, unknown>) => void;
  categories: readonly CategoryRow[];
  /** Whose decisions (workspace and user): another owner starts afresh, and the previous one's late results are dropped. */
  owner: string;
  refresh: () => Promise<unknown>;
  reviewItems: readonly ReviewItemRow[];
};

/**
 * The "?" decisions (Codex r4 on #609): what is held for Undo, saving, revived or decided by the server, and the
 * "?" that therefore still show. Owned once per workspace/user lifetime at AppShell level (CheckDecisionsProvider),
 * so the List, the sidebar badge and Today's chip read one state that outlives the List: an answer still saving
 * stays away when the List is left and opened again, and a saved one until the data no longer lists it open.
 */
function useCheckDecisionsState({ applyTransition, blocks, categories, onAcknowledged, owner, refresh, reviewItems }: CheckDecisionsInput) {
  const openItems = useMemo(() => reviewItems.filter((item) => item.status === "open"), [reviewItems]);
  // As the deck (Codex r1/r2 on #568): a refused outing's canonical statuses, so only its open cards
  // return; and cards the server says are decided stay away until newer data lists them open.
  const outingConflictStatuses = useRef(new Map<string, Record<string, string>>());
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
  const { state, decide, undo, clearError, settleResolved: settleDecisions } = useReviewDecisions(openItems, refresh, onOutingConflict, applyTransition, owner, onAcknowledged);
  // What was answered here, so Undo or a refused save brings it back even when a refresh no longer lists
  // it; and an answered outing's trips, kept folded while its answer is held, saving or saved.
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, ReviewItemRow>>(() => new Map());
  const [revived, setRevived] = useState<ReadonlyMap<string, ReviewItemRow>>(() => new Map());
  const [heldOutings, setHeldOutings] = useState<ReadonlyMap<string, readonly ReviewItemRow[]>>(() => new Map());
  // The owner lifetime: a generation bumped on every owner change (A → B → A is three), which every deferred update
  // captures and checks, so nothing queued in one lifetime lands in another (Codex r6 on #609).
  const [lifetime, setLifetime] = useState({ owner, generation: 0 });
  const generationNow = useRef(0);
  useLayoutEffect(() => {
    generationNow.current = lifetime.generation;
  }, [lifetime.generation]);
  // The items the server resolved another way in this lifetime: never revived.
  const resolvedNow = useRef(new Set<string>());
  useEffect(() => {
    resolvedNow.current = new Set();
  }, [lifetime.generation]);
  // Another owner: nothing of the previous lifetime carries over.
  if (lifetime.owner !== owner) {
    setLifetime({ owner, generation: lifetime.generation + 1 });
    setClosedByServer(new Map());
    setSnapshots(new Map());
    setRevived(new Map());
    setHeldOutings(new Map());
  }
  useEffect(() => {
    outingConflictStatuses.current = new Map();
  }, [owner]);
  // Kept current for the restore effect below.
  const restoreSources = useRef({ snapshots, heldOutings });
  useLayoutEffect(() => {
    restoreSources.current = { snapshots, heldOutings };
  });
  const loadedIds = useMemo(() => new Set(openItems.map((item) => item.id)), [openItems]);
  const loadedRef = useRef(loadedIds);
  useLayoutEffect(() => {
    loadedRef.current = loadedIds;
  }, [loadedIds]);
  // As the deck's restore effect: an outing comes back whole, its Stay and every member the data no longer
  // lists, except cards a refused save says are no longer open.
  useEffect(() => {
    if (!state.restored) return;
    const restoredId = state.restored.itemId;
    const statuses = outingConflictStatuses.current.get(restoredId);
    outingConflictStatuses.current.delete(restoredId);
    const stillOpen = (id: string) => !statuses || statuses[id] === undefined || statuses[id] === "open";
    const loaded = loadedRef.current;
    const snapshot = restoreSources.current.snapshots.get(restoredId);
    const back = [...(snapshot && !loaded.has(restoredId) ? [snapshot] : []),
      ...(restoreSources.current.heldOutings.get(restoredId) ?? []).filter((member) => !loaded.has(member.id) && stillOpen(member.id))];
    // The transition may run it later: only in the lifetime it was for, and only its own items, never one the
    // server resolved meanwhile (Codex r5, r6 on #609).
    const scheduledFor = lifetime.generation;
    if (back.length) applyTransition(() => {
      if (generationNow.current !== scheduledFor) return;
      const still = back.filter((item) => !resolvedNow.current.has(item.id));
      if (still.length) setRevived((current) => new Map([...current, ...still.map((item) => [item.id, item] as const)]));
    });
  }, [applyTransition, lifetime.generation, state.restored]);
  // A revived card the data lists again is the data's card from then on.
  if ([...revived.keys()].some((id) => loadedIds.has(id))) setRevived(new Map([...revived].filter(([id]) => !loadedIds.has(id))));
  // Newer data listing a card open again lifts the server's earlier "decided" for it.
  const reopened = (id: string, over: unknown) => over !== openItems && loadedIds.has(id);
  if ([...closedByServer].some(([id, over]) => reopened(id, over))) {
    setClosedByServer(new Map([...closedByServer].filter(([id, over]) => !reopened(id, over))));
  }
  // Cards the server says are decided leave before outings are grouped, from the data as from revived copies,
  // so no answer covers them again and an open trip under a decided stay stands on its own (Codex r3 on #568).
  const items = useMemo(() => [...openItems, ...[...revived.values()].filter((item) => !loadedIds.has(item.id))]
    .filter((item) => !closedByServer.has(item.id)), [closedByServer, loadedIds, openItems, revived]);
  // An outing (an unknown stay with its trips there and back) is one "?" on its stay, as on the deck.
  const outings = useMemo(() => reviewOutings(items), [items]);
  const memberIds = useMemo(() => new Set([
    ...[...outings.values()].flatMap((outing) => outing.members.map((member) => member.id)),
    // A held outing keeps its trips folded, unless the server says its stay is decided: its open trips then stand alone.
    ...[...heldOutings].filter(([anchorId]) => state.hiddenIds.has(anchorId) && !closedByServer.has(anchorId))
      .flatMap(([, members]) => members.map((member) => member.id))
  ]), [closedByServer, heldOutings, outings, state.hiddenIds]);
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  // A block that ran into a trip is one "?" like any other, asked on its block (design §7), while its block as
  // loaded here still runs into the trip.
  const checks = useMemo<ListCheck[]>(() => {
    return items
      .filter((item) => clashStillAsks(item, blocks) && !state.hiddenIds.has(item.id) && !memberIds.has(item.id) && !closedByServer.has(item.id))
      .map((item) => ({ id: item.id, segmentId: segmentOf(item), startedAt: item.suggestedStartedAt, stoppedAt: item.suggestedStoppedAt }));
  }, [blocks, closedByServer, items, memberIds, state.hiddenIds]);

  // What the badge and Today's chip count: the open items as the List shows them — held, saving, saved (until the
  // data no longer lists them) and server-decided ones away, with the same held outing members as `memberIds` and
  // its exception for a stay the server says is decided; revived ones back.
  const projectedItems = useMemo(() => {
    const hidden = new Set([...state.hiddenIds, ...closedByServer.keys(),
      ...[...heldOutings].filter(([anchorId]) => state.hiddenIds.has(anchorId) && !closedByServer.has(anchorId))
        .flatMap(([, members]) => members.map((member) => member.id))]);
    return items.filter((item) => !hidden.has(item.id) && clashStillAsks(item, blocks));
  }, [blocks, closedByServer, heldOutings, items, state.hiddenIds]);

  // End it held, saving or saved here: its block shows ended at the trip's start until the data says so itself, the
  // running block too (design §7); Undo or a refused save puts it back.
  const endedBlocks = useMemo(() => {
    const ended = new Map<string, string>();
    for (const decision of state.decided) {
      if (decision.kind !== "log") continue;
      const item = itemsById.get(decision.itemId) ?? snapshots.get(decision.itemId);
      const question = item ? timerTripClashQuestion(item) : null;
      if (question) ended.set(question.timeEntryId, question.tripStartedAt);
    }
    return ended as ReadonlyMap<string, string>;
  }, [itemsById, snapshots, state.decided]);

  /** Answers a "?" (held for Undo). `label` names a block's answer ("Ended Team sync at 09:42", "Kept Team sync"). */
  const answer = useCallback((itemId: string, kind: ReviewDecisionKind, label?: string) => {
    const item = itemsById.get(itemId);
    if (!item || (kind === "log" && !reviewWindow(item))) return;
    // End it is sent with the proposal it was shown; without one it is never offered (design §7).
    if (kind === "log" && timerTripClashQuestion(item) && !item.proposalHash) return;
    const outing = outings.get(item.id);
    const span = reviewWindow(item);
    const category = reviewCardCategory(item, undefined, categories);
    const outingMs = outing ? outing.members.reduce((sum, member) => {
      const memberSpan = reviewWindow(member);
      return sum + (memberSpan ? memberSpan.stopMs - memberSpan.startMs : 0);
    }, 0) : 0;
    setSnapshots((current) => new Map([...current, [item.id, item], ...(outing?.members ?? []).map((member) => [member.id, member] as const)]));
    if (outing) setHeldOutings((current) => new Map(current).set(item.id, outing.members));
    const held = decide({
      itemId: item.id,
      kind,
      mutation: outing ? outingMutationFor(outing, kind, undefined) : reviewMutationFor(item, kind, undefined),
      signature: reviewProposalSignature(item),
      label: label ?? (kind === "log" ? `Logged ${reviewDefaultName(item)}` : `Skipped ${reviewTitle(item)}`),
      durationMs: (span ? span.stopMs - span.startMs : 0) + outingMs,
      color: category?.color ?? null,
      colorName: category?.name ?? ""
    });
    // A held answer retires the copies Undo brought back, its outing's members too, as on the deck (Codex r3 on #568).
    const answered = [item.id, ...(outing?.members ?? []).map((member) => member.id)];
    if (held && answered.some((id) => revived.has(id))) {
      setRevived((current) => new Map([...current].filter(([id]) => !answered.includes(id))));
    }
  }, [categories, decide, itemsById, outings, revived]);

  /**
   * A receipt that resolved these items another way (Logs as's `resolvedReviewItemIds`, a Grid answer; Codex r6 on
   * #609): their held or saving decisions are settled, nothing revives them, and they stay away until data lists
   * them open again.
   */
  // A receipt can land lifetimes later (A → B → A; Codex r7 on #609). Each request holds the settle of the lifetime it
  // started in, which applies its ids through the current controller — a resolved review id is a server fact — but
  // only while the workspace is still the one the request was made in; otherwise the receipt is dropped.
  const settleNow = useRef(settleDecisions);
  const ownerNow = useRef(owner);
  useLayoutEffect(() => {
    settleNow.current = settleDecisions;
    ownerNow.current = owner;
  });
  const settleResolved = useCallback((itemIds: readonly string[]) => {
    if (!itemIds.length) return;
    if (workspaceOf(ownerNow.current) !== workspaceOf(owner)) return;
    for (const id of itemIds) resolvedNow.current.add(id);
    settleNow.current(itemIds);
    setRevived((current) => itemIds.some((id) => current.has(id)) ? new Map([...current].filter(([id]) => !itemIds.includes(id))) : current);
    const over = openItemsAtConflict.current;
    setClosedByServer((current) => new Map([...current, ...itemIds.map((id) => [id, over] as const)]));
  }, [owner]);

  return { answer, checks, clearError, endedBlocks, itemsById, outings, projectedItems, settleResolved, state, undo };
}

type CheckDecisions = ReturnType<typeof useCheckDecisionsState>;
type SharedCheckDecisions = CheckDecisions & {
  /** The List, while it is shown, lends its transition and its refresh (which also reloads its weeks). */
  register: (applyTransition: (update: () => void) => void, refresh: () => Promise<unknown>) => () => void;
};
const CheckDecisionsContext = createContext<SharedCheckDecisions | null>(null);

/** The one owner of "?" decisions for the signed-in workspace and user, above the List, the badge and Today. */
export function CheckDecisionsProvider({ blocks, categories, children, owner, refresh, reviewItems }: {
  blocks?: ClashBlocks; categories: readonly CategoryRow[]; children: ReactNode; owner: string; refresh: () => Promise<unknown>;
  reviewItems: readonly ReviewItemRow[];
}) {
  const lent = useRef<{ transition: ((update: () => void) => void) | null; refresh: (() => Promise<unknown>) | null }>({ transition: null, refresh: null });
  const shellRefresh = useRef(refresh);
  useLayoutEffect(() => {
    shellRefresh.current = refresh;
  });
  const applyTransition = useCallback((update: () => void) => (lent.current.transition ?? ((run: () => void) => run()))(update), []);
  const refreshAll = useCallback(() => (lent.current.refresh ?? shellRefresh.current)(), []);
  // End it that stopped the running block: the shell (its timer) reads again too, not only the List.
  const onAcknowledged = useCallback((body: Record<string, unknown>) => {
    if (body.stoppedRunningTimer === true && lent.current.refresh) void shellRefresh.current().catch(() => undefined);
  }, []);
  const decisions = useCheckDecisionsState({ applyTransition, blocks, categories, onAcknowledged, owner, refresh: refreshAll, reviewItems });
  const register = useCallback((transition: (update: () => void) => void, listRefresh: () => Promise<unknown>) => {
    lent.current = { transition, refresh: listRefresh };
    return () => {
      if (lent.current.transition === transition) lent.current = { transition: null, refresh: null };
    };
  }, []);
  const value = useMemo(() => ({ ...decisions, register }), [decisions, register]);
  return <CheckDecisionsContext.Provider value={value}>{children}</CheckDecisionsContext.Provider>;
}

const NO_SETTLE = () => undefined;
/** Settles review items a receipt resolved another way (the Grid's answers and corrections), when a provider owns decisions. */
export function useSettleResolved(): (reviewItemIds: readonly string[]) => void {
  return useContext(CheckDecisionsContext)?.settleResolved ?? NO_SETTLE;
}

/** The open review items as the List shows them, for counts outside it; the items as given without a provider. */
export function useProjectedReviewItems(reviewItems: readonly ReviewItemRow[]) {
  return useContext(CheckDecisionsContext)?.projectedItems ?? reviewItems;
}

const NO_ENDED: ReadonlyMap<string, string> = new Map();
/** Blocks an End it held, saving or saved here ends at its trip's start (by block id), for the List, Grid and timer. */
export function useEndedBlocks(): ReadonlyMap<string, string> {
  return useContext(CheckDecisionsContext)?.endedBlocks ?? NO_ENDED;
}

const NO_ITEMS: readonly ReviewItemRow[] = [];

/**
 * Calendar › List's "?" decisions: the AppShell provider's, with the List lending its transition and refresh while
 * shown; without a provider (a List on its own), its own.
 */
export function useListChecks({ applyTransition, blocks, categories, refresh, reviewItems }: Omit<CheckDecisionsInput, "owner" | "onAcknowledged">) {
  const shared = useContext(CheckDecisionsContext);
  const local = useCheckDecisionsState({ applyTransition, blocks, categories, owner: "local", refresh, reviewItems: shared ? NO_ITEMS : reviewItems });
  const register = shared?.register;
  useLayoutEffect(() => register?.(applyTransition, refresh), [applyTransition, refresh, register]);
  return shared ?? local;
}

/** "3 to check" at the top of the day's List: each press moves to the next "?" and opens its question. */
export function ChecksChip({ count, onNext }: { count: number; onNext: () => void }) {
  if (!count) return null;
  return (
    <div className="timeline-checks-bar is-sticky">
      {/* Every "?" from the last 7 days, oldest first, across days (owner, 28 Oct 2026, concern 4). */}
      <button aria-label={`${count} to check, oldest first`} className="timeline-checks-chip"
        data-tip="Go to the next one, oldest first" onClick={onNext} type="button">
        <DayframeIcon glyph={DAYFRAME_APP_ICONS.placeUnknown} size={16} />
        {count} to check
      </button>
    </div>
  );
}

/**
 * A suggestion's question under its row, with the deck's answers in compact pills. Since the owner's approval
 * (28 Oct 2026) only a "?" with no dialog asks here (Apple Health, or a trip the day's places don't have);
 * places and trips ask at the top of their dialog.
 */
export function CheckQuestionRow({
  clock,
  item,
  onAnswer
}: {
  clock: ClockFormat;
  item: ReviewItemRow;
  onAnswer: (kind: ReviewDecisionKind) => void;
}) {
  const span = reviewWindow(item);
  const when = span ? `${formatTime(new Date(span.startMs), clock)}–${formatTime(new Date(span.stopMs), clock)}` : null;
  const picture = reviewPicture(item);
  // Every Move is a trip here, a round trip from a place too (Codex r1 on #590).
  const trip = item.eventType === "commute_detected";
  // A place asks "Visited {guess}?" (or "Where were you?") with its times under it (card B); anything
  // else asks by its title with its times.
  const place = !trip && picture === "place";
  const visited = place ? placeQuestion(reviewTitle(item)) : null;
  const question = visited ? visited.question : `${reviewTitle(item)}${when ? `, ${when}` : ""}?`;
  const detail = visited ? when ?? reviewSourceLabel(picture)
    : span ? `${formatDuration(Math.round((span.stopMs - span.startMs) / 1000))} · ${reviewSourceLabel(picture)}` : reviewSourceLabel(picture);
  // Yes confirms what it asks: a trip, a place it names, or anything else as suggested. A place it cannot
  // name is answered with Edit; one from before Location V2 has no editor here, so it keeps "Log …" (Codex r1
  // on #594).
  const legacyUnnamed = Boolean(visited && visited.guess == null && !hasV2Evidence(item));
  const canConfirm = !visited || visited.guess != null || legacyUnnamed;
  return (
    // Keyed by its suggestion, so the List finds it again when its row is rebuilt (a day's places
    // arriving turn its own "?" row into a place row's; Codex r8 on #584).
    <tr className="timeline-check-row" data-question-for={item.id}>
      <td colSpan={4}>
        <div className="timeline-check-question" role="group" aria-label={question}>
          <b>{question}</b>
          {/* The row already shows the times (owner item I), so a place's question doesn't repeat them. */}
          {visited ? null : <small>{detail}</small>}
          <div className="timeline-check-answers">
            {/* Card D item 9: the answer is a neutral dark pill on the inset surface, as on iPhone; coral
                stays for Play/Stop and live recording. An outing's trips there and back are logged with it. */}
            {canConfirm ? (
              <button className="ui-button timeline-check-log is-compact" disabled={!span} onClick={() => onAnswer("log")} type="button">
                {(trip || visited) && !legacyUnnamed ? "Yes" : `Log ${reviewDefaultName(item)}`}
              </button>
            ) : null}
            <button className="ui-button ui-button-ghost is-compact" onClick={() => onAnswer("skip")} type="button">Not now</button>
          </div>
        </div>
      </td>
    </tr>
  );
}

/**
 * Owner items A and B (28 Oct 2026): a "?"'s words for its dialog and its row's Yes pill — what it asks, and the
 * one-tap answer when there is a confident one (a trip, or a place with a guess).
 */
export function checkQuestionWords(item: ReviewItemRow, clock: ClockFormat) {
  const span = reviewWindow(item);
  const when = span ? `${formatTime(new Date(span.startMs), clock)}–${formatTime(new Date(span.stopMs), clock)}` : null;
  const picture = reviewPicture(item);
  const trip = item.eventType === "commute_detected";
  const visited = !trip && picture === "place" ? placeQuestion(reviewTitle(item)) : null;
  const question = visited ? visited.question : `${reviewTitle(item)}${when ? `, ${when}` : ""}?`;
  const yesLabel = !span ? null : trip || visited?.guess ? "Yes" : visited ? null : `Log ${reviewDefaultName(item)}`;
  return { question, yesLabel, confident: Boolean(span && (trip || visited?.guess)) };
}

/**
 * A block's "?" (a block that ran into a trip, location v4 design §7): what it asks at the top of the block's editor,
 * its one Yes ("End it at 09:42", offered only with the proposal to send) and "Keep it", and the Undo toast's words.
 */
export function blockQuestionWords(item: ReviewItemRow, blockName: string, clock: ClockFormat) {
  const question = timerTripClashQuestion(item);
  const words = question ? timerTripClashWords(item, question, blockName, clock) : null;
  return {
    question: words?.question ?? reviewTitle(item),
    yesLabel: words && item.proposalHash ? words.endLabel : null,
    noLabel: words?.keepLabel ?? "Keep it",
    endedLabel: `Ended ${blockName} at ${words?.endsAt ?? ""}`.trim(),
    keptLabel: `Kept ${blockName}`
  };
}

/** A "?" with no place row: a trip not yet in a block, Apple Health, or another suggestion, at its time. */
export function CheckRowView({ check, clock, item, onOpen, onYes, row }: {
  check: { expanded: boolean; onToggle: () => void };
  /** A trip's row opens its dialog (owner item A); anything else (Apple Health) opens its question under it. */
  onOpen?: () => void;
  /** The one-tap Yes on the row (owner item B). */
  onYes?: () => void;
  clock: ClockFormat;
  item: ReviewItemRow;
  row: Extract<LocationListRow, { kind: "check" }>;
}) {
  const span = reviewWindow(item);
  const title = reviewTitle(item);
  // Owner concern 1 (28 Oct 2026): its own icon (a trip's route, Apple Health's heart, a place's pin) with the
  // amber dot; the whole row opens its question.
  const picture = reviewPicture(item);
  const glyph = picture === "commute" ? DAYFRAME_APP_ICONS.openTrip : picture === "sleep" || picture === "workout"
    ? DAYFRAME_APP_ICONS.sourceHealth : DAYFRAME_APP_ICONS.places;
  const when = span ? `${formatTime(new Date(span.startMs), clock)}–${formatTime(new Date(span.stopMs), clock)}` : "";
  return (
    <tr className="timeline-list-row timeline-location-row align-middle is-v4" data-location-row={row.key} data-suggestion-id={item.id}>
      <td className="px-3 py-3" colSpan={2}>
        <LocationRowButton asking checkKey={row.key} expanded={onOpen ? undefined : check.expanded}
          hint={onOpen ? row.trip ? "Opens the trip" : "Opens the place" : check.expanded ? "Hides the question" : "Shows the question"}
          label={`${title}${when ? `, ${when}` : ""}. Needs a look`} onPress={onOpen ?? check.onToggle}>
          <LocationMark asking glyph={glyph} />
          <span className="timeline-task-details">
            <span className="timeline-task-primary-line"><b>{title}</b></span>
            {row.trip?.legs.length ? <TripModesLine legs={row.trip.legs} route={row.trip.route} />
              : <span className="timeline-location-secondary">{reviewSourceLabel(picture)}</span>}
          </span>
          {span ? <StackedTimes clock={clock} fromMs={span.startMs} toMs={span.stopMs} /> : null}
        </LocationRowButton>
      </td>
      <td className="tabular px-3 py-3 timeline-list-duration">
        <div className="timeline-list-duration-content">{span ? formatDuration(Math.round((span.stopMs - span.startMs) / 1000)) : null}</div>
      </td>
      <td className="px-3 py-3">
        {onYes ? <button className="ui-button timeline-check-log is-compact timeline-row-yes" onClick={onYes} type="button">Yes</button> : null}
      </td>
    </tr>
  );
}

/** Start over end, as a block's row shows its times (owner item D). */
export function StackedTimes({ clock, fromMs, toMs }: { clock: ClockFormat; fromMs: number; toMs: number | null }) {
  return (
    <span className="tabular timeline-location-span is-stacked">
      <span>{formatTime(new Date(fromMs), clock)}</span>
      <span>{toMs == null ? "now" : formatTime(new Date(toMs), clock)}</span>
    </span>
  );
}
