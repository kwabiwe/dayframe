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
