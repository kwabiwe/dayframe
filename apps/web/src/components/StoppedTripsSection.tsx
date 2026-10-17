"use client";

import { useEffect, useState } from "react";
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
          <h2 id="stopped-trips-title">Trips you log yourself</h2>
          <p>Trips like these wait in Review instead of logging themselves.</p>
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
