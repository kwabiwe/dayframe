"use client";

import { useSyncExternalStore } from "react";
import type { ReviewItemRow } from "@/lib/queries";

/**
 * The List's pending "?" decisions, shared with the sidebar badge and Today's chip (Codex r2 on #609): the "?" an
 * answer hides while it is held for Undo or saving (or the server said are decided), and the ones Undo or a
 * refused save brought back after a refresh had dropped them. Written by the List's `useListChecks`, read by
 * AppShell and Today, so every count and destination agrees through an answer, its Undo and a failure.
 */
export type CheckProjection = { hiddenIds: ReadonlySet<string>; revived: readonly ReviewItemRow[] };

const EMPTY: CheckProjection = { hiddenIds: new Set(), revived: [] };
let projection: CheckProjection = EMPTY;
/** Whose projection it is: the List that published it last. */
let owner: object | null = null;
const listeners = new Set<() => void>();

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

export function publishCheckProjection(next: CheckProjection, by: object | null = null) {
  owner = by;
  const same = sameIds(projection.hiddenIds, next.hiddenIds) && projection.revived.length === next.revived.length &&
    projection.revived.every((item, index) => item === next.revived[index]);
  if (same) return;
  projection = next.hiddenIds.size || next.revived.length ? next : EMPTY;
  for (const listener of listeners) listener();
}

/** Clears it: everyone's (an owner change), or only `by`'s, if no other List has published since. */
export function clearCheckProjection(by?: object) {
  if (by && owner !== by) return;
  publishCheckProjection(EMPTY);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useCheckProjection() {
  return useSyncExternalStore(subscribe, () => projection, () => EMPTY);
}

/** The review items as the List shows them now: held answers away, revived ones back. */
export function projectReviewItems(items: readonly ReviewItemRow[], current: CheckProjection): readonly ReviewItemRow[] {
  if (current === EMPTY) return items;
  const listed = new Set(items.map((item) => item.id));
  return [...items.filter((item) => !current.hiddenIds.has(item.id)),
    ...current.revived.filter((item) => !listed.has(item.id) && !current.hiddenIds.has(item.id))];
}
