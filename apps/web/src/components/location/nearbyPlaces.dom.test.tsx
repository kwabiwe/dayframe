// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// UI review (owner 29 Oct 2026; PRD D19 A7): Apple's nearby places on the web, from MapKit JS next to its map.
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: vi.fn() }));
const { NearbyPlaces } = await import("./NearbyPlaces");
const { resetMapKitPage } = await import("./MapKitEvidenceMap");

type Place = { name: string; id?: string; coordinate: { latitude: number; longitude: number } };
function fakeMapKit(nearby: Place[], found: Place[] = []) {
  const listeners: Array<(event: { status?: string }) => void> = [];
  class Thing { constructor(..._args: unknown[]) {} }
  return {
    fail: () => listeners.forEach((listener) => listener({ status: "Unauthorized" })),
    mapkit: {
      loadedLibraries: ["map", "overlays", "services"],
      init: () => undefined,
      addEventListener: (_type: string, listener: (event: { status?: string }) => void) => listeners.push(listener),
      removeEventListener: () => undefined,
      Coordinate: class { constructor(public latitude: number, public longitude: number) {} },
      CoordinateRegion: Thing, CoordinateSpan: Thing,
      PointsOfInterestSearch: class { search(callback: (error: unknown, data: { places: Place[] }) => void) { callback(null, { places: nearby }); return 1; } },
      Search: class { search(_query: string, callback: (error: unknown, data: { places: Place[] }) => void) { callback(null, { places: found }); return 1; } }
    }
  };
}

const centre = { latitude: 51.5, longitude: -0.1 };

describe("NearbyPlaces", () => {
  beforeEach(() => resetMapKitPage());
  afterEach(cleanup);

  it("lists Apple's places nearest first, and a pick names the visit", async () => {
    const fake = fakeMapKit([
      { name: "Far Bakery", id: "a", coordinate: { latitude: 51.5015, longitude: -0.1 } },
      { name: "Near Café", id: "b", coordinate: { latitude: 51.5002, longitude: -0.1 } }
    ]);
    (window as unknown as { mapkit: unknown }).mapkit = fake.mapkit;
    const onPick = vi.fn();
    render(<NearbyPlaces centre={centre} disabled={false} onPick={onPick} onUnavailable={vi.fn()} />);
    const list = await screen.findByRole("list", { name: "Places nearby" });
    expect([...list.querySelectorAll("b")].map((title) => title.textContent)).toEqual(["Near Café", "Far Bakery"]);
    expect(list.textContent).toContain("20 m away");
    fireEvent.click(screen.getByRole("button", { name: /Near Café/ }));
    expect(onPick).toHaveBeenCalledWith("Near Café");
  });

  it("searches Apple's places by name", async () => {
    const fake = fakeMapKit([], [{ name: "Example Library", coordinate: { latitude: 51.51, longitude: -0.1 } }]);
    (window as unknown as { mapkit: unknown }).mapkit = fake.mapkit;
    render(<NearbyPlaces centre={centre} disabled={false} onPick={vi.fn()} onUnavailable={vi.fn()} />);
    expect(await screen.findByText("No places nearby.")).not.toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search places" }), { target: { value: "library" } });
    expect(await screen.findByRole("list", { name: "Places found" })).not.toBeNull();
    expect(screen.getByText("Example Library")).not.toBeNull();
  });

  it("drops out when MapKit fails for the page", async () => {
    const fake = fakeMapKit([]);
    (window as unknown as { mapkit: unknown }).mapkit = fake.mapkit;
    const onUnavailable = vi.fn();
    render(<NearbyPlaces centre={centre} disabled={false} onPick={vi.fn()} onUnavailable={onUnavailable} />);
    await screen.findByText("No places nearby.");
    fake.fail();
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
  });
});
