import * as SecureStore from "expo-secure-store";

const LEGACY_SESSION_TOKEN_KEY = "dayframe.localSessionToken.v1";
const SESSION_TOKEN_KEY = "dayframe.localSessionToken.v2";
const RETRY_DELAYS_MS = [75, 200] as const;

const SESSION_TOKEN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
};

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

export async function getSessionToken() {
  const current = await withInteractionRetry(() =>
    SecureStore.getItemAsync(SESSION_TOKEN_KEY, SESSION_TOKEN_OPTIONS)
  );
  if (current) return current;

  const legacy = await withInteractionRetry(() => SecureStore.getItemAsync(LEGACY_SESSION_TOKEN_KEY));
  if (!legacy) return null;

  await withInteractionRetry(() =>
    SecureStore.setItemAsync(SESSION_TOKEN_KEY, legacy, SESSION_TOKEN_OPTIONS)
  );
  await withInteractionRetry(() => SecureStore.deleteItemAsync(LEGACY_SESSION_TOKEN_KEY));
  return legacy;
}

export async function setSessionToken(token: string) {
  await withInteractionRetry(() =>
    SecureStore.setItemAsync(SESSION_TOKEN_KEY, token, SESSION_TOKEN_OPTIONS)
  );
  await withInteractionRetry(() => SecureStore.deleteItemAsync(LEGACY_SESSION_TOKEN_KEY));
}

export async function clearSessionToken() {
  await withInteractionRetry(() => SecureStore.deleteItemAsync(SESSION_TOKEN_KEY, SESSION_TOKEN_OPTIONS));
  await withInteractionRetry(() => SecureStore.deleteItemAsync(LEGACY_SESSION_TOKEN_KEY));
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
