import type { MobileBootstrap } from "./api";
import { mobileAccountOwnersEqual, type MobileAccountOwner } from "./mobileAccount";
import { subscribeMobileSignedOut } from "./mobileSessionTransition";

/**
 * Today's last bootstrap, kept in memory so Settings' first open of an app session can show the
 * account card and goal numbers at once instead of empty defaults (I1 follow-up). Display only:
 * Settings never writes from it and refreshes itself after its opening transition. Never persisted;
 * dropped on sign-out; handed out only to the account it belongs to.
 */
let latest: MobileBootstrap | null = null;
// Advances on every sign-out: a read started before it can never publish after it.
let generation = 0;

/** Taken before Today starts reading a bootstrap; pass it back when publishing that bootstrap. */
export function captureSettingsSeedGeneration() {
  return generation;
}

export function publishTodayBootstrapForSettings(bootstrap: MobileBootstrap, capturedGeneration: number) {
  if (capturedGeneration !== generation) return;
  latest = bootstrap;
}

export function readTodayBootstrapForSettings(owner: MobileAccountOwner | null) {
  if (!latest || !owner) return null;
  return mobileAccountOwnersEqual(owner, { userId: latest.user.id, workspaceId: latest.workspace.id }) ? latest : null;
}

export function clearTodayBootstrapForSettings() {
  generation += 1;
  latest = null;
}

subscribeMobileSignedOut(clearTodayBootstrapForSettings);
