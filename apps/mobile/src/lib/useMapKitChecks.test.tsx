import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("react-native", () => ({ Share: { share: vi.fn() } }));
const native = vi.hoisted(() => ({ probeMapKit: vi.fn() }));
vi.mock("../../modules/dayframe-place-search", () => native);
vi.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: vi.fn(async () => ({ granted: true })),
  getCurrentPositionAsync: vi.fn(async () => ({ coords: { latitude: 10.5, longitude: 20.5 } }))
}));

const { useMapKitChecks } = await import("./useMapKitChecks");

const report = {
  osVersion: "27.2.1", radii: [], kindsWithin400m: {},
  areasOfInterest: { answered: true, count: 0, error: null },
  placeIds: { supported: true, places: 0, withPlaceId: 0, lookup: null, lookupAMinuteLater: null },
  rapid: { attempts: 20, succeeded: 20, firstErrorAt: null, firstError: null }
};

function deferredProbe() {
  let finish!: () => void;
  native.probeMapKit.mockImplementation(() => new Promise((resolve) => { finish = () => resolve(report); }));
  return () => finish();
}

type Hook = ReturnType<typeof useMapKitChecks>;
function mount(share: (message: string) => Promise<unknown>) {
  const latest: { current: Hook | null } = { current: null };
  function Probe() {
    latest.current = useMapKitChecks({ share });
    return null;
  }
  let tree: ReactTestRenderer | undefined;
  act(() => { tree = create(<Probe />); });
  return { latest, unmount: () => act(() => tree!.unmount()) };
}

const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });

describe("Check Apple Maps nearby data (Codex r1 on #489)", () => {
  it("runs once for two taps in a row and shares once", async () => {
    native.probeMapKit.mockReset();
    const finish = deferredProbe();
    const share = vi.fn(async () => undefined);
    const screen = mount(share);
    act(() => { screen.latest.current!.start(); screen.latest.current!.start(); });
    await settle();
    expect(screen.latest.current!.checking).toBe(true);
    finish();
    await settle();
    expect(native.probeMapKit).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(1);
    expect(screen.latest.current!.checking).toBe(false);
    screen.unmount();
  });

  it("presents nothing from a screen the person left, and Settings opened again joins the run", async () => {
    native.probeMapKit.mockReset();
    const finish = deferredProbe();
    const leftShare = vi.fn(async () => undefined);
    const left = mount(leftShare);
    act(() => left.latest.current!.start());
    await settle();
    left.unmount();
    // Opened again while it runs: it shows the run, and a tap does not start another.
    const againShare = vi.fn(async () => undefined);
    const again = mount(againShare);
    expect(again.latest.current!.checking).toBe(true);
    act(() => again.latest.current!.start());
    finish();
    await settle();
    expect(native.probeMapKit).toHaveBeenCalledTimes(1);
    expect(leftShare).not.toHaveBeenCalled();
    expect(againShare).toHaveBeenCalledTimes(1);
    again.unmount();
  });

  it("drops a result that arrives after the only screen has gone", async () => {
    native.probeMapKit.mockReset();
    const finish = deferredProbe();
    const share = vi.fn(async () => undefined);
    const screen = mount(share);
    act(() => screen.latest.current!.start());
    await settle();
    screen.unmount();
    finish();
    await settle();
    expect(share).not.toHaveBeenCalled();
  });
});
