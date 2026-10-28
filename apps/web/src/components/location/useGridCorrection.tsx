"use client";

import { useCallback, useMemo, useState } from "react";
import { validReviewAcknowledgement, type ClockFormat, type LocationTimeline, type ReviewMutationEnvelope, type TimelinePlace, type TimelineTrip } from "@dayframe/shared";
import { LocationCorrectionDialog, type CorrectionActivity, type CorrectionPlace, type CorrectionQuestion, type LocationCorrectionTarget } from "@/components/location/LocationCorrectionDialog";
import { checkQuestionWords } from "@/components/location/ListChecks";
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
  const asking = useMemo(() => todayStartMs !== null ? askingChecks(reviewItems, todayStartMs) : null, [reviewItems, todayStartMs]);
  const askingBySegment = useMemo(() => asking
    ? new Map(asking.flatMap((check) => check.segmentId ? [[check.segmentId, check.id] as const] : [])) : null, [asking]);
  const outings = useMemo(() => reviewOutings(reviewItems.filter((item) => item.status === "open")), [reviewItems]);
  const [opened, setOpened] = useState<Opened | null>(null);

  const open = useCallback((item: TimelinePlace | TimelineTrip, timeline: LocationTimeline, checkId: string | null) => {
    const names = new Map(timeline.items.flatMap((each) => each.kind === "place" ? [[each.id, each.name] as const] : []));
    if (item.kind === "trip") {
      setOpened({ owner, checkId, target: { kind: "trip", trip: item,
        route: `${names.get(item.fromId) ?? "Unknown place"} → ${names.get(item.toId) ?? "Unknown place"}` } });
      return;
    }
    const trips = timeline.items.filter((each) => each.kind === "trip");
    setOpened({ owner, checkId, target: { kind: "place", place: item,
      label: item.name ?? (item.matchKind === "ambiguous" ? "Unclear place" : "Unknown place"),
      joinsTrips: trips.some((trip) => trip.toId === item.id) && trips.some((trip) => trip.fromId === item.id) } });
  }, [owner]);

  // Its owner's, and its item still on the days shown: otherwise it closes (and anything it had in flight stops).
  const targetId = opened ? opened.target.kind === "trip" ? opened.target.trip.id : opened.target.place.id : null;
  const present = Boolean(targetId) && [...timelines.values()].some((timeline) => timeline.items.some((item) => item.id === targetId));
  const current = opened && opened.owner === owner && present ? opened : null;
  if (opened && !current) setOpened(null);

  const review = current?.checkId && asking?.some((check) => check.id === current.checkId)
    ? reviewItems.find((item) => item.id === current.checkId && item.status === "open") : undefined;
  const question: CorrectionQuestion | null = review ? (() => {
    const words = checkQuestionWords(review, clock);
    return { text: words.question, yesLabel: words.yesLabel, noLabel: "Not now",
      onAnswer: (yes: boolean, categoryId?: string) => answerReview(review, outings.get(review.id), yes, categoryId, refresh) };
  })() : null;

  const dialog = current ? (
    <LocationCorrectionDialog activities={activities} clock={clock} key={`${current.owner}:${targetId}`} onClose={() => setOpened(null)}
      onCorrected={async () => { await refresh(); }} places={places} question={question} target={current.target} />
  ) : null;
  return { askingBySegment, dialog, open };
}

/** Saves a Grid answer at once: null when the server acknowledged it (or it was decided elsewhere), else why not. */
async function answerReview(review: ReviewItemRow, outing: ReturnType<typeof reviewOutings> extends Map<string, infer O> ? O | undefined : never,
  yes: boolean, categoryId: string | undefined, refresh: () => Promise<unknown>): Promise<string | null> {
  const kind = yes ? "log" : "skip";
  const draft = yes && categoryId !== undefined ? { categoryId } : undefined;
  const envelope: ReviewMutationEnvelope = {
    clientMutationId: crypto.randomUUID(),
    mutation: outing ? outingMutationFor(outing, kind, draft) : reviewMutationFor(review, kind, draft)
  };
  const response = await clientFetch(`/api/review/${review.id}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(envelope)
  }).catch(() => null);
  if (!response) return "Couldn't save that answer. Check your connection and try again.";
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  // Decided elsewhere (another device or tab): nothing left to ask.
  if (response.status === 404 || (response.status === 409 && body.code === "resolution_conflict") || (response.ok && body.alreadyResolved === true)) {
    await refresh().catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    return typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Couldn't save that answer. Try again.";
  }
  if (!validReviewAcknowledgement(body, envelope, review.id)) return "Couldn't confirm that answer was saved. Try again.";
  await refresh().catch(() => undefined);
  return null;
}
