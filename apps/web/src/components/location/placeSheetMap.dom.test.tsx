// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// UI review (owner 29 Oct 2026): the dialogs' map is Apple MapKit JS when the server has its key, else MapLibre.
const fetchToken = vi.hoisted(() => vi.fn());
const mapKit = vi.hoisted(() => ({ onUnavailable: null as null | (() => void) }));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: (url: string) => fetchToken(url) }));
vi.mock("@/components/location/LocationEvidenceMap", () => ({
  LocationEvidenceMap: ({ visitOnly }: { visitOnly?: boolean }) => <div data-testid="maplibre-map" data-visit-only={String(Boolean(visitOnly))} />
}));
vi.mock("@/components/location/MapKitEvidenceMap", () => ({
  MapKitEvidenceMap: ({ onUnavailable }: { onUnavailable: () => void }) => {
    mapKit.onUnavailable = onUnavailable;
    return <div data-testid="mapkit-map" />;
  }
}));

const { PlaceSheetMap, resetPlaceSheetMapProvider } = await import("./PlaceSheetMap");
const evidence = {
  reviewItemId: null, eventId: null, evidenceExpired: false, segment: { id: "seg-cafe", kind: "stay", evidenceCount: 3 },
  map: { gaps: [], centre: { type: "Point", coordinates: [-0.1, 51.5] }, stayRadiusMeters: 80, nearbySavedPlaces: [], acceptedSamples: [] }
} as never;

describe("the place and trip dialogs' map provider", () => {
  beforeEach(() => {
    resetPlaceSheetMapProvider();
    fetchToken.mockReset();
  });
  afterEach(cleanup);

  it("keeps MapLibre, visit only, when the server has no MapKit JS key", async () => {
    fetchToken.mockResolvedValue({ ok: false, status: 404 });
    render(<PlaceSheetMap caption={null} evidence={evidence} />);
    expect((await screen.findByTestId("maplibre-map")).getAttribute("data-visit-only")).toBe("true");
    expect(fetchToken).toHaveBeenCalledWith("/api/mapkit-token");
  });

  it("uses MapKit JS when a token comes back, asks once per page, and falls back to MapLibre if MapKit fails", async () => {
    fetchToken.mockResolvedValue({ ok: true, status: 200 });
    const first = render(<PlaceSheetMap caption={null} evidence={evidence} />);
    await screen.findByTestId("mapkit-map");
    first.unmount();
    render(<PlaceSheetMap caption={null} evidence={evidence} />);
    await screen.findByTestId("mapkit-map");
    expect(fetchToken).toHaveBeenCalledTimes(1);
    act(() => mapKit.onUnavailable?.());
    expect(await screen.findByTestId("maplibre-map")).not.toBeNull();
    cleanup();
    render(<PlaceSheetMap caption={null} evidence={evidence} />);
    expect(await screen.findByTestId("maplibre-map")).not.toBeNull();
  });
});
