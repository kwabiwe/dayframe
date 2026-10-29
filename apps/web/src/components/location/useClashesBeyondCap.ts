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
 * workspace and user. It reads only when the bootstrap listed its 100 items (otherwise none lie past it), on the shell's
 * bootstrap refreshes (`dataVersion`), at most once a minute per owner, one read at a time; never per render or on a
 * timer (performance.md). Another owner aborts the read in flight and starts empty: nothing of one owner's read is
 * used for another.
 */
export function useClashesBeyondCap({ bootstrapItems, dataVersion, fetcher = clientFetch, owner, todayStartMs }: {
  bootstrapItems: readonly ReviewItemRow[];
  /** Changes with each bootstrap the shell commits. */
  dataVersion: unknown;
  fetcher?: ClashPresentationFetch;
  owner: string;
  todayStartMs: number | null;
}): readonly ReviewItemRow[] {
  const [read, setRead] = useState<{ owner: string; items: readonly ReviewItemRow[] }>({ owner, items: NONE });
  const ownerNow = useRef(owner);
  useLayoutEffect(() => {
    ownerNow.current = owner;
  }, [owner]);
  const inFlight = useRef<{ owner: string; controller: AbortController } | null>(null);
  const lastRead = useRef<{ owner: string; at: number } | null>(null);
  const needed = Boolean(owner) && todayStartMs !== null && clashPresentationNeeded(bootstrapItems);
  useEffect(() => {
    if (!needed || todayStartMs === null) return;
    if (inFlight.current?.owner === owner) return;
    const last = lastRead.current;
    if (last && last.owner === owner && Date.now() - last.at < CLASH_PRESENTATION_MIN_INTERVAL_MS) return;
    const controller = new AbortController();
    inFlight.current = { owner, controller };
    lastRead.current = { owner, at: Date.now() };
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    void fetchClashPresentationItems({ fetcher, todayStartMs, timeZone, isCurrent: () => ownerNow.current === owner, signal: controller.signal })
      .then((items) => {
        if (items && ownerNow.current === owner) setRead({ owner, items });
      })
      // A failed read changes nothing: the items read last stay until the next one.
      .catch(() => undefined)
      .finally(() => {
        if (inFlight.current?.controller === controller) inFlight.current = null;
      });
  }, [dataVersion, fetcher, needed, owner, todayStartMs]);
  // Another owner: the read in flight for the previous one stops.
  useEffect(() => () => {
    if (inFlight.current?.owner === owner) {
      inFlight.current.controller.abort();
      inFlight.current = null;
    }
  }, [owner]);
  return needed && read.owner === owner ? read.items : NONE;
}
