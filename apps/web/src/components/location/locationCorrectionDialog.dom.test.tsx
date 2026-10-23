// @vitest-environment jsdom

// The viewer's zone, with its clock changes (25 Oct 2026 back, 29 Mar 2026 forward); restored after.
const originalTimeZone = process.env.TZ;
process.env.TZ = "Europe/London";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelinePlace, TripLeg } from "@dayframe/shared";

const clientFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch }));

const { editedInstant, LocationCorrectionDialog } = await import("./LocationCorrectionDialog");

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
  afterAll(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

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
    expect((screen.getByRole("radio", { name: /Corner café/ }) as HTMLInputElement).checked).toBe(true);
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
  it("keeps untouched times exact, resolves midnight and the clock change, and refuses a skipped time (Codex r1 on #567)", () => {
    // 23:50 → 00:05 is fifteen minutes later, across midnight, not a day earlier.
    expect(editedInstant("2026-08-10T22:50:00.000Z", "00:05")).toBe("2026-08-10T23:05:00.000Z");
    // 01:30 on the morning the clocks go forward doesn't exist.
    expect(editedInstant("2026-03-29T00:15:00.000Z", "01:30")).toBeNull();
    // 01:35 on the night the clocks go back happens twice: the one nearer the 01:30 GMT it replaces.
    expect(editedInstant("2026-10-25T01:30:00.000Z", "01:35")).toBe("2026-10-25T01:35:00.000Z");
    expect(editedInstant("2026-10-25T00:30:00.000Z", "01:35")).toBe("2026-10-25T00:35:00.000Z");
    // A half-hour clock change (Lord Howe Island, 5 Apr 2026): the second 01:45 → 01:50 is five minutes on.
    process.env.TZ = "Australia/Lord_Howe";
    try {
      expect(editedInstant("2026-04-04T15:15:00.000Z", "01:50")).toBe("2026-04-04T15:20:00.000Z");
      expect(editedInstant("2026-04-04T14:45:00.000Z", "01:50")).toBe("2026-04-04T14:50:00.000Z");
    } finally {
      process.env.TZ = "Europe/London";
    }
  });

  it("sends only the edited time, keeping the other instant exact on the night the clocks go back", async () => {
    const onClose = vi.fn();
    // 00:30 BST → 01:30 GMT on 25 Oct: the end (01:30 GMT) is untouched.
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place({ startedAt: "2026-10-24T23:30:00.000Z", stoppedAt: "2026-10-25T01:30:00.000Z" }), label: "Unknown place" }} />);
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "00:45" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent()).toEqual([{ kind: "times", subject: "place", itemId: "seg-cafe", startedAt: "2026-10-24T23:45:00.000Z", stoppedAt: "2026-10-25T01:30:00.000Z" }]);
  });

  it("sends nothing for an unsure leg left as it is", async () => {
    const onClose = vi.fn();
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
      target={{ kind: "leg", tripId: "trip-1", leg, index: 1, count: 3 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(clientFetch).not.toHaveBeenCalled();
  });

  it("after a partial save, compares with what saved, shows it, and locks the choices while saving", async () => {
    const onCorrected = vi.fn();
    let release: (value: unknown) => void = () => undefined;
    clientFetch.mockReset()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "New times must overlap the item's times." }) })
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={onCorrected} places={places}
      target={{ kind: "place", place: place({ learnedPlaceId: "00000000-0000-4000-8000-000000000201", name: "Corner café", matchKind: "learned" }), label: "Corner café" }} />);
    fireEvent.click(screen.getByRole("radio", { name: /Leave as unknown/ }));
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "08:50" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect((await screen.findByRole("alert")).textContent).toBe("New times must overlap the item's times.");
    expect(onCorrected).toHaveBeenCalledTimes(1);
    // Back to the learned place, times as they were: that is a change from what saved (unknown).
    fireEvent.click(screen.getByRole("radio", { name: /Corner café/ }));
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "08:40" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(clientFetch).toHaveBeenCalledTimes(3));
    expect((screen.getByRole("radio", { name: /Leave as unknown/ }) as HTMLInputElement).disabled).toBe(true);
    expect(sent()[2]).toEqual({ kind: "place", subject: "place", itemId: "seg-cafe", placeId: null, learnedPlaceId: "00000000-0000-4000-8000-000000000201" });
    release({ ok: true, json: async () => ({ ok: true }) });
  });
});
