import AsyncStorage from "@react-native-async-storage/async-storage";

const ACTIVE_MOBILE_ACCOUNT_KEY = "dayframe.activeMobileAccount.v1";

export type MobileAccountOwner = {
  userId: string;
  workspaceId: string;
};

let cachedOwner: MobileAccountOwner | null | undefined;
let mutationTail: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

export function mobileAccountKey(owner: MobileAccountOwner) {
  return `${owner.workspaceId}:${owner.userId}`;
}

export function mobileAccountOwnersEqual(
  left: MobileAccountOwner | null | undefined,
  right: MobileAccountOwner | null | undefined
) {
  return left?.userId === right?.userId && left?.workspaceId === right?.workspaceId;
}

export async function readActiveMobileAccount(): Promise<MobileAccountOwner | null> {
  if (cachedOwner !== undefined) return cachedOwner;
  return withAccountMutation(async () => {
    if (cachedOwner !== undefined) return cachedOwner;
    const raw = await AsyncStorage.getItem(ACTIVE_MOBILE_ACCOUNT_KEY);
    cachedOwner = parseOwner(raw);
    return cachedOwner;
  });
}

export async function activateMobileAccount(owner: MobileAccountOwner) {
  const next = requiredOwner(owner);
  return withAccountMutation(async () => {
    if (mobileAccountOwnersEqual(cachedOwner, next)) return next;
    await AsyncStorage.setItem(ACTIVE_MOBILE_ACCOUNT_KEY, JSON.stringify(next));
    cachedOwner = next;
    emitChange();
    return next;
  });
}

export async function deactivateMobileAccount(owner?: MobileAccountOwner) {
  return withAccountMutation(async () => {
    if (cachedOwner === undefined) {
      cachedOwner = parseOwner(await AsyncStorage.getItem(ACTIVE_MOBILE_ACCOUNT_KEY));
    }
    if (!cachedOwner || (owner && !mobileAccountOwnersEqual(cachedOwner, owner))) {
      return false;
    }
    await AsyncStorage.removeItem(ACTIVE_MOBILE_ACCOUNT_KEY);
    cachedOwner = null;
    emitChange();
    return true;
  });
}

export function getActiveMobileAccountSnapshot() {
  return cachedOwner ?? null;
}

export function subscribeActiveMobileAccount(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function __resetMobileAccountForTests() {
  cachedOwner = undefined;
  mutationTail = Promise.resolve();
  listeners.clear();
}

function withAccountMutation<Result>(operation: () => Promise<Result>) {
  const result = mutationTail.catch(() => undefined).then(operation);
  mutationTail = result.then(() => undefined, () => undefined);
  return result;
}

function parseOwner(raw: string | null): MobileAccountOwner | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const userId = optionalText(value.userId);
    const workspaceId = optionalText(value.workspaceId);
    return userId && workspaceId ? { userId, workspaceId } : null;
  } catch {
    return null;
  }
}

function requiredOwner(owner: MobileAccountOwner): MobileAccountOwner {
  const userId = optionalText(owner.userId);
  const workspaceId = optionalText(owner.workspaceId);
  if (!userId || !workspaceId) {
    throw new Error("An authenticated account is required for durable mobile work.");
  }
  return { userId, workspaceId };
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function emitChange() {
  for (const listener of listeners) listener();
}
