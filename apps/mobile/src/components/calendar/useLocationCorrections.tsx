import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  placeDisplayName,
  type ClockFormat,
  type LocationTimeline,
  type TimelineItemEvidenceDto,
  type TimelinePlace,
  type TimelineTrip
} from "@dayframe/shared";
import { fetchTimelineItemEvidence, type MobileBootstrap } from "../../lib/api";
import type { MobileTheme } from "../../lib/mobileTheme";
import type { QueuedCorrection } from "../../lib/locationCorrectionDraft";
import {
  enqueueTimelineCorrection,
  removeTimelineCorrections,
  synchroniseTimelineCorrections,
  type PendingTimelineCorrection
} from "../../lib/timelineCorrectionOutbox";
import { LocationCorrectionSheet, type LocationCorrectionTarget } from "./LocationCorrectionSheet";

type Open = { id: number; kind: "place"; itemId: string; label: string } | { id: number; kind: "trip"; itemId: string; legIndex: number | null };

/**
 * Calendar › List's correction sheets (location v4 step 12) for the Dashboard: which item's sheet is open
 * (by id, so it shows the List's projected timeline, a leg change included), queueing and sending what Done
 * set, and saying once why a refused correction came back (the row is already back as it was).
 */
export function useLocationCorrections({
  clockFormat,
  data,
  pending,
  reduceMotion,
  showNotice,
  theme,
  timeline
}: {
  clockFormat: ClockFormat;
  data: Pick<MobileBootstrap, "places" | "user" | "workspace"> | null;
  /** The queue as the List shows it (useTimelineCorrectionQueue). */
  pending: readonly PendingTimelineCorrection[];
  reduceMotion: boolean;
  showNotice: (message: string) => void;
  theme: MobileTheme;
  /** The List's timeline, with the queued corrections shown. */
  timeline: LocationTimeline | null;
}) {
  const [open, setOpen] = useState<Open | null>(null);
  const presentations = useRef(0);
  const [held, setHeld] = useState<LocationCorrectionTarget | null>(null);
  const userId = data?.user.id ?? null;
  const workspaceId = data?.workspace.id ?? null;
  // The open item's map (owner feedback, 27 Oct 2026: the map comes first on every sheet).
  const [evidence, setEvidence] = useState<{ itemId: string; evidence: TimelineItemEvidenceDto | null } | null>(null);
  const openItemId = open?.itemId ?? null;
  useEffect(() => {
    if (!openItemId || !userId || !workspaceId) return;
    const controller = new AbortController();
    fetchTimelineItemEvidence(openItemId, { owner: { userId, workspaceId }, signal: controller.signal }).then(
      (result) => { if (!controller.signal.aborted) setEvidence({ itemId: openItemId, evidence: result }); },
      () => { if (!controller.signal.aborted) setEvidence({ itemId: openItemId, evidence: null }); }
    );
    return () => controller.abort();
  }, [openItemId, userId, workspaceId]);
  const shownEvidence = evidence && evidence.itemId === openItemId ? evidence.evidence ?? "unavailable" as const : null;

  const openPlace = useCallback((place: TimelinePlace, label: string) => {
    presentations.current += 1;
    setOpen({ id: presentations.current, kind: "place", itemId: place.id, label });
  }, []);
  const openTripLeg = useCallback((trip: TimelineTrip, legIndex: number | null) => {
    presentations.current += 1;
    setOpen({ id: presentations.current, kind: "trip", itemId: trip.id, legIndex });
  }, []);

  const target = useMemo<LocationCorrectionTarget | null>(() => {
    if (!open) return null;
    const item = timeline?.items.find((each) => each.id === open.itemId && each.kind === open.kind);
    if (item?.kind === "place" && open.kind === "place") return { kind: "place", place: item, label: open.label };
    if (item?.kind === "trip" && open.kind === "trip") {
      const names = new Map(timeline!.items.flatMap((each) => each.kind === "place" ? [[each.id, each.name] as const] : []));
      return { kind: "trip", trip: { ...item, route: `${names.get(item.fromId) ?? "Unknown place"} → ${names.get(item.toId) ?? "Unknown place"}` }, legIndex: open.legIndex };
    }
    return null;
  }, [open, timeline]);
  // The item can leave the List while its sheet closes (a trip that wasn't one): it closes as it was.
  if (target && target !== held) setHeld(target);
  const shown = target ?? (open ? held : null);

  const places = useMemo(
    () => (data?.places ?? []).map((place) => ({ id: place.id, name: placeDisplayName(place), role: place.role ?? null })),
    [data?.places]
  );

  const queue = useCallback((corrections: QueuedCorrection[]) => {
    if (!userId || !workspaceId) return;
    const owner = { userId, workspaceId };
    void (async () => {
      for (const correction of corrections) {
        await enqueueTimelineCorrection(owner, correction.request, correction.preview ? { preview: correction.preview } : {});
      }
      await synchroniseTimelineCorrections({ owner, force: true });
    })().catch(() => undefined);
  }, [userId, workspaceId]);

  // A refusal (the item changed, or is in a block now): said once, then dropped; the List already shows the row as it was.
  const refusedKey = pending.filter((item) => item.failureKind === "permanent").map((item) => item.clientCorrectionId).join("|");
  useEffect(() => {
    if (!refusedKey) return;
    const refused = pending.filter((item) => item.failureKind === "permanent");
    showNotice(refused[0]?.lastError ?? "That change wasn't saved.");
    void removeTimelineCorrections(refused.map((item) => item.clientCorrectionId));
    // Only a new refusal shows a notice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refusedKey]);

  const sheet = open && shown ? (
    <LocationCorrectionSheet
      key={`location-correction-${open.id}`}
      clockFormat={clockFormat}
      evidence={shownEvidence}
      onDismissed={(id) => setOpen((current) => current?.id === id ? null : current)}
      onQueue={queue}
      places={places}
      presentationId={open.id}
      reduceMotion={reduceMotion}
      rootHosted={false}
      target={shown}
      theme={theme}
    />
  ) : null;

  return { openPlace, openTripLeg, sheet };
}
