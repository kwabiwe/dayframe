"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DAYFRAME_APP_ICONS, placeQuestion, type ClockFormat, type ListCheck, type LocationListRow } from "@dayframe/shared";
import { LocationMark, LocationRowButton, TripModesLine } from "@/components/location/LocationListRows";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { useReviewDecisions } from "@/components/review/useReviewDecisions";
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

export function useListChecks({
  applyTransition,
  categories,
  refresh,
  reviewItems
}: {
  /** The List's transition, which owns every change a "?" makes, restores included. */
  applyTransition: (update: () => void) => void;
  categories: readonly CategoryRow[];
  refresh: () => Promise<unknown>;
  reviewItems: readonly ReviewItemRow[];
}) {
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
  const { state, decide, undo, clearError } = useReviewDecisions(openItems, refresh, onOutingConflict, applyTransition);
  // What was answered here, so Undo or a refused save brings it back even when a refresh no longer lists
  // it; and an answered outing's trips, kept folded while its answer is held, saving or saved.
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, ReviewItemRow>>(() => new Map());
  const [revived, setRevived] = useState<ReadonlyMap<string, ReviewItemRow>>(() => new Map());
  const [heldOutings, setHeldOutings] = useState<ReadonlyMap<string, readonly ReviewItemRow[]>>(() => new Map());
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
    if (back.length) applyTransition(() => setRevived((current) => new Map([...current, ...back.map((item) => [item.id, item] as const)])));
  }, [applyTransition, state.restored]);
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
  const checks = useMemo<ListCheck[]>(() => items
    .filter((item) => !state.hiddenIds.has(item.id) && !memberIds.has(item.id) && !closedByServer.has(item.id))
    .map((item) => ({ id: item.id, segmentId: segmentOf(item), startedAt: item.suggestedStartedAt, stoppedAt: item.suggestedStoppedAt })),
  [closedByServer, items, memberIds, state.hiddenIds]);

  const answer = useCallback((itemId: string, kind: ReviewDecisionKind) => {
    const item = itemsById.get(itemId);
    if (!item || (kind === "log" && !reviewWindow(item))) return;
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
      label: kind === "log" ? `Logged ${reviewDefaultName(item)}` : `Skipped ${reviewTitle(item)}`,
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

  return { answer, checks, clearError, itemsById, outings, state, undo };
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
          hint={onOpen ? "Opens the trip" : check.expanded ? "Hides the question" : "Shows the question"}
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
