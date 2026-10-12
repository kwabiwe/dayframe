import type { MobileBootstrap } from "./api";
import { mobileAccountOwnersEqual, type MobileAccountOwner } from "./mobileAccount";
import { subscribeMobileSignedOut } from "./mobileSessionTransition";

/**
 * Today's last bootstrap, kept in memory so Settings' first open of an app session can draw the
 * account card, goals and activities at once instead of empty defaults (I1 follow-up). Settings
 * still refreshes itself after its opening transition; this is only the first frame's data.
 * Never persisted; dropped on sign-out; handed out only to the account it belongs to.
 */
let latest: MobileBootstrap | null = null;

export function publishTodayBootstrapForSettings(bootstrap: MobileBootstrap) {
  latest = bootstrap;
}

export function readTodayBootstrapForSettings(owner: MobileAccountOwner | null) {
  if (!latest || !owner) return null;
  return mobileAccountOwnersEqual(owner, { userId: latest.user.id, workspaceId: latest.workspace.id }) ? latest : null;
}

export function clearTodayBootstrapForSettings() {
  latest = null;
}

subscribeMobileSignedOut(clearTodayBootstrapForSettings);
