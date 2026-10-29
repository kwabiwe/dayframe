"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";
import { prefersReducedMotion } from "@/lib/blocks-motion";
import { clientFetch } from "@/lib/client-auth-fetch";
import { hasLocationMapGeometry } from "@/lib/location/location-evidence-presentation";
import { evidenceBounds } from "@/lib/location/evidence-bounds";

/**
 * The place and trip dialogs' map on Apple MapKit JS (UI review, owner 29 Oct 2026): the same Apple map as the
 * iPhone, in its dark style on Midnight, drawing only the visit's area or the trip's route. It reports failure (no
 * token, an authorisation error, the script not loading) so the dialog falls back to the MapLibre map.
 */

const MAPKIT_SCRIPT_URL = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js";
const BOUNDS_PADDING = 48;
/** The narrowest region shown, about a street's length: MapLibre's max zoom 16 in the other map. */
const MIN_SPAN_DEGREES = 0.004;

/* The small part of MapKit JS used here. */
type MkCoordinate = object;
type MkOverlay = object;
type MkStyle = object;
type MkMap = {
  colorScheme: string;
  padding: object;
  addOverlays(overlays: MkOverlay[]): void;
  removeOverlays(overlays: MkOverlay[]): void;
  setRegionAnimated(region: object, animate?: boolean): void;
  destroy(): void;
};
type MapKit = {
  init(options: { authorizationCallback: (done: (token: string) => void) => void }): void;
  addEventListener(type: string, listener: (event: { status?: string }) => void): void;
  removeEventListener(type: string, listener: (event: { status?: string }) => void): void;
  loadedLibraries: string[];
  Map: (new (element: HTMLElement, options: Record<string, unknown>) => MkMap) & {
    ColorSchemes: { Light: string; Dark: string };
  };
  FeatureVisibility: { Hidden: string; Visible: string; Adaptive: string };
  Coordinate: new (latitude: number, longitude: number) => MkCoordinate;
  CoordinateRegion: new (centre: MkCoordinate, span: object) => object;
  CoordinateSpan: new (latitudeDelta: number, longitudeDelta: number) => object;
  Padding: new (top: number, right: number, bottom: number, left: number) => object;
  Style: new (options: Record<string, unknown>) => MkStyle;
  CircleOverlay: new (centre: MkCoordinate, radius: number, options: { style: MkStyle }) => MkOverlay;
  PolylineOverlay: new (points: MkCoordinate[], options: { style: MkStyle }) => MkOverlay;
  PointsOfInterestSearch: new (options: { center: MkCoordinate; radius: number }) => {
    search(callback: (error: unknown, data?: { places?: MkPlace[] }) => void): number;
    cancel?(id: number): boolean;
  };
  Search: new (options: { coordinate?: MkCoordinate; region?: object; includePointsOfInterest?: boolean }) => {
    search(query: string, callback: (error: unknown, data?: { places?: MkPlace[] }) => void): number;
    cancel?(id: number): boolean;
  };
};

/** A place from MapKit JS's searches. */
export type MkPlace = {
  name?: string;
  id?: string;
  formattedAddress?: string;
  coordinate?: { latitude: number; longitude: number };
};

declare global {
  interface Window {
    mapkit?: MapKit;
    __dayframeMapKitReady?: () => void;
  }
}

/** How long a token request, and the MapKit script, may take before MapKit is given up on for the page. */
const TOKEN_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 15_000;

let loading: Promise<MapKit> | null = null;
export type { MapKit };
/**
 * MapKit failed for this page (a token request that failed or stalled, an authorisation error, the script not
 * loading): every map, mounted now or later, falls back to MapLibre (Codex r1 on #633).
 */
let pageFailed = false;
const failureListeners = new Set<() => void>();

function failPage() {
  if (pageFailed) return;
  pageFailed = true;
  for (const listener of [...failureListeners]) listener();
}

/** Test seam: a fresh page. */
export function resetMapKitPage() {
  loading = null;
  pageFailed = false;
  failureListeners.clear();
}

/** Calls `listener` once MapKit has failed for the page (at once if it already has); returns the unsubscribe. */
export function onPageFailure(listener: () => void) {
  if (pageFailed) {
    listener();
    return () => undefined;
  }
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

/** A token for MapKit, or a page failure: a non-2xx answer, a body without a token, a network error or a stall. */
async function fetchToken(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  try {
    const response = await clientFetch("/api/mapkit-token", { signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json() as { token?: unknown };
    return typeof body.token === "string" && body.token ? body.token : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Loads MapKit JS once per page and initialises it with tokens from `/api/mapkit-token`. */
export function loadMapKit(): Promise<MapKit> {
  if (loading) return loading;
  loading = new Promise<MapKit>((resolve, reject) => {
    const ready = () => {
      const mapkit = window.mapkit;
      if (!mapkit) {
        reject(new Error("MapKit JS did not load"));
        return;
      }
      mapkit.init({
        authorizationCallback: (done) => {
          void fetchToken().then((token) => {
            if (token) done(token);
            else failPage();
          });
        }
      });
      // One page-wide owner for MapKit's own errors (an authorisation refused, too many requests), so a failure
      // that lands while no dialog is open still counts for the next one.
      mapkit.addEventListener("error", failPage);
      resolve(mapkit);
    };
    if (window.mapkit?.loadedLibraries?.length) {
      ready();
      return;
    }
    const script = document.createElement("script");
    script.src = MAPKIT_SCRIPT_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.callback = "__dayframeMapKitReady";
    script.dataset.libraries = "map,overlays,services";
    // A script that neither loads nor errors in time is a failure for the page too (Codex r2 on #633).
    const deadline = setTimeout(() => {
      failPage();
      reject(new Error("MapKit JS did not load in time"));
    }, SCRIPT_TIMEOUT_MS);
    window.__dayframeMapKitReady = () => {
      clearTimeout(deadline);
      ready();
    };
    script.onerror = () => {
      clearTimeout(deadline);
      failPage();
      reject(new Error("MapKit JS did not load"));
    };
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** Midnight or Daylight as the page shows it: the shell's choice, else the system's. */
function pageIsDark() {
  const chosen = document.documentElement.getAttribute("data-theme");
  if (chosen === "dark") return true;
  if (chosen === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function MapKitEvidenceMap({
  caption,
  evidence,
  onUnavailable
}: {
  caption: string | null;
  evidence: LocationReviewEvidenceDto;
  /** MapKit couldn't show this map (no token, an authorisation error, the script failing): use the other map. */
  onUnavailable: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const hasGeometry = hasLocationMapGeometry(evidence);
  const contentKey = useMemo(() => JSON.stringify(evidence.map), [evidence.map]);
  const latest = useRef({ evidence, onUnavailable });
  useEffect(() => {
    latest.current = { evidence, onUnavailable };
  });
  const live = useRef<{ mapkit: MapKit; map: MkMap; overlays: MkOverlay[]; key: string } | null>(null);
  const identity = `${evidence.segment.kind}:${evidence.segment.id}`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasGeometry) return undefined;
    let cancelled = false;
    let map: MkMap | null = null;
    let mapkitRef: MapKit | null = null;
    const unsubscribe = onPageFailure(() => {
      if (!cancelled) latest.current.onUnavailable();
    });
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const applyScheme = () => {
      if (map && mapkitRef) map.colorScheme = pageIsDark() ? mapkitRef.Map.ColorSchemes.Dark : mapkitRef.Map.ColorSchemes.Light;
    };
    const themeObserver = new MutationObserver(applyScheme);

    void loadMapKit().then((mapkit) => {
      if (cancelled) return;
      mapkitRef = mapkit;
      map = new mapkit.Map(container, {
        colorScheme: pageIsDark() ? mapkit.Map.ColorSchemes.Dark : mapkit.Map.ColorSchemes.Light,
        isRotationEnabled: false,
        showsCompass: mapkit.FeatureVisibility.Hidden,
        showsMapTypeControl: false,
        showsScale: mapkit.FeatureVisibility.Hidden,
        showsUserLocationControl: false,
        showsZoomControl: true,
        padding: new mapkit.Padding(BOUNDS_PADDING, BOUNDS_PADDING, BOUNDS_PADDING, BOUNDS_PADDING)
      });
      live.current = { mapkit, map, overlays: [], key: "" };
      draw(live.current, latest.current.evidence, false);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      media?.addEventListener("change", applyScheme);
      setReady(true);
    }).catch(() => {
      failPage();
    });

    return () => {
      cancelled = true;
      unsubscribe();
      themeObserver.disconnect();
      media?.removeEventListener("change", applyScheme);
      live.current = null;
      map?.destroy();
    };
  }, [hasGeometry, identity]);

  // New content in the same map (a leg swap, a refresh): its overlays and region change in place.
  useEffect(() => {
    const current = live.current;
    if (!current || current.key === contentKey) return;
    draw(current, evidence, !prefersReducedMotion());
  }, [contentKey, evidence]);

  if (!hasGeometry) {
    // Expired or coordinate-free evidence: the same empty state as the MapLibre map (Codex r1 on #633).
    return (
      <div className="location-evidence">
        <div className="location-evidence-frame">
          <div className="location-evidence-empty" role="status">
            <DayframeIcon glyph="map-pin" size={22} />
            <strong>No map for this one</strong>
            {caption ? <span>{caption}</span> : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="location-evidence">
      <div className="location-evidence-frame">
        <div
          ref={containerRef}
          aria-label={`Map of this ${evidence.segment.kind === "commute" ? "trip" : "visit"}.${caption ? ` ${caption}` : ""}`}
          className="location-evidence-map is-mapkit"
          role="region"
        />
        {ready ? null : (
          <p aria-live="polite" className="location-evidence-provider-state is-loading" role="status">Loading map…</p>
        )}
      </div>
      {caption ? <p className="location-evidence-caption">{caption}</p> : null}
    </div>
  );
}

/** Draws the visit's area or the trip's route and fits it, as the MapLibre map does for the dialogs. */
function draw(current: { mapkit: MapKit; map: MkMap; overlays: MkOverlay[]; key: string }, evidence: LocationReviewEvidenceDto, animate: boolean) {
  const { mapkit, map } = current;
  const tokens = getComputedStyle(document.documentElement);
  const colour = (name: string) => tokens.getPropertyValue(name).trim();
  const coordinate = ([longitude, latitude]: [number, number] | number[]) => new mapkit.Coordinate(latitude, longitude);
  const overlays: MkOverlay[] = [];
  if (evidence.map.route?.coordinates.length) {
    overlays.push(new mapkit.PolylineOverlay(evidence.map.route.coordinates.map(coordinate), {
      style: new mapkit.Style({ strokeColor: colour("--accent"), strokeOpacity: 0.9, lineWidth: 4, lineJoin: "round", lineCap: "round" })
    }));
  }
  if (evidence.map.straightLineFallback?.coordinates.length) {
    overlays.push(new mapkit.PolylineOverlay(evidence.map.straightLineFallback.coordinates.map(coordinate), {
      style: new mapkit.Style({ strokeColor: colour("--warning"), strokeOpacity: 0.8, lineWidth: 3, lineDash: [6, 6] })
    }));
  }
  if (evidence.map.centre && evidence.map.stayRadiusMeters) {
    overlays.push(new mapkit.CircleOverlay(coordinate(evidence.map.centre.coordinates), evidence.map.stayRadiusMeters, {
      style: new mapkit.Style({ strokeColor: colour("--accent"), lineWidth: 2, fillColor: colour("--accent"), fillOpacity: 0.18 })
    }));
  }
  if (current.overlays.length) map.removeOverlays(current.overlays);
  map.addOverlays(overlays);
  current.overlays = overlays;
  current.key = JSON.stringify(evidence.map);
  const bounds = evidenceBounds(evidence, true);
  if (!bounds) return;
  const [[west, south], [east, north]] = bounds;
  const centre = new mapkit.Coordinate((north + south) / 2, (east + west) / 2);
  const span = new mapkit.CoordinateSpan(Math.max(north - south, MIN_SPAN_DEGREES) * 1.1, Math.max(east - west, MIN_SPAN_DEGREES) * 1.1);
  map.setRegionAnimated(new mapkit.CoordinateRegion(centre, span), animate);
}
