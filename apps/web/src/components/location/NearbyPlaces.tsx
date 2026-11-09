"use client";

import { useEffect, useRef, useState } from "react";
import { DAYFRAME_APP_ICONS } from "@dayframe/shared";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { loadMapKit, onPageFailure, type MkPlace } from "@/components/location/MapKitEvidenceMap";

/**
 * Apple's places near an unknown place, on the web (UI review, owner 29 Oct 2026; PRD D19 A7), as the iPhone's
 * sheet lists them: the nearest five and a search, from Apple MapKit JS next to its Apple map. Picking one names
 * the visit: the dialog then offers to save it under that name ("Save this place"), so a name is never a rule
 * until it's saved. The visit's centre goes to Apple's search from this browser only; it is never logged or kept,
 * and nothing Apple returns is stored except the name a person saves.
 */

const NEARBY_RADIUS_METERS = 250;
const NEARBY_ROWS = 5;
const SEARCH_DELAY_MS = 300;

type Row = { key: string; title: string; detail: string };
type State = { status: "loading" | "results" | "empty" | "unavailable"; rows: Row[] };

/** Metres between two nearby points (equirectangular is exact enough at this scale). */
function metresBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const toRadians = Math.PI / 180;
  const x = (b.longitude - a.longitude) * toRadians * Math.cos(((a.latitude + b.latitude) / 2) * toRadians);
  const y = (b.latitude - a.latitude) * toRadians;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

function formatDistance(metres: number) {
  return metres < 1000 ? `${Math.max(10, Math.round(metres / 10) * 10)} m away` : `${(metres / 1000).toFixed(1)} km away`;
}

export function NearbyPlaces({
  centre,
  disabled,
  onNearbyCount,
  onPick,
  onSearching,
  onUnavailable,
  pickLabel = "Names this visit; you can then save it",
  query: controlledQuery,
  rows = NEARBY_ROWS,
  savedNames = [],
  searchRows = 6
}: {
  centre: { latitude: number; longitude: number };
  disabled: boolean;
  /** How many nearby places came back (none on a failure): the dialog's list settles on its height from it. */
  onNearbyCount?: (count: number) => void;
  onPick: (name: string) => void;
  /** Whether a typed search is waiting on Apple (the dialog's quiet spinner). */
  onSearching?: (searching: boolean) => void;
  /** What a pick does, for assistive tech (Proposed: the pick answers the question). */
  pickLabel?: string;
  /** The dialog's own search text (Proposed, round 2): this list then draws no search field of its own. */
  query?: string;
  /** How many nearby places show before a search (Proposed: 3). */
  rows?: number;
  /** Places the host already lists: Apple's row of the same name would save a duplicate. */
  savedNames?: string[];
  /** How many places a search shows (Proposed: 3). */
  searchRows?: number;
  /** MapKit failed for the page: the dialog drops this list. */
  onUnavailable: () => void;
}) {
  const [nearby, setNearby] = useState<State>({ status: "loading", rows: [] });
  // The latest search's answer, kept with the text it was for, so a newer query never shows an older answer.
  const [searched, setSearched] = useState<{ query: string; state: State } | null>(null);
  const [ownQuery, setQuery] = useState("");
  const query = controlledQuery ?? ownQuery;
  const latest = useRef({ onNearbyCount, onSearching, onUnavailable, savedNames });
  useEffect(() => {
    latest.current = { onNearbyCount, onSearching, onUnavailable, savedNames };
  });
  const { latitude, longitude } = centre;

  useEffect(() => onPageFailure(() => latest.current.onUnavailable()), []);

  useEffect(() => {
    let cancelled = false;
    void loadMapKit().then((mapkit) => {
      if (cancelled) return;
      const search = new mapkit.PointsOfInterestSearch({ center: new mapkit.Coordinate(latitude, longitude), radius: NEARBY_RADIUS_METERS });
      search.search((error, data) => {
        if (cancelled) return;
        if (error) {
          setNearby({ status: "unavailable", rows: [] });
          latest.current.onNearbyCount?.(0);
          return;
        }
        const found = toRows(data?.places ?? [], { latitude, longitude }, latest.current.savedNames).slice(0, rows);
        setNearby({ status: found.length ? "results" : "empty", rows: found });
        latest.current.onNearbyCount?.(found.length);
      });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude, rows]);

  useEffect(() => {
    const text = query.trim();
    if (!text) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      void loadMapKit().then((mapkit) => {
        if (cancelled) return;
        const search = new mapkit.Search({
          coordinate: new mapkit.Coordinate(latitude, longitude),
          region: new mapkit.CoordinateRegion(new mapkit.Coordinate(latitude, longitude), new mapkit.CoordinateSpan(0.05, 0.05)),
          includePointsOfInterest: true
        });
        const answer = (error: unknown, places: MkPlace[]) => {
          const rows = error ? [] : toRows(places, { latitude, longitude }, latest.current.savedNames).slice(0, searchRows);
          setSearched({ query: text, state: { status: error ? "unavailable" : rows.length ? "results" : "empty", rows } });
        };
        const fullSearch = () => search.search(text, (error, data) => {
          if (!cancelled) answer(error, data?.places ?? []);
        });
        if (!search.autocomplete) {
          fullSearch();
          return;
        }
        // As you type, near the visit: "rivers" finds Riverside Leisure Centre. A full search backs it up.
        search.autocomplete(text, (error, data) => {
          if (cancelled) return;
          const places = (data?.results ?? []).flatMap((result) => {
            const name = result.displayLines?.[0];
            return name && result.coordinate ? [{ name, coordinate: result.coordinate }] : [];
          });
          if (error || !places.length) fullSearch();
          else answer(null, places);
        });
      }).catch(() => undefined);
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, latitude, longitude, searchRows]);

  const text = query.trim();
  const typed = text.length > 0;
  const searching = typed && searched?.query !== text;
  useEffect(() => {
    latest.current.onSearching?.(searching);
  }, [searching]);
  // Gone mid-search (MapKit failed for the page): the host's spinner stops with it (Codex r1 on #639).
  useEffect(() => () => latest.current.onSearching?.(false), []);
  // Inside the dialog (it owns the search) the rows stay until the next answer arrives, so nothing jumps (owner,
  // 30 Oct 2026): a tap on one still names that place. On its own, a newer query shows "Looking…" (Codex r3 on #633).
  const held = searched?.state ?? nearby;
  const shown: State = !typed ? nearby
    : !searching ? searched!.state
      : controlledQuery !== undefined ? { ...held, status: "loading" }
        : { status: "loading", rows: [] };
  const quiet = controlledQuery !== undefined && shown.status === "loading";
  // The nearest places' room while they load, so the dialog's list doesn't jump.
  if (quiet && !shown.rows.length) {
    return (
      <div aria-hidden="true" className="location-correction-nearby" data-section="nearby">
        {Array.from({ length: rows }, (_, index) => <span className="location-correction-placeholder" key={index} />)}
      </div>
    );
  }
  return (
    <div className="location-correction-nearby" data-section="nearby">
      {controlledQuery === undefined ? (
        <label className="location-correction-nearby-search">
          <DayframeIcon glyph="search" size={16} />
          <input aria-label="Search places" disabled={disabled} onChange={(event) => setQuery(event.target.value)}
            placeholder="Search places" type="search" value={query} />
        </label>
      ) : null}
      {shown.rows.length ? (
        <ul aria-label={typed ? "Places found" : "Places nearby"} className="location-correction-options">
          {shown.rows.map((row) => (
            <li key={row.key}>
              <button aria-label={`${row.title}, ${row.detail}. ${pickLabel}`} className="location-correction-option is-nearby"
                disabled={disabled} onClick={() => onPick(row.title)} type="button">
                <DayframeIcon glyph={DAYFRAME_APP_ICONS.places} size={18} />
                <span><b>{row.title}</b><small>{row.detail}</small></span>
              </button>
            </li>
          ))}
        </ul>
      ) : quiet ? null : (
        <p aria-live="polite" className="location-correction-nearby-note" role="status">
          {shown.status === "loading" ? (typed ? "Looking…" : "Looking nearby…") : shown.status === "unavailable" ? "Nearby places aren’t available right now."
            : typed ? "No places match." : "No places nearby."}
        </p>
      )}
    </div>
  );
}

function toRows(places: MkPlace[], centre: { latitude: number; longitude: number }, savedNames: string[]): Row[] {
  const seen = new Set<string>();
  const saved = new Set(savedNames.map((name) => name.trim().toLowerCase()));
  return places
    .flatMap((place) => {
      const title = place.name?.trim();
      if (!title || !place.coordinate || saved.has(title.toLowerCase())) return [];
      const metres = metresBetween(centre, place.coordinate);
      const key = place.id ?? `${title}@${place.coordinate.latitude},${place.coordinate.longitude}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ key, title, detail: formatDistance(metres), metres }];
    })
    .sort((a, b) => a.metres - b.metres)
    .map(({ key, title, detail }) => ({ key, title, detail }));
}
