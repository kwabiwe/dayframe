"use client";

import { useEffect, useRef, useState } from "react";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { clientFetch } from "@/lib/client-auth-fetch";

type StoppedTrip = { patternKey: string; label: string; stoppedAt: string };

/**
 * Places › Trips (PRD D19, A4): the trips the person stopped logging automatically ("Don't log trips
 * like this"), each with "Log automatically again". Shown only when there are any; read once when
 * Places opens.
 */
export function StoppedTripsSection() {
  const [trips, setTrips] = useState<StoppedTrip[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  // Where focus goes once a resumed row (whose button had it) is gone: the next row's button, else
  // the previous one's, else the section heading (Codex r1 on #463).
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const refocus = useRef<{ next: string | null } | null>(null);
  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const next = target.next ? buttonRefs.current.get(target.next) : undefined;
    if (next) next.focus();
    else headingRef.current?.focus();
  }, [trips]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await clientFetch("/api/location/name-patterns");
        if (!response.ok) return;
        const body = (await response.json()) as { trips?: StoppedTrip[] };
        if (live) setTrips(body.trips ?? []);
      } catch {
        // Offline: the section stays hidden until Places opens again.
      }
    })();
    return () => { live = false; };
  }, []);

  async function resume(trip: StoppedTrip) {
    if (busyKey) return;
    setBusyKey(trip.patternKey);
    setMessage(null);
    try {
      const response = await clientFetch("/api/location/name-patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume_trips", patternKey: trip.patternKey })
      });
      if (!response.ok) throw new Error();
      const list = trips ?? [];
      const index = list.findIndex((other) => other.patternKey === trip.patternKey);
      const neighbour = list[index + 1] ?? list[index - 1] ?? null;
      refocus.current = { next: neighbour?.patternKey ?? null };
      setTrips((current) => current?.filter((other) => other.patternKey !== trip.patternKey) ?? null);
      setMessage({ text: `${trip.label} logs itself again when it’s clear.`, error: false });
    } catch {
      setMessage({ text: "Couldn’t change that. Check your connection and try again.", error: true });
    } finally {
      setBusyKey(null);
    }
  }

  if (!trips?.length && !message) return null;
  return (
    <section className="places-list-section" aria-labelledby="stopped-trips-title">
      <header>
        <div>
          <h2 id="stopped-trips-title" ref={headingRef} tabIndex={-1}>Trips you log yourself</h2>
          <p>Trips like these are asked in Calendar instead of logging themselves.</p>
        </div>
        <span>{trips?.length ?? 0}</span>
      </header>
      <div className="places-list">
        {(trips ?? []).map((trip) => (
          <article className="place-list-row" key={trip.patternKey}>
            <span className="place-list-icon"><DayframeIcon glyph="route" size={19}/></span>
            <div className="place-list-copy">
              <h3>{trip.label}</h3>
            </div>
            <div className="place-list-actions">
              <button
                className="df-rbtn df-rbtn--sm df-rbtn--ghost"
                disabled={busyKey !== null}
                ref={(node) => { if (node) buttonRefs.current.set(trip.patternKey, node); else buttonRefs.current.delete(trip.patternKey); }}
                onClick={() => void resume(trip)}
                type="button"
              >
                Log automatically again
              </button>
            </div>
          </article>
        ))}
      </div>
      {message ? (
        <p className={`settings-section-feedback${message.error ? " is-error" : ""}`} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
