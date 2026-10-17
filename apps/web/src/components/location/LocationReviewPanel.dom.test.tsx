// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";
import type { CategoryRow } from "@/lib/queries";

const mocks = vi.hoisted(() => ({
  clientFetch: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh })
}));

vi.mock("next/dynamic", () => ({
  default: () => function MockLocationEvidenceMap({ evidence }: { evidence: LocationReviewEvidenceDto }) {
    return <div data-testid="location-evidence-map">{evidence.display.title}</div>;
  }
}));

vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: mocks.clientFetch
}));

const { LocationReviewPanel } = await import("./LocationReviewPanel");

const categories: CategoryRow[] = [{
  id: "20000000-0000-4000-8000-000000000001",
  name: "Commute",
  color: "blue",
  isPinned: true
}, {
  id: "20000000-0000-4000-8000-000000000002",
  name: "Exercise",
  color: "mint",
  isPinned: false
}];

describe("LocationReviewPanel", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => cleanup());

  it("renders one compact Resolve row and submits edited description, category and times", async () => {
    mocks.clientFetch
      .mockResolvedValueOnce(jsonResponse(evidence()))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const onClose = vi.fn();
    render(
      <LocationReviewPanel
        reviewItemId="10000000-0000-4000-8000-000000000001"
        categories={categories}
        entries={[]}
        initialCategoryId={categories[0].id}
        onClose={onClose}
      />
    );
    const user = userEvent.setup();

    expect(await screen.findByTestId("location-evidence-map")).not.toBeNull();
    const description = screen.getByLabelText("Description") as HTMLInputElement;
    const start = screen.getByLabelText("Start time") as HTMLInputElement;
    const end = screen.getByLabelText("End time") as HTMLInputElement;
    const resolveGrid = description.closest(".location-review-resolve-grid");
    expect(resolveGrid).not.toBeNull();
    expect(resolveGrid?.contains(start)).toBe(true);
    expect(resolveGrid?.contains(end)).toBe(true);
    expect(resolveGrid?.querySelector(".location-resolve-category")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Commute/ })).not.toBeNull();

    await user.clear(description);
    await user.type(description, "Morning journey");
    await user.click(screen.getByRole("button", { name: /Commute/ }));
    await user.click(screen.getByRole("option", { name: "Exercise" }));
    await user.click(screen.getByRole("button", { name: "Confirm edits" }));

    await waitFor(() => expect(mocks.clientFetch).toHaveBeenCalledTimes(2));
    const request = mocks.clientFetch.mock.calls[1]?.[1] as RequestInit;
    expect(request.method).toBe("POST");
    expect(JSON.parse(String(request.body))).toMatchObject({
      action: "edit_and_confirm",
      edit: {
        categoryId: categories[1].id,
        description: "Morning journey",
        startedAt: "2026-08-14T09:00:00.000Z",
        stoppedAt: "2026-08-14T10:00:00.000Z"
      }
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("edits times with the shared date picker and a typed time, and never guesses an unreadable one (WUI-042)", async () => {
    mocks.clientFetch
      .mockResolvedValueOnce(jsonResponse(evidence()))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    render(
      <LocationReviewPanel reviewItemId="10000000-0000-4000-8000-000000000001" categories={categories} entries={[]}
        initialCategoryId={categories[0].id} onClose={vi.fn()} />
    );
    const user = userEvent.setup();
    const start = await screen.findByLabelText("Start time") as HTMLInputElement;
    // No native datetime-local field is left; each date opens the shared picker.
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(screen.getByRole("button", { name: /Choose Start date, currently/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Choose End date, currently/ })).not.toBeNull();

    await user.clear(start);
    await user.type(start, "99");
    expect(start.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toMatch(/Enter a time like/);
    expect((screen.getByRole("button", { name: "Confirm edits" }) as HTMLButtonElement).disabled).toBe(true);

    await user.clear(start);
    await user.type(start, "9:15 am");
    await user.tab();
    expect(start.getAttribute("aria-invalid")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Confirm edits" }));
    await waitFor(() => expect(mocks.clientFetch).toHaveBeenCalledTimes(2));
    const day = localDay("2026-08-14T09:00:00.000Z");
    expect(JSON.parse(String((mocks.clientFetch.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({
      action: "edit_and_confirm",
      edit: { startedAt: new Date(`${day}T09:15`).toISOString(), stoppedAt: "2026-08-14T10:00:00.000Z" }
    });
  });

  it("holds the confirmations when an open End gets a day but no time, and never throws (Codex r1 on #474)", async () => {
    const open = evidence();
    mocks.clientFetch.mockResolvedValueOnce(jsonResponse({ ...open, segment: { ...open.segment, stoppedAt: null } }));
    render(
      <LocationReviewPanel reviewItemId="10000000-0000-4000-8000-000000000001" categories={categories} entries={[]}
        initialCategoryId={categories[0].id} onClose={vi.fn()} />
    );
    const user = userEvent.setup();
    const end = await screen.findByLabelText("End time") as HTMLInputElement;
    expect(end.value).toBe("");
    const confirm = screen.getByRole("button", { name: "Confirm edits" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    // Focusing the empty End is not an error, and the hint and the gate agree (Codex r2 on #474).
    await user.click(end);
    expect(end.getAttribute("aria-invalid")).toBeNull();
    await user.type(end, ":");
    await user.clear(end);
    expect(end.getAttribute("aria-invalid")).toBeNull();
    expect(confirm.disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: /Choose End date, currently/ }));
    const days = screen.getAllByRole("button").filter((button) => /^\d{1,2}$/.test(button.textContent ?? "") && !(button as HTMLButtonElement).disabled);
    await user.click(days[0]);
    expect(confirm.disabled).toBe(true);
    expect(end.getAttribute("aria-invalid")).toBe("true");
    await user.click(confirm);
    expect(mocks.clientFetch).toHaveBeenCalledTimes(1);
    await user.type(end, "11:20");
    expect(confirm.disabled).toBe(false);
  });

  it("uses the Blocks controls only (WUI-041)", async () => {
    mocks.clientFetch.mockResolvedValueOnce(jsonResponse(unsavedStay()));
    const { container } = render(
      <LocationReviewPanel reviewItemId="10000000-0000-4000-8000-000000000001" categories={categories} entries={[]}
        initialCategoryId={categories[0].id} onClose={vi.fn()} />
    );
    await screen.findByLabelText("Place name");
    expect(container.querySelector('[class*="industrial-"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Close location evidence" }).className).toContain("df-rbtn");
    expect(screen.getByRole("button", { name: "Confirm edits" }).className).toContain("df-rbtn--live");
  });

  it("saves where you were without logging, keeps the panel and its edits, and says what it matched (design §7)", async () => {
    const stay = unsavedStay();
    mocks.clientFetch
      .mockResolvedValueOnce(jsonResponse(stay))
      .mockResolvedValueOnce(jsonResponse({ ok: true, action: "save_place", status: "open", placeId: "30000000-0000-4000-8000-000000000001", rematchedCount: 2 }))
      .mockResolvedValueOnce(jsonResponse({ ...stay, display: { ...stay.display, placeId: "30000000-0000-4000-8000-000000000001", placeName: "Swim club" } }));
    const onClose = vi.fn();
    render(
      <LocationReviewPanel reviewItemId="10000000-0000-4000-8000-000000000001" categories={categories} entries={[]}
        initialCategoryId={categories[1].id} onClose={onClose} />
    );
    const user = userEvent.setup();
    const description = await screen.findByLabelText("Description") as HTMLInputElement;
    await user.clear(description);
    await user.type(description, "Lessons");
    await user.type(screen.getByLabelText("Place name"), "Swim club");
    await user.click(screen.getByRole("radio", { name: "Large" }));
    await user.click(screen.getByRole("switch", { name: "Log automatically" }));
    await user.click(screen.getByRole("button", { name: "Save place" }));

    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Saved Swim club · 2 more visits now use it");
    expect(JSON.parse(String((mocks.clientFetch.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      action: "save_place", name: "Swim club", radiusMeters: 200, categoryId: categories[1].id, suggestVisits: true, autoLog: true
    });
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe("Lessons");
    // The card now has its place: the box is gone.
    await waitFor(() => expect(screen.queryByLabelText("Place name")).toBeNull());
  });

  it("saves and confirms with the Resolve edits, and turning suggestions off turns Log automatically off", async () => {
    mocks.clientFetch.mockResolvedValueOnce(jsonResponse(unsavedStay())).mockResolvedValueOnce(jsonResponse({ ok: true }));
    const onClose = vi.fn();
    render(
      <LocationReviewPanel reviewItemId="10000000-0000-4000-8000-000000000001" categories={categories} entries={[]}
        initialCategoryId={categories[1].id} onClose={onClose} />
    );
    const user = userEvent.setup();
    const description = await screen.findByLabelText("Description") as HTMLInputElement;
    await user.clear(description);
    await user.type(description, "Lessons");
    await user.type(screen.getByLabelText("Place name"), "Swim club");
    await user.click(screen.getByRole("switch", { name: "Log automatically" }));
    await user.click(screen.getByRole("switch", { name: "Suggest visits here" }));
    expect((screen.getByRole("switch", { name: "Log automatically" }) as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByRole("button", { name: "Save place and confirm" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(JSON.parse(String((mocks.clientFetch.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({
      action: "save_place_and_confirm", name: "Swim club", latitude: 0.001, longitude: 0.002, radiusMeters: 110,
      suggestVisits: false, autoLog: false,
      edit: { categoryId: categories[1].id, description: "Lessons", descriptionTyped: true }
    });
  });

  it("keeps every field and says so when Dayframe can't be reached (Codex r1 on #459)", async () => {
    mocks.clientFetch.mockResolvedValueOnce(jsonResponse(unsavedStay())).mockRejectedValueOnce(new TypeError("Network request failed"));
    const onClose = vi.fn();
    render(
      <LocationReviewPanel reviewItemId="10000000-0000-4000-8000-000000000001" categories={categories} entries={[]}
        initialCategoryId={categories[1].id} onClose={onClose} />
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Place name"), "Swim club");
    await user.click(screen.getByRole("radio", { name: "Large" }));
    await user.click(screen.getByRole("button", { name: "Save place" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't reach Dayframe");
    expect((screen.getByLabelText("Place name") as HTMLInputElement).value).toBe("Swim club");
    expect((screen.getByRole("radio", { name: "Large" }) as HTMLInputElement).checked).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps a failed evidence panel open and retries in place", async () => {
    mocks.clientFetch
      .mockResolvedValueOnce(jsonResponse({ error: "Unable to load location evidence." }, 503))
      .mockResolvedValueOnce(jsonResponse(evidence()));
    const onClose = vi.fn();
    render(
      <LocationReviewPanel
        reviewItemId="10000000-0000-4000-8000-000000000001"
        categories={categories}
        entries={[]}
        initialCategoryId={null}
        onClose={onClose}
      />
    );
    const user = userEvent.setup();

    expect((await screen.findByRole("alert")).textContent).toContain("Unable to load location evidence");
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByTestId("location-evidence-map")).not.toBeNull();
    expect(mocks.clientFetch).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls a widened unknown Visit arrival approximate without claiming confirmed dwell", async () => {
    const visit = evidence();
    visit.segment.kind = "stay";
    visit.segment.approximateArrival = true;
    visit.segment.startUncertainty = {
      lower: "2026-08-14T08:59:40.000Z",
      upper: "2026-08-14T09:24:00.000Z"
    };
    visit.display.title = "Visit at an unknown place";
    mocks.clientFetch.mockResolvedValueOnce(jsonResponse(visit));
    render(
      <LocationReviewPanel
        reviewItemId="10000000-0000-4000-8000-000000000001"
        categories={categories}
        entries={[]}
        initialCategoryId={null}
        onClose={vi.fn()}
      />
    );
    expect((await screen.findByText(/Approximate arrival/)).textContent).toContain("Approximate arrival");
    expect(screen.getByText(/not confirmed stationary time/)).not.toBeNull();
  });

  it("lists the stops recorded inside a trip, and none for a trip without stops", async () => {
    const trip = evidence();
    trip.stops = [
      { startedAt: "2026-08-14T09:22:17.000Z", stoppedAt: "2026-08-14T09:28:15.000Z", durationSeconds: 358, approximate: false },
      { startedAt: "2026-08-14T09:40:00.000Z", stoppedAt: "2026-08-14T09:46:00.000Z", durationSeconds: 360, approximate: true }
    ];
    mocks.clientFetch.mockResolvedValueOnce(jsonResponse(trip));
    const { unmount } = render(
      <LocationReviewPanel
        reviewItemId="10000000-0000-4000-8000-000000000001"
        categories={categories}
        entries={[]}
        initialCategoryId={null}
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByText("2 stops on this trip")).not.toBeNull();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toMatch(/^Stopped .+ · 5m$/);
    expect(rows[1].textContent).toMatch(/^Stopped about .+ · 6m$/);
    expect(rows[1].getAttribute("aria-label")).toMatch(/approximate$/);
    unmount();

    mocks.clientFetch.mockResolvedValueOnce(jsonResponse(evidence()));
    render(
      <LocationReviewPanel
        reviewItemId="10000000-0000-4000-8000-000000000001"
        categories={categories}
        entries={[]}
        initialCategoryId={null}
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByTestId("location-evidence-map")).not.toBeNull();
    expect(screen.queryByText(/on this trip/)).toBeNull();
  });

  it("preserves saved-place gap copy when existing bounds are widened", async () => {
    const saved = evidence();
    saved.segment.kind = "stay";
    saved.segment.continuityStatus = "uncertain_gap";
    saved.segment.startUncertainty = {
      lower: "2026-08-14T08:59:40.000Z",
      upper: "2026-08-14T09:24:00.000Z"
    };
    mocks.clientFetch.mockResolvedValueOnce(jsonResponse(saved));
    render(
      <LocationReviewPanel
        reviewItemId="10000000-0000-4000-8000-000000000001"
        categories={categories}
        entries={[]}
        initialCategoryId={null}
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByText(/A gap limits precision/)).not.toBeNull();
    expect(screen.queryByText(/Approximate arrival/)).toBeNull();
  });
});

function evidence(): LocationReviewEvidenceDto {
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
    textualSummary: "Only journey endpoints are available."
  };
}

/** An unsaved Stay with a centre (synthetic coordinates). */
function unsavedStay(): LocationReviewEvidenceDto {
  const base = evidence();
  return {
    ...base,
    segment: { ...base.segment, kind: "stay", travelMode: null, timeAway: false },
    display: { ...base.display, title: "Visit at an unknown place", placeId: null, placeName: null },
    map: { ...base.map, centre: { type: "Point", coordinates: [0.002, 0.001] } }
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function localDay(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
