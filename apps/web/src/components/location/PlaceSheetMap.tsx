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

export type Provider = "probing" | "mapkit" | "maplibre";

let pageProvider: Provider = "probing";
let probing: Promise<Provider> | null = null;

/** A probe that hasn't answered by then counts as no MapKit for the page (Codex r2 on #633). */
const PROBE_TIMEOUT_MS = 8_000;

function probeProvider(): Promise<Provider> {
  if (probing) return probing;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  probing = clientFetch("/api/mapkit-token", { signal: controller.signal })
    .then((response) => (response.ok ? "mapkit" as const : "maplibre" as const))
    .catch(() => "maplibre" as const)
    .finally(() => clearTimeout(timer))
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

/**
 * Whether this page shows Apple's map: "probing" until the server answers, then "mapkit" or "maplibre". `enabled`
 * false asks nothing (a dialog with nothing to look up).
 */
export function useMapProvider(enabled = true): [Provider, (next: Provider) => void] {
  const [provider, setProvider] = useState<Provider>(pageProvider);
  useEffect(() => {
    if (!enabled || provider !== "probing") return undefined;
    let cancelled = false;
    void probeProvider().then((next) => {
      if (!cancelled) setProvider(next);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, provider]);
  const fallBack = (next: Provider) => {
    pageProvider = next;
    setProvider(next);
  };
  return [provider, fallBack];
}

export function PlaceSheetMap({ caption, evidence }: { caption: string | null; evidence: LocationReviewEvidenceDto }) {
  const [provider, setProvider] = useMapProvider();

  if (provider === "probing") return <div aria-hidden className="location-evidence-frame" data-testid="evidence-map-loading" />;
  if (provider === "mapkit") {
    return (
      <MapKitEvidenceMap
        caption={caption}
        evidence={evidence}
        onUnavailable={() => setProvider("maplibre")}
      />
    );
  }
  return <LocationEvidenceMap caption={caption} evidence={evidence} visitOnly />;
}
