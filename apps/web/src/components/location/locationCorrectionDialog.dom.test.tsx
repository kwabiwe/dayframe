// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelinePlace, TripLeg } from "@dayframe/shared";

const clientFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch }));

const { LocationCorrectionDialog } = await import("./LocationCorrectionDialog");

// Location v4 step 13: synthetic ids, made-up names.
const at = (hour: number, minute = 0) => new Date(2026, 7, 11, hour, minute).toISOString();
const place = (patch: Partial<TimelinePlace> = {}): TimelinePlace => ({
  kind: "place", id: "seg-cafe", status: "finalised", startedAt: at(8, 40), stoppedAt: at(10), placeId: null, learnedPlaceId: null,
  name: null, role: null, matchKind: "unknown", confidence: "medium", blockIds: [], ...patch
});
const places = [{ id: "00000000-0000-4000-8000-000000000101", name: "Home", role: "home" }, { id: "00000000-0000-4000-8000-000000000102", name: "Exampleton Library", role: null }];
const leg: TripLeg = { startedAt: at(8, 12), stoppedAt: at(8, 40), mode: "underground", confidence: "unsure", runnerUp: "train", unobserved: true, distanceMeters: 11_000 };
const sent = () => clientFetch.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

describe("correcting the location timeline on the web (location v4 step 13)", () => {
  beforeEach(() => {
    clientFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  });
  afterEach(cleanup);

  it("sets an unknown place's place and times, event-first through the corrections API", async () => {
    const onCorrected = vi.fn();
    const onClose = vi.fn();
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={onCorrected} places={places}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    fireEvent.click(screen.getByRole("radio", { name: /Exampleton Library/ }));
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "08:45" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent()).toEqual([
      { kind: "place", subject: "place", itemId: "seg-cafe", placeId: places[1].id, learnedPlaceId: null },
      { kind: "times", subject: "place", itemId: "seg-cafe", startedAt: at(8, 45), stoppedAt: at(10) }
    ]);
    expect(clientFetch.mock.calls[0][0]).toBe("/api/timeline/corrections");
    expect(onCorrected).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when nothing changed, and never turns a learned place unknown by itself", async () => {
    const onClose = vi.fn();
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place({ learnedPlaceId: "00000000-0000-4000-8000-000000000201", name: "Corner café", matchKind: "learned" }), label: "Corner café" }} />);
    expect(screen.getByRole("radio", { name: /Corner café/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(clientFetch).not.toHaveBeenCalled();
  });

  it("sets a leg's mode, and shows why the server refused one", async () => {
    clientFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "That leg is no longer part of this trip." }) });
    const onClose = vi.fn();
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
      target={{ kind: "leg", tripId: "trip-1", leg, index: 1, count: 3 }} />);
    expect(screen.getByRole("button", { name: "Underground" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Train" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That leg is no longer part of this trip.");
    expect(onClose).not.toHaveBeenCalled();
    expect(sent()).toEqual([{ kind: "leg_mode", subject: "leg", itemId: "trip-1", legStartedAt: leg.startedAt, legStoppedAt: leg.stoppedAt, mode: "train" }]);
  });
});
