"use client";

import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type Marker
} from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { WebPlaceCoordinate } from "@/lib/web-place-editor";

const SOURCE_ID = "dayframe-place-radius";

export function PlaceMapPreview({
  coordinate,
  onChange,
  radiusMeters
}: {
  coordinate: WebPlaceCoordinate | null;
  onChange: (coordinate: WebPlaceCoordinate) => void;
  radiusMeters: number;
}) {
  const styleUrl = process.env.NEXT_PUBLIC_DAYFRAME_MAP_STYLE_URL?.trim();
  if (!coordinate) {
    return (
      <div className="place-map-fallback" role="status">
        Choose a search result, use Current location, or enter coordinates.
      </div>
    );
  }

  if (!styleUrl) {
    return (
      <div className="place-map-fallback" role="status">
        <strong>Map preview unavailable</strong>
        <span>
          Centre {coordinate.latitude.toFixed(5)}, {coordinate.longitude.toFixed(5)} · {radiusMeters}m radius
        </span>
        <span>You can still review and save this place.</span>
      </div>
    );
  }

  return (
    <ConfiguredPlaceMap
      coordinate={coordinate}
      onChange={onChange}
      radiusMeters={radiusMeters}
      styleUrl={styleUrl}
    />
  );
}

function ConfiguredPlaceMap({
  coordinate,
  onChange,
  radiusMeters,
  styleUrl
}: {
  coordinate: WebPlaceCoordinate;
  onChange: (coordinate: WebPlaceCoordinate) => void;
  radiusMeters: number;
  styleUrl: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  const coordinateRef = useRef(coordinate);
  const radiusRef = useRef(radiusMeters);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    coordinateRef.current = coordinate;
    radiusRef.current = radiusMeters;
  }, [coordinate, radiusMeters]);

  useEffect(() => {
    if (!containerRef.current) return;
    const initialCoordinate = coordinateRef.current;
    const accent = getComputedStyle(containerRef.current).getPropertyValue("--accent").trim();
    const map = new maplibregl.Map({
      attributionControl: { compact: false },
      center: [initialCoordinate.longitude, initialCoordinate.latitude],
      container: containerRef.current,
      style: styleUrl,
      zoom: 16
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      const currentCoordinate = coordinateRef.current;
      const currentRadius = radiusRef.current;
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: radiusFeature(currentCoordinate, currentRadius)
      });
      map.addLayer({
        id: `${SOURCE_ID}-fill`,
        source: SOURCE_ID,
        type: "fill",
        paint: { "fill-color": accent, "fill-opacity": 0.16 }
      });
      map.addLayer({
        id: `${SOURCE_ID}-line`,
        source: SOURCE_ID,
        type: "line",
        paint: { "line-color": accent, "line-width": 2 }
      });
      markerRef.current = new maplibregl.Marker({ color: accent })
        .setLngLat([currentCoordinate.longitude, currentCoordinate.latitude])
        .addTo(map);
      map.jumpTo({ center: [currentCoordinate.longitude, currentCoordinate.latitude] });
    });
    map.on("click", (event) => {
      onChangeRef.current({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng
      });
    });
    return () => {
      markerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [styleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !coordinate || !map.isStyleLoaded()) return;
    map.jumpTo({ center: [coordinate.longitude, coordinate.latitude] });
    markerRef.current?.setLngLat([coordinate.longitude, coordinate.latitude]);
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(radiusFeature(coordinate, radiusMeters));
  }, [coordinate, radiusMeters]);

  return (
    <div>
      <div
        ref={containerRef}
        aria-label={`Place centre and ${radiusMeters} metre radius preview. Click the map to fine-tune the centre.`}
        className="place-map-preview"
        role="img"
      />
      <p className="place-map-help">Click the map to fine-tune the centre. Map attribution remains visible.</p>
    </div>
  );
}

function radiusFeature(
  coordinate: WebPlaceCoordinate,
  radiusMeters: number
): GeoJSON.Feature<GeoJSON.Polygon> {
  const points: [number, number][] = [];
  const latitudeRadians = coordinate.latitude * Math.PI / 180;
  const longitudeScale = Math.max(0.01, Math.cos(latitudeRadians));
  for (let index = 0; index <= 64; index += 1) {
    const angle = index / 64 * Math.PI * 2;
    points.push([
      coordinate.longitude + radiusMeters * Math.cos(angle) / (111_320 * longitudeScale),
      coordinate.latitude + radiusMeters * Math.sin(angle) / 111_320
    ]);
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [points] }
  };
}
