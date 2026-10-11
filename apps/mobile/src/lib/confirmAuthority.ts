import { mobileAccountOwnersEqual, readActiveMobileAccount, type MobileAccountOwner } from "./mobileAccount";
import {
  currentSessionGeneration,
  hasPersistedSessionToken,
  isAuthenticatedSessionSnapshotCurrent,
  readAuthenticatedSessionSnapshot,
  type AuthenticatedSessionSnapshot
} from "./secure-session";

/**
 * The account and session a destructive confirmation was asked for. Consent given for one
 * session never acts on another: a confirmation captures this when it opens and its action runs
 * only if the same account and the same session (token and generation) are still current once the
 * sheet has left. A sign-out, an account switch or a session refresh in between voids it.
 */
export type ConfirmAuthority = {
  owner: MobileAccountOwner | null;
  snapshot: AuthenticatedSessionSnapshot;
};

/** Null when no signed-in session can be pinned (signed out, or a change is in progress). */
export async function captureConfirmAuthority(): Promise<ConfirmAuthority | null> {
  const owner = await readActiveMobileAccount();
  const session = await readAuthenticatedSessionSnapshot();
  if (session.status !== "authenticated") return null;
  if (session.snapshot.owner && !mobileAccountOwnersEqual(session.snapshot.owner, owner)) return null;
  if (!mobileAccountOwnersEqual(owner, await readActiveMobileAccount())) return null;
  if (!isAuthenticatedSessionSnapshotCurrent(session.snapshot)) return null;
  return { owner, snapshot: session.snapshot };
}

export async function confirmAuthorityStillCurrent(authority: ConfirmAuthority | null) {
  if (!authority) return false;
  const owner = await readActiveMobileAccount();
  return mobileAccountOwnersEqual(owner, authority.owner) && isAuthenticatedSessionSnapshotCurrent(authority.snapshot);
}

/**
 * Wraps a confirmation so its action runs only while `authority` is still current when the sheet
 * has left; otherwise `onStale` runs instead and nothing is changed.
 */
export function bindConfirmToSession<T extends { onConfirm: () => void }>(
  request: T,
  authority: ConfirmAuthority,
  options: { onStale: () => void; stillCurrent?: (authority: ConfirmAuthority) => Promise<boolean> }
): T {
  const stillCurrent = options.stillCurrent ?? confirmAuthorityStillCurrent;
  return {
    ...request,
    onConfirm: () => {
      void stillCurrent(authority).then(
        (current) => {
          if (current) request.onConfirm();
          else options.onStale();
        },
        () => options.onStale()
      );
    }
  };
}

/**
 * Log out must always be reachable. When no live session can be pinned, this says what is left:
 * - "stored": this process is signed out but the Keychain still holds a sign-in (a logout whose
 *   Keychain deletion failed); bound to the session generation it saw.
 * - "orphaned": a loaded session whose account was already deactivated (the same failure, read
 *   back after a restart); bound to that exact session.
 * - "signed_out": nothing left to clean up (go to sign-in).
 * Null while a session change is in progress (the caller says so; the person can try again).
 */
export type LogoutRecovery =
  | { kind: "stored"; generation: number }
  | { kind: "orphaned"; snapshot: AuthenticatedSessionSnapshot }
  | { kind: "signed_out" };

export async function captureLogoutRecovery(): Promise<LogoutRecovery | null> {
  const generation = currentSessionGeneration();
  const session = await readAuthenticatedSessionSnapshot();
  if (session.status === "changed") return null;
  if (session.status === "authenticated") {
    // A session with a live account is the normal Log out path, not a recovery.
    if (await readActiveMobileAccount()) return null;
    return isAuthenticatedSessionSnapshotCurrent(session.snapshot) ? { kind: "orphaned", snapshot: session.snapshot } : null;
  }
  // If the Keychain can't be read, offer the cleanup anyway: logout() is fenced to this state.
  const stored = await hasPersistedSessionToken().catch(() => true);
  if (generation !== currentSessionGeneration()) return null;
  return stored ? { kind: "stored", generation } : { kind: "signed_out" };
}

/** False once anyone has signed in (or the session otherwise changed) since the recovery was offered. */
export async function logoutRecoveryStillCurrent(recovery: LogoutRecovery) {
  if (recovery.kind === "signed_out") return false;
  if (recovery.kind === "orphaned") {
    if (!isAuthenticatedSessionSnapshotCurrent(recovery.snapshot)) return false;
    const owner = await readActiveMobileAccount();
    return owner === null && isAuthenticatedSessionSnapshotCurrent(recovery.snapshot);
  }
  if (recovery.generation !== currentSessionGeneration()) return false;
  const session = await readAuthenticatedSessionSnapshot();
  return session.status === "signed_out" && recovery.generation === currentSessionGeneration();
}
