"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/**
 * The clock for live durations in server-rendered client components.
 *
 * The server render and the browser's hydration pass both use `renderedAt`, the
 * instant the server rendered, so values derived from a running timer match
 * exactly. After hydration every render reads the real clock again.
 */
export function useHydrationSafeNow(renderedAt: string): Date {
  return useIsHydrated() ? new Date() : new Date(renderedAt);
}

/** False during the server render and the browser's hydration pass, true afterwards. */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
