import { distanceMeters, placeDisplayName, placeRoleLabel, placeSecondaryName, type PlaceRole } from "@dayframe/shared";
import { formatLocaleDate } from "./localeDateFormat";

type PagePlace = {
  name: string;
  role?: PlaceRole | null;
  radiusMeters: number;
  loggingEnabled?: boolean;
  defaultCategoryId?: string | null;
  defaultCategoryName?: string | null;
  defaultActivityDescription?: string | null;
};

/**
 * Blocks parity step 7a: the plain line under a saved place on the Places page. The saved name
 * first when a role (Home, Work) is the title, then what a visit logs, then the radius.
 */
export function placeRowSubtitle(place: PagePlace, categories: readonly { id: string; name: string }[]) {
  const secondary = placeSecondaryName({ name: place.name, role: place.role ?? null });
  const radius = `${place.radiusMeters} m`;
  let visits: string;
  if (place.loggingEnabled === false) {
    visits = "Visits not suggested";
  } else {
    const activity = place.defaultCategoryName
      ?? categories.find((category) => category.id === place.defaultCategoryId)?.name
      ?? null;
    const description = place.defaultActivityDescription?.trim() || null;
    visits = activity
      ? `Logs ${description ? `“${description}” as ` : "as "}${activity}`
      : description ? `Logs “${description}”` : "No default activity";
  }
  return [secondary, `${visits} · ${radius}`].filter(Boolean).join("\n");
}

/** "4 visits on 3 days · last seen 6 Oct", the plain line under a suggested place. */
export function learnedPlaceSubtitle(input: { visitCount: number; distinctDayCount: number; lastSeenAt: string }) {
  const visits = input.visitCount === 1 ? "1 visit" : `${input.visitCount} visits`;
  const days = input.distinctDayCount === 1 ? "1 day" : `${input.distinctDayCount} days`;
  const lastSeen = new Date(input.lastSeenAt);
  const seen = Number.isNaN(lastSeen.getTime())
    ? "recently"
    : formatLocaleDate(lastSeen, { day: "numeric", month: "short" });
  return `${visits} on ${days} · last seen ${seen}`;
}

type RolePlace = { id: string; name: string; role?: PlaceRole | null; latitude?: number | null; longitude?: number | null };

type MaybeCoordinate = { latitude?: number | null; longitude?: number | null } | null | undefined;

/** "Replace the old place" (PRD D19 A10): the server archives the old holder only this close. */
export const REPLACE_PREVIOUS_PLACE_METERS = 300;

/**
 * Whether to offer "Replace the old place" when Home or Work moves from `holder` to `chosen`: only
 * when both have coordinates and are within 300 m, where their two circles would overlap (as the
 * web's PlaceEditor and PlaceRoleSlots decide). The server checks the distance again.
 */
export function replacePreviousOffered(holder: MaybeCoordinate, chosen: MaybeCoordinate) {
  if (!holder || !chosen) return false;
  const { latitude: holderLatitude, longitude: holderLongitude } = holder;
  const { latitude: chosenLatitude, longitude: chosenLongitude } = chosen;
  if (!isCoordinate(holderLatitude) || !isCoordinate(holderLongitude) || !isCoordinate(chosenLatitude) || !isCoordinate(chosenLongitude)) {
    return false;
  }
  return distanceMeters(
    { latitude: holderLatitude, longitude: holderLongitude },
    { latitude: chosenLatitude, longitude: chosenLongitude }
  ) <= REPLACE_PREVIOUS_PLACE_METERS;
}

/** The line under the "Replace the old place" switch: why it is offered, and that it can be undone. */
export function replacePreviousNote(role: PlaceRole) {
  return `Your old ${placeRoleLabel(role)} is close by; archive it so the two don't overlap. You can restore it from Places.`;
}

function isCoordinate(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * An accepted Home/Work change applied to the page at once (PUT /api/places/role), mirroring the
 * server (`assignPlaceRoleWith`), so a refresh that fails afterwards never shows the old holder:
 * the target takes the role (leaving any other role it held); the place holding the role loses it
 * and takes the requested name; with no holder, every role-less place named like the role
 * ("Home", "HOME") is an implicit holder and is renamed when a name was given. With
 * `archivePrevious` (the server said it archived the old holder) every previous holder within
 * 300 m of the target leaves the list, as archived places leave bootstrap.
 */
export function applyPlaceRoleLocally<T extends RolePlace>(
  places: readonly T[],
  request: { role: PlaceRole; placeId: string | null; previousPlaceName: string | null; archivePrevious?: boolean }
): T[] {
  const holder = places.find((place) => place.role === request.role && place.id !== request.placeId) ?? null;
  const holderIsTarget = places.some((place) => place.role === request.role && place.id === request.placeId);
  const label = placeRoleLabel(request.role).toLowerCase();
  const implicit = holder || holderIsTarget
    ? []
    : places.filter((place) => !place.role && place.id !== request.placeId && place.name.trim().toLowerCase() === label);
  const previous = new Set((holder ? [holder] : request.previousPlaceName || request.archivePrevious ? implicit : []).map((place) => place.id));
  const target = request.placeId ? places.find((place) => place.id === request.placeId) ?? null : null;
  const archived = new Set(request.archivePrevious && target
    ? places.filter((place) => previous.has(place.id) && replacePreviousOffered(place, target)).map((place) => place.id)
    : []);
  return places.flatMap((place) => {
    if (place.id === request.placeId) return [{ ...place, role: request.role }];
    if (archived.has(place.id)) return [];
    if (previous.has(place.id)) return [{ ...place, role: null, name: request.previousPlaceName ?? place.name }];
    return [place];
  });
}

/** Places › Archived (PRD D19 A10): one row per archived place, newest first as the server sends them. */
export function archivedPlaceRows(places: readonly { id: string; name: string }[]) {
  return places.map((place) => ({
    id: place.id,
    name: place.name,
    subtitle: "History kept",
    accessibilityLabel: `${place.name}, archived, history kept`,
    restoreLabel: `Restore ${place.name}`
  }));
}

/** A page read's place in line: when it started, how many changes had been accepted by then, and in which lifetime. */
export type PageReadTicket = { sequence: number; changes: number; lifetime: string };

/**
 * The one gate every Places list goes through before it is applied, settles restores or refreshes
 * monitoring (Codex r5/r6 on #508, after rounds 2–6 were all read-ordering races). Every page read
 * (opening, focus, pull-to-refresh, Try again, the restore retry, and the refresh after a change or
 * a restore) takes a ticket when it starts. Every accepted change (an archive, a delete, a restore,
 * Home/Work, a learned place) calls `changed`, so a read that started before it never applies: the
 * next list to apply always comes from after every change accepted so far. A list may be applied
 * only when:
 * - it belongs to the same account lifetime (else "foreign": nothing is applied or said);
 * - no change was accepted after it started, and no read that started after it has already been
 *   applied (else "stale": overtaken; nothing is applied or monitored).
 * Applying records the ticket, so an older answer arriving later can never undo a newer one.
 */
export function createPageReadGate() {
  let issued = 0;
  let lastApplied = 0;
  let changes = 0;
  return {
    begin(lifetime: string): PageReadTicket {
      issued += 1;
      return { sequence: issued, changes, lifetime };
    },
    /** A change was accepted: every read already out, and every list already applied, is out of date. */
    changed() {
      changes += 1;
    },
    judge(ticket: PageReadTicket, lifetime: string): "apply" | "stale" | "foreign" {
      if (ticket.lifetime !== lifetime) return "foreign";
      return ticket.changes !== changes || ticket.sequence <= lastApplied ? "stale" : "apply";
    },
    /** Call in the same synchronous step as applying the list. */
    applied(ticket: PageReadTicket) {
      lastApplied = Math.max(lastApplied, ticket.sequence);
    },
    /** A change or a newer list has landed since `ticket` started. */
    superseded(ticket: PageReadTicket) {
      return ticket.changes !== changes || ticket.sequence <= lastApplied;
    },
    /**
     * `ticket`'s list is what the page shows: the newest applied, with no change accepted since
     * (Codex r6 on #508). Only then may its follow-ups (settling restores, the learned-place
     * backfill) still write.
     */
    isCurrent(ticket: PageReadTicket) {
      return lastApplied === ticket.sequence && ticket.changes === changes;
    },
    /** No read started after `ticket` (only the newest read reports its failure). */
    isNewest(ticket: PageReadTicket) {
      return issued === ticket.sequence;
    }
  };
}

/**
 * Places' geofence monitoring, one refresh at a time and latest wins (Codex r6/r7 on #508): a request
 * while one runs replaces whatever was waiting, so the last input is always the newest requested.
 * Just before an input runs, `runnable` is asked again; false drops it unrun (its account lifetime
 * ended, or the page closed), and `clear` drops whatever waits. `finished` hears every refresh that
 * ran, so retries that keep queueing newer inputs never starve settlement; it decides from the
 * page's current state, not from the input's. `request` resolves once that input has run, or was
 * replaced or dropped. `engaged`: the page has asked at least once, so every list it shows from then
 * on is monitored.
 */
export function createMonitorQueue<T>(options: {
  refresh: (input: T) => Promise<unknown>;
  runnable: (input: T) => boolean;
  finished: (input: T, refreshed: boolean) => void;
}) {
  type Job = { input: T; done: () => void };
  let waiting: Job | null = null;
  let active = false;
  let engaged = false;
  async function drain() {
    try {
      while (waiting) {
        const job: Job = waiting;
        waiting = null;
        try {
          if (!options.runnable(job.input)) continue;
          const refreshed = await Promise.resolve().then(() => options.refresh(job.input)).then(() => true, () => false);
          options.finished(job.input, refreshed);
        } finally {
          job.done();
        }
      }
    } finally {
      // In the same step as the last check for a waiting input, so a request never goes unrun.
      active = false;
    }
  }
  return {
    request(input: T) {
      engaged = true;
      waiting?.done();
      let done!: () => void;
      const ran = new Promise<void>((resolve) => { done = resolve; });
      waiting = { input, done };
      if (!active) {
        active = true;
        void drain();
      }
      return ran;
    },
    clear() {
      waiting?.done();
      waiting = null;
    },
    engaged() {
      return engaged;
    }
  };
}

/**
 * How the refresh after an accepted restore ended: its list applied; overtaken ("stale": a newer
 * change or list landed, or it failed after a newer read started, which brings the list instead);
 * or failed as the newest read.
 */
export type RestoreRefreshOutcome = "applied" | "stale" | "failed";

/**
 * Places › Archived › Restore runs one request at a time (Codex r1 on #508). `take` is synchronous,
 * so two taps in one frame can't both pass; only the request holding the gate releases it, so an
 * older answer never unlocks Restore while a newer request is still out. Another account takes it
 * over at once: a request still out for the previous account only ever releases its own token.
 */
export function createPlaceRestoreGate() {
  let issued = 0;
  let held: { token: number; accountKey: string } | null = null;
  return {
    take(accountKey: string) {
      if (held && held.accountKey === accountKey) return null;
      issued += 1;
      held = { token: issued, accountKey };
      return issued;
    },
    release(token: number) {
      if (held?.token !== token) return false;
      held = null;
      return true;
    }
  };
}

/** Said (and announced) when a restore was accepted but Places couldn't refresh after it. */
export function restoredNotRefreshedMessage(name: string) {
  return `${name} is restored, but Places couldn't refresh. Pull to refresh to finish; visits there are noticed again once it shows.`;
}

/**
 * Said (and announced) when a restore's list arrived but monitoring from it failed: the place is
 * back, but its visits aren't noticed until a retry succeeds (Codex r4 on #508).
 */
export function restoredNotMonitoredMessage(name: string) {
  return `${name} is restored, but visits there aren't noticed yet. Dayframe will keep trying.`;
}

/** Announced once a restore that was announced with a warning is monitored after all. */
export function restoredMonitoredMessage(name: string) {
  return `${name} restored. Visits there are noticed again.`;
}

/**
 * Restored places still waiting for a refreshed list, as rows under Saved places (never in neither
 * list): only those the shown list doesn't already have.
 */
export function pendingRestoredRows(pending: readonly { id: string; name: string }[], shown: readonly { id: string }[]) {
  const shownIds = new Set(shown.map((place) => place.id));
  return pending.filter((place) => !shownIds.has(place.id)).map((place) => ({
    id: place.id,
    name: place.name,
    subtitle: "Restored · pull to refresh to finish",
    accessibilityLabel: `${place.name}, restored, pull to refresh to finish`
  }));
}

/** The place editor's Archive confirmation: what archiving keeps, and where it can be restored. */
export function archivePlaceConfirmCopy(place: { name: string; role?: PlaceRole | null }) {
  const role = place.role ? placeRoleLabel(place.role) : null;
  return {
    eyebrow: "Place",
    title: `Archive ${placeDisplayName({ name: place.name, role: place.role ?? null })}?`,
    message: `Past blocks keep its name, and it stops matching new visits${role ? ` and stops being your ${role}` : ""}. You can restore it from Places › Archived.`,
    confirmLabel: "Archive"
  };
}

// Places the editor deleted, per account, for the Places page to drop when it is shown again
// (even if its own refresh then fails). Taken once.
const deletedPlaceIds = new Map<string, Set<string>>();

const deletedPlaceListeners = new Set<(accountKey: string) => void>();

export function notePlaceDeleted(accountKey: string, placeId: string) {
  const ids = deletedPlaceIds.get(accountKey) ?? new Set<string>();
  ids.add(placeId);
  deletedPlaceIds.set(accountKey, ids);
  // A Places page already showing (the person went back before the delete finished) hears it now.
  for (const listener of [...deletedPlaceListeners]) listener(accountKey);
}

/** Calls `listener` whenever a delete is noted; returns the unsubscribe. */
export function subscribeDeletedPlaces(listener: (accountKey: string) => void) {
  deletedPlaceListeners.add(listener);
  return () => {
    deletedPlaceListeners.delete(listener);
  };
}

export function takeDeletedPlaces(accountKey: string) {
  const ids = deletedPlaceIds.get(accountKey);
  deletedPlaceIds.delete(accountKey);
  return ids ? [...ids] : [];
}

export type PlacesPageState = "ready" | "pending" | "failed";

/**
 * What the Places page draws (staging feedback B2, Codex r1): the Home/Work and place groups only
 * from a list that was actually read, so "Not set", "Nothing saved yet" and Set-goes-straight-to-
 * adding never appear for places not yet known. Before the first read settles it is a quiet
 * pending line (no spinner); a failed first read is the Blocks unavailable state.
 */
export function placesPageState(hasData: boolean, loadFailed: boolean): PlacesPageState {
  if (hasData) return "ready";
  return loadFailed ? "failed" : "pending";
}
