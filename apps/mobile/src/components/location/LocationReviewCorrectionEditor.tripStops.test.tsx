import { act, create, type ReactTestInstance } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Keyboard: { addListener: () => ({ remove() {} }) },
  Platform: { OS: "ios" },
  Pressable: "Pressable", ScrollView: "ScrollView", Switch: "Switch",
  Text: "Text", TextInput: "TextInput", View: "View",
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  useWindowDimensions: () => ({ fontScale: 1, width: 375, height: 812 })
}));
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" } }));
// The Blocks groups (SettingsBlocks) bring DayframeIcon, which draws ellipses, lines and polylines too.
vi.mock("react-native-svg", () => ({ default: "Svg", Circle: "Circle", Ellipse: "Ellipse", G: "G", Line: "Line", Path: "Path", Polygon: "Polygon", Polyline: "Polyline", Rect: "Rect" }));
vi.mock("@/lib/mobileTheme", () => ({
  pressable: (value: unknown) => value,
  useMobileTheme: () => ({ styles: {}, theme: {
    textPrimary: "primary", textSecondary: "secondary", border: "border",
    surface: "surface", surfaceRaised: "raised", surfaceMuted: "muted",
    accent: "accent", accentSoft: "accentSoft", accentText: "accentText", onAccent: "onAccent", danger: "danger"
  } })
}));
vi.mock("@/lib/motion", () => ({
  useReduceMotionPreference: () => false,
  localLayoutTransition: () => ({ marker: "local-layout" }),
  localPresenceEntering: () => ({ marker: "local-enter" }),
  localPresenceExiting: () => ({ marker: "local-exit" })
}));
vi.mock("@/lib/placeSearch", () => ({
  createNativeNearbyPointOfInterestProvider: () => null,
  createNativePlaceSearchProvider: () => null,
  friendlyPlaceSearchError: () => "Unavailable", visibleNearbyPlaces: () => [],
  NearbyPointOfInterestController: class {}, PlaceSearchController: class {},
  selectPlaceSearchBias: () => undefined
}));
vi.mock("@/components/location/LocationEvidenceMap", () => ({ LocationEvidenceMap: () => null }));
vi.mock("./LocationEvidenceMap", () => ({ LocationEvidenceMap: () => null }));
// The real draft and typography helpers, reached by relative path.
vi.mock("@/lib/locationReviewDraft", () => import("../../lib/locationReviewDraft"));
vi.mock("@/lib/mobileTypography", () => import("../../lib/mobileTypography"));

const { LocationReviewCorrectionEditor } = await import("./LocationReviewCorrectionEditor");

const priorTz = process.env.TZ;
let tree: ReturnType<typeof create> | undefined;
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  if (priorTz === undefined) delete process.env.TZ; else process.env.TZ = priorTz;
});

const stop = { startedAt: "2026-08-14T09:22:00Z", stoppedAt: "2026-08-14T09:28:00Z", durationSeconds: 360, approximate: false };

function fixture(stops?: typeof stop[], kind: "commute" | "stay" = "commute") {
  return {
    reviewItemId: "10000000-0000-4000-8000-000000000001",
    eventId: "10000000-0000-4000-8000-000000000002",
    segment: { id: "trip", kind, status: "finalised", startedAt: "2026-08-14T09:00:00Z", stoppedAt: "2026-08-14T10:00:00Z",
      approximateArrival: false, confidence: "medium", continuityStatus: "continuous", algorithmVersion: "location-v2.0",
      evidenceCount: 3, rejectedEvidenceCount: 0 },
    display: { title: "Possible journey", subtitle: null, placeId: null, placeName: null, addressSummary: null },
    map: { centre: null, stayRadiusMeters: null, route: null, straightLineFallback: null,
      acceptedSamples: [], rejectedSamples: [], anchors: [], gaps: [], nearbySavedPlaces: [] },
    stops, suggestedSplitPoints: [], evidenceExpiresAt: null, evidenceExpired: false, rawEvidenceAvailable: true,
    textualSummary: "Synthetic test trip"
  } as unknown as LocationReviewEvidenceDto;
}

function editor(evidence: LocationReviewEvidenceDto, saving = false) {
  return (
    <LocationReviewCorrectionEditor
      adjacentReview={undefined}
      categories={[]}
      evidence={evidence}
      isFocused
      onResolve={vi.fn()}
      places={[]}
      reviewItem={undefined}
      saving={saving}
    />
  );
}

const text = (node: ReactTestInstance) => node.children.map((child) => typeof child === "string" ? child : "").join("");
const stopRows = () => tree!.root.findAllByType("Text" as never).filter((node) => text(node).startsWith("Stopped "));

describe("trip stops in mobile Location Evidence", () => {
  it("shows no stop list for a stay or a stop-free trip", () => {
    act(() => { tree = create(editor(fixture([stop], "stay"))); });
    expect(stopRows()).toHaveLength(0);
    act(() => tree!.update(editor(fixture())));
    expect(stopRows()).toHaveLength(0);
  });

  // Codex review of 52cf92b: rows were memoised on evidence only.
  it("follows a time-zone change while the evidence stays the same", () => {
    process.env.TZ = "Europe/London";
    const evidence = fixture([stop]);
    act(() => { tree = create(editor(evidence)); });
    const london = text(stopRows()[0]);
    process.env.TZ = "America/New_York";
    act(() => tree!.update(editor(evidence, true)));
    const newYork = text(stopRows()[0]);
    expect(newYork).not.toBe(london);
    const expected = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(stop.startedAt));
    expect(newYork).toContain(expected);
  });

  // Codex review of 52cf92b: stops arriving with refreshed evidence appeared abruptly.
  it("enters, leaves and reflows with the screen's local motion, with a heading and positions", () => {
    act(() => { tree = create(editor(fixture())); });
    act(() => tree!.update(editor(fixture([stop, { ...stop, startedAt: "2026-08-14T09:40:00Z", stoppedAt: "2026-08-14T09:46:00Z" }]))));
    const rows = stopRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const animated = row.parent!;
      expect(animated.type).toBe("AnimatedView");
      expect(animated.props).toMatchObject({ entering: { marker: "local-enter" }, exiting: { marker: "local-exit" }, layout: { marker: "local-layout" } });
      expect(animated.parent!.props).toMatchObject({ entering: { marker: "local-enter" }, exiting: { marker: "local-exit" }, layout: { marker: "local-layout" } });
    }
    expect(rows[0].props.accessibilityLabel).toMatch(/^Stop 1 of 2: Stopped from /);
    expect(rows[1].props.accessibilityLabel).toMatch(/^Stop 2 of 2: /);
    const heading = tree!.root.findAllByType("Text" as never).find((node) => text(node) === "2 stops on this trip");
    expect(heading?.props.accessibilityRole).toBe("header");
  });
});

// Codex review of #270 r1: finishing the pin hid Use this pin before the drafted name was used.
describe("map pin in More options", () => {
  const byTestId = (id: string) => tree!.root.find((node) => node.props.testID === id);
  const pinNameInput = () => tree!.root.findAll((node) => node.props.accessibilityLabel === "New saved place name");
  const useThisPin = () => tree!.root.findAllByType("Text" as never).filter((node) => text(node) === "Use this pin");

  it("keeps the drafted name and Use this pin after Finish moving pin, and every row has a layout owner", () => {
    act(() => { tree = create(editor(fixture(undefined, "stay"))); });
    expect(pinNameInput()).toHaveLength(0);
    act(() => byTestId("location-evidence-map-pin").props.onPress());
    act(() => pinNameInput()[0].props.onChangeText("Library"));
    act(() => byTestId("location-evidence-map-pin").props.onPress());
    expect(pinNameInput()).toHaveLength(1);
    expect(pinNameInput()[0].props.value).toBe("Library");
    expect(useThisPin()).toHaveLength(1);
    for (const id of ["location-evidence-record-once", "location-evidence-skip"]) {
      expect(byTestId(id).parent!.props).toMatchObject({ layout: { marker: "local-layout" } });
    }
  });
});
