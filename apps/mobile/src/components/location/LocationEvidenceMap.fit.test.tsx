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

// Synthetic coordinates only.
const centre = { latitude: 10, longitude: 20 };
const stay = {
  reviewItemId: "10000000-0000-4000-8000-000000000001", eventId: null,
  segment: { id: "stay", kind: "stay", status: "finalised", startedAt: "2026-03-10T12:00:00Z", stoppedAt: "2026-03-10T12:40:00Z",
    approximateArrival: false, confidence: "medium", continuityStatus: "continuous", algorithmVersion: "location-v2.0",
    evidenceCount: 1, rejectedEvidenceCount: 0 },
  display: { title: "Stay", subtitle: null, placeId: null, placeName: null, addressSummary: null },
  map: { centre: { type: "Point", coordinates: [centre.longitude, centre.latitude] }, stayRadiusMeters: 60, route: null,
    straightLineFallback: null, acceptedSamples: [], rejectedSamples: [], anchors: [], gaps: [], nearbySavedPlaces: [] },
  stops: [], suggestedSplitPoints: [], evidenceExpiresAt: null, evidenceExpired: false, rawEvidenceAvailable: true,
  textualSummary: "Synthetic stay"
} as unknown as LocationReviewEvidenceDto;

function mount(reduceMotion = false) {
  const fitToCoordinates = vi.fn();
  const animateToRegion = vi.fn();
  let tree: ReactTestRenderer | undefined;
  const element = (point: { latitude: number; longitude: number }) => (
    <LocationEvidenceMap accentColor="#000" dangerColor="#f00" evidence={stay} onSelectPoint={vi.fn()} reduceMotion={reduceMotion}
      selectedPoint={point} selectedPointRadiusMeters={80} showDetails={false} surfaceColor="#fff" textColor="#111" />
  );
  act(() => {
    tree = create(element(centre), {
      createNodeMock: (node) => node.type === "MapView" ? { animateToRegion, fitToCoordinates } : null
    });
  });
  return {
    animateToRegion,
    fitToCoordinates,
    moves: () => fitToCoordinates.mock.calls.length + animateToRegion.mock.calls.length,
    choose(point: { latitude: number; longitude: number }) { act(() => tree!.update(element(point))); },
    tap(point: { latitude: number; longitude: number }) {
      act(() => {
        tree!.root.findByType("MapView" as never).props.onPress({ nativeEvent: { coordinate: point } });
        tree!.update(element(point));
      });
    }
  };
}

// About 350 m north: beyond the opening 0.004° view.
const far = { latitude: 10.0032, longitude: 20 };
const near = { latitude: 10.0002, longitude: 20.0002 };
const opening = { ...centre, latitudeDelta: 0.004, longitudeDelta: 0.004 };

describe("the evidence map shows the chosen place's pin with the stay's area", () => {
  it("leaves the camera alone for the opening choice", () => {
    expect(mount().moves()).toBe(0);
  });

  it("fits a place chosen outside the opening view together with the stay's area", () => {
    const map = mount();
    map.choose(far);
    expect(map.fitToCoordinates).toHaveBeenCalledTimes(1);
    const [points, options] = map.fitToCoordinates.mock.calls[0];
    const latitudes = points.map((point: { latitude: number }) => point.latitude);
    expect(Math.min(...latitudes)).toBeLessThan(centre.latitude - 0.0005);
    expect(Math.max(...latitudes)).toBeGreaterThan(far.latitude + 0.0007);
    expect(options).toEqual(expect.objectContaining({ animated: true }));
  });

  it("returns to the stay's opening view for a place that fits in it", () => {
    const map = mount();
    map.choose(far);
    map.choose(near);
    expect(map.animateToRegion).toHaveBeenCalledWith(opening, expect.any(Number));
    expect(map.animateToRegion.mock.calls[0][1]).toBeGreaterThan(0);
  });

  it("makes one camera call per choice, so the newest choice always wins (Codex r2 on #482)", () => {
    const map = mount();
    map.choose(far);
    map.choose({ latitude: 10, longitude: 20.0009 });
    map.choose(far);
    expect(map.moves()).toBe(3);
    expect(map.fitToCoordinates.mock.lastCall?.[0]).toEqual(map.fitToCoordinates.mock.calls[0][0]);
  });

  it("never moves for a map tap, even one near the edge whose circle runs off screen (Codex r1 on #482)", () => {
    const map = mount();
    map.tap({ latitude: 10.0019, longitude: 20.0019 });
    map.tap(far);
    expect(map.moves()).toBe(0);
    // A later list choice still moves it.
    map.choose({ latitude: 10.0040, longitude: 20 });
    expect(map.fitToCoordinates).toHaveBeenCalledTimes(1);
  });

  it("jumps instead of gliding under Reduce Motion", () => {
    const map = mount(true);
    map.choose(far);
    map.choose(near);
    expect(map.fitToCoordinates.mock.calls[0][1]).toEqual(expect.objectContaining({ animated: false }));
    expect(map.animateToRegion).toHaveBeenCalledWith(opening, 0);
  });
});
