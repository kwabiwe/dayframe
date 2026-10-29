"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";
import { clientFetch } from "@/lib/client-auth-fetch";

/**
 * The place and trip dialogs' map: Apple MapKit JS when the server has a MapKit JS key (UI review, owner
 * 29 Oct 2026), else the MapLibre map. The server's answer is a deployment setting, so it is asked once per page;
 * a MapKit failure falls back to MapLibre for the rest of the page.
 */
const LocationEvidenceMap = dynamic(() => import("@/components/location/LocationEvidenceMap").then((module) => module.LocationEvidenceMap),
  { ssr: false, loading: () => <div aria-hidden className="location-evidence-frame" data-testid="evidence-map-loading" /> });
const MapKitEvidenceMap = dynamic(() => import("@/components/location/MapKitEvidenceMap").then((module) => module.MapKitEvidenceMap),
  { ssr: false, loading: () => <div aria-hidden className="location-evidence-frame" data-testid="evidence-map-loading" /> });

type Provider = "probing" | "mapkit" | "maplibre";

let pageProvider: Provider = "probing";
let probing: Promise<Provider> | null = null;

function probeProvider(): Promise<Provider> {
  probing ??= clientFetch("/api/mapkit-token")
    .then((response) => (response.ok ? "mapkit" as const : "maplibre" as const))
    .catch(() => "maplibre" as const)
    .then((provider) => {
      pageProvider = provider;
      return provider;
    });
  return probing;
}

/** Test seam: forget this page's answer. */
export function resetPlaceSheetMapProvider() {
  pageProvider = "probing";
  probing = null;
}

export function PlaceSheetMap({ caption, evidence }: { caption: string | null; evidence: LocationReviewEvidenceDto }) {
  const [provider, setProvider] = useState<Provider>(pageProvider);
  useEffect(() => {
    if (provider !== "probing") return undefined;
    let cancelled = false;
    void probeProvider().then((next) => {
      if (!cancelled) setProvider(next);
    });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  if (provider === "probing") return <div aria-hidden className="location-evidence-frame" data-testid="evidence-map-loading" />;
  if (provider === "mapkit") {
    return (
      <MapKitEvidenceMap
        caption={caption}
        evidence={evidence}
        onUnavailable={() => {
          pageProvider = "maplibre";
          setProvider("maplibre");
        }}
      />
    );
  }
  return <LocationEvidenceMap caption={caption} evidence={evidence} visitOnly />;
}
