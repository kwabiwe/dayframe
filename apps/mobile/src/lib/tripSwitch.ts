import type { MobileBootstrap } from "./api";

/** A "Log trips automatically" value the server stored, with the revision it stored it at. */
export type SavedTripSwitch = { userId: string; value: boolean; revision: number };

/**
 * The value Settings shows (PRD D19, A4): the saved one while the shown copy of the account is older
 * than the save (a bootstrap read before it, published late, or recovered from cache), else the
 * copy's own value. Undefined when the server sends none (an older server).
 */
export function shownTripSwitch(user: MobileBootstrap["user"] | null | undefined, saved: SavedTripSwitch | null) {
  if (user && saved && user.id === saved.userId && (user.goalsRevision ?? 0) < saved.revision) return saved.value;
  return user?.logTripsAutomatically;
}

/** The copy with the saved value, only for its account and only over an older copy. */
export function withSavedTripSwitch(data: MobileBootstrap | null, saved: SavedTripSwitch) {
  return data && data.user.id === saved.userId && (data.user.goalsRevision ?? 0) < saved.revision
    ? { ...data, user: { ...data.user, logTripsAutomatically: saved.value, goalsRevision: saved.revision } }
    : data;
}

// The last value this iPhone saved, kept beyond the Settings screen so a stale copy published while
// it was closed never wins when it reopens (Codex r2 on #464). One per process; per account by userId.
let rememberedSave: SavedTripSwitch | null = null;

export function rememberSavedTripSwitch(saved: SavedTripSwitch) {
  if (!rememberedSave || rememberedSave.userId !== saved.userId || rememberedSave.revision <= saved.revision) rememberedSave = saved;
}

export function rememberedSavedTripSwitch() {
  return rememberedSave;
}

export function __resetSavedTripSwitchForTests() {
  rememberedSave = null;
}
