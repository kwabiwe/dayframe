import { useCallback, useState, type SetStateAction } from "react";
import { getActiveMobileAccountSnapshot } from "./mobileAccount";
import { subscribeMobileSignedOut } from "./mobileSessionTransition";

/**
 * Last-known values of states each Settings page reads after it opens (permissions, Apple Health
 * access, the evening reminder, sync diagnostics), so a newly pushed page starts from them instead
 * of empty and nothing visibly flips on open (owner, 12 Oct). In memory only, per account (user and
 * workspace), and dropped on sign-out.
 */
let remembered: { ownerKey: string; values: Map<string, unknown> } | null = null;

function ownerKey() {
  const owner = getActiveMobileAccountSnapshot();
  return owner ? `${owner.userId}:${owner.workspaceId}` : null;
}

export function readRememberedSetting<T>(key: string): T | undefined {
  const current = ownerKey();
  if (!remembered || !current || remembered.ownerKey !== current) return undefined;
  return remembered.values.get(key) as T | undefined;
}

export function writeRememberedSetting(key: string, value: unknown) {
  const current = ownerKey();
  if (!current) return;
  if (!remembered || remembered.ownerKey !== current) remembered = { ownerKey: current, values: new Map() };
  remembered.values.set(key, value);
}

export function clearRememberedSettings() {
  remembered = null;
}

subscribeMobileSignedOut(clearRememberedSettings);

function resolve<T>(action: SetStateAction<T>, current: T): T {
  return typeof action === "function" ? (action as (value: T) => T)(current) : action;
}

/** useState that starts from this account's last-known value and remembers every change. */
export function useRememberedSettingsState<T>(key: string, initial: T): [T, (action: SetStateAction<T>) => void] {
  const [value, setValue] = useState<T>(() => {
    const known = readRememberedSetting<T>(key);
    return known === undefined ? initial : known;
  });
  const set = useCallback((action: SetStateAction<T>) => {
    setValue((current) => {
      const next = resolve(action, current);
      writeRememberedSetting(key, next);
      return next;
    });
  }, [key]);
  return [value, set];
}
