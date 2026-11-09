// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Codex r1 on #633: MapKit failures (a token request that fails, an authorisation error) fall back for the page.
const fetchToken = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: (url: string, init?: RequestInit) => fetchToken(url, init) }));

const { MapKitEvidenceMap, resetMapKitPage } = await import("./MapKitEvidenceMap");

type Listener = (event: { status?: string }) => void;
function fakeMapKit() {
  const listeners = new Map<string, Listener[]>();
  let authorize: ((done: (token: string) => void) => void) | null = null;
  const tokens: string[] = [];
  class Thing { constructor(..._args: unknown[]) {} }
  const MapClass = class {
    colorScheme = "light";
    padding = {};
    addOverlays() {}
    removeOverlays() {}
    setRegionAnimated() {}
    destroy() {}
    static ColorSchemes = { Light: "light", Dark: "dark" };
  };
  const mapkit = {
    loadedLibraries: ["map", "overlays"],
    init: ({ authorizationCallback }: { authorizationCallback: (done: (token: string) => void) => void }) => {
      authorize = authorizationCallback;
    },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    removeEventListener: () => undefined,
    Map: MapClass,
    FeatureVisibility: { Hidden: "hidden", Visible: "visible", Adaptive: "adaptive" },
    Coordinate: Thing, CoordinateRegion: Thing, CoordinateSpan: Thing, Padding: Thing, Style: Thing, CircleOverlay: Thing, PolylineOverlay: Thing
  };
  return {
    mapkit,
    authorizeNow: () => authorize?.((token) => tokens.push(token)),
    tokens,
    emit: (type: string, status: string) => listeners.get(type)?.forEach((listener) => listener({ status }))
  };
}

const evidence = (withGeometry = true) => ({
  reviewItemId: null, eventId: null, evidenceExpired: false, segment: { id: "seg-cafe", kind: "stay", evidenceCount: 3 },
  map: withGeometry
    ? { gaps: [], centre: { type: "Point", coordinates: [-0.1, 51.5] }, stayRadiusMeters: 80, nearbySavedPlaces: [], acceptedSamples: [], anchors: [], rejectedSamples: [] }
    : { gaps: [], centre: null, stayRadiusMeters: null, nearbySavedPlaces: [], acceptedSamples: [], anchors: [], rejectedSamples: [] }
}) as never;

describe("MapKitEvidenceMap", () => {
  let fake: ReturnType<typeof fakeMapKit>;
  beforeEach(() => {
    resetMapKitPage();
    fake = fakeMapKit();
    (window as unknown as { mapkit: unknown }).mapkit = fake.mapkit;
    window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
    fetchToken.mockReset();
  });
  afterEach(cleanup);

  it("hands MapKit a token from the session-gated endpoint", async () => {
    fetchToken.mockResolvedValue({ ok: true, json: async () => ({ available: true, token: "signed" }) });
    const onUnavailable = vi.fn();
    render(<MapKitEvidenceMap caption={null} evidence={evidence()} onUnavailable={onUnavailable} />);
    await waitFor(() => expect(screen.queryByText("Loading map…")).toBeNull());
    await act(async () => { fake.authorizeNow(); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(fake.tokens).toEqual(["signed"]));
    expect(fetchToken).toHaveBeenCalledWith("/api/mapkit-token", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("falls back when the token request fails", async () => {
    fetchToken.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const onUnavailable = vi.fn();
    render(<MapKitEvidenceMap caption={null} evidence={evidence()} onUnavailable={onUnavailable} />);
    await waitFor(() => expect(screen.queryByText("Loading map…")).toBeNull());
    await act(async () => { fake.authorizeNow(); });
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
    expect(fake.tokens).toEqual([]);
  });

  it("remembers a failure that lands while no map is open, for the next one", async () => {
    fetchToken.mockResolvedValue({ ok: true, json: async () => ({ token: "signed" }) });
    const first = render(<MapKitEvidenceMap caption={null} evidence={evidence()} onUnavailable={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText("Loading map…")).toBeNull());
    first.unmount();
    act(() => fake.emit("error", "Unauthorized"));
    const onUnavailable = vi.fn();
    render(<MapKitEvidenceMap caption={null} evidence={evidence()} onUnavailable={onUnavailable} />);
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
  });

  it("shows the empty state, not a loading line, for evidence without coordinates", () => {
    render(<MapKitEvidenceMap caption="Based on 3 readings" evidence={evidence(false)} onUnavailable={vi.fn()} />);
    expect(screen.getByText("No map for this one")).not.toBeNull();
    expect(screen.queryByText("Loading map…")).toBeNull();
  });
});
