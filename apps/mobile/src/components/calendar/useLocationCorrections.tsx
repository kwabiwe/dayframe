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
  enqueueTimelineCorrections,
  removeTimelineCorrections,
  synchroniseTimelineCorrections,
  type PendingTimelineCorrection
} from "../../lib/timelineCorrectionOutbox";
import { LocationCorrectionSheet, type LocationCorrectionTarget } from "./LocationCorrectionSheet";

// Each sheet belongs to the account it opened for (Codex r1 on #602).
type Open = ({ kind: "place"; itemId: string; label: string } | { kind: "trip"; itemId: string; legIndex: number | null }) &
  { id: number; ownerKey: string };

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
  const [opened, setOpen] = useState<Open | null>(null);
  const presentations = useRef(0);
  const userId = data?.user.id ?? null;
  const workspaceId = data?.workspace.id ?? null;
  const ownerKey = userId && workspaceId ? `${workspaceId}:${userId}` : null;
  // Another account (or none) closes the sheet at once: its item, map and draft are never shown to it.
  const open = opened && opened.ownerKey === ownerKey ? opened : null;
  if (opened && !open) setOpen(null);
  // The last target shown, by presentation: the sheet closes as it was when its item leaves the List.
  const [held, setHeld] = useState<{ id: number; target: LocationCorrectionTarget } | null>(null);
  // The presentation whose Done kept corrections: its item may leave the List as the sheet closes.
  const [closingId, setClosingId] = useState<number | null>(null);
  // The open item's map (owner feedback, 27 Oct 2026: the map comes first on every sheet).
  const [evidence, setEvidence] = useState<{ itemId: string; evidence: TimelineItemEvidenceDto | null } | null>(null);
  const openItemId = open?.itemId ?? null;
  const openKind = open?.kind ?? null;
  // The item's start as the timeline gave it when the sheet opened (its sheet's map stays with that item).
  const [openedStart, setOpenedStart] = useState<{ id: number; startedAt: string } | null>(null);
  if (open && openedStart?.id !== open.id) {
    const item = timeline?.items.find((each) => each.id === open.itemId && each.kind === open.kind);
    if (item) setOpenedStart({ id: open.id, startedAt: item.startedAt });
  }
  const openStartedAt = open && openedStart?.id === open.id ? openedStart.startedAt : null;
  useEffect(() => {
    if (!openItemId || !openKind || !openStartedAt || !userId || !workspaceId) return;
    const controller = new AbortController();
    fetchTimelineItemEvidence({ id: openItemId, kind: openKind, startedAt: openStartedAt },
      { owner: { userId, workspaceId }, signal: controller.signal }).then(
      (result) => { if (!controller.signal.aborted) setEvidence({ itemId: openItemId, evidence: result }); },
      () => { if (!controller.signal.aborted) setEvidence({ itemId: openItemId, evidence: null }); }
    );
    return () => controller.abort();
  }, [openItemId, openKind, openStartedAt, userId, workspaceId]);
  const shownEvidence = evidence && evidence.itemId === openItemId && open ? evidence.evidence ?? "unavailable" as const : null;

  const openPlace = useCallback((place: TimelinePlace, label: string) => {
    if (!ownerKey) return;
    presentations.current += 1;
    setEvidence(null);
    setOpen({ id: presentations.current, ownerKey, kind: "place", itemId: place.id, label });
  }, [ownerKey]);
  const openTripLeg = useCallback((trip: TimelineTrip, legIndex: number | null) => {
    if (!ownerKey) return;
    presentations.current += 1;
    setEvidence(null);
    setOpen({ id: presentations.current, ownerKey, kind: "trip", itemId: trip.id, legIndex });
  }, [ownerKey]);

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
  // The item can leave the List while its sheet closes (a trip that wasn't one): it closes as it was. One that
  // leaves while the sheet is open shows as it was, with nothing to change (Codex r1 on #602).
  if (open && target && (held?.id !== open.id || held.target !== target)) setHeld({ id: open.id, target });
  const last = open && held?.id === open.id ? held.target : null;
  const shown = target ?? last;
  const stale = Boolean(open && !target && last && closingId !== open.id);

  const places = useMemo(
    () => (data?.places ?? []).map((place) => ({ id: place.id, name: placeDisplayName(place), role: place.role ?? null })),
    [data?.places]
  );

  // Kept on the phone for the sheet's own account before its Done closes it; sending follows on its own.
  const queue = useCallback(async (presentationId: number, sheetOwnerKey: string, corrections: QueuedCorrection[]) => {
    if (!userId || !workspaceId || sheetOwnerKey !== ownerKey) throw new Error("The account changed.");
    const owner = { userId, workspaceId };
    await enqueueTimelineCorrections(owner, corrections.map((correction) => ({
      request: correction.request, ...(correction.preview ? { preview: correction.preview } : {})
    })));
    setClosingId(presentationId);
    void synchroniseTimelineCorrections({ owner, force: true }).catch(() => undefined);
  }, [ownerKey, userId, workspaceId]);

  // A refusal (the item changed, or is in a block now): each said once, then dropped; the List already shows the
  // row as it was. Removal is tried again while it fails, without saying it again (Codex r1 on #602).
  const announced = useRef(new Set<string>());
  const refusedKey = pending.filter((item) => item.failureKind === "permanent").map((item) => item.clientCorrectionId).join("|");
  useEffect(() => {
    if (!refusedKey) return;
    const refused = pending.filter((item) => item.failureKind === "permanent");
    const fresh = refused.filter((item) => !announced.current.has(item.clientCorrectionId));
    for (const item of fresh) announced.current.add(item.clientCorrectionId);
    if (fresh.length) showNotice(fresh[0].lastError ?? "That change wasn't saved.");
    void removeTimelineCorrections(refused.map((item) => item.clientCorrectionId)).catch(() => undefined);
    // Only a new refusal shows a notice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refusedKey]);

  const sheet = open && shown ? (
    <LocationCorrectionSheet
      key={`location-correction-${open.id}`}
      clockFormat={clockFormat}
      evidence={shownEvidence}
      onDismissed={(id) => setOpen((current) => current?.id === id ? null : current)}
      onQueue={(corrections) => queue(open.id, open.ownerKey, corrections)}
      places={places}
      presentationId={open.id}
      reduceMotion={reduceMotion}
      rootHosted={false}
      stale={stale}
      target={shown}
      theme={theme}
    />
  ) : null;

  return { openPlace, openTripLeg, sheet };
}
