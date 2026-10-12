import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { getActiveMobileAccountSnapshot, subscribeActiveMobileAccount } from "./mobileAccount";
import { subscribeMobileSignedOut } from "./mobileSessionTransition";
import { currentSessionGeneration, subscribeAuthenticatedSession } from "./secure-session";

/**
 * Last-known values of states each Settings page reads after it opens (permissions, Apple Health
 * access, the evening reminder, sync diagnostics), so a newly pushed page starts from them instead
 * of empty and nothing visibly flips on open (owner, 12 Oct). In memory only, dropped on sign-out,
 * and bound to one account (user and workspace) in one authenticated session
 * (`currentSessionGeneration`, bumped by every sign-in, sign-out and invalidation): a value is only
 * handed out to that same account in that same session, and a late result that started in an
 * earlier account or session never lands (Codex r1 on #355).
 */
export type RememberedSettingsBinding = { generation: number; ownerKey: string | null };

let remembered: { binding: RememberedSettingsBinding; values: Map<string, unknown> } | null = null;

/** The account and session a read starts in; pass it back when publishing that read's result. */
export function captureRememberedSettingsBinding(): RememberedSettingsBinding {
  const owner = getActiveMobileAccountSnapshot();
  return {
    generation: currentSessionGeneration(),
    ownerKey: owner ? `${owner.userId}:${owner.workspaceId}` : null
  };
}

function sameBinding(left: RememberedSettingsBinding, right: RememberedSettingsBinding) {
  return left.ownerKey === right.ownerKey && left.generation === right.generation;
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

/** Publishes only while `binding` is still the current account and session; returns whether it did. */
export function writeRememberedSetting(key: string, value: unknown, binding: RememberedSettingsBinding) {
  if (!isRememberedSettingsBindingCurrent(binding)) return false;
  if (!remembered || !sameBinding(remembered.binding, binding)) remembered = { binding, values: new Map() };
  remembered.values.set(key, value);
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

/**
 * Whether state bound to `from` still belongs to `to`: the same session, and the same account — or
 * an account that was not known yet when the state was bound (the active account loads lazily; a
 * different account always arrives with a new sign-in, so a new generation).
 */
function continues(from: RememberedSettingsBinding, to: RememberedSettingsBinding) {
  return from.generation === to.generation && (from.ownerKey === to.ownerKey || from.ownerKey === null);
}

/**
 * useState that starts from this account's last-known value and remembers every change. The state
 * is bound to the account and session it was read in: when either changes (account switch,
 * sign-out, a new sign-in of the same account) it goes back to `initial` (or what the new account
 * already remembers), and a setter handed out before the change is spent — a late result from the
 * earlier account or session neither reaches the module nor shows on screen.
 */
export function useRememberedSettingsState<T>(key: string, initial: T): [T, (action: SetStateAction<T>) => void] {
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
        if (sameBinding(previous.binding, now)) return previous;
        if (continues(previous.binding, now)) return { binding: now, value: previous.value };
        return { binding: now, value: rememberedOr(key, initialRef.current) };
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

  const { generation, ownerKey } = state.binding;
  const set = useCallback((action: SetStateAction<T>) => {
    const bound = { generation, ownerKey };
    // Spent: this setter belongs to an account or session that is no longer current.
    if (!continues(bound, captureRememberedSettingsBinding())) return;
    setState((previous) => {
      const now = captureRememberedSettingsBinding();
      if (!continues(bound, now) || !continues(previous.binding, now)) return previous;
      const value = resolve(action, previous.value);
      writeRememberedSetting(key, value, now);
      return { binding: now, value };
    });
  }, [generation, key, ownerKey]);

  // Between a change and its notification, nothing from the earlier account or session shows.
  const now = captureRememberedSettingsBinding();
  return [continues(state.binding, now) ? state.value : rememberedOr(key, initial), set];
}
