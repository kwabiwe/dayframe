import { StrictMode } from "react";
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
  let token = 0;
  let point = centre;
  // StrictMode replays effects, as development builds do (Codex r4 on #482).
  const element = (value: LocationReviewEvidenceDto = stay) => (
    <StrictMode>
      <LocationEvidenceMap clockFormat="24h" accentColor="#000" dangerColor="#f00" evidence={value} onSelectPoint={vi.fn()} reduceMotion={reduceMotion}
        revealChoiceToken={token} selectedPoint={point} selectedPointRadiusMeters={80} showDetails={false} surfaceColor="#fff" textColor="#111" />
    </StrictMode>
  );
  act(() => {
    tree = create(element(), {
      createNodeMock: (node) => node.type === "MapView" ? { animateToRegion, fitToCoordinates } : null
    });
  });
  return {
    tree: () => tree!,
    animateToRegion,
    fitToCoordinates,
    moves: () => fitToCoordinates.mock.calls.length + animateToRegion.mock.calls.length,
    /** A choice from a list: a new point and a new token. */
    choose(next: { latitude: number; longitude: number }) { point = next; token += 1; act(() => tree!.update(element())); },
    /** A map tap: the pin moves with no new token. */
    tap(next: { latitude: number; longitude: number }) { point = next; act(() => tree!.update(element())); },
    rerender(value?: LocationReviewEvidenceDto) { act(() => tree!.update(element(value))); }
  };
}

// About 350 m north: beyond the opening 0.004° view.
const far = { latitude: 10.0032, longitude: 20 };
const near = { latitude: 10.0002, longitude: 20.0002 };
const opening = { ...centre, latitudeDelta: 0.004, longitudeDelta: 0.004 };

describe("the evidence map's plain words (owner feedback, 27 Oct 2026)", () => {
  it("shows and says them with its details off, as the review screen and the sheets draw it (Codex r1 on #599)", () => {
    const map = mount();
    expect(map.tree().root.findByProps({ testID: "location-evidence-summary" }).props.children).toBe("1 reading");
    expect(map.tree().root.findByType("MapView" as never).props.accessibilityLabel).toBe("Map showing the detected visit location. 1 reading");
  });
});

describe("the evidence map frames a whole trip (step 12)", () => {
  it("fits the route's ends, the stays either side, not only the readings (Codex r2 on #599)", () => {
    const trip = {
      ...stay,
      segment: { ...stay.segment, kind: "commute" },
      map: {
        ...stay.map, centre: null, stayRadiusMeters: null,
        acceptedSamples: [10.02, 10.03].map((latitude, index) => ({ id: `s${index}`, point: { type: "Point", coordinates: [20, latitude] },
          occurredAt: "2026-08-20T08:00:00.000Z", accuracyMeters: 10, kind: "location", role: null })),
        route: { type: "LineString", coordinates: [[20, 10], [20, 10.02], [20, 10.03], [20, 10.05]] }
      }
    } as unknown as LocationReviewEvidenceDto;
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<LocationEvidenceMap clockFormat="24h" accentColor="#000" dangerColor="#f00" evidence={trip} showDetails={false}
        surfaceColor="#fff" textColor="#111" />);
    });
    const region = tree.root.findByType("MapView" as never).props.initialRegion;
    expect(region.latitude).toBeCloseTo(10.025, 6);
    expect(region.latitude - region.latitudeDelta / 2).toBeLessThan(10);
    expect(region.latitude + region.latitudeDelta / 2).toBeGreaterThan(10.05);
  });
});

describe("the evidence map shows the chosen place's pin with the stay's area", () => {
  it("leaves the camera alone for the opening choice, a re-render and new evidence (Codex r3 on #482)", () => {
    const map = mount();
    map.rerender();
    map.rerender({ ...stay, textualSummary: "Synthetic stay, again" } as LocationReviewEvidenceDto);
    expect(map.moves()).toBe(0);
  });

  it("fits a place chosen outside the opening view together with the stay's area", () => {
    const map = mount();
    map.choose(far);
    expect(map.fitToCoordinates).toHaveBeenCalledTimes(1);
    const [points, options] = map.fitToCoordinates.mock.calls[0];
    const latitudes = points.map((value: { latitude: number }) => value.latitude);
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

  it("moves for every list choice, the same place again included (Codex r3 on #482)", () => {
    const map = mount();
    map.choose(centre);
    map.choose(centre);
    expect(map.animateToRegion).toHaveBeenCalledTimes(2);
    map.choose(far);
    map.choose({ latitude: 10, longitude: 20.0009 });
    map.choose(far);
    expect(map.moves()).toBe(5);
    expect(map.fitToCoordinates.mock.lastCall?.[0]).toEqual(map.fitToCoordinates.mock.calls[0][0]);
  });

  it("never moves for a map tap, even one near the edge or far away (Codex r1 on #482)", () => {
    const map = mount();
    map.tap({ latitude: 10.0019, longitude: 20.0019 });
    map.tap(far);
    expect(map.moves()).toBe(0);
    // A later list choice still moves it.
    map.choose({ latitude: 10.004, longitude: 20 });
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
