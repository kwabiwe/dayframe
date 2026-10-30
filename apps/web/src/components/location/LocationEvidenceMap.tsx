"use client";

import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type StyleSpecification
} from "maplibre-gl";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";
import { prefersReducedMotion } from "@/lib/blocks-motion";
import { clientFetch } from "@/lib/client-auth-fetch";
import { evidenceBounds } from "@/lib/location/evidence-bounds";
export { evidenceBounds } from "@/lib/location/evidence-bounds";
import {
  hasLocationMapGeometry,
  locationEvidenceCaption,
  locationEvidenceMapMode,
  locationEvidenceModeLabel
} from "@/lib/location/location-evidence-presentation";

/**
 * The base map's state. "degraded" is the soft note for a style that failed or most of the first view's tiles
 * failing; an isolated tile error is ignored (MapLibre asks for it again on the next move).
 */
type BaseMapState = "loading" | "ready" | "unavailable" | "degraded";

const PROVIDER_STATE_CLASS: Record<BaseMapState, string> = {
  loading: "is-loading",
  ready: "is-ready",
  unavailable: "is-unavailable",
  degraded: "is-degraded"
};

const BOUNDS_PADDING = 48;
const BOUNDS_MAX_ZOOM = 16;
/** The first load's window for counting tile failures, if MapLibre's `load` never comes. */
const FIRST_LOAD_WINDOW_MS = 10_000;
/** After the style loads, tiles still pending this long stop holding the verdict (Codex r5 on #626). */
const FIRST_LOAD_SETTLE_CAP_MS = 20_000;
/** A bounds change in place (a leg swap, new evidence): the brand guide's panel range, ease-out (motion.md). */
const BOUNDS_EASE_MS = 300;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

type EvidenceColours = {
  accent: string;
  accentSoft: string;
  danger: string;
  surfaceRaised: string;
  warning: string;
};

/** The evidence layers' own sources: errors on them are never base-map tile errors. */
const EVIDENCE_SOURCE_IDS = new Set(["route", "straight-line-fallback", "samples", "rejected-samples", "stay-radius", "gaps"]);

export function LocationEvidenceMap({
  caption: sheetCaption,
  evidence,
  onSelectPoint,
  visitOnly = false
}: {
  /**
   * The place and trip dialogs' one line in place of the evidence caption (owner feedback, 29 Oct 2026):
   * `evidenceSheetCaption`, null for none.
   */
  caption?: string | null;
  evidence: LocationReviewEvidenceDto;
  onSelectPoint?: (point: { latitude: number; longitude: number }) => void;
  /** Only the visit's own area or the trip's route: no saved places, anchors, rejected samples, gaps or mode label. */
  visitOnly?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mode = locationEvidenceMapMode(evidence);
  const hasGeometry = hasLocationMapGeometry(evidence);
  const caption = sheetCaption !== undefined ? sheetCaption : locationEvidenceCaption(evidence, mode);
  const [baseMapState, setBaseMapState] = useState<BaseMapState>(
    hasGeometry ? "loading" : "unavailable"
  );
  // One MapLibre instance per mount and item (glitch fix 1): a re-render with the same content changes nothing,
  // and new content (or a trip's leg) is drawn into the same map in place.
  const identity = `${evidence.segment.kind}:${evidence.segment.id}`;
  const contentKey = useMemo(() => evidenceContentKey(evidence, visitOnly), [evidence, visitOnly]);
  const latest = useRef({ evidence, visitOnly, contentKey, onSelectPoint });
  useEffect(() => {
    latest.current = { evidence, visitOnly, contentKey, onSelectPoint };
  });
  /** What the map draws now: its content key, colours and markers; null until its style has loaded. */
  const drawn = useRef<{ key: string; colours: EvidenceColours; markers: maplibregl.Marker[] } | null>(null);

  useEffect(() => {
    if (!containerRef.current || !hasGeometry) return undefined;
    const container = containerRef.current;
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let windowTimer: ReturnType<typeof setTimeout> | null = null;
    let settleCapTimer: ReturnType<typeof setTimeout> | null = null;

    async function initialize() {
      const computedStyle = getComputedStyle(container);
      const token = (name: string) => computedStyle.getPropertyValue(name).trim();
      const surfaceInset = token("--surface-inset");
      const colours: EvidenceColours = {
        accent: token("--accent"),
        accentSoft: token("--accent-soft"),
        danger: token("--danger"),
        surfaceRaised: token("--surface-raised"),
        warning: token("--warning")
      };
      const customStyleUrl = process.env.NEXT_PUBLIC_DAYFRAME_MAP_STYLE_URL?.trim();
      const baseMap = await resolveBaseMapStyle(customStyleUrl, surfaceInset);
      if (cancelled) return;
      setBaseMapState(baseMap.available ? "loading" : "unavailable");

      const { evidence: firstEvidence, visitOnly: firstVisitOnly } = latest.current;
      // The first tiles load at the fitted view (glitch fix 2): no centre-and-zoom-15 first, then a jump.
      const bounds = evidenceBounds(firstEvidence, firstVisitOnly);
      let firstLoadWindowOpen = true;
      map = new maplibregl.Map({
        container,
        ...(bounds
          ? { bounds, fitBoundsOptions: { padding: BOUNDS_PADDING, maxZoom: BOUNDS_MAX_ZOOM } }
          : { center: fallbackCentre(firstEvidence), zoom: 11 }),
        attributionControl: baseMap.available ? { compact: true } : false,
        style: baseMap.style,
        transformRequest: (url) => {
          return {
            url,
            ...(url.startsWith(window.location.origin) ? { credentials: "same-origin" as const } : {})
          };
        }
      });
      const created = map;
      mapRef.current = created;
      created.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      // Glitch fix 4: one bad tile is not a broken map. Only most of the first view's tiles failing is. Each tile
      // MapLibre starts loading inside the first load window (until its `load`, or 10 s) is admitted by its source
      // and tile id and settled once, by its own success or failure; the verdict comes only when the window has
      // closed and every admitted tile has settled, and "ready" needs the style loaded (Codex r3, r4 on #626).
      let styleFailed = !baseMap.available;
      let sourceFailed = false;
      let styleLoaded = false;
      let decided = false;
      const admitted = new Map<string, "pending" | "loaded" | "failed">();
      const decide = () => {
        if (decided || cancelled || styleFailed || sourceFailed || !styleLoaded || firstLoadWindowOpen) return;
        const outcomes = [...admitted.values()];
        if (outcomes.includes("pending")) return;
        decided = true;
        const failed = outcomes.filter((outcome) => outcome === "failed").length;
        setBaseMapState(failed * 2 > outcomes.length ? "degraded" : "ready");
      };
      const settle = (event: unknown, outcome: "loaded" | "failed") => {
        const key = baseTileKey(event);
        if (!key || admitted.get(key) !== "pending") return;
        admitted.set(key, outcome);
        decide();
      };
      const closeFirstLoadWindow = () => {
        if (!firstLoadWindowOpen) return;
        firstLoadWindowOpen = false;
        if (windowTimer) clearTimeout(windowTimer);
        windowTimer = null;
        decide();
      };
      // The window's 10 s run from the style loading: no tile is asked for before it, so a slow style never
      // closes the window empty.
      // A safety cap so the verdict can never hang: 20 s after the style loads, the window is closed and any tile
      // still pending is dropped from the count, neither failure nor success.
      const startFirstLoadWindowTimer = () => {
        if (settleCapTimer) return;
        settleCapTimer = setTimeout(() => {
          for (const [key, outcome] of admitted) if (outcome === "pending") admitted.delete(key);
          closeFirstLoadWindow();
          decide();
        }, FIRST_LOAD_SETTLE_CAP_MS);
        if (windowTimer || !firstLoadWindowOpen) return;
        windowTimer = setTimeout(closeFirstLoadWindow, FIRST_LOAD_WINDOW_MS);
      };
      // The evidence is drawn as soon as the style is there, not after the tiles, from the newest content: a leg
      // opened before the style loaded is drawn and fitted at once (Codex r1 on #626).
      const drawFirst = () => {
        if (cancelled || drawn.current) return;
        const current = latest.current;
        drawn.current = { key: current.contentKey, colours, markers: [] };
        drawEvidence(created, current.evidence, current.visitOnly, colours, drawn.current.markers);
        const newest = evidenceBounds(current.evidence, current.visitOnly);
        if (newest && !sameBounds(newest, bounds)) {
          created.fitBounds(newest, { padding: BOUNDS_PADDING, maxZoom: BOUNDS_MAX_ZOOM, duration: 0, animate: false });
        }
      };
      // A style that fails (an error with no tile or source, as a custom style URL that can't load gives) is the
      // base map unavailable: the soft note, and the evidence on a blank style, never "ready" with nothing drawn
      // (Codex r1 on #626).
      const failStyle = () => {
        if (styleFailed || cancelled) return;
        styleFailed = true;
        setBaseMapState("unavailable");
        for (const marker of drawn.current?.markers ?? []) marker.remove();
        drawn.current = null;
        created.setStyle(tileFreeStyle(surfaceInset), { diff: false });
      };
      created.on("error", (event) => {
        const detail = event as unknown as { sourceId?: string; tile?: unknown };
        if (!detail.tile && !detail.sourceId) {
          failStyle();
          return;
        }
        if (detail.sourceId && EVIDENCE_SOURCE_IDS.has(detail.sourceId)) return;
        // A base source's own failure (its TileJSON or metadata, no tile): the background is unavailable, apart
        // from tile errors, and the first load can't make it "ready" (Codex r2 on #626).
        if (!detail.tile) {
          if (!sourceFailed && !styleFailed && !cancelled) setBaseMapState("unavailable");
          sourceFailed = true;
          return;
        }
        settle(event, "failed");
      });
      created.on("sourcedataloading", (event) => {
        const key = baseTileKey(event);
        if (key && firstLoadWindowOpen && !admitted.has(key)) admitted.set(key, "pending");
      });
      created.on("sourcedata", (event) => settle(event, "loaded"));
      // A tile cancelled by a pan, zoom or leg switch never settles: it leaves the count (Codex r5 on #626).
      created.on("sourcedataabort", (event) => {
        const key = baseTileKey(event);
        if (!key || admitted.get(key) !== "pending") return;
        admitted.delete(key);
        decide();
      });
      created.on("load", closeFirstLoadWindow);
      created.on("style.load", () => {
        styleLoaded = true;
        startFirstLoadWindowTimer();
        drawFirst();
        decide();
      });
      if (created.isStyleLoaded?.()) {
        styleLoaded = true;
        startFirstLoadWindowTimer();
        drawFirst();
      }
      created.on("click", (event) => latest.current.onSelectPoint?.({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng
      }));
    }

    void initialize().catch(() => {
      if (!cancelled) setBaseMapState("unavailable");
    });
    return () => {
      cancelled = true;
      if (windowTimer) clearTimeout(windowTimer);
      if (settleCapTimer) clearTimeout(settleCapTimer);
      mapRef.current = null;
      drawn.current = null;
      map?.remove();
    };
  }, [hasGeometry, identity]);

  // New content in the same map (a leg swap, a refresh): its sources' data and fitted bounds change in place.
  useEffect(() => {
    const map = mapRef.current;
    const current = drawn.current;
    if (!map || !current || current.key === contentKey) return;
    current.key = contentKey;
    drawEvidence(map, evidence, visitOnly, current.colours, current.markers);
    const bounds = evidenceBounds(evidence, visitOnly);
    if (bounds) {
      const reduceMotion = prefersReducedMotion();
      map.fitBounds(bounds, {
        padding: BOUNDS_PADDING,
        maxZoom: BOUNDS_MAX_ZOOM,
        duration: reduceMotion ? 0 : BOUNDS_EASE_MS,
        easing: easeOutCubic,
        animate: !reduceMotion
      });
    }
  }, [contentKey, evidence, visitOnly]);

  return (
    <div className="location-evidence">
      <div className="location-evidence-frame">
        {hasGeometry ? (
          <div
            ref={containerRef}
            aria-label={visitOnly ? `Map of this ${evidence.segment.kind === "commute" ? "trip" : "visit"}.${caption ? ` ${caption}` : ""}`
              : `Location evidence map. ${caption}`}
            className="location-evidence-map"
            role="region"
          />
        ) : (
          <div className="location-evidence-empty" role="status">
            <DayframeIcon glyph="map-pin" size={22}/>
            <strong>{visitOnly ? "No map for this one" : "No mapped evidence"}</strong>
            {caption ? <span>{caption}</span> : null}
          </div>
        )}
        {hasGeometry && !visitOnly ? (
          <span className="location-evidence-mode">{locationEvidenceModeLabel(mode)}</span>
        ) : null}
        {hasGeometry && baseMapState !== "ready" ? (
          <p
            aria-live="polite"
            className={`location-evidence-provider-state ${PROVIDER_STATE_CLASS[baseMapState]}`}
            role="status"
          >
            {baseMapState === "loading"
              ? "Loading map…"
              : baseMapState === "degraded"
                ? "Some of the map didn’t load."
                : "Map unavailable"}
          </p>
        ) : null}
      </div>
      {hasGeometry && caption ? <p className="location-evidence-caption">{caption}</p> : null}
      {!visitOnly && evidence.map.rejectedSamples.length ? (
        <p className="location-evidence-rejected">
          {evidence.map.rejectedSamples.length} noisy or invalid sample{evidence.map.rejectedSamples.length === 1 ? "" : "s"} excluded from the derived boundary.
        </p>
      ) : null}
    </div>
  );
}

/** A cheap content key: what the map draws and fits, so equal content in a new object changes nothing. */
function evidenceContentKey(evidence: LocationReviewEvidenceDto, visitOnly: boolean) {
  return JSON.stringify([visitOnly, evidence.map]);
}

/**
 * The base map's style, fetched once per page session (glitch fix 1): every dialog after the first opens with it
 * at once. A failure is not kept, so the next map asks again.
 */
let cachedBaseMapStyle: Promise<StyleSpecification | null> | null = null;

/** Tests only: forget the session's style. */
export function resetLocationMapStyleCache() {
  cachedBaseMapStyle = null;
}

async function resolveBaseMapStyle(
  customStyleUrl: string | undefined,
  surfaceInset: string
): Promise<{ style: StyleSpecification | string; available: boolean }> {
  if (customStyleUrl) return { style: customStyleUrl, available: true };
  const request = cachedBaseMapStyle ?? (cachedBaseMapStyle = clientFetch("/api/map-style", { cache: "no-store" })
    .then(async (response) => response.ok ? await response.json() as StyleSpecification : null)
    .catch(() => null));
  const style = await request;
  if (!style) {
    if (cachedBaseMapStyle === request) cachedBaseMapStyle = null;
    return { style: tileFreeStyle(surfaceInset), available: false };
  }
  // Each map gets its own copy: MapLibre may annotate the style it is given.
  return { style: structuredClone(style), available: true };
}

function tileFreeStyle(surfaceInset: string): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{
      id: "canvas",
      type: "background",
      paint: { "background-color": surfaceInset }
    }]
  };
}

/**
 * Draws the evidence, or redraws it in place: each source's data is set when it exists, added with its layer when
 * it is first needed, and emptied when it no longer applies; the markers are made again.
 */
function drawEvidence(
  map: MapLibreMap,
  evidence: LocationReviewEvidenceDto,
  visitOnly: boolean,
  colours: EvidenceColours,
  markers: maplibregl.Marker[]
) {
  upsertGeoJson(map, "route", evidence.map.route ?? emptyLine(), [{
    id: "route-line",
    type: "line",
    paint: { "line-color": colours.accent, "line-width": 4, "line-opacity": 0.9 }
  }]);
  upsertGeoJson(map, "straight-line-fallback", evidence.map.straightLineFallback ?? emptyLine(), [{
    id: "straight-line-fallback-line",
    type: "line",
    paint: { "line-color": colours.warning, "line-width": 3, "line-dasharray": [2, 2], "line-opacity": 0.8 }
  }]);
  // The sheets' map shows only the visit's area or the trip's route, never its readings (Codex r3 on #620).
  upsertGeoJson(map, "samples", visitOnly ? null : {
    type: "FeatureCollection",
    features: evidence.map.acceptedSamples.map((sample) => ({
      type: "Feature",
      properties: { accuracyMeters: sample.accuracyMeters ?? 0 },
      geometry: sample.point
    }))
  }, [{
    id: "sample-points",
    type: "circle",
    paint: {
      "circle-color": colours.accent,
      "circle-opacity": 0.55,
      "circle-radius": ["interpolate", ["linear"], ["get", "accuracyMeters"], 0, 4, 100, 14],
      "circle-stroke-color": colours.surfaceRaised,
      "circle-stroke-width": 1
    }
  }]);
  upsertGeoJson(map, "rejected-samples", visitOnly ? null : {
    type: "FeatureCollection",
    features: evidence.map.rejectedSamples.flatMap((sample) => sample.point
      ? [{ type: "Feature" as const, properties: {}, geometry: sample.point }]
      : [])
  }, [{
    id: "rejected-sample-points",
    type: "circle",
    paint: {
      "circle-color": colours.danger,
      "circle-opacity": 0.25,
      "circle-radius": 8,
      "circle-stroke-color": colours.danger,
      "circle-stroke-width": 2
    }
  }]);
  upsertGeoJson(map, "stay-radius", evidence.map.centre && evidence.map.stayRadiusMeters
    ? circleFeature(evidence.map.centre.coordinates, evidence.map.stayRadiusMeters) : null, [{
    id: "stay-radius-fill",
    type: "fill",
    paint: { "fill-color": colours.accentSoft, "fill-opacity": 0.55 }
  }, {
    id: "stay-radius-line",
    type: "line",
    paint: { "line-color": colours.accent, "line-width": 2 }
  }]);
  upsertGeoJson(map, "gaps", !visitOnly && evidence.map.gaps.length ? {
    type: "FeatureCollection",
    features: evidence.map.gaps.flatMap((gap) => gap.fromPoint && gap.toPoint
      ? [{
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "LineString" as const,
            coordinates: [gap.fromPoint.coordinates, gap.toPoint.coordinates]
          }
        }]
      : [])
  } : null, [{
    id: "gap-lines",
    type: "line",
    paint: { "line-color": colours.warning, "line-width": 3, "line-dasharray": [2, 2] }
  }]);
  for (const marker of markers.splice(0)) marker.remove();
  for (const place of visitOnly ? [] : evidence.map.nearbySavedPlaces) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "flex h-11 w-11 items-center justify-center rounded-full border-0 bg-transparent";
    marker.ariaLabel = `${place.name}, ${place.distanceMeters} metres from the detected centre`;
    const markerDot = document.createElement("span");
    markerDot.className = "block h-5 w-5 rounded-full border-2 border-white bg-[var(--accent)] shadow-lg";
    marker.append(markerDot);
    markers.push(new maplibregl.Marker({ element: marker })
      .setLngLat(place.point.coordinates)
      .setPopup(new maplibregl.Popup({ offset: 12 }).setText(`${place.name} · ${place.distanceMeters} m`))
      .addTo(map));
  }
  for (const anchor of visitOnly ? [] : evidence.map.anchors) {
    if (!anchor.point) continue;
    const marker = document.createElement("div");
    marker.className = "h-3 w-3 rounded-full border-2 border-white bg-[var(--warning)] shadow-lg";
    marker.ariaLabel = anchor.label;
    marker.setAttribute("role", "img");
    markers.push(new maplibregl.Marker({ element: marker })
      .setLngLat(anchor.point.coordinates)
      .setPopup(new maplibregl.Popup({ offset: 10 }).setText(anchor.label))
      .addTo(map));
  }
}

/** A base-map tile's identity in a MapLibre event: its source and canonical z/x/y; null for anything else. */
function baseTileKey(event: unknown) {
  const detail = event as { sourceId?: string; tile?: { tileID?: { canonical?: { x: number; y: number; z: number } } } };
  const canonical = detail.tile?.tileID?.canonical;
  if (!detail.sourceId || EVIDENCE_SOURCE_IDS.has(detail.sourceId) || !canonical) return null;
  return `${detail.sourceId}/${canonical.z}/${canonical.x}/${canonical.y}`;
}

function sameBounds(left: [[number, number], [number, number]], right: [[number, number], [number, number]] | null) {
  return Boolean(right) && left.every((corner, index) => corner.every((value, axis) => value === right![index][axis]));
}

function fallbackCentre(evidence: LocationReviewEvidenceDto): [number, number] {
  return evidence.map.anchors.find((anchor) => anchor.point)?.point?.coordinates ??
    evidence.map.nearbySavedPlaces[0]?.point.coordinates ??
    [-0.1278, 51.5074];
}

/** A source and its layers: data set in place when it exists, added when first needed; null empties it. */
function upsertGeoJson(
  map: MapLibreMap,
  sourceId: string,
  data: GeoJSON.GeoJSON | null,
  layers: Array<Omit<maplibregl.LayerSpecification, "source">>
) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (source) {
    source.setData(data ?? emptyLine());
    return;
  }
  if (!data) return;
  map.addSource(sourceId, { type: "geojson", data });
  for (const layer of layers) map.addLayer({ ...layer, source: sourceId } as maplibregl.LayerSpecification);
}

function emptyLine(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function circleFeature(centre: [number, number], radiusMeters: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const coordinates: [number, number][] = [];
  const latitudeRadians = centre[1] * Math.PI / 180;
  for (let index = 0; index <= 64; index += 1) {
    const angle = index / 64 * Math.PI * 2;
    const latitudeOffset = radiusMeters * Math.sin(angle) / 111_320;
    const longitudeOffset = radiusMeters * Math.cos(angle) / (111_320 * Math.cos(latitudeRadians));
    coordinates.push([centre[0] + longitudeOffset, centre[1] + latitudeOffset]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coordinates] } };
}
