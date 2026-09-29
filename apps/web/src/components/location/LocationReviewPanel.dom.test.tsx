// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("previews both journeys and sends one canonical Review mutation with the entered stop times", async () => {
    const commute = evidence();
    commute.segment.status = "finalised";
    mocks.clientFetch.mockResolvedValueOnce(jsonResponse(commute)).mockImplementationOnce(async (_url, request: RequestInit) => {
      const envelope = JSON.parse(String(request.body));
      return jsonResponse({ ok: true, action: "interrupt_commute", status: "accepted",
        clientMutationId: envelope.clientMutationId, reviewItemId: commute.reviewItemId,
        childSegmentIds: ["child-1", "child-2"], childReviewItemIds: ["review-1", "review-2"] });
    });
    const onClose = vi.fn();
    render(<LocationReviewPanel reviewItemId={commute.reviewItemId} categories={categories}
      entries={[]} initialCategoryId={null} onClose={onClose} />);
    expect(await screen.findByText("Interrupted this commute?")).not.toBeNull();
    const submit = screen.getByRole("button", { name: "Save interruption and review both legs" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Stop began"), { target: { value: localInput("2026-08-14T09:20:00.000Z") } });
    fireEvent.change(screen.getByLabelText("Journey resumed"), { target: { value: localInput("2026-08-14T09:35:00.000Z") } });
    expect(submit.disabled).toBe(false);
    expect(screen.getByLabelText("Interruption preview").textContent).toContain("Journey 1");
    expect(screen.getByLabelText("Interruption preview").textContent).toContain("Unassigned stop");
    expect(screen.getByLabelText("Interruption preview").textContent).toContain("Journey 2");
    await userEvent.setup().click(submit);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const [url, request] = mocks.clientFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`/api/review/${commute.reviewItemId}`);
    expect(request.method).toBe("POST");
    expect(JSON.parse(String(request.body))).toMatchObject({
      clientMutationId: expect.any(String),
      mutation: { action: "interrupt_commute", stopStartedAt: "2026-08-14T09:20:00.000Z",
        stopEndedAt: "2026-08-14T09:35:00.000Z" }
    });
  });

  it("keeps expired interruption evidence explanatory and never offers submission", async () => {
    const commute = evidence();
    commute.segment.status = "finalised";
    commute.evidenceExpired = true;
    mocks.clientFetch.mockResolvedValueOnce(jsonResponse(commute));
    render(<LocationReviewPanel reviewItemId={commute.reviewItemId} categories={categories}
      entries={[]} initialCategoryId={null} onClose={vi.fn()} />);
    expect(await screen.findByText(/retained route evidence has expired/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Save interruption and review both legs" })).toBeNull();
    expect(screen.queryByLabelText("Stop began")).toBeNull();
    expect(mocks.clientFetch).toHaveBeenCalledTimes(1);
  });

  it("withholds interruption when no unexpired route observation remains", async () => {
    const commute = evidence();
    commute.segment.status = "finalised";
    commute.map.acceptedSamples = [];
    commute.rawEvidenceAvailable = false;
    mocks.clientFetch.mockResolvedValueOnce(jsonResponse(commute));
    render(<LocationReviewPanel reviewItemId={commute.reviewItemId} categories={categories}
      entries={[]} initialCategoryId={null} onClose={vi.fn()} />);
    expect(await screen.findByText(/No unexpired route observations are available/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Save interruption and review both legs" })).toBeNull();
  });

  it("rejects out-of-bounds stop times and retries an uncertain delivery with the same mutation ID", async () => {
    const commute = evidence();
    commute.segment.status = "finalised";
    mocks.clientFetch.mockResolvedValueOnce(jsonResponse(commute))
      .mockResolvedValueOnce(jsonResponse({ message: "The result is still unknown." }, 503))
      .mockImplementationOnce(async (_url, request: RequestInit) => {
        const envelope = JSON.parse(String(request.body));
        return jsonResponse({ ok: true, action: "interrupt_commute", status: "accepted",
          clientMutationId: envelope.clientMutationId, reviewItemId: commute.reviewItemId,
          childSegmentIds: ["child-1", "child-2"], childReviewItemIds: ["review-1", "review-2"] });
      });
    const onClose = vi.fn();
    render(<LocationReviewPanel reviewItemId={commute.reviewItemId} categories={categories}
      entries={[]} initialCategoryId={null} onClose={onClose} />);
    const start = await screen.findByLabelText("Stop began");
    const end = screen.getByLabelText("Journey resumed");
    const submit = screen.getByRole("button", { name: "Save interruption and review both legs" }) as HTMLButtonElement;
    fireEvent.change(start, { target: { value: localInput("2026-08-14T09:00:00.000Z") } });
    fireEvent.change(end, { target: { value: localInput("2026-08-14T09:35:00.000Z") } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(start, { target: { value: localInput("2026-08-14T09:20:00.000Z") } });
    expect(submit.disabled).toBe(false);
    const user = userEvent.setup();
    await user.click(submit);
    expect((await screen.findByRole("alert")).textContent).toContain("The result is still unknown");
    expect(onClose).not.toHaveBeenCalled();
    await user.click(submit);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const first = JSON.parse(String((mocks.clientFetch.mock.calls[1]?.[1] as RequestInit).body));
    const second = JSON.parse(String((mocks.clientFetch.mock.calls[2]?.[1] as RequestInit).body));
    expect(second.clientMutationId).toBe(first.clientMutationId);
    expect(second.mutation).toEqual(first.mutation);
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
      acceptedSamples: [{ id: "route-1", point: { type: "Point", coordinates: [-0.1, 51.5] },
        occurredAt: "2026-08-14T09:20:00.000Z", accuracyMeters: 12,
        kind: "standard_location", role: "route" }],
      rejectedSamples: [],
      anchors: [],
      gaps: [],
      nearbySavedPlaces: []
    },
    suggestedSplitPoints: [],
    evidenceExpiresAt: null,
    evidenceExpired: false,
    rawEvidenceAvailable: true,
    textualSummary: "Only journey endpoints are available."
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function localInput(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
