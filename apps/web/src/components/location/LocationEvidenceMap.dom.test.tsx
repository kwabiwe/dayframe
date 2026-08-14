// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";

const mocks = vi.hoisted(() => ({
  clientFetch: vi.fn(),
  maps: [] as Array<{
    options: Record<string, unknown>;
    handlers: Record<string, Array<() => void>>;
    addLayer: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  }>
}));

vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: mocks.clientFetch }));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    options: Record<string, unknown>;
    handlers: Record<string, Array<() => void>> = {};
    addLayer = vi.fn();
    addSource = vi.fn();
    addControl = vi.fn();
    fitBounds = vi.fn();
    getSource = vi.fn(() => ({}));
    remove = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      mocks.maps.push(this);
    }

    on(event: string, handler: () => void) {
      this.handlers[event] ??= [];
      this.handlers[event].push(handler);
      if (event === "load") queueMicrotask(handler);
      return this;
    }
  }

  class FakeBounds {
    coordinates = 0;
    extend() { this.coordinates += 1; return this; }
    isEmpty() { return this.coordinates === 0; }
  }

  class FakePopup {
    setText() { return this; }
  }

  class FakeMarker {
    setLngLat() { return this; }
    setPopup() { return this; }
    addTo() { return this; }
  }

  class FakeNavigationControl {}

  const maplibreModule = {
    Map: FakeMap,
    LngLatBounds: FakeBounds,
    Marker: FakeMarker,
    NavigationControl: FakeNavigationControl,
    Popup: FakePopup
  };
  return { ...maplibreModule, default: maplibreModule };
});

const { LocationEvidenceMap } = await import("./LocationEvidenceMap");

describe("LocationEvidenceMap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.maps.length = 0;
  });
  afterEach(() => cleanup());

  it("keeps endpoint geometry visible on the explicit tile-free fallback and cleans up", async () => {
    mocks.clientFetch.mockResolvedValue(new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }));
    const result = render(<LocationEvidenceMap evidence={evidence()} />);

    expect(await screen.findByText("Endpoint estimate")).not.toBeNull();
    expect(await screen.findByText("Map background is unavailable. Evidence remains visible.")).not.toBeNull();
    await waitFor(() => expect(mocks.maps).toHaveLength(1));
    expect(mocks.maps[0]?.options.style).toMatchObject({
      version: 8,
      layers: [{ id: "canvas", type: "background" }]
    });
    await waitFor(() => expect(mocks.maps[0]?.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: "straight-line-fallback-line"
    })));

    result.unmount();
    expect(mocks.maps[0]?.remove).toHaveBeenCalledOnce();
  });

  it("uses the authenticated style response and reports a later provider failure without hiding evidence", async () => {
    mocks.clientFetch.mockResolvedValue(new Response(JSON.stringify({
      version: 8,
      sources: {
        base: { type: "raster", tiles: ["https://dayframe.test/api/map-tiles/{z}/{x}/{y}"] }
      },
      layers: [{ id: "base", type: "raster", source: "base" }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<LocationEvidenceMap evidence={evidence()} />);

    await waitFor(() => expect(mocks.maps).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Loading map background…")).toBeNull());
    for (const handler of mocks.maps[0]?.handlers.error ?? []) handler();

    expect(await screen.findByText("Map background could not load. Evidence remains visible.")).not.toBeNull();
    expect(screen.getByText("Endpoint estimate")).not.toBeNull();
  });

  it("does not initialize MapLibre when there is no map geometry", async () => {
    render(<LocationEvidenceMap evidence={evidence({
      map: { ...evidence().map, straightLineFallback: null }
    })} />);

    expect(screen.getByText("No mapped evidence")).not.toBeNull();
    expect(screen.getByText("No coordinate samples or anchors are attached to this item.")).not.toBeNull();
    expect(mocks.clientFetch).not.toHaveBeenCalled();
    expect(mocks.maps).toHaveLength(0);
  });
});

function evidence(overrides: Partial<LocationReviewEvidenceDto> = {}): LocationReviewEvidenceDto {
  return {
    reviewItemId: "10000000-0000-4000-8000-000000000001",
    eventId: "10000000-0000-4000-8000-000000000002",
    segment: {
      id: "segment-1",
      kind: "commute",
      status: "open",
      startedAt: "2026-08-14T09:00:00.000Z",
      stoppedAt: "2026-08-14T10:00:00.000Z",
      confidence: "medium",
      continuityStatus: "continuous",
      algorithmVersion: "location-v2.0",
      evidenceCount: 0,
      rejectedEvidenceCount: 0
    },
    display: {
      title: "Possible journey",
      subtitle: null,
      placeId: null,
      placeName: null,
      addressSummary: null
    },
    map: {
      centre: null,
      stayRadiusMeters: null,
      route: null,
      straightLineFallback: {
        type: "LineString",
        coordinates: [[0.1, 51.5], [0.2, 51.6]]
      },
      acceptedSamples: [],
      rejectedSamples: [],
      anchors: [],
      gaps: [],
      nearbySavedPlaces: []
    },
    suggestedSplitPoints: [],
    evidenceExpiresAt: null,
    evidenceExpired: false,
    rawEvidenceAvailable: false,
    textualSummary: "Only journey endpoints are available.",
    ...overrides
  };
}
