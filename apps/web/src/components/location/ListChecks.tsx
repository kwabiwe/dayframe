"use client";

import { useCallback, useMemo } from "react";
import { DAYFRAME_APP_ICONS, type ClockFormat, type ListCheck, type LocationListRow } from "@dayframe/shared";
import { CheckToggle, TripModesLine } from "@/components/location/LocationListRows";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { useReviewDecisions } from "@/components/review/useReviewDecisions";
import { formatDuration, formatTime } from "@/lib/format";
import type { CategoryRow, ReviewItemRow } from "@/lib/queries";
import {
  outingMutationFor,
  reviewCardCategory,
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
  categories,
  refresh,
  reviewItems
}: {
  categories: readonly CategoryRow[];
  refresh: () => Promise<unknown>;
  reviewItems: readonly ReviewItemRow[];
}) {
  const openItems = useMemo(() => reviewItems.filter((item) => item.status === "open"), [reviewItems]);
  const { state, decide, undo, clearError } = useReviewDecisions(openItems, refresh, () => undefined);
  // An outing (an unknown stay with its trips there and back) is one "?" on its stay, as on the deck.
  const outings = useMemo(() => reviewOutings(openItems), [openItems]);
  const memberIds = useMemo(() => new Set([...outings.values()].flatMap((outing) => outing.members.map((member) => member.id))), [outings]);
  const itemsById = useMemo(() => new Map(openItems.map((item) => [item.id, item])), [openItems]);
  const checks = useMemo<ListCheck[]>(() => openItems
    .filter((item) => !state.hiddenIds.has(item.id) && !memberIds.has(item.id))
    .map((item) => ({ id: item.id, segmentId: segmentOf(item), startedAt: item.suggestedStartedAt, stoppedAt: item.suggestedStoppedAt })),
  [memberIds, openItems, state.hiddenIds]);

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
    decide({
      itemId: item.id,
      kind,
      mutation: outing ? outingMutationFor(outing, kind, undefined) : reviewMutationFor(item, kind, undefined),
      signature: reviewProposalSignature(item),
      label: kind === "log" ? `Logged ${reviewDefaultName(item)}` : `Skipped ${reviewTitle(item)}`,
      durationMs: (span ? span.stopMs - span.startMs : 0) + outingMs,
      color: category?.color ?? null,
      colorName: category?.name ?? ""
    });
  }, [categories, decide, itemsById, outings]);

  return { answer, checks, clearError, itemsById, state, undo };
}

/** "3 to check" at the top of the day's List: each press moves to the next "?" and opens its question. */
export function ChecksChip({ count, onNext }: { count: number; onNext: () => void }) {
  if (!count) return null;
  return (
    <div className="timeline-checks-bar">
      <button className="timeline-checks-chip" data-tip="Go to the next one" onClick={onNext} type="button">
        <DayframeIcon glyph={DAYFRAME_APP_ICONS.placeUnknown} size={16} />
        {count} to check
      </button>
    </div>
  );
}

/** A suggestion's question under its row, with the deck's answers. */
export function CheckQuestionRow({
  clock,
  item,
  onAnswer,
  onPickPlace
}: {
  clock: ClockFormat;
  item: ReviewItemRow;
  onAnswer: (kind: ReviewDecisionKind) => void;
  /** Correct the place first (step 13): the suggestion then offers the place you picked. */
  onPickPlace?: () => void;
}) {
  const span = reviewWindow(item);
  const when = span ? `${formatTime(new Date(span.startMs), clock)}–${formatTime(new Date(span.stopMs), clock)}` : null;
  const picture = reviewPicture(item);
  const question = picture === "place"
    ? `Where were you${when ? `, ${when}` : ""}?`
    : `${reviewTitle(item)}${when ? `, ${when}` : ""}?`;
  const detail = span ? `${formatDuration(Math.round((span.stopMs - span.startMs) / 1000))} · ${reviewSourceLabel(picture)}` : reviewSourceLabel(picture);
  return (
    <tr className="timeline-check-row">
      <td colSpan={4}>
        <div className="timeline-check-question" role="group" aria-label={question}>
          <b>{question}</b>
          <small>{detail}</small>
          <div className="timeline-check-answers">
            <button className="ui-button ui-button-primary is-compact" disabled={!span} onClick={() => onAnswer("log")} type="button">
              Log {reviewDefaultName(item)}
            </button>
            {onPickPlace ? <button className="ui-button ui-button-secondary is-compact" onClick={onPickPlace} type="button">Pick a place…</button> : null}
            <button className="ui-button ui-button-ghost is-compact" onClick={() => onAnswer("skip")} type="button">Not now</button>
          </div>
        </div>
      </td>
    </tr>
  );
}

/** A "?" with no place row: a trip not yet in a block, Apple Health, or another suggestion, at its time. */
export function CheckRowView({ check, clock, item, row }: {
  check: { expanded: boolean; onToggle: () => void };
  clock: ClockFormat;
  item: ReviewItemRow;
  row: Extract<LocationListRow, { kind: "check" }>;
}) {
  const span = reviewWindow(item);
  const title = reviewTitle(item);
  return (
    <tr className="timeline-list-row timeline-location-row align-middle" data-location-row={row.key}>
      <td className="px-3 py-3">
        <div className="timeline-task-cell is-single">
          <span aria-hidden="true" className="timeline-location-mark is-unknown"><DayframeIcon glyph={DAYFRAME_APP_ICONS.placeUnknown} size={16} /></span>
          <span className="timeline-task-details">
            <span className="timeline-task-primary-line"><b>{title}</b></span>
            {row.trip?.legs.length ? <TripModesLine legs={row.trip.legs} route={row.trip.route} />
              : <span className="timeline-location-secondary">{reviewSourceLabel(reviewPicture(item))}</span>}
          </span>
        </div>
      </td>
      <td className="tabular px-3 py-3">
        <div className="timeline-list-time-content">
          {span ? `${formatTime(new Date(span.startMs), clock)}–${formatTime(new Date(span.stopMs), clock)}` : null}
        </div>
      </td>
      <td className="tabular px-3 py-3 timeline-list-duration">
        <div className="timeline-list-duration-content">{span ? formatDuration(Math.round((span.stopMs - span.startMs) / 1000)) : null}</div>
      </td>
      <td className="px-3 py-3">
        <div className="timeline-list-actions"><CheckToggle expanded={check.expanded} label={title} onToggle={check.onToggle} /></div>
      </td>
    </tr>
  );
}
