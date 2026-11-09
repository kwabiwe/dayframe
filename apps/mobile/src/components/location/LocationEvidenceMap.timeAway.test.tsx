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
    tree = create(<LocationEvidenceMap clockFormat="24h" accentColor="#f00" dangerColor="#f00" evidence={value} showDetails={false}
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
    expect(tree.root.findByType("MapView" as never).props.accessibilityLabel).toMatch(/^Map of readings while you were away\. \d+ reading/);
  });
});

describe("the place and trip sheets' map (Codex r6 on #620)", () => {
  it("draws no reading for time away with the sheet's own props, nor any diagnostic layer even if details are asked", () => {
    // The sheet's props exactly (LocationCorrectionSheet): visit-only, details off, its one-line caption.
    for (const showDetails of [false, true]) {
      let tree: ReactTestRenderer | undefined;
      act(() => {
        tree = create(<LocationEvidenceMap accentColor="#111" appearance="light" caption="Based on 2 readings" clockFormat="24h" dangerColor="#f00"
          evidence={{ ...evidence(true), map: { ...evidence(true).map,
            rejectedSamples: [{ id: "r", point: { type: "Point", coordinates: [-0.1, 51.6] }, occurredAt: "2026-03-10T12:05:00.000Z", kind: "standard_location", reason: "accuracy" }],
            anchors: [{ id: "x", point: { type: "Point", coordinates: [-0.1, 51.5] }, occurredAt: "2026-03-10T12:00:00.000Z", endedAt: null, kind: "visit", label: "Arrival" }],
            gaps: [{ startedAt: "2026-03-10T12:04:00Z", stoppedAt: "2026-03-10T12:06:00Z", durationSeconds: 120,
              fromPoint: { type: "Point", coordinates: [-0.1, 51.5027] }, toPoint: { type: "Point", coordinates: [-0.1, 51.5029] } }] } } as never}
          reduceMotion={false} showDetails={showDetails} surfaceColor="#eee" textColor="#555" visitOnly />);
      });
      expect(tree!.root.findAllByType("Circle" as never)).toHaveLength(0);
      expect(tree!.root.findAllByType("Polyline" as never)).toHaveLength(0);
      expect(tree!.root.findAllByType("Marker" as never)).toHaveLength(0);
      expect(tree!.root.findByType("MapView" as never).props.accessibilityLabel).toBe("Map of where you were while away. Based on 2 readings");
      expect(JSON.stringify(tree!.toJSON())).not.toMatch(/legend|Excluded noisy|No readings/i);
    }
  });
});

describe("map appearance (UIA-027)", () => {
  it("follows Dayframe's theme, not the system's, so neutral overlays read on it", () => {
    for (const appearance of ["light", "dark"] as const) {
      let tree: ReactTestRenderer | undefined;
      act(() => {
        tree = create(<LocationEvidenceMap clockFormat="24h" accentColor="#f00" appearance={appearance} dangerColor="#f00" evidence={evidence(true)}
          showDetails={false} surfaceColor="#000" textColor="#fff" />);
      });
      expect(tree!.root.findByType("MapView" as never).props.userInterfaceStyle).toBe(appearance);
    }
  });
});
