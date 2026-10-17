import { describe, expect, it, vi } from "vitest";

vi.mock("../../modules/dayframe-place-search", () => ({ probeMapKit: vi.fn() }));
vi.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn()
}));

const { runMapKitChecks } = await import("./mapKitProbe");

const report = {
  osVersion: "27.2.1",
  radii: [{ radiusMeters: 200, count: 4, farthestMeters: 190, error: null }],
  kindsWithin400m: { Store: 3 },
  areasOfInterest: { answered: true, count: 1, error: null },
  placeIds: { supported: true, places: 4, withPlaceId: 4, found: 4, notFound: 0, foundAMinuteLater: 4, notFoundAMinuteLater: 0 },
  rapid: { attempts: 20, succeeded: 20, firstErrorAt: null, firstError: null }
};
const point = { latitude: 10.5, longitude: 20.5 };
const now = () => new Date("2026-10-17T12:00:00.000Z");

describe("the Apple Maps checks in Sync help", () => {
  it("asks for location access first and never probes without it", async () => {
    const probe = vi.fn();
    await expect(runMapKitChecks({ permission: async () => ({ granted: false }), probe })).resolves.toEqual({ status: "needs_location" });
    expect(probe).not.toHaveBeenCalled();
  });

  it("says so when no position arrives", async () => {
    await expect(runMapKitChecks({ permission: async () => ({ granted: true }), position: async () => null, probe: vi.fn() }))
      .resolves.toEqual({ status: "no_position" });
  });

  it("shares counts and answers only, never the point it asked about", async () => {
    const probe = vi.fn(async () => ({ ...report, latitude: point.latitude } as typeof report));
    const outcome = await runMapKitChecks({ permission: async () => ({ granted: true }), position: async () => point, probe, now });
    expect(probe).toHaveBeenCalledWith(10.5, 20.5);
    expect(outcome.status).toBe("ready");
    const message = (outcome as { message: string }).message;
    expect(JSON.parse(message)).toEqual({ check: "dayframe-mapkit-checks", ranAt: "2026-10-17T12:00:00.000Z", ...report });
    expect(message).not.toMatch(/10\.5|20\.5|latitude|longitude/);
  });

  it("reports an unavailable probe plainly", async () => {
    await expect(runMapKitChecks({
      permission: async () => ({ granted: true }), position: async () => point, probe: async () => { throw new Error("no module"); }
    })).resolves.toEqual({ status: "unavailable" });
  });
});
