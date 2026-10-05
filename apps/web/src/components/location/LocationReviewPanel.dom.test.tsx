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
    const start = screen.getByLabelText("Start") as HTMLInputElement;
    const end = screen.getByLabelText("End") as HTMLInputElement;
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
    expect(rows[0].textContent).toMatch(/^Stopped .+ · 6m$/);
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
