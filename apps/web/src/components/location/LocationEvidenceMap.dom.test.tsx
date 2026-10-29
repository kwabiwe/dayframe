// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";

const mocks = vi.hoisted(() => ({
  clientFetch: vi.fn(),
  reducedMotion: false,
  /** false: the test fires the first view's `load` itself, after its tile requests and errors. */
  autoLoad: true,
  /** false: the test fires `style.load` itself (a slow style). */
  autoStyle: true,
  maps: [] as Array<{
    options: Record<string, unknown>;
    handlers: Record<string, Array<(event?: unknown) => void>>;
    addLayer: ReturnType<typeof vi.fn>;
    addSource: ReturnType<typeof vi.fn>;
    fitBounds: ReturnType<typeof vi.fn>;
    sources: Map<string, { setData: ReturnType<typeof vi.fn> }>;
    remove: ReturnType<typeof vi.fn>;
    setStyle: ReturnType<typeof vi.fn>;
    emit: (event: string, payload?: unknown) => void;
  }>
}));

vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: mocks.clientFetch }));
vi.mock("@/lib/blocks-motion", () => ({ prefersReducedMotion: () => mocks.reducedMotion }));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    options: Record<string, unknown>;
    handlers: Record<string, Array<(event?: unknown) => void>> = {};
    sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
    addLayer = vi.fn();
    addSource = vi.fn((id: string) => { this.sources.set(id, { setData: vi.fn() }); });
    addControl = vi.fn();
    fitBounds = vi.fn();
    getSource = vi.fn((id: string) => this.sources.get(id));
    isStyleLoaded = vi.fn(() => false);
    remove = vi.fn();
    setStyle = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      mocks.maps.push(this);
      // The style loads first, then the first view's tiles (MapLibre's own order).
      queueMicrotask(() => {
        if (!mocks.autoStyle) return;
        this.emit("style.load");
        if (mocks.autoLoad) queueMicrotask(() => this.emit("load"));
      });
    }

    on(event: string, handler: (event?: unknown) => void) {
      this.handlers[event] ??= [];
      this.handlers[event].push(handler);
      return this;
    }

    emit(event: string, payload?: unknown) {
      for (const handler of this.handlers[event] ?? []) handler(payload);
    }
  }

  class FakePopup {
    setText() { return this; }
  }

  class FakeMarker {
    setLngLat() { return this; }
    setPopup() { return this; }
    addTo() { return this; }
    remove() { return this; }
  }

  class FakeNavigationControl {}

  const maplibreModule = {
    Map: FakeMap,
    Marker: FakeMarker,
    NavigationControl: FakeNavigationControl,
    Popup: FakePopup
  };
  return { ...maplibreModule, default: maplibreModule };
});

const { LocationEvidenceMap, resetLocationMapStyleCache } = await import("./LocationEvidenceMap");

describe("LocationEvidenceMap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.maps.length = 0;
    mocks.reducedMotion = false;
    mocks.autoLoad = true;
    mocks.autoStyle = true;
    vi.unstubAllEnvs();
    resetLocationMapStyleCache();
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

  it("uses the authenticated style response and ignores an isolated tile error (glitch fix 4)", async () => {
    mocks.autoLoad = false;
    mocks.clientFetch.mockResolvedValue(styleResponse());
    render(<LocationEvidenceMap evidence={evidence()} />);

    await waitFor(() => expect(mocks.maps[0]?.addSource).toHaveBeenCalled());
    const map = mocks.maps[0]!;
    const tiles = [0, 1, 2, 3, 4, 5];
    act(() => { for (const x of tiles) map.emit("sourcedataloading", tileEvent(x)); });
    act(() => map.emit("error", { ...tileEvent(0), error: new Error("502") }));
    act(() => { for (const x of tiles.slice(1)) map.emit("sourcedata", tileEvent(x)); });
    expect(screen.getByText("Loading map background…")).not.toBeNull();
    act(() => map.emit("load"));

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Endpoint estimate")).not.toBeNull();
  });

  it("shows the soft note when most of the first view's tiles fail, never a hard error (glitch fix 4)", async () => {
    mocks.autoLoad = false;
    mocks.clientFetch.mockResolvedValue(styleResponse());
    render(<LocationEvidenceMap evidence={evidence()} />);

    await waitFor(() => expect(mocks.maps[0]?.addSource).toHaveBeenCalled());
    const map = mocks.maps[0]!;
    act(() => { for (const x of [0, 1, 2, 3]) map.emit("sourcedataloading", tileEvent(x)); });
    act(() => { for (const x of [0, 1, 2]) map.emit("error", { ...tileEvent(x), error: new Error("502") }); });
    act(() => map.emit("sourcedata", tileEvent(3)));
    // An evidence source's error is never a tile failure.
    act(() => map.emit("error", { sourceId: "route", error: new Error("bad data") }));
    act(() => map.emit("load"));

    const note = screen.getByText("Some of the map background didn’t load. Evidence remains visible.");
    expect(note.className).toContain("is-degraded");
    expect(note.className).not.toContain("is-error");
    expect(screen.getByText("Endpoint estimate")).not.toBeNull();
  });

  it("shows the soft note when the style fails, and asks again next time", async () => {
    mocks.clientFetch.mockResolvedValue(new Response("{}", { status: 503 }));
    const first = render(<LocationEvidenceMap evidence={evidence()} />);
    expect(await screen.findByText("Map background is unavailable. Evidence remains visible.")).not.toBeNull();
    first.unmount();
    render(<LocationEvidenceMap evidence={evidence()} />);
    await waitFor(() => expect(mocks.maps).toHaveLength(2));
    expect(mocks.clientFetch).toHaveBeenCalledTimes(2);
  });

  it("fetches the style once per page session (glitch fix 1)", async () => {
    mocks.clientFetch.mockImplementation(async () => styleResponse());
    const first = render(<LocationEvidenceMap evidence={evidence()} />);
    await waitFor(() => expect(mocks.maps).toHaveLength(1));
    first.unmount();
    render(<LocationEvidenceMap evidence={evidence({ segment: { ...evidence().segment, id: "segment-2" } })} />);
    await waitFor(() => expect(mocks.maps).toHaveLength(2));

    expect(mocks.clientFetch).toHaveBeenCalledTimes(1);
    expect(mocks.maps[1]?.options.style).toMatchObject({ version: 8, layers: [{ id: "base" }] });
    // Each map has its own copy of the cached style.
    expect(mocks.maps[1]?.options.style).not.toBe(mocks.maps[0]?.options.style);
  });

  it("opens at the evidence's bounds, never at a zoom-15 centre first (glitch fix 2)", async () => {
    mocks.clientFetch.mockResolvedValue(styleResponse());
    render(<LocationEvidenceMap evidence={evidence()} />);
    await waitFor(() => expect(mocks.maps).toHaveLength(1));
    const options = mocks.maps[0]!.options;

    expect(options.bounds).toEqual([[0.1, 51.5], [0.2, 51.6]]);
    expect(options.fitBoundsOptions).toEqual({ padding: 48, maxZoom: 16 });
    expect(options.zoom).toBeUndefined();
    expect(options.center).toBeUndefined();
    // The layers are added as soon as the style loads, and nothing refits after the tiles.
    await waitFor(() => expect(mocks.maps[0]?.addLayer).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Loading map background…")).toBeNull());
    expect(mocks.maps[0]?.fitBounds).not.toHaveBeenCalled();
  });

  it("keeps one map across re-renders with equal content, and updates its sources in place when content changes (glitch fix 1)", async () => {
    mocks.clientFetch.mockResolvedValue(styleResponse());
    const view = render(<LocationEvidenceMap evidence={evidence()} visitOnly />);
    await waitFor(() => expect(mocks.maps[0]?.addSource).toHaveBeenCalled());
    const map = mocks.maps[0]!;
    const sourcesAdded = map.addSource.mock.calls.length;

    // A new object with the same content (the dialog's re-render, a timer tick) changes nothing.
    view.rerender(<LocationEvidenceMap evidence={evidence()} visitOnly />);
    view.rerender(<LocationEvidenceMap caption="Based on 2 readings" evidence={evidence()} visitOnly />);
    expect(mocks.maps).toHaveLength(1);
    expect(map.remove).not.toHaveBeenCalled();
    expect(map.sources.get("straight-line-fallback")?.setData).not.toHaveBeenCalled();
    expect(map.fitBounds).not.toHaveBeenCalled();

    // New content: the same map, its data set in place and the bounds eased to it.
    const moved = evidence({ map: { ...evidence().map, straightLineFallback: { type: "LineString", coordinates: [[0.3, 51.7], [0.4, 51.8]] } } });
    view.rerender(<LocationEvidenceMap evidence={moved} visitOnly />);
    expect(mocks.maps).toHaveLength(1);
    expect(map.remove).not.toHaveBeenCalled();
    expect(map.addSource).toHaveBeenCalledTimes(sourcesAdded);
    expect(map.sources.get("straight-line-fallback")?.setData).toHaveBeenCalledWith(moved.map.straightLineFallback);
    expect(map.fitBounds).toHaveBeenCalledWith([[0.3, 51.7], [0.4, 51.8]], expect.objectContaining({ duration: 300, animate: true }));
  });

  it("draws and fits the newest content when it changed before the style loaded (Codex r1 on #626)", async () => {
    mocks.autoStyle = false;
    mocks.clientFetch.mockResolvedValue(styleResponse());
    const view = render(<LocationEvidenceMap evidence={evidence()} visitOnly />);
    await waitFor(() => expect(mocks.maps).toHaveLength(1));
    const map = mocks.maps[0]!;
    // A leg opened while the style is still loading.
    const leg = evidence({ map: { ...evidence().map, straightLineFallback: { type: "LineString", coordinates: [[0.3, 51.7], [0.4, 51.8]] } } });
    view.rerender(<LocationEvidenceMap evidence={leg} visitOnly />);
    expect(map.addSource).not.toHaveBeenCalled();

    act(() => map.emit("style.load"));
    expect(map.addSource).toHaveBeenCalledWith("straight-line-fallback", { type: "geojson", data: leg.map.straightLineFallback });
    expect(map.fitBounds).toHaveBeenCalledOnce();
    expect(map.fitBounds).toHaveBeenCalledWith([[0.3, 51.7], [0.4, 51.8]], expect.objectContaining({ duration: 0, animate: false }));
  });

  it("does not refit at style load when the content is what the map opened with", async () => {
    mocks.autoStyle = false;
    mocks.clientFetch.mockResolvedValue(styleResponse());
    render(<LocationEvidenceMap evidence={evidence()} visitOnly />);
    await waitFor(() => expect(mocks.maps).toHaveLength(1));
    act(() => mocks.maps[0]!.emit("style.load"));
    expect(mocks.maps[0]!.addSource).toHaveBeenCalled();
    expect(mocks.maps[0]!.fitBounds).not.toHaveBeenCalled();
  });

  it("treats a custom style's failure as the base map unavailable, drawing the evidence on a blank style (Codex r1 on #626)", async () => {
    vi.stubEnv("NEXT_PUBLIC_DAYFRAME_MAP_STYLE_URL", "https://maps.example.test/style.json");
    mocks.autoStyle = false;
    mocks.autoLoad = false;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      render(<LocationEvidenceMap evidence={evidence()} visitOnly />);
      await vi.waitFor(() => expect(mocks.maps).toHaveLength(1));
      const map = mocks.maps[0]!;
      expect(map.options.style).toBe("https://maps.example.test/style.json");
      expect(mocks.clientFetch).not.toHaveBeenCalled();
      // The style can't load: an error with no tile or source.
      act(() => map.emit("error", { error: new Error("Failed to fetch style") }));
      expect(map.setStyle).toHaveBeenCalledWith(expect.objectContaining({ version: 8, sources: {}, layers: [expect.objectContaining({ type: "background" })] }), { diff: false });
      expect(screen.getByText("Map background is unavailable. Evidence remains visible.")).not.toBeNull();
      // The blank style loads and the route is drawn on it.
      act(() => map.emit("style.load"));
      expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "straight-line-fallback-line" }));
      // The first load window ends without tiles: still the note, never "ready".
      act(() => { vi.advanceTimersByTime(10_000); });
      act(() => map.emit("load"));
      expect(screen.getByText("Map background is unavailable. Evidence remains visible.")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a base source's failure before any tile as the background unavailable, never ready (Codex r2 on #626)", async () => {
    mocks.autoLoad = false;
    mocks.clientFetch.mockResolvedValue(styleResponse());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      render(<LocationEvidenceMap evidence={evidence()} visitOnly />);
      await vi.waitFor(() => expect(mocks.maps).toHaveLength(1));
      const map = mocks.maps[0]!;
      await vi.waitFor(() => expect(map.addSource).toHaveBeenCalled());
      // The base source's TileJSON fails: a source error, no tile, before any tile request.
      act(() => map.emit("error", { sourceId: "base", error: new Error("TileJSON 502") }));
      expect(screen.getByText("Map background is unavailable. Evidence remains visible.")).not.toBeNull();
      expect(map.setStyle).not.toHaveBeenCalled();
      act(() => map.emit("load"));
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(screen.getByText("Map background is unavailable. Evidence remains visible.")).not.toBeNull();
      expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "straight-line-fallback-line" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays loading until the style loads, however long it takes: the timeout is not success (Codex r3 on #626)", async () => {
    mocks.autoStyle = false;
    mocks.autoLoad = false;
    mocks.clientFetch.mockResolvedValue(styleResponse());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      render(<LocationEvidenceMap evidence={evidence()} visitOnly />);
      await vi.waitFor(() => expect(mocks.maps).toHaveLength(1));
      const map = mocks.maps[0]!;
      act(() => { vi.advanceTimersByTime(12_000); });
      expect(screen.getByText("Loading map background…")).not.toBeNull();
      // The style loads at 12 s, then the first view.
      act(() => map.emit("style.load"));
      expect(map.addLayer).toHaveBeenCalled();
      expect(screen.getByText("Loading map background…")).not.toBeNull();
      act(() => map.emit("load"));
      expect(screen.queryByText("Loading map background…")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  /** A map whose style has loaded, with tiles 0–3 of the first view admitted, under fake timers. */
  async function mapWithFourPendingTiles() {
    mocks.autoLoad = false;
    mocks.clientFetch.mockResolvedValue(styleResponse());
    render(<LocationEvidenceMap evidence={evidence()} visitOnly />);
    await vi.waitFor(() => expect(mocks.maps[0]?.addSource).toHaveBeenCalled());
    const map = mocks.maps[0]!;
    act(() => { for (const x of [0, 1, 2, 3]) map.emit("sourcedataloading", tileEvent(x)); });
    return map;
  }

  it("never lets new tiles' successes settle the first window's: three of the four originals failing late shows the note (Codex r3, r4 on #626)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const map = await mapWithFourPendingTiles();
      act(() => { vi.advanceTimersByTime(10_000); });
      // Four new tiles after the window: not admitted, and their successes settle nothing.
      act(() => { for (const x of [10, 11, 12, 13]) { map.emit("sourcedataloading", tileEvent(x)); map.emit("sourcedata", tileEvent(x)); } });
      expect(screen.getByText("Loading map background…")).not.toBeNull();
      act(() => { for (const x of [0, 1, 2]) map.emit("error", { ...tileEvent(x), error: new Error("502") }); });
      expect(screen.getByText("Loading map background…")).not.toBeNull();
      act(() => map.emit("sourcedata", tileEvent(3)));
      expect(screen.getByText("Some of the map background didn’t load. Evidence remains visible.")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores new tiles' failures: the originals all loading ends ready (Codex r4 on #626)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const map = await mapWithFourPendingTiles();
      act(() => { vi.advanceTimersByTime(10_000); });
      act(() => { for (const x of [10, 11, 12]) { map.emit("sourcedataloading", tileEvent(x)); map.emit("error", { ...tileEvent(x), error: new Error("502") }); } });
      act(() => { for (const x of [0, 1, 2, 3]) map.emit("sourcedata", tileEvent(x)); });
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("decides only when the window has closed: one failure then three successes inside it ends ready (Codex r4 on #626)", async () => {
    const map = await mapWithFourPendingTiles();
    act(() => map.emit("error", { ...tileEvent(0), error: new Error("502") }));
    act(() => { for (const x of [1, 2, 3]) map.emit("sourcedata", tileEvent(x)); });
    // Everything has settled, but the window is still open: no verdict yet, no early warning.
    expect(screen.getByText("Loading map background…")).not.toBeNull();
    act(() => map.emit("load"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("waits for a tile still loading when the window closes", async () => {
    const map = await mapWithFourPendingTiles();
    act(() => { for (const x of [0, 1, 2]) map.emit("sourcedata", tileEvent(x)); });
    act(() => map.emit("load"));
    expect(screen.getByText("Loading map background…")).not.toBeNull();
    // A repeated outcome for a settled tile changes nothing; the last one decides.
    act(() => map.emit("error", { ...tileEvent(0), error: new Error("502") }));
    act(() => map.emit("sourcedata", tileEvent(3)));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("jumps to new bounds at once under Reduce Motion", async () => {
    mocks.reducedMotion = true;
    mocks.clientFetch.mockResolvedValue(styleResponse());
    const view = render(<LocationEvidenceMap evidence={evidence()} visitOnly />);
    await waitFor(() => expect(mocks.maps[0]?.addSource).toHaveBeenCalled());
    view.rerender(<LocationEvidenceMap evidence={evidence({ map: { ...evidence().map, straightLineFallback: { type: "LineString", coordinates: [[0.3, 51.7], [0.4, 51.8]] } } })} visitOnly />);
    expect(mocks.maps[0]?.fitBounds).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 0, animate: false }));
  });

  it("draws only the visit's area on the sheets' map, never its readings, rejected readings, gaps, saved places or anchors (Codex r3 on #620)", async () => {
    mocks.clientFetch.mockResolvedValue(new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }));
    const point = (longitude: number, latitude: number) => ({ type: "Point" as const, coordinates: [longitude, latitude] as [number, number] });
    const stay = evidence({
      segment: { ...evidence().segment, kind: "stay", evidenceCount: 2 },
      map: {
        ...evidence().map, straightLineFallback: null, centre: point(0.1, 51.5), stayRadiusMeters: 60,
        acceptedSamples: [{ id: "s1", point: point(0.1, 51.5), occurredAt: "2026-08-14T09:10:00.000Z", accuracyMeters: 10, kind: "location", role: null },
          { id: "s2", point: point(0.1001, 51.5001), occurredAt: "2026-08-14T09:20:00.000Z", accuracyMeters: 10, kind: "location", role: null }],
        rejectedSamples: [{ id: "r1", point: point(0.2, 51.6), occurredAt: "2026-08-14T09:30:00.000Z", kind: "location", reason: "accuracy" }],
        gaps: [{ startedAt: "2026-08-14T09:30:00.000Z", stoppedAt: "2026-08-14T09:40:00.000Z", durationSeconds: 600, fromPoint: point(0.1, 51.5), toPoint: point(0.1001, 51.5001) }]
      } as LocationReviewEvidenceDto["map"]
    });
    const layers = async () => {
      await waitFor(() => expect(mocks.maps.at(-1)?.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "stay-radius-line" })));
      return (mocks.maps.at(-1)!.addLayer.mock.calls as Array<[{ id: string }]>).map(([layer]) => layer.id);
    };
    const sheet = render(<LocationEvidenceMap caption="Based on 2 readings" evidence={stay} visitOnly />);
    expect(await layers()).toEqual(["route-line", "straight-line-fallback-line", "stay-radius-fill", "stay-radius-line"]);
    expect(screen.getByText("Based on 2 readings")).not.toBeNull();
    sheet.unmount();
    // The full map, for comparison, still draws them.
    render(<LocationEvidenceMap evidence={stay} />);
    expect(await layers()).toEqual(expect.arrayContaining(["sample-points", "rejected-sample-points", "gap-lines"]));
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

/** A base-map tile's MapLibre event: its source and canonical tile id. */
function tileEvent(x: number) {
  return { sourceId: "base", dataType: "source", tile: { tileID: { canonical: { x, y: 1, z: 15 } } } };
}

function styleResponse() {
  return new Response(JSON.stringify({
    version: 8,
    sources: {
      base: { type: "raster", tiles: ["https://dayframe.test/api/map-tiles/{z}/{x}/{y}"] }
    },
    layers: [{ id: "base", type: "raster", source: "base" }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

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
      approximateArrival: false,
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
