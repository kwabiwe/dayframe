import { mobileAccountOwnersEqual, readActiveMobileAccount, type MobileAccountOwner } from "./mobileAccount";
import {
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
