"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validReviewAcknowledgement, type ClockFormat, type LocationTimeline, type ReviewMutationEnvelope, type TimelinePlace, type TimelineTrip } from "@dayframe/shared";
import { LocationCorrectionDialog, type CorrectionActivity, type CorrectionPlace, type CorrectionQuestion, type LocationCorrectionTarget } from "@/components/location/LocationCorrectionDialog";
import { checkQuestionWords, useSettleResolved } from "@/components/location/ListChecks";
import { askingChecks } from "@/lib/calendar-checks";
import { clientFetch } from "@/lib/client-auth-fetch";
import type { ReviewItemRow } from "@/lib/queries";
import { outingMutationFor, reviewMutationFor, reviewOutings } from "@/lib/review-deck";

type Opened = { owner: string; checkId: string | null; target: Extract<LocationCorrectionTarget, { kind: "place" | "trip" }> };

/**
 * The Grid's place and trip dialogs (owner item A, 28 Oct 2026): a Places-lane item opens its dialog, its "?"
 * asked at the top. The "?" are the shared asking list (today and the 6 days before, an outing once on its stay),
 * so the lane, the badge and the List agree. An answer is saved at once with the deck's own mutation (an outing's
 * decides its trips with it) and the dialog closes only once the server acknowledged it; a refusal keeps the
 * question and says why. A dialog belongs to its owner (workspace and user) and to its item: switching workspace,
 * or a refresh that no longer lists the item, closes it (Codex r1 on #609).
 */
export function useGridCorrection({ activities, clock, owner, places, refresh, reviewItems, timelines, todayStartMs }: {
  activities: readonly CorrectionActivity[];
  clock: ClockFormat;
  owner: string;
  places: readonly CorrectionPlace[];
  refresh: () => Promise<unknown>;
  reviewItems: readonly ReviewItemRow[];
  timelines: ReadonlyMap<string, LocationTimeline>;
  todayStartMs: number | null;
}) {
  const settleResolved = useSettleResolved();
  const asking = useMemo(() => todayStartMs !== null ? askingChecks(reviewItems, todayStartMs) : null, [reviewItems, todayStartMs]);
  const askingBySegment = useMemo(() => asking
    ? new Map(asking.flatMap((check) => check.segmentId ? [[check.segmentId, check.id] as const] : [])) : null, [asking]);
  const outings = useMemo(() => reviewOutings(reviewItems.filter((item) => item.status === "open")), [reviewItems]);
  const [opened, setOpened] = useState<Opened | null>(null);
  // The control that opened the dialog, and whether an answer or a saved correction closed it: focus then moves
  // on (Codex r2, r3 on #609).
  const opener = useRef<HTMLElement | null>(null);
  const answered = useRef(false);

  const open = useCallback((item: TimelinePlace | TimelineTrip, timeline: LocationTimeline, checkId: string | null) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    answered.current = false;
    setOpened({ owner, checkId, target: targetFor(item, timeline) });
  }, [owner]);

  // Its owner's, and its item still on the days shown, as the newest data has it (its times, place and route):
  // otherwise it closes, and anything it had in flight stops (Codex r1, r2 on #609).
  const targetId = opened ? opened.target.kind === "trip" ? opened.target.trip.id : opened.target.place.id : null;
  const fresh = targetId ? [...timelines.values()].flatMap((timeline) => timeline.items.flatMap((item) =>
    item.id === targetId && (item.kind === "place" || item.kind === "trip") ? [targetFor(item, timeline)] : [])).at(-1) ?? null : null;
  const current = opened && opened.owner === owner && fresh ? { ...opened, target: fresh } : null;
  if (opened && !current) setOpened(null);

  // An answer that closed the dialog: focus goes to the next question on the Grid, else the Grid itself, when the
  // control that opened it is gone (Codex r2 on #609).
  useEffect(() => {
    if (current || !answered.current) return;
    answered.current = false;
    const from = opener.current;
    opener.current = null;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const questions = [...document.querySelectorAll<HTMLElement>(".calendar-places-item.is-asking, .calendar-review-block")];
      const next = (from?.isConnected ? questions.find((each) => each !== from && Boolean(from.compareDocumentPosition(each) & Node.DOCUMENT_POSITION_FOLLOWING)) : undefined)
        ?? questions.find((each) => each !== from);
      (next ?? document.querySelector<HTMLElement>(".calendar-grid-scroller"))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  });

  const review = current?.checkId && asking?.some((check) => check.id === current.checkId)
    ? reviewItems.find((item) => item.id === current.checkId && item.status === "open") : undefined;
  const question: CorrectionQuestion | null = review ? (() => {
    const words = checkQuestionWords(review, clock);
    return { text: words.question, yesLabel: words.yesLabel, noLabel: "Not now",
      onAnswer: async (yes: boolean) => {
        const failure = await answerReview(review, outings.get(review.id), yes, refresh, settleResolved);
        if (!failure) answered.current = true;
        return failure;
      } };
  })() : null;

  const dialog = current ? (
    <LocationCorrectionDialog activities={activities} clock={clock} key={`${current.owner}:${targetId}`} onClose={() => setOpened(null)}
      // A saved correction (Logs as, Save this place, a fix) can remove the opener too: focus moves on as after an answer (Codex r3 on #609).
      onCorrected={async () => { answered.current = true; await refresh(); }} onResolved={settleResolved} places={places} question={question}
      target={current.target} />
  ) : null;
  return { askingBySegment, dialog, open };
}

/** A dialog's target from the timeline's copy of the item: a place with its label, a trip with its route. */
function targetFor(item: TimelinePlace | TimelineTrip, timeline: LocationTimeline): Opened["target"] {
  const names = new Map(timeline.items.flatMap((each) => each.kind === "place" ? [[each.id, each.name] as const] : []));
  if (item.kind === "trip") {
    return { kind: "trip", trip: item, route: `${names.get(item.fromId) ?? "Unknown place"} → ${names.get(item.toId) ?? "Unknown place"}` };
  }
  const trips = timeline.items.filter((each) => each.kind === "trip");
  return { kind: "place", place: item, label: item.name ?? (item.matchKind === "ambiguous" ? "Unclear place" : "Unknown place"),
    joinsTrips: trips.some((trip) => trip.toId === item.id) && trips.some((trip) => trip.fromId === item.id) };
}

/** Saves a Grid answer at once: null when the server acknowledged it (or it was decided elsewhere), else why not. */
async function answerReview(review: ReviewItemRow, outing: ReturnType<typeof reviewOutings> extends Map<string, infer O> ? O | undefined : never,
  yes: boolean, refresh: () => Promise<unknown>, settleResolved: (reviewItemIds: readonly string[]) => void): Promise<string | null> {
  // Every item this answer covers: once the server resolved them, the List's held or Undo-able decisions for them
  // are settled, so its Undo can't bring them back (Codex r6 on #609).
  const covered = [review.id, ...(outing?.members ?? []).map((member) => member.id)];
  const kind = yes ? "log" : "skip";
  const envelope: ReviewMutationEnvelope = {
    clientMutationId: crypto.randomUUID(),
    mutation: outing ? outingMutationFor(outing, kind, undefined) : reviewMutationFor(review, kind, undefined)
  };
  const response = await clientFetch(`/api/review/${review.id}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(envelope)
  }).catch(() => null);
  if (!response) return "Couldn't save that answer. Check your connection and try again.";
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  // An outing that changed (one of its cards decided elsewhere) saved nothing: as the List's controller does, its
  // question stays while the stay is still open, and says why; a stay decided elsewhere has nothing left to ask.
  if (outing && response.status === 409 && body.code === "resolution_conflict") {
    await refresh().catch(() => undefined);
    const statuses = body.canonicalReviewStatuses && typeof body.canonicalReviewStatuses === "object"
      ? body.canonicalReviewStatuses as Record<string, string> : null;
    if (statuses) settleResolved(Object.entries(statuses).filter(([, status]) => status !== "open").map(([id]) => id));
    if (statuses && statuses[review.id] !== undefined && statuses[review.id] !== "open") return null;
    return "Part of this outing was decided elsewhere, so nothing was saved. Answer it again.";
  }
  // Decided elsewhere (another device or tab): nothing left to ask.
  if (response.status === 404 || (response.status === 409 && body.code === "resolution_conflict") || (response.ok && body.alreadyResolved === true)) {
    settleResolved(covered);
    await refresh().catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    return typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Couldn't save that answer. Try again.";
  }
  if (!validReviewAcknowledgement(body, envelope, review.id)) return "Couldn't confirm that answer was saved. Try again.";
  settleResolved(covered);
  await refresh().catch(() => undefined);
  return null;
}
