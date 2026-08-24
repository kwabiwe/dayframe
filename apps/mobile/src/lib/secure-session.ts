import * as SecureStore from "expo-secure-store";
import { NativeModules, Platform } from "react-native";
import { DAYFRAME_API_BASE } from "./config";
import { publishMobileSignedOut } from "./mobileSessionTransition";
import {
  mobileAccountOwnersEqual,
  type MobileAccountOwner
} from "./mobileAccount";

const LEGACY_SESSION_TOKEN_KEY = "dayframe.localSessionToken.v1";
const SESSION_TOKEN_KEY = "dayframe.localSessionToken.v2";
const RETRY_DELAYS_MS = [75, 200] as const;

const SESSION_TOKEN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
};

// SecureStore can briefly reject reads while iOS is moving between a locked
// background task and the foreground app. Once the foreground has read the
// session successfully, keep that process-local copy available to background
// reconciliation instead of asking Keychain for the same value again.
type StoredMobileSession = {
  owner: MobileAccountOwner | null;
  token: string;
};

let cachedSession: StoredMobileSession | null | undefined;
let sessionRevision = 0;
let sessionOperations: Promise<void> = Promise.resolve();
const sessionListeners = new Set<() => void>();

export type AuthenticatedSessionSnapshot = {
  generation: number;
  owner: MobileAccountOwner | null;
  token: string;
};

export type SessionSnapshotRead =
  | { status: "authenticated"; snapshot: AuthenticatedSessionSnapshot }
  | { status: "signed_out" }
  | { status: "changed" };

export type OwnedSessionSnapshotRead =
  | { status: "authenticated"; snapshot: AuthenticatedSessionSnapshot }
  | { status: "signed_out" }
  | { status: "changed" }
  | { status: "owner_mismatch" };

export function resetSessionTokenCacheForTesting() {
  cachedSession = undefined;
  sessionRevision += 1;
  sessionOperations = Promise.resolve();
  sessionListeners.clear();
}

export function subscribeAuthenticatedSession(listener: () => void) {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

type DayframeLiveActivityNativeModule = {
  setRuntimeContext?: (apiBase: string, sessionToken: string) => Promise<boolean>;
  clearRuntimeContext?: () => Promise<boolean>;
  clearRuntimeContextIfToken?: (sessionToken: string) => Promise<boolean>;
};

function liveActivityNativeModule() {
  if (Platform.OS !== "ios") return null;
  return NativeModules.DayframeLiveActivityModule as DayframeLiveActivityNativeModule | undefined;
}

async function mirrorRuntimeContext(token: string) {
  try {
    await liveActivityNativeModule()?.setRuntimeContext?.(DAYFRAME_API_BASE, token);
  } catch {
    // The normal app session remains authoritative; the native shortcut queue is the fallback.
  }
}

async function clearRuntimeContext() {
  try {
    await liveActivityNativeModule()?.clearRuntimeContext?.();
  } catch {
    // Clearing the JS session must not be blocked by an unavailable optional native module.
  }
}

async function clearRuntimeContextIfCurrent(token: string) {
  try {
    await liveActivityNativeModule()?.clearRuntimeContextIfToken?.(token);
  } catch {
    // A rejected request must not let an optional native module disrupt session recovery.
  }
}

export class SecureSessionUnavailableError extends Error {
  constructor() {
    super("Secure session is temporarily unavailable. Unlock your iPhone, then reopen Dayframe.");
    this.name = "SecureSessionUnavailableError";
  }
}

export function isKeychainInteractionUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /user interaction is not allowed|errsecinteractionnotallowed|-25308/i.test(message);
}

async function withInteractionRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isKeychainInteractionUnavailable(error) || attempt >= RETRY_DELAYS_MS.length) {
        if (isKeychainInteractionUnavailable(error)) throw new SecureSessionUnavailableError();
        throw error;
      }
      await delay(RETRY_DELAYS_MS[attempt]);
    }
  }
}

function serialiseSessionOperation<T>(operation: () => Promise<T>) {
  const result = sessionOperations.then(operation, operation);
  sessionOperations = result.then(() => undefined, () => undefined);
  return result;
}

export async function getSessionToken() {
  if (cachedSession !== undefined) return currentCachedSessionToken();

  const revision = sessionRevision;
  return serialiseSessionOperation(async () => {
    if (revision !== sessionRevision || cachedSession !== undefined) {
      return currentCachedSessionToken();
    }

    const current = await withInteractionRetry(() =>
      SecureStore.getItemAsync(SESSION_TOKEN_KEY, SESSION_TOKEN_OPTIONS)
    );
    if (revision !== sessionRevision) return currentCachedSessionToken();
    if (current) {
      const parsed = parseStoredSession(current);
      cachedSession = parsed;
      await mirrorRuntimeContext(parsed.token);
      return revision === sessionRevision ? parsed.token : currentCachedSessionToken();
    }

    const legacy = await withInteractionRetry(() => SecureStore.getItemAsync(LEGACY_SESSION_TOKEN_KEY));
    if (revision !== sessionRevision) return currentCachedSessionToken();
    if (!legacy) {
      cachedSession = null;
      return null;
    }

    await withInteractionRetry(() =>
      SecureStore.setItemAsync(SESSION_TOKEN_KEY, legacy, SESSION_TOKEN_OPTIONS)
    );
    await withInteractionRetry(() => SecureStore.deleteItemAsync(LEGACY_SESSION_TOKEN_KEY));
    if (revision !== sessionRevision) return currentCachedSessionToken();
    cachedSession = { owner: null, token: legacy };
    await mirrorRuntimeContext(legacy);
    return revision === sessionRevision ? legacy : currentCachedSessionToken();
  });
}

function currentCachedSessionToken() {
  return cachedSession?.token ?? null;
}

/**
 * Captures the session generation before any Keychain work begins. Callers
 * that are about to dispatch account-owned data must revalidate the returned
 * snapshot immediately before invoking fetch.
 */
export async function readAuthenticatedSessionSnapshot(): Promise<SessionSnapshotRead> {
  const generation = sessionRevision;
  const token = await getSessionToken();
  if (generation !== sessionRevision) return { status: "changed" };
  if (!token) return { status: "signed_out" };
  return {
    status: "authenticated",
    snapshot: { generation, owner: cachedSession?.owner ?? null, token }
  };
}

export async function readOwnedAuthenticatedSessionSnapshot(
  owner: MobileAccountOwner
): Promise<OwnedSessionSnapshotRead> {
  const session = await readAuthenticatedSessionSnapshot();
  if (session.status !== "authenticated") return session;
  if (!mobileAccountOwnersEqual(session.snapshot.owner, owner)) {
    return { status: "owner_mismatch" };
  }
  return session;
}

export function isAuthenticatedSessionSnapshotCurrent(
  snapshot: AuthenticatedSessionSnapshot
) {
  return snapshot.generation === sessionRevision &&
    cachedSession?.token === snapshot.token &&
    mobileAccountOwnersEqual(cachedSession.owner, snapshot.owner);
}

export async function setSessionToken(token: string, owner?: MobileAccountOwner) {
  const revision = ++sessionRevision;
  cachedSession = null;
  return serialiseSessionOperation(async () => {
    const session = { owner: owner ?? null, token } satisfies StoredMobileSession;
    await withInteractionRetry(() =>
      SecureStore.setItemAsync(
        SESSION_TOKEN_KEY,
        owner ? serialiseStoredSession(session) : token,
        SESSION_TOKEN_OPTIONS
      )
    );
    await withInteractionRetry(() => SecureStore.deleteItemAsync(LEGACY_SESSION_TOKEN_KEY));
    if (revision !== sessionRevision) return;
    cachedSession = session;
    await mirrorRuntimeContext(token);
    emitSessionChange();
  });
}

export async function bindAuthenticatedSessionOwner(
  snapshot: AuthenticatedSessionSnapshot,
  owner: MobileAccountOwner
) {
  return serialiseSessionOperation(async () => {
    if (
      !isAuthenticatedSessionSnapshotCurrent(snapshot) ||
      (snapshot.owner && !mobileAccountOwnersEqual(snapshot.owner, owner))
    ) {
      return false;
    }
    if (snapshot.owner) return true;
    const session = { owner, token: snapshot.token } satisfies StoredMobileSession;
    await withInteractionRetry(() =>
      SecureStore.setItemAsync(
        SESSION_TOKEN_KEY,
        serialiseStoredSession(session),
        SESSION_TOKEN_OPTIONS
      )
    );
    if (!isAuthenticatedSessionSnapshotCurrent(snapshot)) return false;
    cachedSession = session;
    emitSessionChange();
    return true;
  });
}

export async function clearSessionToken() {
  sessionRevision += 1;
  cachedSession = null;
  return serialiseSessionOperation(async () => {
    try {
      await withInteractionRetry(() => SecureStore.deleteItemAsync(SESSION_TOKEN_KEY, SESSION_TOKEN_OPTIONS));
      await withInteractionRetry(() => SecureStore.deleteItemAsync(LEGACY_SESSION_TOKEN_KEY));
    } finally {
      await clearRuntimeContext();
      emitSessionChange();
    }
  });
}

function emitSessionChange() {
  for (const listener of sessionListeners) listener();
}

export async function invalidateMobileSession() {
  try {
    await clearSessionToken();
  } finally {
    publishMobileSignedOut();
  }
}

export function invalidateMobileSessionIfCurrent(rejectedToken: string) {
  return serialiseSessionOperation(async () => {
    if (cachedSession?.token !== rejectedToken) return false;

    const invalidationRevision = ++sessionRevision;
    cachedSession = null;
    let deletionError: unknown;
    try {
      await withInteractionRetry(() =>
        SecureStore.deleteItemAsync(SESSION_TOKEN_KEY, SESSION_TOKEN_OPTIONS)
      );
      await withInteractionRetry(() => SecureStore.deleteItemAsync(LEGACY_SESSION_TOKEN_KEY));
    } catch (error) {
      deletionError = error;
    }

    let invalidated = false;
    if (invalidationRevision === sessionRevision) {
      await clearRuntimeContextIfCurrent(rejectedToken);
      if (invalidationRevision === sessionRevision) {
        publishMobileSignedOut();
        invalidated = true;
      }
    }
    if (deletionError) throw deletionError;
    return invalidated;
  });
}

function serialiseStoredSession(session: StoredMobileSession) {
  return JSON.stringify({
    version: 1,
    token: session.token,
    userId: session.owner?.userId,
    workspaceId: session.owner?.workspaceId
  });
}

function parseStoredSession(raw: string): StoredMobileSession {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== 1 || typeof value.token !== "string" || !value.token) {
      return { owner: null, token: raw };
    }
    const userId = typeof value.userId === "string" && value.userId ? value.userId : null;
    const workspaceId = typeof value.workspaceId === "string" && value.workspaceId
      ? value.workspaceId
      : null;
    return {
      owner: userId && workspaceId ? { userId, workspaceId } : null,
      token: value.token
    };
  } catch {
    return { owner: null, token: raw };
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
