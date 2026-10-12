import type { MobileBootstrap } from "./api";
import { mobileAccountOwnersEqual, type MobileAccountOwner } from "./mobileAccount";
import { subscribeMobileSignedOut } from "./mobileSessionTransition";
import { currentSessionGeneration } from "./secure-session";

/**
 * Today's last bootstrap, kept in memory so Settings' first open of an app session can show the
 * account card and goal numbers at once instead of empty defaults (I1 follow-up). Display only:
 * Settings never writes from it and refreshes itself after its opening transition. Never persisted.
 * Bound to the authenticated session it was read in (`currentSessionGeneration`, bumped by every
 * sign-in, sign-out and invalidation) and to its account: a read from an earlier session is never
 * published, and a seed from an earlier session or another account is never handed out.
 */
let latest: { bootstrap: MobileBootstrap; sessionGeneration: number } | null = null;

/** Taken before Today starts reading a bootstrap; pass it back when publishing that bootstrap. */
export function captureSettingsSeedGeneration() {
  return currentSessionGeneration();
}

export function publishTodayBootstrapForSettings(bootstrap: MobileBootstrap, capturedGeneration: number) {
  if (capturedGeneration !== currentSessionGeneration()) return;
  latest = { bootstrap, sessionGeneration: capturedGeneration };
}

export function readTodayBootstrapForSettings(owner: MobileAccountOwner | null) {
  if (!latest || !owner || latest.sessionGeneration !== currentSessionGeneration()) return null;
  const { bootstrap } = latest;
  return mobileAccountOwnersEqual(owner, { userId: bootstrap.user.id, workspaceId: bootstrap.workspace.id }) ? bootstrap : null;
}

export function clearTodayBootstrapForSettings() {
  latest = null;
}

subscribeMobileSignedOut(clearTodayBootstrapForSettings);
