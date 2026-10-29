// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Codex r1 on #626: on a cold load the map's chunk arrives after the evidence; the real `next/dynamic` shows its
// loading fallback, the frame itself, so the dialog never collapses in between.
const chunk = vi.hoisted(() => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release: () => release() };
});
vi.mock("@/components/location/LocationEvidenceMap", async () => {
  await chunk.gate;
  return { LocationEvidenceMap: () => <div data-testid="evidence-map" /> };
});
const evidenceFetch = vi.hoisted(() => vi.fn());
// No MapKit JS key here (UI review, 29 Oct 2026): the dialog's map is MapLibre's.
vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: (url: string, init?: RequestInit) => url.includes("/api/mapkit-token")
    ? Promise.resolve({ ok: false, status: 404, json: async () => ({ available: false }) })
    : evidenceFetch(url, init)
}));

const { LocationCorrectionDialog } = await import("./LocationCorrectionDialog");

describe("the map's chunk loading (Codex r1 on #626)", () => {
  afterEach(cleanup);

  it("holds the frame while the map's chunk loads, then shows the map", async () => {
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
    evidenceFetch.mockResolvedValue({ ok: true, json: async () => ({
      reviewItemId: null, eventId: null, evidenceExpired: false, segment: { id: "seg-cafe", kind: "stay", evidenceCount: 3 },
      map: { gaps: [], centre: { type: "Point", coordinates: [-0.1, 51.5] }, stayRadiusMeters: 80, nearbySavedPlaces: [], acceptedSamples: [] }
    }) });
    const at = new Date(2026, 7, 11, 9).toISOString();
    render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={[]}
      target={{ kind: "place", place: { kind: "place", id: "seg-cafe", status: "finalised", startedAt: at, stoppedAt: at, placeId: null,
        learnedPlaceId: null, name: null, role: null, matchKind: "unknown", confidence: "medium", blockIds: [] } as never, label: "Unknown place" }} />);

    const loading = await screen.findByTestId("evidence-map-loading");
    expect(loading.className).toBe("location-evidence-frame");
    expect(loading.closest(".location-correction-map")).not.toBeNull();
    expect(screen.queryByTestId("evidence-map")).toBeNull();

    chunk.release();
    expect(await screen.findByTestId("evidence-map")).not.toBeNull();
    expect(screen.queryByTestId("evidence-map-loading")).toBeNull();
  });
});
