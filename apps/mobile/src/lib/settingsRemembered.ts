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

type EpochState<T> = { epoch: number; value: T };

/**
 * useState that starts from this account's last-known value and remembers every change. Each hook
 * holds one binding per epoch: the account and session it was read in. A binding made before the
 * active account had loaded (no owner yet) is claimed once, by the first owner it resolves to in
 * that session; any other owner afterwards, a new session or sign-out ends the epoch (Codex r2 on
 * #355: the session and the active account are stored separately, so an owner can be replaced
 * within one session during startup reconciliation). Ending an epoch puts the state back to
 * `initial` (or what the new account already remembers) and spends every setter handed out in it:
 * a late result from the earlier account or session neither reaches the module nor shows on screen.
 */
export function useRememberedSettingsState<T>(key: string, initial: T): [T, (action: SetStateAction<T>) => void] {
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const bindingRef = useRef<RememberedSettingsBinding | null>(null);
  if (bindingRef.current === null) bindingRef.current = captureRememberedSettingsBinding();
  const epochRef = useRef(0);
  const [state, setState] = useState<EpochState<T>>(() => ({ epoch: 0, value: rememberedOr(key, initial) }));

  /** Whether `epoch` still holds; read-only (render). */
  const holds = useCallback((epoch: number) => {
    const bound = bindingRef.current!;
    const now = captureRememberedSettingsBinding();
    return epoch === epochRef.current && (
      sameBinding(bound, now) ||
      (bound.ownerKey === null && bound.generation === now.generation)
    );
  }, []);

  /** The binding to publish under while `epoch` holds (claiming a not-yet-known owner once), or null. */
  const claim = useCallback((epoch: number) => {
    if (!holds(epoch)) return null;
    const now = captureRememberedSettingsBinding();
    if (bindingRef.current!.ownerKey === null && now.ownerKey !== null) bindingRef.current = now;
    return now;
  }, [holds]);

  useEffect(() => {
    const rebind = () => {
      if (claim(epochRef.current)) return;
      epochRef.current += 1;
      bindingRef.current = captureRememberedSettingsBinding();
      const epoch = epochRef.current;
      setState({ epoch, value: rememberedOr(key, initialRef.current) });
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
  }, [claim, key]);

  const { epoch } = state;
  const set = useCallback((action: SetStateAction<T>) => {
    // Spent: this setter's epoch ended (another account or session).
    if (!claim(epoch)) return;
    setState((previous) => {
      if (previous.epoch !== epoch) return previous;
      const binding = claim(epoch);
      if (!binding) return previous;
      const value = resolve(action, previous.value);
      writeRememberedSetting(key, value, binding);
      return { epoch, value };
    });
  }, [claim, epoch, key]);

  // Between a change and its notification, nothing from the earlier account or session shows.
  return [state.epoch === epochRef.current && holds(state.epoch) ? state.value : rememberedOr(key, initial), set];
}
