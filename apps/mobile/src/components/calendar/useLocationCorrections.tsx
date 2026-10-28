import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  placeDisplayName,
  type ClockFormat,
  type LocationTimeline,
  type TimelineItemEvidenceDto,
  type TimelinePlace,
  type TimelineTrip
} from "@dayframe/shared";
import { createPlace, fetchTimelineItemEvidence, type MobileBootstrap } from "../../lib/api";
import type { MobileTheme } from "../../lib/mobileTheme";
import { canSayDidntLeave, canSayNotHere, type QueuedCorrection } from "../../lib/locationCorrectionDraft";
import { REVIEW_DECK_UNDO_MS } from "../../lib/reviewDeckHold";
import {
  enqueueTimelineCorrections,
  removeTimelineCorrections,
  synchroniseTimelineCorrections,
  type AcknowledgedTimelineCorrection,
  type PendingTimelineCorrection
} from "../../lib/timelineCorrectionOutbox";
import { LocationCorrectionSheet, type LocationCorrectionTarget } from "./LocationCorrectionSheet";

// Each sheet belongs to the account it opened for (Codex r1 on #602).
const appInFront = () => AppState.currentState === "active";

type Open = ({ kind: "place"; itemId: string; label: string } | { kind: "trip"; itemId: string; legIndex: number | null }) &
  { id: number; ownerKey: string };

/**
 * Calendar › List's correction sheets (location v4 step 12) for the Dashboard: which item's sheet is open
 * (by id, so it shows the List's projected timeline, a leg change included), queueing and sending what Done
 * set, and saying once why a refused correction came back (the row is already back as it was).
 */
export function useLocationCorrections({
  acknowledged = [],
  clockFormat,
  data,
  onLogged,
  pending,
  reduceMotion,
  showNotice,
  theme,
  timeline
}: {
  /** The corrections the server has had, this account's (useTimelineCorrectionQueue). */
  acknowledged?: readonly AcknowledgedTimelineCorrection[];
  clockFormat: ClockFormat;
  data: Pick<MobileBootstrap, "categories" | "places" | "user" | "workspace"> | null;
  /** A place logged with Logs as reached the server: the day's blocks are read again. */
  onLogged?: () => void;
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
    if (item?.kind === "place" && open.kind === "place") {
      return { kind: "place", place: item, label: open.label, notHere: canSayNotHere(item, timeline!.items) };
    }
    if (item?.kind === "trip" && open.kind === "trip") {
      const names = new Map(timeline!.items.flatMap((each) => each.kind === "place" ? [[each.id, each.name] as const] : []));
      return { kind: "trip", trip: { ...item, route: `${names.get(item.fromId) ?? "Unknown place"} → ${names.get(item.toId) ?? "Unknown place"}` },
        legIndex: open.legIndex, didntLeave: canSayDidntLeave(item, timeline!.items) };
    }
    return null;
  }, [open, timeline]);
  // The item can leave the List while its sheet closes (a trip that wasn't one): it closes as it was. One that
  // leaves while the sheet is open shows as it was, with nothing to change (Codex r1 on #602).
  if (open && target && (held?.id !== open.id || held.target !== target)) setHeld({ id: open.id, target });
  const last = open && held?.id === open.id ? held.target : null;
  const shown = target ?? last;
  const stale = Boolean(open && !target && last && closingId !== open.id);

  // Places saved here show as choices at once, until the account's places are read again (Codex r1 on #606).
  const [savedHere, setSavedHere] = useState<Array<{ ownerKey: string; id: string; name: string }>>([]);
  const places = useMemo(() => {
    const listed = (data?.places ?? []).map((place) => ({ id: place.id, name: placeDisplayName(place), role: place.role ?? null }));
    const known = new Set(listed.map((place) => place.id));
    return [...listed, ...savedHere.filter((place) => place.ownerKey === ownerKey && !known.has(place.id))
      .map((place) => ({ id: place.id, name: place.name, role: null }))];
  }, [data?.places, ownerKey, savedHere]);

  // Kept on the phone for the sheet's own account before its Done closes it, never once another account (or
  // none) is signed in, however late the Done; sending follows on its own.
  const currentOwner = useRef(ownerKey);
  useEffect(() => { currentOwner.current = ownerKey; }, [ownerKey]);
  const queue = useCallback(async (presentationId: number, sheetOwnerKey: string, corrections: QueuedCorrection[], closing: boolean) => {
    if (!userId || !workspaceId || sheetOwnerKey !== ownerKey || currentOwner.current !== sheetOwnerKey) throw new Error("The account changed.");
    const owner = { userId, workspaceId };
    await enqueueTimelineCorrections(owner, corrections.map((correction) => ({
      request: correction.request, ...(correction.preview ? { preview: correction.preview } : {})
    })));
    // Only a Done that closes the sheet lets its item leave the List unremarked (a leg's Done goes back to the trip).
    if (closing) setClosingId(presentationId);
    // Sent only while the app is in front: a Logs as queued behind these must never go from the background
    // (Codex r3 on #606).
    void synchroniseTimelineCorrections({ owner, force: true, isForeground: appInFront }).catch(() => undefined);
  }, [ownerKey, userId, workspaceId]);

  // "Save this place" (step 12 part 4, card D item 14): a saved place at the visit's centre, under the name the
  // person typed, then the visit set to it. Saving a place needs the server; the sheet says so if it fails.
  const shownCentre = shownEvidence && shownEvidence !== "unavailable" ? shownEvidence.map.centre : null;
  const shownRadius = shownEvidence && shownEvidence !== "unavailable" ? shownEvidence.map.stayRadiusMeters : null;
  // A place saved for a visit under a name is kept, so trying again after the visit's change wasn't kept never
  // saves it twice (Codex r1 on #606).
  const createdPlaces = useRef(new Map<string, string>());
  const savePlace = useCallback(async (presentationId: number, sheetOwnerKey: string, place: TimelinePlace, name: string,
    rest: QueuedCorrection[]) => {
    if (!userId || !workspaceId || !shownCentre || sheetOwnerKey !== ownerKey || currentOwner.current !== sheetOwnerKey) {
      throw new Error("The place can't be saved now.");
    }
    const key = `${sheetOwnerKey}|${place.id}|${name}`;
    let placeId = createdPlaces.current.get(key) ?? null;
    if (!placeId) {
      const [longitude, latitude] = shownCentre.coordinates;
      // Under the sheet's own account's session, or not at all (Codex r1 on #606).
      const created = await createPlace({ name, latitude, longitude, radiusMeters: Math.round(Math.min(250, Math.max(75, shownRadius ?? 100))) },
        undefined, { userId, workspaceId });
      placeId = (created as { place?: { id?: string } })?.place?.id ?? null;
      if (!placeId) throw new Error("The place wasn't saved.");
      createdPlaces.current.set(key, placeId);
      const saved = placeId;
      setSavedHere((current) => [...current, { ownerKey: sheetOwnerKey, id: saved, name }]);
    }
    if (currentOwner.current !== sheetOwnerKey) throw new Error("The account changed.");
    // The visit set to it, then the sheet's other changes (its times), in one Done.
    await queue(presentationId, sheetOwnerKey, [{
      request: { kind: "place", subject: "place", itemId: place.id, placeId, learnedPlaceId: null },
      preview: { name, role: null }
    }, ...rest], true);
  }, [ownerKey, queue, shownCentre, shownRadius, userId, workspaceId]);

  // "Logs as" (step 12 part 4c): held for Undo for the deck's 4.8 s, then queued as `log_place`; once the server
  // has it, the day's blocks are read again so the place shows them.
  const [heldLog, setHeldLog] = useState<{ token: number; ownerKey: string; title: string; request: QueuedCorrection["request"] } | null>(null);
  const logTokens = useRef(0);
  const sentLogs = useRef(new Set<string>());
  // Kept on the phone for the account it was picked for; sent only while the app is in front (the queue's own
  // recovery sends it otherwise). Read through refs, so a Dashboard render never restarts the hold (Codex r1 on #606).
  const commitLogRef = useRef<(log: NonNullable<typeof heldLog>, send: boolean) => void>(() => undefined);
  // A hold is consumed once, at once: a second ending (the timer, then leaving the app) never queues it again
  // (Codex r2 on #606).
  const heldNow = useRef<NonNullable<typeof heldLog> | null>(null);
  heldNow.current = heldLog;
  const consumed = useRef(new Set<number>());
  commitLogRef.current = (log, send) => {
    if (consumed.current.has(log.token)) return;
    consumed.current.add(log.token);
    if (!userId || !workspaceId || log.ownerKey !== currentOwner.current) return;
    const owner = { userId, workspaceId };
    void enqueueTimelineCorrections(owner, [{ request: log.request }]).then((items) => {
      for (const item of items) sentLogs.current.add(item.clientCorrectionId);
      // Sent only while the app is in front, then and at every step of the send (Codex r2 on #606).
      return send && appInFront() ? synchroniseTimelineCorrections({ owner, force: true, isForeground: appInFront }) : undefined;
    }).catch(() => showNotice("That place wasn't logged. Try again."));
  };
  useEffect(() => {
    if (!heldLog) return;
    // Another account (or none): the held log is dropped, never sent for it.
    if (heldLog.ownerKey !== ownerKey) {
      setHeldLog(null);
      return;
    }
    const finish = (send: boolean) => {
      setHeldLog((current) => current?.token === heldLog.token ? null : current);
      commitLogRef.current(heldLog, send);
    };
    // Made while the app is already away (a Done that finished in the background): kept now, never sent from
    // there (Codex r3 on #606).
    if (!appInFront()) {
      finish(false);
      return;
    }
    const timer = setTimeout(() => finish(true), REVIEW_DECK_UNDO_MS);
    // Leaving the app keeps the decision now, as the deck's hold does, and sends it on return (Codex r1 on #606).
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") finish(false);
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [heldLog, ownerKey]);
  // A second Logs as sends the one held now, as the deck's hold does.
  // A hold for an account no longer signed in (a sheet's Done that finished after a switch) is never held, and
  // never replaces this account's (Codex r2 on #606).
  const holdLog = (next: NonNullable<typeof heldLog>) => {
    if (next.ownerKey !== currentOwner.current) return;
    if (heldNow.current) commitLogRef.current(heldNow.current, true);
    setHeldLog(next);
  };
  const undoLog = useCallback(() => {
    if (heldNow.current) consumed.current.add(heldNow.current.token);
    setHeldLog(null);
  }, []);
  // A Logs as the server has acknowledged (never one refused): read the day's blocks again (Codex r1 on #606).
  const acknowledgedIds = acknowledged.map((item) => item.clientCorrectionId).join("|");
  useEffect(() => {
    const delivered = acknowledged.filter((item) => sentLogs.current.has(item.clientCorrectionId));
    if (!delivered.length) return;
    for (const item of delivered) sentLogs.current.delete(item.clientCorrectionId);
    onLogged?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acknowledgedIds]);
  const activities = useMemo(() => [...(data?.categories ?? [])]
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((category) => ({ id: category.id, name: category.name })), [data?.categories]);

  // A refusal (the item changed, or is in a block now): each said once, then dropped; the List already shows the
  // row as it was. Removal is tried again while it fails, without saying it again (Codex r1 on #602).
  // Several at once are said together (Codex r2 on #602).
  const announced = useRef(new Set<string>());
  const [removalRetry, setRemovalRetry] = useState(0);
  const removalAttempts = useRef({ key: "", count: 0 });
  const refusedKey = pending.filter((item) => item.failureKind === "permanent").map((item) => item.clientCorrectionId).join("|");
  useEffect(() => {
    if (!refusedKey) return;
    const refused = pending.filter((item) => item.failureKind === "permanent");
    const fresh = refused.filter((item) => !announced.current.has(item.clientCorrectionId));
    for (const item of fresh) announced.current.add(item.clientCorrectionId);
    if (fresh.length === 1) showNotice(fresh[0].lastError ?? "That change wasn't saved.");
    else if (fresh.length > 1) showNotice(`${fresh.length} changes weren't saved. ${fresh[0].lastError ?? ""}`.trim());
    if (removalAttempts.current.key !== refusedKey) removalAttempts.current = { key: refusedKey, count: 0 };
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current = true;
    removeTimelineCorrections(refused.map((item) => item.clientCorrectionId)).catch(() => {
      // Tried again a few times, a little later, without saying it again.
      if (!current) return;
      removalAttempts.current.count += 1;
      if (removalAttempts.current.count < 3) timer = setTimeout(() => setRemovalRetry((count) => count + 1), 2_000);
    });
    return () => {
      current = false;
      if (timer) clearTimeout(timer);
    };
    // Only a new refusal shows a notice; a failed removal runs again on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refusedKey, removalRetry]);

  const sheet = open && shown ? (
    <LocationCorrectionSheet
      key={`location-correction-${open.id}`}
      clockFormat={clockFormat}
      evidence={shownEvidence}
      onDismissed={(id) => setOpen((current) => current?.id === id ? null : current)}
      onQueue={(corrections, options) => queue(open.id, open.ownerKey, corrections, options.closing)}
      logAs={shown.kind === "place" && !shown.place.blockIds.length && shown.place.stoppedAt && activities.length && !stale ? {
        activities,
        onLog: (categoryId) => {
          logTokens.current += 1;
          const name = activities.find((activity) => activity.id === categoryId)?.name ?? "an activity";
          holdLog({ token: logTokens.current, ownerKey: open.ownerKey, title: `${shown.label} as ${name}`,
            request: { kind: "log_place", subject: "place", itemId: shown.place.id, categoryId } });
        }
      } : undefined}
      onSavePlace={shown.kind === "place" && shown.place.matchKind === "unknown" && !shown.place.blockIds.length && shownCentre
        ? (name, rest) => savePlace(open.id, open.ownerKey, shown.place, name, rest) : undefined}
      places={places}
      presentationId={open.id}
      reduceMotion={reduceMotion}
      rootHosted={false}
      stale={stale}
      target={shown}
      theme={theme}
    />
  ) : null;

  return { heldLog, openPlace, openTripLeg, sheet, undoLog };
}
