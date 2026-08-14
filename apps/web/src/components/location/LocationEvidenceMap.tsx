"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinned } from "lucide-react";
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type StyleSpecification
} from "maplibre-gl";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";
import { clientFetch } from "@/lib/client-auth-fetch";
import {
  hasLocationMapGeometry,
  locationEvidenceCaption,
  locationEvidenceMapMode,
  locationEvidenceModeLabel
} from "@/lib/location/location-evidence-presentation";

type BaseMapState = "loading" | "ready" | "unavailable" | "error";

export function LocationEvidenceMap({
  evidence,
  onSelectPoint
}: {
  evidence: LocationReviewEvidenceDto;
  onSelectPoint?: (point: { latitude: number; longitude: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mode = locationEvidenceMapMode(evidence);
  const hasGeometry = hasLocationMapGeometry(evidence);
  const caption = locationEvidenceCaption(evidence, mode);
  const [baseMapState, setBaseMapState] = useState<BaseMapState>(
    hasGeometry ? "loading" : "unavailable"
  );

  useEffect(() => {
    if (!containerRef.current || !hasGeometry) return undefined;
    const container = containerRef.current;
    const abortController = new AbortController();
    let cancelled = false;
    let map: MapLibreMap | null = null;

    async function initialize() {
      const computedStyle = getComputedStyle(container);
      const token = (name: string) => computedStyle.getPropertyValue(name).trim();
      const surfaceInset = token("--surface-inset");
      const surfaceRaised = token("--surface-raised");
      const accent = token("--accent");
      const accentSoft = token("--accent-soft");
      const warning = token("--warning");
      const danger = token("--danger");
      const customStyleUrl = process.env.NEXT_PUBLIC_DAYFRAME_MAP_STYLE_URL?.trim();
      const baseMap = await resolveBaseMapStyle(customStyleUrl, surfaceInset, abortController.signal);
      if (cancelled) return;
      setBaseMapState(baseMap.available ? "loading" : "unavailable");

      const points = evidence.map.acceptedSamples.map((sample) => sample.point.coordinates);
      const centre = evidence.map.centre?.coordinates ??
        points[0] ??
        evidence.map.straightLineFallback?.coordinates[0] ??
        evidence.map.nearbySavedPlaces[0]?.point.coordinates ??
        [-0.1278, 51.5074];
      map = new maplibregl.Map({
        container,
        center: centre,
        zoom: points.length ? 15 : 11,
        attributionControl: baseMap.available ? { compact: true } : false,
        style: baseMap.style,
        transformRequest: (url) => ({
          url,
          ...(url.startsWith(window.location.origin) ? { credentials: "same-origin" as const } : {})
        })
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("error", () => {
        if (!cancelled && baseMap.available) setBaseMapState("error");
      });
      map.on("load", () => {
        if (cancelled || !map) return;
        if (baseMap.available) setBaseMapState("ready");
        addEvidenceLayers(map, evidence, {
          accent,
          accentSoft,
          danger,
          surfaceRaised,
          warning
        });
        fitEvidenceBounds(map, evidence, points);
      });
      if (onSelectPoint) {
        map.on("click", (event) => onSelectPoint({
          latitude: event.lngLat.lat,
          longitude: event.lngLat.lng
        }));
      }
    }

    void initialize().catch(() => {
      if (!cancelled && !abortController.signal.aborted) setBaseMapState("error");
    });
    return () => {
      cancelled = true;
      abortController.abort();
      mapRef.current = null;
      map?.remove();
    };
  }, [evidence, hasGeometry, onSelectPoint]);

  return (
    <div className="location-evidence">
      <div className="location-evidence-frame">
        {hasGeometry ? (
          <div
            ref={containerRef}
            aria-label={`Location evidence map. ${caption}`}
            className="location-evidence-map"
            role="region"
          />
        ) : (
          <div className="location-evidence-empty" role="status">
            <MapPinned aria-hidden="true" size={22} />
            <strong>No mapped evidence</strong>
            <span>{caption}</span>
          </div>
        )}
        {hasGeometry ? (
          <span className="location-evidence-mode">{locationEvidenceModeLabel(mode)}</span>
        ) : null}
        {hasGeometry && baseMapState !== "ready" ? (
          <p
            aria-live="polite"
            className={`location-evidence-provider-state is-${baseMapState}`}
            role="status"
          >
            {baseMapState === "loading"
              ? "Loading map background…"
              : baseMapState === "error"
                ? "Map background could not load. Evidence remains visible."
                : "Map background is unavailable. Evidence remains visible."}
          </p>
        ) : null}
      </div>
      {hasGeometry ? <p className="location-evidence-caption">{caption}</p> : null}
      {evidence.map.rejectedSamples.length ? (
        <p className="location-evidence-rejected">
          {evidence.map.rejectedSamples.length} noisy or invalid sample{evidence.map.rejectedSamples.length === 1 ? "" : "s"} excluded from the derived boundary.
        </p>
      ) : null}
    </div>
  );
}

async function resolveBaseMapStyle(
  customStyleUrl: string | undefined,
  surfaceInset: string,
  signal: AbortSignal
): Promise<{ style: StyleSpecification | string; available: boolean }> {
  if (customStyleUrl) return { style: customStyleUrl, available: true };
  try {
    const response = await clientFetch("/api/map-style", { cache: "no-store", signal });
    if (!response.ok) return { style: tileFreeStyle(surfaceInset), available: false };
    return { style: await response.json() as StyleSpecification, available: true };
  } catch (error) {
    if (signal.aborted) throw error;
    return { style: tileFreeStyle(surfaceInset), available: false };
  }
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

function addEvidenceLayers(
  map: MapLibreMap,
  evidence: LocationReviewEvidenceDto,
  colours: {
    accent: string;
    accentSoft: string;
    danger: string;
    surfaceRaised: string;
    warning: string;
  }
) {
  addGeoJson(map, "route", evidence.map.route ?? emptyLine(), {
    id: "route-line",
    type: "line",
    paint: { "line-color": colours.accent, "line-width": 4, "line-opacity": 0.9 }
  });
  addGeoJson(map, "straight-line-fallback", evidence.map.straightLineFallback ?? emptyLine(), {
    id: "straight-line-fallback-line",
    type: "line",
    paint: { "line-color": colours.warning, "line-width": 3, "line-dasharray": [2, 2], "line-opacity": 0.8 }
  });
  addGeoJson(map, "samples", {
    type: "FeatureCollection",
    features: evidence.map.acceptedSamples.map((sample) => ({
      type: "Feature",
      properties: { accuracyMeters: sample.accuracyMeters ?? 0 },
      geometry: sample.point
    }))
  }, {
    id: "sample-points",
    type: "circle",
    paint: {
      "circle-color": colours.accent,
      "circle-opacity": 0.55,
      "circle-radius": ["interpolate", ["linear"], ["get", "accuracyMeters"], 0, 4, 100, 14],
      "circle-stroke-color": colours.surfaceRaised,
      "circle-stroke-width": 1
    }
  });
  addGeoJson(map, "rejected-samples", {
    type: "FeatureCollection",
    features: evidence.map.rejectedSamples.flatMap((sample) => sample.point
      ? [{ type: "Feature" as const, properties: {}, geometry: sample.point }]
      : [])
  }, {
    id: "rejected-sample-points",
    type: "circle",
    paint: {
      "circle-color": colours.danger,
      "circle-opacity": 0.25,
      "circle-radius": 8,
      "circle-stroke-color": colours.danger,
      "circle-stroke-width": 2
    }
  });
  if (evidence.map.centre && evidence.map.stayRadiusMeters) {
    addGeoJson(map, "stay-radius", circleFeature(evidence.map.centre.coordinates, evidence.map.stayRadiusMeters), {
      id: "stay-radius-fill",
      type: "fill",
      paint: { "fill-color": colours.accentSoft, "fill-opacity": 0.55 }
    });
    map.addLayer({
      id: "stay-radius-line",
      source: "stay-radius",
      type: "line",
      paint: { "line-color": colours.accent, "line-width": 2 }
    });
  }
  if (evidence.map.gaps.length) {
    addGeoJson(map, "gaps", {
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
    }, {
      id: "gap-lines",
      type: "line",
      paint: { "line-color": colours.warning, "line-width": 3, "line-dasharray": [2, 2] }
    });
  }
  for (const place of evidence.map.nearbySavedPlaces) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "flex h-11 w-11 items-center justify-center rounded-full border-0 bg-transparent";
    marker.ariaLabel = `${place.name}, ${place.distanceMeters} metres from the detected centre`;
    const markerDot = document.createElement("span");
    markerDot.className = "block h-5 w-5 rounded-full border-2 border-white bg-[var(--accent)] shadow-lg";
    marker.append(markerDot);
    new maplibregl.Marker({ element: marker })
      .setLngLat(place.point.coordinates)
      .setPopup(new maplibregl.Popup({ offset: 12 }).setText(`${place.name} · ${place.distanceMeters} m`))
      .addTo(map);
  }
  for (const anchor of evidence.map.anchors) {
    if (!anchor.point) continue;
    const marker = document.createElement("div");
    marker.className = "h-3 w-3 rounded-full border-2 border-white bg-[var(--warning)] shadow-lg";
    marker.ariaLabel = anchor.label;
    marker.setAttribute("role", "img");
    new maplibregl.Marker({ element: marker })
      .setLngLat(anchor.point.coordinates)
      .setPopup(new maplibregl.Popup({ offset: 10 }).setText(anchor.label))
      .addTo(map);
  }
}

function fitEvidenceBounds(
  map: MapLibreMap,
  evidence: LocationReviewEvidenceDto,
  points: [number, number][]
) {
  const bounds = new maplibregl.LngLatBounds();
  for (const coordinate of [
    ...points,
    ...evidence.map.nearbySavedPlaces.map((place) => place.point.coordinates),
    ...evidence.map.rejectedSamples.flatMap((sample) => sample.point ? [sample.point.coordinates] : []),
    ...(evidence.map.route?.coordinates ?? []),
    ...(evidence.map.straightLineFallback?.coordinates ?? []),
    ...(evidence.map.centre ? [evidence.map.centre.coordinates] : [])
  ]) bounds.extend(coordinate);
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
}

function addGeoJson(
  map: MapLibreMap,
  sourceId: string,
  data: GeoJSON.GeoJSON,
  layer: Omit<maplibregl.LayerSpecification, "source">
) {
  map.addSource(sourceId, { type: "geojson", data });
  map.addLayer({ ...layer, source: sourceId } as maplibregl.LayerSpecification);
  void (map.getSource(sourceId) as GeoJSONSource | undefined);
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
