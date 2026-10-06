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
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return hydrated ? new Date() : new Date(renderedAt);
}
