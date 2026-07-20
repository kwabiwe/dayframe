"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";

export function LocationEvidenceMap({
  evidence,
  onSelectPoint
}: {
  evidence: LocationReviewEvidenceDto;
  onSelectPoint?: (point: { latitude: number; longitude: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const computedStyle = getComputedStyle(containerRef.current);
    const token = (name: string) => computedStyle.getPropertyValue(name).trim();
    const surfaceInset = token("--surface-inset");
    const surfaceRaised = token("--surface-raised");
    const accent = token("--accent");
    const accentSoft = token("--accent-soft");
    const warning = token("--warning");
    const danger = token("--danger");
    const styleUrl = process.env.NEXT_PUBLIC_DAYFRAME_MAP_STYLE_URL?.trim();
    const points = evidence.map.acceptedSamples.map((sample) => sample.point.coordinates);
    const centre = evidence.map.centre?.coordinates ?? points[0] ?? [-0.1278, 51.5074];
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: centre,
      zoom: points.length ? 15 : 11,
      attributionControl: styleUrl ? { compact: true } : false,
      style: styleUrl || {
        version: 8,
        sources: {},
        layers: [{
          id: "canvas",
          type: "background",
          paint: { "background-color": surfaceInset }
        }]
      }
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      addGeoJson(map, "route", evidence.map.route ?? emptyLine(), {
        id: "route-line",
        type: "line",
        paint: { "line-color": accent, "line-width": 4, "line-opacity": 0.9 }
      });
      addGeoJson(map, "straight-line-fallback", evidence.map.straightLineFallback ?? emptyLine(), {
        id: "straight-line-fallback-line",
        type: "line",
        paint: { "line-color": warning, "line-width": 3, "line-dasharray": [2, 2], "line-opacity": 0.8 }
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
          "circle-color": accent,
          "circle-opacity": 0.55,
          "circle-radius": ["interpolate", ["linear"], ["get", "accuracyMeters"], 0, 4, 100, 14],
          "circle-stroke-color": surfaceRaised,
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
          "circle-color": danger,
          "circle-opacity": 0.25,
          "circle-radius": 8,
          "circle-stroke-color": danger,
          "circle-stroke-width": 2
        }
      });
      if (evidence.map.centre && evidence.map.stayRadiusMeters) {
        addGeoJson(map, "stay-radius", circleFeature(evidence.map.centre.coordinates, evidence.map.stayRadiusMeters), {
          id: "stay-radius-fill",
          type: "fill",
          paint: { "fill-color": accentSoft, "fill-opacity": 0.55 }
        });
        map.addLayer({
          id: "stay-radius-line",
          source: "stay-radius",
          type: "line",
          paint: { "line-color": accent, "line-width": 2 }
        });
      }
      if (evidence.map.gaps.length) {
        addGeoJson(map, "gaps", {
          type: "FeatureCollection",
          features: evidence.map.gaps.flatMap((gap) =>
            gap.fromPoint && gap.toPoint
              ? [{ type: "Feature" as const, properties: {}, geometry: {
                  type: "LineString" as const,
                  coordinates: [gap.fromPoint.coordinates, gap.toPoint.coordinates]
                }}]
              : []
          )
        }, {
          id: "gap-lines",
          type: "line",
          paint: { "line-color": warning, "line-width": 3, "line-dasharray": [2, 2] }
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
      const bounds = new maplibregl.LngLatBounds();
      for (const coordinate of [
        ...points,
        ...evidence.map.nearbySavedPlaces.map((place) => place.point.coordinates),
        ...evidence.map.rejectedSamples.flatMap((sample) => sample.point ? [sample.point.coordinates] : []),
        ...(evidence.map.straightLineFallback?.coordinates ?? []),
        ...(evidence.map.centre ? [evidence.map.centre.coordinates] : [])
      ]) bounds.extend(coordinate);
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
    });
    if (onSelectPoint) {
      map.on("click", (event) => onSelectPoint({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }));
    }
    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, [evidence, onSelectPoint]);

  return (
    <div>
      <div
        ref={containerRef}
        aria-label={`Location evidence map. ${evidence.textualSummary}`}
        className="location-evidence-map h-72 w-full overflow-hidden rounded-2xl bg-[var(--surface-muted)]"
        role="img"
      />
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{evidence.textualSummary}</p>
      {evidence.map.rejectedSamples.length ? (
        <p className="mt-1 text-xs leading-5 text-[var(--danger)]">
          {evidence.map.rejectedSamples.length} noisy or invalid sample{evidence.map.rejectedSamples.length === 1 ? "" : "s"} excluded from the derived boundary.
        </p>
      ) : null}
    </div>
  );
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
