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

  it("leaves out a place the dialog already lists, so a tap can't save a duplicate", async () => {
    const fake = fakeMapKit([
      { name: "The Dental Abode", id: "a", coordinate: { latitude: 51.5001, longitude: -0.1 } },
      { name: "Near Café", id: "b", coordinate: { latitude: 51.5002, longitude: -0.1 } }
    ], [{ name: "the dental abode", id: "c", coordinate: { latitude: 51.5001, longitude: -0.1 } }, { name: "Dental Lab", id: "d", coordinate: { latitude: 51.5003, longitude: -0.1 } }]);
    (window as unknown as { mapkit: unknown }).mapkit = fake.mapkit;
    const onNearbyCount = vi.fn();
    const view = render(<NearbyPlaces centre={centre} disabled={false} onNearbyCount={onNearbyCount} onPick={vi.fn()} onUnavailable={vi.fn()} savedNames={["The Dental Abode"]} />);
    const list = await screen.findByRole("list", { name: "Places nearby" });
    expect([...list.querySelectorAll("b")].map((title) => title.textContent)).toEqual(["Near Café"]);
    expect(onNearbyCount).toHaveBeenLastCalledWith(1);
    view.rerender(<NearbyPlaces centre={centre} disabled={false} onPick={vi.fn()} onUnavailable={vi.fn()} query="dental" savedNames={["The Dental Abode"]} />);
    const found = await screen.findByRole("list", { name: "Places found" });
    await waitFor(() => expect([...found.querySelectorAll("b")].map((title) => title.textContent)).toEqual(["Dental Lab"]));
  });

  it("searches Apple's places by name", async () => {
    const fake = fakeMapKit([], [{ name: "Example Library", coordinate: { latitude: 51.51, longitude: -0.1 } }]);
    (window as unknown as { mapkit: unknown }).mapkit = fake.mapkit;
    render(<NearbyPlaces centre={centre} disabled={false} onPick={vi.fn()} onUnavailable={vi.fn()} />);
    expect(await screen.findByText("No places nearby.")).not.toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search places" }), { target: { value: "library" } });
    expect(await screen.findByRole("list", { name: "Places found" })).not.toBeNull();
    expect(screen.getByText("Example Library")).not.toBeNull();
    // A new query never leaves the last answer's rows to pick from while it looks (Codex r3 on #633).
    fireEvent.change(screen.getByRole("searchbox", { name: "Search places" }), { target: { value: "library hall" } });
    expect(screen.queryByText("Example Library")).toBeNull();
    expect(screen.getByText("Looking…")).not.toBeNull();
  });

  it("holds its rows while a dialog-owned search looks, says so through onSearching, and stops when it goes (owner, 30 Oct 2026)", async () => {
    const fake = fakeMapKit([{ name: "Near Café", id: "b", coordinate: { latitude: 51.5002, longitude: -0.1 } }],
      [{ name: "Example Library", coordinate: { latitude: 51.51, longitude: -0.1 } }]);
    (window as unknown as { mapkit: unknown }).mapkit = fake.mapkit;
    const onSearching = vi.fn();
    const view = (query: string) => <NearbyPlaces centre={centre} disabled={false} onPick={vi.fn()} onSearching={onSearching} onUnavailable={vi.fn()} query={query} />;
    const { rerender, unmount } = render(view(""));
    await screen.findByRole("list", { name: "Places nearby" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    rerender(view("library"));
    // No "Looking…": the rows stay until the answer.
    expect(screen.getByText("Near Café")).not.toBeNull();
    expect(screen.queryByText("Looking…")).toBeNull();
    expect(onSearching).toHaveBeenLastCalledWith(true);
    await screen.findByText("Example Library");
    // `onSearching` is a passive effect: it runs a task after the commit that draws the row, so wait for it.
    await waitFor(() => expect(onSearching).toHaveBeenLastCalledWith(false));
    rerender(view("library hall"));
    expect(screen.getByText("Example Library")).not.toBeNull();
    expect(onSearching).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onSearching).toHaveBeenLastCalledWith(false);
  });

  it("searches as you type with autocomplete near the visit, nearest first, and backs it up with a full search", async () => {
    const near = { displayLines: ["Riverside Leisure Centre", "Chelmsford"], coordinate: { latitude: 51.5002, longitude: -0.1 } };
    const far = { displayLines: ["Rivers Café"], coordinate: { latitude: 51.52, longitude: -0.1 } };
    const fake = fakeMapKit([], [{ name: "Full search place", coordinate: { latitude: 51.51, longitude: -0.1 } }]);
    const Search = fake.mapkit.Search as unknown as { prototype: { autocomplete?: unknown } };
    Search.prototype.autocomplete = (query: string, done: (error: null, data: { results: unknown[] }) => void) => done(null, { results: query === "rivers" ? [far, near] : [] });
    (window as unknown as { mapkit: unknown }).mapkit = fake.mapkit;
    const counted = vi.fn();
    const view = (query: string) => <NearbyPlaces centre={centre} disabled={false} onNearbyCount={counted} onPick={vi.fn()} onUnavailable={vi.fn()} query={query} />;
    const { rerender } = render(view("rivers"));
    const list = await screen.findByRole("list", { name: "Places found" });
    expect([...list.querySelectorAll("b")].map((title) => title.textContent)).toEqual(["Riverside Leisure Centre", "Rivers Café"]);
    rerender(view("xyz"));
    expect(await screen.findByText("Full search place")).not.toBeNull();
    await waitFor(() => expect(counted).toHaveBeenCalledWith(0));
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
