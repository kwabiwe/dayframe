import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("react-native", () => ({
  Text: "Text", View: "View", StyleSheet: { create: (value: unknown) => value }
}));
vi.mock("react-native-maps", () => ({ default: "MapView", Circle: "Circle", Marker: "Marker", Polyline: "Polyline" }));

const { LocationEvidenceMap } = await import("./LocationEvidenceMap");

const sample = (id: string, latitude: number) => ({ id, point: { type: "Point", coordinates: [-0.1, latitude] },
  occurredAt: "2026-03-10T12:03:00.000Z", accuracyMeters: 5, kind: "standard_location", role: "route" });
const evidence = (timeAway: boolean) => ({
  reviewItemId: "10000000-0000-4000-8000-000000000001", eventId: null,
  segment: { id: "away", kind: "commute", status: "finalised", startedAt: "2026-03-10T12:00:00Z", stoppedAt: "2026-03-10T12:10:00Z",
    approximateArrival: false, confidence: "low", continuityStatus: "continuous", algorithmVersion: "location-v2.0",
    evidenceCount: 2, rejectedEvidenceCount: 0, ...(timeAway ? { timeAway: true } : {}) },
  display: { title: "Time away from Home", subtitle: null, placeId: null, placeName: null, addressSummary: null },
  map: { centre: null, stayRadiusMeters: null, route: null, straightLineFallback: null,
    acceptedSamples: [sample("a", 51.5027), sample("b", 51.5029)], rejectedSamples: [], anchors: [], gaps: [], nearbySavedPlaces: [] },
  stops: [], suggestedSplitPoints: [], evidenceExpiresAt: null, evidenceExpired: false, rawEvidenceAvailable: true,
  textualSummary: "Synthetic time away"
}) as unknown as LocationReviewEvidenceDto;

function render(value: LocationReviewEvidenceDto) {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<LocationEvidenceMap accentColor="#f00" dangerColor="#f00" evidence={value} showDetails={false}
      surfaceColor="#000" textColor="#fff" />);
  });
  return tree!;
}

describe("time away on the mobile evidence map", () => {
  it("shows the readings away even when details are hidden, with no route line (round 3 finding 2)", () => {
    const tree = render(evidence(true));
    expect(tree.root.findAllByType("Circle" as never)).toHaveLength(2);
    expect(tree.root.findAllByType("Polyline" as never)).toHaveLength(0);
    expect(tree.root.findAllByType("Marker" as never)).toHaveLength(0);
    expect(tree.root.findByType("MapView" as never).props.accessibilityLabel).toBe("Map of readings while you were away.");
  });
});
