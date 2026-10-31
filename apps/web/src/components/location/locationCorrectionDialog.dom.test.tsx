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
// It counts its mounts and the evidence objects it is handed, so a test can see one map kept across renders.
const mapStandIn = vi.hoisted(() => ({ mounts: 0, evidence: [] as unknown[] }));
vi.mock("next/dynamic", async () => {
  const { useEffect } = await import("react");
  // Apple's Nearby list (MapKit JS only) is its own dynamic chunk: not a map.
  return { default: (loader: () => unknown) => String(loader).includes("NearbyPlaces") ? () => null : function EvidenceMapStandIn({ caption, evidence, visitOnly }: { caption?: string | null; evidence?: unknown; visitOnly?: boolean }) {
    useEffect(() => { mapStandIn.mounts += 1; }, []);
    mapStandIn.evidence.push(evidence);
    return <div data-testid="evidence-map" data-visit-only={String(Boolean(visitOnly))}>{caption}</div>;
  } };
});
vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: (url: string, init?: RequestInit) => url.includes("/api/mapkit-token")
    ? Promise.resolve({ ok: false, status: 404, json: async () => ({ available: false }) })
    : url.includes("/evidence?") ? evidenceFetch(url, init) : clientFetch(url, init)
}));

const { DIALOG_SECTION_ORDER, editedInstant, legEvidence, LocationCorrectionDialog } = await import("./LocationCorrectionDialog");

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
  reviewItemId: null, eventId: null, evidenceExpired: false,
  segment: { kind: "stay", evidenceCount: 14 },
  map: { gaps: [{ startedAt: at(8, 50), stoppedAt: at(9, 5) }], centre: { type: "Point", coordinates: [-0.1, 51.5] }, stayRadiusMeters: 80, nearbySavedPlaces }
});
const bodies = () => clientFetch.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
/** What was sent, without the per-correction receipt id (checked on its own). */
const sent = () => bodies().map((body) => {
  const { clientCorrectionId, ...rest } = body;
  void clientCorrectionId;
  return rest;
});
/** "More options": Logs as, the times, Save this place, Leave as unknown and I wasn't here wait behind it (UI review round 2). */
const moreOptions = () => fireEvent.click(screen.getByRole("button", { name: "More options" }));
/** A TimeField commits what was typed on blur. */
const typeTime = (label: "Start time" | "End time", value: string) => {
  const field = screen.getByLabelText(label);
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
};

describe("correcting the location timeline on the web (location v4 step 13)", () => {
  beforeEach(() => {
    clientFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    evidenceFetch.mockReset().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    mapStandIn.mounts = 0;
    mapStandIn.evidence.length = 0;
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
    moreOptions();
    typeTime("Start time", "08:45");
    // A tapped saved place answers at once, with the other edits (no visit centre here, so it is found by search).
    fireEvent.change(screen.getByLabelText("Search places"), { target: { value: "library" } });
    fireEvent.click(within(screen.getByRole("list", { name: "Saved places found" })).getByRole("button", { name: /Exampleton Library/ }));
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
    expect(within(screen.getByRole("list", { name: "Saved places nearby" })).getByRole("button", { name: /Corner café/ }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
    moreOptions();
    typeTime("Start time", "00:45");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
    moreOptions();
    typeTime("Start time", "08:50");
    // A tapped place applies at once, with the edited time.
    fireEvent.change(screen.getByLabelText("Search places"), { target: { value: "Home" } });
    fireEvent.click(screen.getByRole("button", { name: /^Home/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("New times must overlap the item's times.");
    expect(onCorrected).toHaveBeenCalledTimes(1);
    expect(sent().slice(0, 2).map((body) => body.kind)).toEqual(["place", "times"]);
    // Back to the learned place, times as they were: that is a change from what saved (unknown).
    typeTime("Start time", "08:40");
    fireEvent.change(screen.getByLabelText("Search places"), { target: { value: "" } });
    fireEvent.click(within(screen.getByRole("list", { name: "Saved places nearby" })).getByRole("button", { name: /Corner café/ }));
    await waitFor(() => expect(clientFetch).toHaveBeenCalledTimes(3));
    expect((within(screen.getByRole("list", { name: "Saved places nearby" })).getByRole("button", { name: /Corner café/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Start time") as HTMLInputElement).disabled).toBe(true);
    expect(sent()[2]).toEqual({ kind: "place", subject: "place", itemId: "seg-cafe", placeId: null, learnedPlaceId: "00000000-0000-4000-8000-000000000201" });
    release({ ok: true, json: async () => ({ ok: true }) });
  });

  it("takes a place you weren't at off the day, joining the trips either side, once you confirm (step 12 part 4)", async () => {
    const onCorrected = vi.fn();
    const onClose = vi.fn();
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={onCorrected} places={places}
      target={{ kind: "place", place: place(), label: "Unknown place", joinsTrips: true }} />);
    moreOptions();
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
    moreOptions();
    expect(screen.queryByRole("button", { name: "I wasn't here" })).toBeNull();
    cleanup();
    render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place({ stoppedAt: null }), label: "Unknown place", joinsTrips: true }} />);
    moreOptions();
    expect(screen.queryByRole("button", { name: "I wasn't here" })).toBeNull();
  });

  it("says why the server refused to take a place off the day, and keeps the dialog open", async () => {
    clientFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "A trip next to this place is already in a block. Edit the block instead." }) });
    const onClose = vi.fn();
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place(), label: "Unknown place", joinsTrips: true }} />);
    moreOptions();
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

  it("offers the question's Yes as the primary until something is edited, then Save (owner item O, round 2)", async () => {
    // With the visit's centre, so "Save this place" shows.
    evidenceFetch.mockResolvedValue({ ok: true, json: async () => evidence() });
    render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
      question={{ text: "Visited Boots?", yesLabel: "Yes", noLabel: "Not now", onAnswer: vi.fn() }}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    const primary = () => document.querySelector(".ui-button-primary")?.textContent;
    expect(primary()).toBe("Yes");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    // No Cancel/Done pair on a place: the ✕ closes, Not now answers no.
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    await screen.findByTestId("evidence-map");
    moreOptions();
    typeTime("Start time", "08:45");
    expect(primary()).toBe("Save");
    // Back as it was: nothing to send, so the question's Yes again.
    typeTime("Start time", "08:40");
    expect(primary()).toBe("Yes");
    // Typing a name for "Save this place" is a change too.
    fireEvent.change(screen.getByLabelText("Name for this place"), { target: { value: "Pret" } });
    expect(primary()).toBe("Save");
  });

  it("asks the row's \"?\" at the top, and an answer closes the dialog (owner item A)", () => {
    const onAnswer = vi.fn();
    const onClose = vi.fn();
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
      question={{ text: "Visited Boots?", yesLabel: "Yes", noLabel: "Not now", onAnswer }}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    // No question card: the question is a plain line, first in the dialog, above the map and the choices.
    expect(document.querySelector(".location-correction-question")).toBeNull();
    const question = document.querySelector("p.location-correction-ask")!;
    expect(question.textContent).toBe("Visited Boots?");
    expect(question.parentElement?.firstElementChild).toBe(question);
    // Its Yes is the footer's primary.
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
      question={{ text: "Where were you?", yesLabel: null, noLabel: "Not now", onAnswer }}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    // A place it can't name has no Yes: Not now, or a choice below; "Where were you?" isn't repeated as a line.
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
    expect(document.querySelector(".location-correction-ask")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Don't log" }));
    expect(onAnswer).toHaveBeenLastCalledWith(false);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("clears a Logs as pick from its own chip, keeping focus on it (Codex r5 on #620; Don't log removed in round 2)", () => {
    render(<LocationCorrectionDialog activities={[{ id: "cat-errands", name: "Errands", color: "teal" }]} clock="24h" onClose={vi.fn()}
      onCorrected={vi.fn()} places={places} target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    moreOptions();
    const chip = screen.getByRole("radio", { name: "Errands" });
    chip.focus();
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("button", { name: "Don't log" })).toBeNull();
    // Pressed again, the pick goes, and focus stays on the chip it cleared, never on the page.
    fireEvent.click(chip);
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Errands" }));
    expect(screen.getByRole("radio", { name: "Errands" }).getAttribute("aria-checked")).toBe("false");
  });

  it("logs a place with no \"?\" as an activity through log_place", async () => {
    const onClose = vi.fn();
    render(<LocationCorrectionDialog activities={[{ id: "cat-errands", name: "Errands" }]} clock="24h" onClose={onClose} onCorrected={vi.fn()}
      places={places} target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    moreOptions();
    // Nothing picked is "don't log": no "Don't log" choice to select, and no activity checked.
    expect(screen.queryByRole("radio", { name: "Don't log" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Don't log" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Errands" }).getAttribute("aria-checked")).toBe("false");
    // Picked, the chip again is the way back; picked again, it logs.
    fireEvent.click(screen.getByRole("radio", { name: "Errands" }));
    fireEvent.click(screen.getByRole("radio", { name: "Errands" }));
    expect(screen.getByRole("radio", { name: "Errands" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("radio", { name: "Errands" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(clientFetch.mock.calls.map(([url]) => url)).toEqual(["/api/timeline/corrections"]);
    expect(sent()).toEqual([{ kind: "log_place", subject: "place", itemId: "seg-cafe", categoryId: "cat-errands" }]);
  });

  it("logs a place that asks through log_place, after the other changes, and never answers its \"?\" for it (Codex r2 on #609)", async () => {
    // The server closes the place's open "?" as their own Not now does, in the same transaction, and logs only the
    // time your blocks don't cover: so Logs as is log_place whether or not the place asks.
    const onAnswer = vi.fn();
    const onClose = vi.fn();
    const onCorrected = vi.fn();
    render(<LocationCorrectionDialog activities={[{ id: "cat-errands", name: "Errands" }]} clock="24h" onClose={onClose} onCorrected={onCorrected}
      places={places} question={{ text: "Visited Boots?", yesLabel: "Yes", noLabel: "Not now", onAnswer }}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    moreOptions();
    typeTime("Start time", "08:45");
    fireEvent.click(screen.getByRole("radio", { name: "Errands" }));
    // Edited, the primary saves the edits instead of answering Yes.
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The time correction first, so log_place reads the corrected place.
    expect(sent()).toEqual([
      { kind: "times", subject: "place", itemId: "seg-cafe", startedAt: at(8, 45), stoppedAt: at(10) },
      { kind: "log_place", subject: "place", itemId: "seg-cafe", categoryId: "cat-errands" }
    ]);
    expect(onAnswer).not.toHaveBeenCalled();
    // The refresh after it is what hides the "?".
    expect(onCorrected).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open and says why when Logs as is refused", async () => {
    clientFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Your blocks already cover this place's time." }) });
    const onClose = vi.fn();
    render(<LocationCorrectionDialog activities={[{ id: "cat-errands", name: "Errands" }]} clock="24h" onClose={onClose} onCorrected={vi.fn()}
      places={places} question={{ text: "Visited Boots?", yesLabel: "Yes", noLabel: "Not now", onAnswer: vi.fn() }}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    moreOptions();
    fireEvent.click(screen.getByRole("radio", { name: "Errands" }));
    expect(screen.getByRole("button", { name: "Save" }).className).toContain("ui-button-primary");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Your blocks already cover this place's time.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("starts its fields again from the place a refresh moved, once nothing is saving (Codex r2 on #609)", () => {
    const onClose = vi.fn();
    const ask = { text: "Visited Boots?", yesLabel: "Yes", noLabel: "Not now", onAnswer: vi.fn() };
    const view = render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places} question={ask}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    moreOptions();
    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("08:40");
    view.rerender(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places} question={ask}
      target={{ kind: "place", place: place({ startedAt: at(8, 50) }), label: "Unknown place" }} />);
    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("08:50");
    // Nothing changed from the new copy: the primary is still the question's Yes, not Save.
    expect(screen.getByRole("button", { name: "Yes" }).className).toContain("ui-button-primary");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    // Its map is read again for the new times.
    expect(evidenceFetch.mock.calls.map(([url]) => url)).toEqual([
      `/api/timeline/items/seg-cafe/evidence?kind=place&startedAt=${encodeURIComponent(at(8, 40))}`,
      `/api/timeline/items/seg-cafe/evidence?kind=place&startedAt=${encodeURIComponent(at(8, 50))}`
    ]);
  });

  it("keeps the question open when its own answer isn't saved, and closes once it is", async () => {
    const onClose = vi.fn();
    const onAnswer = vi.fn().mockResolvedValueOnce("Couldn't save that answer. Try again.").mockResolvedValueOnce(null);
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
      question={{ text: "Visited Boots?", yesLabel: "Yes", noLabel: "Not now", onAnswer }} target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save that answer. Try again.");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("offers Save, not the question's Yes, while a creation's outcome is unknown (Codex r3 on #636)", async () => {
    evidenceFetch.mockResolvedValue({ ok: true, json: async () => evidence() });
    clientFetch.mockReset().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const onAnswer = vi.fn();
    render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
      question={{ text: "Visited Boots?", yesLabel: "Yes", noLabel: "Not now", onAnswer }} target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    await screen.findByTestId("evidence-map");
    expect(screen.getByRole("button", { name: "Yes" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search places"), { target: { value: "Bakery" } });
    fireEvent.change(screen.getByLabelText("Search places"), { target: { value: "Bakery" } });
    fireEvent.click(screen.getByRole("button", { name: "Save “Bakery” as a place" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("saves a new place in the correction itself, for a wrongly matched visit in a block too (owner 31 Oct 2026)", async () => {
    evidenceFetch.mockResolvedValue({ ok: true, json: async () => evidence() });
    clientFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const onClose = vi.fn();
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place({ placeId: places[1].id, name: "Exampleton Library", matchKind: "saved", blockIds: ["block-1"] }), label: "Exampleton Library" }} />);
    await screen.findByTestId("evidence-map");
    fireEvent.change(screen.getByLabelText("Search places"), { target: { value: "Pret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save “Pret” as a place" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(clientFetch.mock.calls.map(([url]) => url)).toEqual(["/api/timeline/corrections"]);
    expect(sent()[0]).toEqual({ kind: "place", subject: "place", itemId: "seg-cafe", placeId: null, learnedPlaceId: null,
      newPlace: { name: "Pret", latitude: 51.5, longitude: -0.1, radiusMeters: 80 } });
  });

  it("leaves a block's times to the block, and sends the new place first with an unlogged visit's other edits", async () => {
    evidenceFetch.mockResolvedValue({ ok: true, json: async () => evidence() });
    const view = render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place({ blockIds: ["block-1"] }), label: "Unknown place" }} />);
    await screen.findByTestId("evidence-map");
    moreOptions();
    expect(screen.queryByLabelText("Start time")).toBeNull();
    view.unmount();
    clientFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const onClose = vi.fn();
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    await screen.findByTestId("evidence-map");
    moreOptions();
    typeTime("Start time", "08:45");
    fireEvent.change(screen.getByLabelText("Name for this place"), { target: { value: "Pret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent().map((each) => each.kind)).toEqual(["place", "times"]);
  });

  it("retries a lost reply under one id, even with the name edited, so a place is never saved twice", async () => {
    evidenceFetch.mockResolvedValue({ ok: true, json: async () => evidence() });
    clientFetch.mockReset().mockRejectedValueOnce(new Error("lost")).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const onClose = vi.fn();
    render(<LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    await screen.findByTestId("evidence-map");
    moreOptions();
    fireEvent.change(screen.getByLabelText("Name for this place"), { target: { value: "Pret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save place" }));
    await screen.findByRole("alert");
    fireEvent.change(screen.getByLabelText("Name for this place"), { target: { value: "Pret A Manger" } });
    fireEvent.click(screen.getByRole("button", { name: "Save place" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [first, second] = bodies();
    expect(second.clientCorrectionId).toBe(first.clientCorrectionId);
  });

  it("lists at most two saved places within 1 km, nearest first, and finds the far ones by search", async () => {
    const shop = { id: "00000000-0000-4000-8000-000000000103", name: "Corner Shop", role: null };
    const park = { id: "00000000-0000-4000-8000-000000000104", name: "Exampleton Park", role: null };
    const nearby = [...places, shop, park];
    evidenceFetch.mockResolvedValue({ ok: true, json: async () => evidence([
      { id: park.id, distanceMeters: 900 }, { id: places[1].id, distanceMeters: 120 }, { id: shop.id, distanceMeters: 600 }, { id: places[0].id, distanceMeters: 5_400 }
    ]) });
    render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={nearby}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    await screen.findByTestId("evidence-map");
    const names = (list: string) => within(screen.getByRole("list", { name: list })).getAllByRole("button").map((button) => button.querySelector("b")?.textContent);
    expect(names("Saved places nearby")).toEqual(["Exampleton Library", "Corner Shop"]);
    expect(screen.getByText("Saved place · 120 m away")).not.toBeNull();
    // No "Show all saved places" and no radio "Leave as unknown" row: the far ones are a search away.
    expect(screen.queryByRole("button", { name: "Show all saved places" })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search places"), { target: { value: "home" } });
    expect(names("Saved places found")).toEqual(["Home"]);
    // The pinned slot under the results, only while there's text.
    expect(screen.getByRole("button", { name: "Save “home” as a place" }).parentElement?.className).toBe("location-correction-results");
    expect(screen.getByText("Saved place · 5.4 km away")).not.toBeNull();
    // Every saved place that matches.
    fireEvent.change(screen.getByLabelText("Search places"), { target: { value: "e" } });
    expect(names("Saved places found")).toHaveLength(4);
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
  it("hands the map one evidence object across re-renders, so it never rebuilds (glitch fix 1)", async () => {
    evidenceFetch.mockResolvedValue({ ok: true, json: async () => evidence() });
    const props = { clock: "24h" as const, onClose: vi.fn(), onCorrected: vi.fn(), places, target: { kind: "place" as const, place: place(), label: "Unknown place" } };
    const view = render(<LocationCorrectionDialog {...props} />);
    await screen.findByTestId("evidence-map");
    // Typing, a choice and a re-render from above (the clock's tick) change nothing for the map.
    moreOptions();
    typeTime("Start time", "08:45");
    typeTime("End time", "09:55");
    fireEvent.change(screen.getByLabelText("Search places"), { target: { value: "lib" } });
    view.rerender(<LocationCorrectionDialog {...props} />);
    expect(mapStandIn.mounts).toBe(1);
    expect(mapStandIn.evidence.length).toBeGreaterThan(2);
    expect(new Set(mapStandIn.evidence).size).toBe(1);
  });

  it("keeps one map across a trip's leg and back, drawing the leg in it (glitch fix 5)", async () => {
    const point = (longitude: number, latitude: number) => ({ type: "Point", coordinates: [longitude, latitude] });
    const walk: TripLeg = { startedAt: at(8), stoppedAt: at(8, 12), mode: "walking", confidence: "sure", distanceMeters: 800 };
    const samples = [
      { id: "a", point: point(-0.10, 51.50), occurredAt: at(8, 2) },
      { id: "b", point: point(-0.11, 51.51), occurredAt: at(8, 10) },
      { id: "c", point: point(-0.20, 51.60), occurredAt: at(8, 30) }
    ];
    evidenceFetch.mockResolvedValue({ ok: true, json: async () => ({ ...evidence(), segment: { id: "trip-1", kind: "commute", evidenceCount: 3 },
      map: { ...evidence().map, centre: null, stayRadiusMeters: null, route: { type: "LineString", coordinates: samples.map((sample) => sample.point.coordinates) }, acceptedSamples: samples } }) });
    const trip = { kind: "trip" as const, id: "trip-1", status: "finalised" as const, startedAt: at(8), stoppedAt: at(8, 40),
      fromId: "seg-home", toId: "seg-cafe", legs: [walk, leg], blockIds: [] };
    render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
      target={{ kind: "trip", trip: trip as never, route: "Home → Corner café" }} />);
    await screen.findByTestId("evidence-map");
    const tripEvidence = mapStandIn.evidence.at(-1) as { map: { route: { coordinates: unknown[] } } };
    expect(tripEvidence.map.route.coordinates).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /Walk/ }));
    expect(screen.getByRole("button", { name: "All legs" })).not.toBeNull();
    const walkEvidence = mapStandIn.evidence.at(-1) as { map: { route: { coordinates: unknown[] } } };
    expect(walkEvidence.map.route.coordinates).toEqual([[-0.10, 51.50], [-0.11, 51.51]]);
    fireEvent.click(screen.getByRole("button", { name: "All legs" }));
    // Back to the trip's content (the map compares content, not the object).
    expect(mapStandIn.evidence.at(-1)).toStrictEqual(tripEvidence);
    // An unobserved leg (no readings of its own) shows the trip.
    fireEvent.click(screen.getByRole("button", { name: /Underground\?/ }));
    expect((mapStandIn.evidence.at(-1) as typeof tripEvidence).map.route.coordinates).toHaveLength(3);
    expect(mapStandIn.mounts).toBe(1);
  });

  it("draws a leg from the trip's readings within its times (glitch fix 5)", () => {
    const sample = (id: string, minute: number) => ({ id, point: { type: "Point" as const, coordinates: [minute, 51] as [number, number] }, occurredAt: at(8, minute), accuracyMeters: 5, kind: "location", role: null });
    const tripEvidence = { segment: { evidenceCount: 3 }, map: { route: null, straightLineFallback: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
      acceptedSamples: [sample("c", 30), sample("a", 2), sample("b", 10)] } } as never;
    const shown = legEvidence(tripEvidence, { startedAt: at(8), stoppedAt: at(8, 12) });
    expect(shown.map.route?.coordinates).toEqual([[2, 51], [10, 51]]);
    expect(shown.map.straightLineFallback).toBeNull();
    expect(shown.segment.evidenceCount).toBe(2);
    expect(legEvidence(tripEvidence, { startedAt: at(8, 20), stoppedAt: at(8, 40) })).toBe(tripEvidence);
  });

  it("sends each correction with one id, reused when it is retried, so a lost reply's receipt comes back (Codex r3 on #609)", async () => {
    clientFetch.mockReset()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const onClose = vi.fn();
    render(<LocationCorrectionDialog activities={[{ id: "cat-errands", name: "Errands" }]} clock="24h" onClose={onClose} onCorrected={vi.fn()}
      places={places} target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    moreOptions();
    fireEvent.click(screen.getByRole("radio", { name: "Errands" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Check your connection");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [first, retry] = bodies();
    expect(first.clientCorrectionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(retry).toEqual(first);
  });

  it("keeps the open leg when its trip refreshes, and goes back to the trip when that leg is gone (Codex r3 on #609)", () => {
    const walk: TripLeg = { startedAt: at(8), stoppedAt: at(8, 12), mode: "walking", confidence: "sure", distanceMeters: 800 };
    const trip = (legs: TripLeg[]) => ({ kind: "trip" as const, id: "trip-1", status: "finalised" as const, startedAt: at(8), stoppedAt: at(8, 40),
      fromId: "seg-home", toId: "seg-cafe", legs, blockIds: [] }) as never;
    const view = render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
      target={{ kind: "trip", trip: trip([walk, leg]), route: "Home → Corner café" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Underground\?/ }));
    expect(screen.getByRole("dialog").textContent).toContain("Leg 2 of 2");
    // A leg added before it: the same leg, now the third.
    const early: TripLeg = { ...walk, startedAt: at(7, 50), stoppedAt: at(8) };
    view.rerender(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
      target={{ kind: "trip", trip: trip([early, walk, leg]), route: "Home → Corner café" }} />);
    expect(screen.getByRole("dialog").textContent).toContain("Leg 3 of 3");
    // The legs merged into one: that leg is gone, so the dialog is the trip again.
    view.rerender(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
      target={{ kind: "trip", trip: trip([{ ...walk, stoppedAt: at(8, 40) }]), route: "Home → Corner café" }} />);
    expect(screen.getByRole("group", { name: "Legs" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "All legs" })).toBeNull();
  });

  it("reads the map again when a refresh moves the place's end (Codex r3 on #609)", () => {
    const view = render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place(), label: "Unknown place" }} />);
    expect(evidenceFetch).toHaveBeenCalledTimes(1);
    view.rerender(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
      target={{ kind: "place", place: place({ stoppedAt: at(10, 30) }), label: "Unknown place" }} />);
    expect(evidenceFetch).toHaveBeenCalledTimes(2);
  });
  it("moves the open leg's baseline to a refreshed mode, keeping a mode the person already picked (Codex r4 on #609)", async () => {
    const trip = (mode: TripLeg["mode"]) => ({ kind: "trip" as const, id: "trip-1", status: "finalised" as const, startedAt: at(8, 12),
      stoppedAt: at(8, 40), fromId: "seg-home", toId: "seg-cafe", legs: [{ ...leg, mode, confidence: "sure" as const }], blockIds: [] }) as never;
    const dialog = (mode: TripLeg["mode"], onClose = vi.fn()) => (
      <LocationCorrectionDialog clock="24h" onClose={onClose} onCorrected={vi.fn()} places={places}
        target={{ kind: "trip", trip: trip(mode), route: "Home → Corner café" }} />);
    const pressed = () => screen.getAllByRole("button", { pressed: true }).map((button) => button.textContent);
    const view = render(dialog("underground"));
    fireEvent.click(screen.getByRole("button", { name: /^Underground/ }));
    expect(pressed()).toEqual(["Underground"]);
    // Refreshed as Train: Train is chosen and is what nothing-changed means.
    view.rerender(dialog("train"));
    expect(pressed()).toEqual(["Train"]);
    expect(screen.getByRole("button", { name: "Done" }).className).toContain("ui-button-secondary");
    // Underground is now a change from the new baseline, and is sent.
    fireEvent.click(screen.getByRole("button", { name: "Underground" }));
    const onClose = vi.fn();
    view.rerender(dialog("train", onClose));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent()).toEqual([{ kind: "leg_mode", subject: "leg", itemId: "trip-1", legStartedAt: leg.startedAt, legStoppedAt: leg.stoppedAt, mode: "underground" }]);
    cleanup();
    // A pick made before the refresh stays the person's: Bus, compared with the refreshed Train.
    clientFetch.mockClear();
    const second = render(dialog("underground"));
    fireEvent.click(screen.getByRole("button", { name: /^Underground/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bus" }));
    second.rerender(dialog("train"));
    expect(pressed()).toEqual(["Bus"]);
    expect(screen.getByRole("button", { name: "Done" }).className).toContain("ui-button-primary");
  });
  describe("one layout for every place and trip dialog", () => {
    const sections = () => [...document.querySelectorAll("[data-section]")].map((node) => node.getAttribute("data-section"));
    const inOrder = (seen: Array<string | null>) => DIALOG_SECTION_ORDER.filter((id) => seen.includes(id));
    const home = () => place({ placeId: places[0].id, name: "Home", role: "home", matchKind: "saved" });
    const tripTarget = () => ({ kind: "trip" as const, route: "Home → Exampleton Library", trip: { kind: "trip" as const, id: "trip-1",
      status: "finalised" as const, startedAt: at(8, 12), stoppedAt: at(8, 40), fromId: "seg-home", toId: "seg-cafe", legs: [leg], blockIds: [] } as never });

    it("puts the sections in the same order for an unknown place, a saved place and a trip", async () => {
      evidenceFetch.mockResolvedValue({ ok: true, json: async () => evidence() });
      const activities = [{ id: "cat-errands", name: "Errands", color: "teal" }];
      const ask = { text: "Where were you?", yesLabel: null, noLabel: "Not now", onAnswer: vi.fn() };
      render(<LocationCorrectionDialog activities={activities} clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places} question={ask}
        target={{ kind: "place", place: place(), label: "Unknown place", joinsTrips: true }} />);
      await screen.findByTestId("evidence-map");
      // A place is the question itself (round 2): no question card; the rest waits behind More options.
      expect(sections()).toEqual(["map", "where"]);
      moreOptions();
      expect(sections()).toEqual(["map", "where", "logs-as", "times"]);
      expect(sections()).toEqual(inOrder(sections()));
      cleanup();
      render(<LocationCorrectionDialog activities={activities} clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
        target={{ kind: "place", place: home(), label: "Home" }} />);
      await screen.findByTestId("evidence-map");
      moreOptions();
      expect(sections()).toEqual(["map", "where", "logs-as", "times"]);
      cleanup();
      render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
        question={{ text: "Getting around?", yesLabel: "Yes", noLabel: "Not now", onAnswer: vi.fn() }} target={tripTarget()} />);
      await screen.findByTestId("evidence-map");
      expect(sections()).toEqual(["question", "map", "corrections"]);
      expect(sections()).toEqual(inOrder(sections()));
    });

    it("never shows the gap list, says at most how many readings, and nothing of them for a saved place", async () => {
      evidenceFetch.mockResolvedValue({ ok: true, json: async () => evidence() });
      render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
        target={{ kind: "place", place: place(), label: "Unknown place" }} />);
      const map = await screen.findByTestId("evidence-map");
      expect(map.textContent).toBe("Based on 14 readings");
      // The dialog's map (PlaceSheetMap: MapKit JS or MapLibre) only ever draws the visit's area or the trip's route.
      expect(map.getAttribute("data-visit-only")).toBe("false");
      expect(document.body.textContent).not.toMatch(/No readings|Fix the shape|More places/);
      cleanup();
      render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places}
        target={{ kind: "place", place: home(), label: "Home" }} />);
      expect((await screen.findByTestId("evidence-map")).textContent).toBe("");
      expect(document.body.textContent).not.toMatch(/reading/);
      // A trip says nothing of them either, on the trip or on its leg.
      cleanup();
      const fetched = evidence();
      evidenceFetch.mockResolvedValue({ ok: true, json: async () => ({ ...fetched, segment: { ...fetched.segment, kind: "commute" } }) });
      render(<LocationCorrectionDialog clock="24h" onClose={vi.fn()} onCorrected={vi.fn()} places={places} target={tripTarget()} />);
      expect((await screen.findByTestId("evidence-map")).textContent).toBe("");
      expect(document.body.textContent).not.toMatch(/reading/);
    });

    it("never selects Don't log as a filled pill: the Logs as chips are the shared activity chips", () => {
      render(<LocationCorrectionDialog activities={[{ id: "cat-errands", name: "Errands", color: "teal" }]} clock="24h" onClose={vi.fn()}
        onCorrected={vi.fn()} places={places} target={{ kind: "place", place: place(), label: "Unknown place" }} />);
      moreOptions();
      const group = screen.getByRole("radiogroup", { name: "Logs as" });
      expect(within(group).getAllByRole("radio").map((radio) => radio.className)).toEqual(["df-rchip"]);
      expect(group.querySelector(".df-rchip-block.df-block")).not.toBeNull();
      expect(within(group).queryByText("Don't log")).toBeNull();
      expect(document.querySelector('[aria-checked="true"]')).toBeNull();
    });
  });
});
