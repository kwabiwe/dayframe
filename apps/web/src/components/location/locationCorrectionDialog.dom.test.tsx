// @vitest-environment jsdom

// The viewer's zone, with its clock changes (25 Oct 2026 back, 29 Mar 2026 forward); restored after.
const originalTimeZone = process.env.TZ;
process.env.TZ = "Europe/London";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelinePlace, TripLeg } from "@dayframe/shared";

const clientFetch = vi.hoisted(() => vi.fn());
// The dialog reads the item's map from its evidence route when it opens (step 15); those reads have their
// own mock, so `clientFetch` sees only what the dialog sends.
const evidenceFetch = vi.hoisted(() => vi.fn());
// The map itself is MapLibre, client-only; a stand-in shows where it draws.
vi.mock("next/dynamic", () => ({ default: () => function EvidenceMapStandIn() { return <div data-testid="evidence-map" />; } }));
vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: (url: string, init?: RequestInit) => url.includes("/evidence?") ? evidenceFetch(url, init) : clientFetch(url, init)
}));

const { editedInstant, LocationCorrectionDialog } = await import("./LocationCorrectionDialog");

// Location v4 step 13: synthetic ids, made-up names.
const at = (hour: number, minute = 0) => new Date(2026, 7, 11, hour, minute).toISOString();
const place = (patch: Partial<TimelinePlace> = {}): TimelinePlace => ({
  kind: "place", id: "seg-cafe", status: "finalised", startedAt: at(8, 40), stoppedAt: at(10), placeId: null, learnedPlaceId: null,
  name: null, role: null, matchKind: "unknown", confidence: "medium", blockIds: [], ...patch
});
const places = [{ id: "00000000-0000-4000-8000-000000000101", name: "Home", role: "home" }, { id: "00000000-0000-4000-8000-000000000102", name: "Exampleton Library", role: null }];
const leg: TripLeg = { startedAt: at(8, 12), stoppedAt: at(8, 40), mode: "underground", confidence: "unsure", runnerUp: "train", unobserved: true, distanceMeters: 11_000 };
/** Enough of an item's evidence for the dialog: where the visit was, and the saved places near it. */
const evidence = (nearbySavedPlaces: Array<{ id: string; distanceMeters: number }> = []) => ({
  reviewItemId: null, eventId: null,
  map: { centre: { type: "Point", coordinates: [-0.1, 51.5] }, stayRadiusMeters: 80, nearbySavedPlaces }
});
const sent = () => clientFetch.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

describe("correcting the location timeline on the web (location v4 step 13)", () => {
  beforeEach(() => {
    clientFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    evidenceFetch.mockReset().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
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

  it("takes a place you weren't at off the day, joining the trips either side, once you confirm (step 12 part 4)", async () => {
    const onCorrected = vi.fn();
    const onClose = vi.fn();
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={onCorrected} places={places}
      target={{ kind: "place", place: place(), label: "Unknown place", joinsTrips: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "I wasn't here" }));
    expect(clientFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("button", { name: "Take it off your day" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "I wasn't here" }));
    fireEvent.click(screen.getByRole("button", { name: "Take it off your day" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent()).toEqual([{ kind: "delete", subject: "place", itemId: "seg-cafe" }]);
    expect(onCorrected).toHaveBeenCalledTimes(1);
  });

  it("offers I wasn't here only between two trips, and never for a place you are still at", () => {
    render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    expect(screen.queryByRole("button", { name: "I wasn't here" })).toBeNull();
    cleanup();
    render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place({ stoppedAt: null }), label: "Unknown place", joinsTrips: true }} />);
    expect(screen.queryByRole("button", { name: "I wasn't here" })).toBeNull();
  });

  it("says why the server refused to take a place off the day, and keeps the dialog open", async () => {
    clientFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "A trip next to this place is already in a block. Edit the block instead." }) });
    const onClose = vi.fn();
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place(), label: "Unknown place", joinsTrips: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "I wasn't here" }));
    fireEvent.click(screen.getByRole("button", { name: "Take it off your day" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already in a block");
    expect(onClose).not.toHaveBeenCalled();
  });
  it("loads the place's map from its evidence when it opens (step 15)", async () => {
    evidenceFetch.mockResolvedValue({ ok: true, json: async () => evidence() });
    render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    expect(screen.getByText("Loading the map…")).not.toBeNull();
    expect(await screen.findByTestId("evidence-map")).not.toBeNull();
    expect(evidenceFetch.mock.calls[0][0]).toBe(`/api/timeline/items/seg-cafe/evidence?kind=place&startedAt=${encodeURIComponent(at(8, 40))}`);
  });

  it("keeps Done secondary until something changes (owner item O)", () => {
    render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    const done = () => screen.getByRole("button", { name: "Done" });
    expect(done().className).toContain("ui-button-secondary");
    expect(done().className).not.toContain("ui-button-primary");
    fireEvent.click(screen.getByRole("radio", { name: /Exampleton Library/ }));
    expect(done().className).toContain("ui-button-primary");
    // Back as it was: nothing to send, so secondary again.
    fireEvent.click(screen.getByRole("radio", { name: /Leave as unknown/ }));
    expect(done().className).toContain("ui-button-secondary");
    // Typing a name for "Save this place" is a change too.
    fireEvent.change(screen.getByLabelText("Name for this place"), { target: { value: "Pret" } });
    expect(done().className).toContain("ui-button-primary");
  });

  it("asks the row's \"?\" at the top, and an answer closes the dialog (owner item A)", () => {
    const onAnswer = vi.fn();
    const onClose = vi.fn();
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
      question={{ text: "Visited Boots?", yesLabel: "Yes", noLabel: "Not now", onAnswer }}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    const question = screen.getByRole("group", { name: "Visited Boots?" });
    // First in the dialog, above the map and the choices.
    expect(question.parentElement?.firstElementChild).toBe(question);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
      question={{ text: "Where were you?", yesLabel: null, noLabel: "Not now", onAnswer }}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    // A place it can't name has no Yes: Not now, or a choice below.
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onAnswer).toHaveBeenLastCalledWith(false);
  });

  it("logs a place's time as an activity and closes its \"?\" as Not now does", async () => {
    const onClose = vi.fn();
    render(<LocationCorrectionDialog activities={[{ id: "cat-errands", name: "Errands" }]} clock="24h" onClose={onClose} onCorrected={vi.fn()}
      places={places} target={{ kind: "place", place: place(), label: "Unknown place", closeChecks: [{ id: "review-1", mutation: { kind: "skip" } }] }} />);
    expect(screen.getByRole("radio", { name: "Don't log" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Errands" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(clientFetch.mock.calls.map(([url]) => url)).toEqual(["/api/timeline/corrections", "/api/review/review-1"]);
    expect(sent()[0]).toEqual({ kind: "log_place", subject: "place", itemId: "seg-cafe", categoryId: "cat-errands" });
    expect(sent()[1].mutation).toEqual({ kind: "skip" });
  });

  it("sorts saved places nearest first when the map knows the visit's centre, the far ones behind More places", async () => {
    evidenceFetch.mockResolvedValue({ ok: true, json: async () => evidence([{ id: places[1].id, distanceMeters: 120 }, { id: places[0].id, distanceMeters: 5_400 }]) });
    render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    await screen.findByTestId("evidence-map");
    const names = () => within(screen.getByRole("radiogroup", { name: "Where were you?" })).getAllByRole("radio").map((radio) => radio.closest("label")?.querySelector("b")?.textContent);
    expect(names()).toEqual(["Exampleton Library", "Leave as unknown"]);
    expect(screen.getByText("Saved place · 120 m away")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More places (1)" }));
    expect(names()).toEqual(["Exampleton Library", "Home", "Leave as unknown"]);
  });

  it("gives a trip its own dialog: its legs, I didn't leave and This wasn't a trip", async () => {
    const onClose = vi.fn();
    const trip = { kind: "trip" as const, id: "trip-1", status: "finalised" as const, startedAt: at(8, 12), stoppedAt: at(8, 40),
      fromId: "seg-home", toId: "seg-cafe", legs: [leg], blockIds: [] };
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
      target={{ kind: "trip", trip: trip as never, route: "Home → Corner café" }} />);
    expect(screen.getByRole("dialog", { name: "Home → Corner café" })).not.toBeNull();
    // A leg opens inside the dialog, with a way back.
    fireEvent.click(screen.getByRole("button", { name: /Underground\?/ }));
    expect(screen.getByRole("button", { name: "Underground" }).getAttribute("aria-pressed")).toBe("true");
    // Left as it is, the leg sends nothing; the trip's own fixes are back with "All legs".
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(clientFetch).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "All legs" }));
    fireEvent.click(screen.getByRole("button", { name: "This wasn't a trip" }));
    fireEvent.click(screen.getByRole("button", { name: "Take it off your day" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    expect(sent()).toEqual([{ kind: "delete", subject: "trip", itemId: "trip-1" }]);
  });
});
