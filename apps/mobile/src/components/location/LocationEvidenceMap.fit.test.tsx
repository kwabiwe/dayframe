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
  let tree: ReactTestRenderer | undefined;
  const element = (point: { latitude: number; longitude: number }) => (
    <LocationEvidenceMap accentColor="#000" dangerColor="#f00" evidence={stay} onSelectPoint={vi.fn()} reduceMotion={reduceMotion}
      selectedPoint={point} selectedPointRadiusMeters={80} showDetails={false} surfaceColor="#fff" textColor="#111" />
  );
  act(() => {
    tree = create(element(centre), {
      createNodeMock: (node) => node.type === "MapView" ? { fitToCoordinates } : null
    });
  });
  return {
    fitToCoordinates,
    choose(point: { latitude: number; longitude: number }) { act(() => tree!.update(element(point))); },
    tap(point: { latitude: number; longitude: number }) {
      act(() => {
        tree!.root.findByType("MapView" as never).props.onPress({ nativeEvent: { coordinate: point } });
        tree!.update(element(point));
      });
    },
    pan(region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) {
      act(() => tree!.root.findByType("MapView" as never).props.onRegionChangeComplete(region));
    }
  };
}

describe("the evidence map shows the chosen place's pin", () => {
  it("leaves the camera alone when the chosen point is the stay's own centre", () => {
    expect(mount().fitToCoordinates).not.toHaveBeenCalled();
  });

  it("moves once to show a place chosen outside the opening view, with the stay's area", () => {
    const map = mount();
    // About 350 m north: beyond the opening 0.004° view.
    map.choose({ latitude: 10.0032, longitude: 20 });
    expect(map.fitToCoordinates).toHaveBeenCalledTimes(1);
    const [points, options] = map.fitToCoordinates.mock.calls[0];
    const latitudes = points.map((point: { latitude: number }) => point.latitude);
    expect(Math.min(...latitudes)).toBeLessThan(centre.latitude - 0.0005);
    expect(Math.max(...latitudes)).toBeGreaterThan(10.0032 + 0.0007);
    expect(options).toEqual(expect.objectContaining({ animated: true }));
  });

  it("does not move for a point already in view, such as a tap on the map", () => {
    const map = mount();
    map.choose({ latitude: 10.0002, longitude: 20.0002 });
    expect(map.fitToCoordinates).not.toHaveBeenCalled();
  });

  it("never moves for a map tap, even one near the edge whose circle runs off screen (Codex r1 on #482)", () => {
    const map = mount();
    map.tap({ latitude: 10.0019, longitude: 20.0019 });
    expect(map.fitToCoordinates).not.toHaveBeenCalled();
    // A later list choice out of view still moves it.
    map.choose({ latitude: 10.0032, longitude: 20 });
    expect(map.fitToCoordinates).toHaveBeenCalledTimes(1);
  });

  it("judges a choice made while the camera moves against where it is heading (Codex r1 on #482)", () => {
    const map = mount();
    map.choose({ latitude: 10.0032, longitude: 20 });
    // Inside the opening view, but not inside the view the camera is heading for.
    map.choose({ latitude: 10, longitude: 20.0009 });
    expect(map.fitToCoordinates).toHaveBeenCalledTimes(2);
  });

  it("shows the newest choice if the camera settles without it, and only once (Codex r1 on #482)", () => {
    const map = mount();
    map.choose({ latitude: 10.0032, longitude: 20 });
    map.choose({ latitude: 10.0016, longitude: 20 });
    expect(map.fitToCoordinates).toHaveBeenCalledTimes(1);
    map.pan({ latitude: 10.0032, longitude: 20, latitudeDelta: 0.001, longitudeDelta: 0.001 });
    expect(map.fitToCoordinates).toHaveBeenCalledTimes(2);
    // That fit's own settle, and a later pan by the person, move nothing more.
    map.pan({ latitude: 10.0032, longitude: 20, latitudeDelta: 0.001, longitudeDelta: 0.001 });
    map.pan({ latitude: 10.01, longitude: 20, latitudeDelta: 0.001, longitudeDelta: 0.001 });
    expect(map.fitToCoordinates).toHaveBeenCalledTimes(2);
  });

  it("judges what is in view from where the person has panned", () => {
    const map = mount();
    map.pan({ latitude: 10.0032, longitude: 20, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    map.choose({ latitude: 10.0032, longitude: 20 });
    expect(map.fitToCoordinates).not.toHaveBeenCalled();
  });

  it("jumps instead of gliding under Reduce Motion", () => {
    const map = mount(true);
    map.choose({ latitude: 10.0032, longitude: 20 });
    expect(map.fitToCoordinates.mock.calls[0][1]).toEqual(expect.objectContaining({ animated: false }));
  });
});
