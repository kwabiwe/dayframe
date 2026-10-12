import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import {
  getActiveMobileAccountSnapshot,
  readActiveMobileAccount,
  subscribeActiveMobileAccount,
  type MobileAccountOwner
} from "./mobileAccount";
import { subscribeMobileSignedOut } from "./mobileSessionTransition";
import { currentSessionGeneration, subscribeAuthenticatedSession } from "./secure-session";

/**
 * Last-known values of states each Settings page reads after it opens (permissions, Apple Health
 * access, the evening reminder, sync diagnostics), so a newly pushed page starts from them instead
 * of empty and nothing visibly flips on open (owner, 12 Oct). In memory, dropped on sign-out,
 * and bound to one account (user and workspace) in one authenticated session
 * (`currentSessionGeneration`, bumped by every sign-in, sign-out and invalidation): a value is only
 * handed out to that same account in that same session, and a late result that started in an
 * earlier account or session never lands (Codex r1–r3 on #355). Every read is bound to the account
 * it was started for (`beginRememberedSettingsRead`), never to whichever account a page later
 * belongs to: the active account can load silently and then be replaced within one session.
 * Across launches, `settingsLastKnown.ts` keeps a display-only projection of these values on the
 * device (A4), fed by `subscribeRememberedSettingWrites`; it never feeds values back in here.
 */
export type RememberedSettingsBinding = {
  generation: number;
  /** The account a read is for: account-scoped stores are read for exactly this owner. */
  owner: MobileAccountOwner | null;
  ownerKey: string | null;
};

let remembered: { binding: RememberedSettingsBinding; values: Map<string, unknown> } | null = null;

/** The account and session a read starts in; pass it back when publishing that read's result. */
export function captureRememberedSettingsBinding(): RememberedSettingsBinding {
  const owner = getActiveMobileAccountSnapshot();
  return {
    generation: currentSessionGeneration(),
    owner: owner ? { userId: owner.userId, workspaceId: owner.workspaceId } : null,
    ownerKey: owner ? `${owner.userId}:${owner.workspaceId}` : null
  };
}

export function sameRememberedSettingsBinding(left: RememberedSettingsBinding, right: RememberedSettingsBinding) {
  return sameBinding(left, right);
}

function sameBinding(left: RememberedSettingsBinding, right: RememberedSettingsBinding) {
  return left.ownerKey === right.ownerKey && left.generation === right.generation;
}

/**
 * Taken when a read starts: waits for the active account to be known (it loads lazily), then binds
 * the read to that account and session. Pass it back with the read's result.
 */
export async function beginRememberedSettingsRead(): Promise<RememberedSettingsBinding> {
  await readActiveMobileAccount();
  return captureRememberedSettingsBinding();
}

/** Whether a binding is still this process's signed-in account and session. */
export function isRememberedSettingsBindingCurrent(binding: RememberedSettingsBinding) {
  return binding.ownerKey !== null && sameBinding(binding, captureRememberedSettingsBinding());
}

export function readRememberedSetting<T>(key: string): T | undefined {
  const current = captureRememberedSettingsBinding();
  if (!remembered || current.ownerKey === null || !sameBinding(remembered.binding, current)) return undefined;
  return remembered.values.get(key) as T | undefined;
}

type RememberedSettingWriteListener = (key: string, value: unknown, binding: RememberedSettingsBinding) => void;
const writeListeners = new Set<RememberedSettingWriteListener>();

/**
 * Hears every value that lands (only ever for the current account and session). The on-device
 * last-known store (`settingsLastKnown.ts`) keeps a display-only projection of some of them.
 */
export function subscribeRememberedSettingWrites(listener: RememberedSettingWriteListener) {
  writeListeners.add(listener);
  return () => {
    writeListeners.delete(listener);
  };
}

/** Publishes only while `binding` is still the current account and session; returns whether it did. */
export function writeRememberedSetting(key: string, value: unknown, binding: RememberedSettingsBinding) {
  if (!isRememberedSettingsBindingCurrent(binding)) return false;
  if (!remembered || !sameBinding(remembered.binding, binding)) remembered = { binding, values: new Map() };
  remembered.values.set(key, value);
  for (const listener of [...writeListeners]) listener(key, value, binding);
  return true;
}

export function clearRememberedSettings() {
  remembered = null;
}

subscribeMobileSignedOut(clearRememberedSettings);

function resolve<T>(action: SetStateAction<T>, current: T): T {
  return typeof action === "function" ? (action as (value: T) => T)(current) : action;
}

function rememberedOr<T>(key: string, initial: T) {
  const known = readRememberedSetting<T>(key);
  return known === undefined ? initial : known;
}

type BoundState<T> = { binding: RememberedSettingsBinding; value: T };

export type RememberedSettingsSetter<T> = (action: SetStateAction<T>, startedFor: RememberedSettingsBinding) => void;

/**
 * useState that starts from this account's last-known value and remembers every change. Each
 * change carries the binding its read started for (`beginRememberedSettingsRead`) and lands only
 * while that account and session are still current — in the module and on screen; a read started
 * before any account was known never lands. The state shows only while it belongs to the current
 * account and session: an account switch, sign-out or new sign-in puts it back to `initial` (or
 * what the new account already remembers), also before the change's notification arrives.
 */
export function useRememberedSettingsState<T>(key: string, initial: T): [T, RememberedSettingsSetter<T>] {
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const [state, setState] = useState<BoundState<T>>(() => ({
    binding: captureRememberedSettingsBinding(),
    value: rememberedOr(key, initial)
  }));

  useEffect(() => {
    const rebind = () => {
      setState((previous) => {
        const now = captureRememberedSettingsBinding();
        return sameBinding(previous.binding, now) ? previous : { binding: now, value: rememberedOr(key, initialRef.current) };
      });
    };
    const unsubscribes = [
      subscribeActiveMobileAccount(rebind),
      subscribeAuthenticatedSession(rebind),
      subscribeMobileSignedOut(rebind)
    ];
    // A change between the first render and this subscription.
    rebind();
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [key]);

  const set = useCallback<RememberedSettingsSetter<T>>((action, startedFor) => {
    // A read for another account or session (or for no account) never lands.
    if (!isRememberedSettingsBindingCurrent(startedFor)) return;
    setState((previous) => {
      if (!isRememberedSettingsBindingCurrent(startedFor)) return previous;
      const base = sameBinding(previous.binding, startedFor) ? previous.value : rememberedOr(key, initialRef.current);
      const value = resolve(action, base);
      writeRememberedSetting(key, value, startedFor);
      return { binding: startedFor, value };
    });
  }, [key]);

  // Between a change and its notification, nothing from the earlier account or session shows.
  const current = sameBinding(state.binding, captureRememberedSettingsBinding());
  return [current ? state.value : rememberedOr(key, initial), set];
}
