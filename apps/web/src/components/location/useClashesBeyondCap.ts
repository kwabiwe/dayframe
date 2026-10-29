"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clientFetch } from "@/lib/client-auth-fetch";
import {
  CLASH_PRESENTATION_MIN_INTERVAL_MS,
  clashPresentationNeeded,
  fetchClashPresentationItems,
  type ClashPresentationFetch
} from "@/lib/clash-presentation";
import type { ReviewItemRow } from "@/lib/queries";

const NONE: readonly ReviewItemRow[] = [];

/**
 * The clashes past the bootstrap's cap (location v4 design §7, web parity with #622), for the "?" owner of one
 * workspace and user. Its inputs are the shell's canonical bootstrap (not a selected period's data, which is briefly
 * empty while the Calendar loads another date; Codex r1 on #623).
 *
 * It reads only when the bootstrap listed its 100 items (otherwise none lie past it), on the shell's bootstrap refreshes
 * (`dataVersion`), at most once a minute, one read at a time; never per render or on a timer (performance.md).
 *
 * Generations (Codex r1 on #623): every owner change starts a new lifetime — the cache is cleared, the read in flight
 * aborted, the throttle reset — and every bootstrap under the cap (a complete list, which disproves anything past it)
 * clears the cache too. A read applies only in the lifetime and bootstrap generation it started in, so nothing read
 * for one owner, or before a complete bootstrap, is ever shown after it.
 */
export function useClashesBeyondCap({ bootstrapItems, dataVersion, fetcher = clientFetch, owner, todayStartMs }: {
  bootstrapItems: readonly ReviewItemRow[];
  /** Changes with each bootstrap the shell commits. */
  dataVersion: unknown;
  fetcher?: ClashPresentationFetch;
  owner: string;
  todayStartMs: number | null;
}): readonly ReviewItemRow[] {
  const complete = !clashPresentationNeeded(bootstrapItems);
  // The lifetime (bumped per owner) and the bootstrap generation (bumped per complete bootstrap), as render state so a
  // cleared cache never shows, and as refs so a completing read checks the ones current then.
  const [generation, setGeneration] = useState({ owner, lifetime: 0, snapshot: 0, complete });
  let current = generation;
  if (generation.owner !== owner) {
    current = { owner, lifetime: generation.lifetime + 1, snapshot: 0, complete };
    setGeneration(current);
  } else if (complete && !generation.complete) {
    current = { ...generation, snapshot: generation.snapshot + 1, complete };
    setGeneration(current);
  } else if (!complete && generation.complete) {
    current = { ...generation, complete };
    setGeneration(current);
  }
  const now = useRef(current);
  useLayoutEffect(() => {
    now.current = current;
  });
  const [cache, setCache] = useState<{ lifetime: number; snapshot: number; items: readonly ReviewItemRow[] }>(
    { lifetime: 0, snapshot: 0, items: NONE });
  const inFlight = useRef<{ lifetime: number; snapshot: number; controller: AbortController } | null>(null);
  const lastRead = useRef<{ lifetime: number; snapshot: number; at: number } | null>(null);
  const needed = Boolean(owner) && todayStartMs !== null && !complete;
  const { lifetime, snapshot } = current;
  useEffect(() => {
    if (!needed || todayStartMs === null) return;
    const live = inFlight.current;
    if (live && live.lifetime === lifetime && live.snapshot === snapshot) return;
    const last = lastRead.current;
    if (last && last.lifetime === lifetime && last.snapshot === snapshot && Date.now() - last.at < CLASH_PRESENTATION_MIN_INTERVAL_MS) return;
    const controller = new AbortController();
    inFlight.current = { lifetime, snapshot, controller };
    lastRead.current = { lifetime, snapshot, at: Date.now() };
    const stillCurrent = () => now.current.lifetime === lifetime && now.current.snapshot === snapshot && !now.current.complete;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    void fetchClashPresentationItems({ fetcher, todayStartMs, timeZone, isCurrent: stillCurrent, signal: controller.signal })
      .then((items) => {
        if (items && stillCurrent()) setCache({ lifetime, snapshot, items });
      })
      // A failed read changes nothing: the items read last in this generation stay until the next one.
      .catch(() => undefined)
      .finally(() => {
        if (inFlight.current?.controller === controller) inFlight.current = null;
      });
  }, [dataVersion, fetcher, lifetime, needed, snapshot, todayStartMs]);
  // A new lifetime or a complete bootstrap: the read in flight for the previous one stops.
  useEffect(() => () => {
    const live = inFlight.current;
    if (live && live.lifetime === lifetime && live.snapshot === snapshot) {
      live.controller.abort();
      inFlight.current = null;
    }
  }, [lifetime, snapshot]);
  return needed && cache.lifetime === lifetime && cache.snapshot === snapshot ? cache.items : NONE;
}
