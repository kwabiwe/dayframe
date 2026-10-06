import { describe, expect, it, vi } from "vitest";

vi.mock("../../../modules/dayframe-motion-activity", () => ({
  getAuthorizationStatus: vi.fn(() => "not_determined"),
  requestAuthorization: vi.fn(async () => "authorized")
}));
const { motionFitnessPresentation, readMotionFitnessStatus, requestMotionFitness } = await import("./motionPermission");

describe("Motion & Fitness in Settings", () => {
  it("offers the prompt only before it was answered and iOS Settings after a refusal", () => {
    expect(motionFitnessPresentation("not_determined", true).action).toEqual({ kind: "request", label: "Allow Motion & Fitness" });
    expect(motionFitnessPresentation("denied", true).action).toEqual({ kind: "open_settings", label: "Open iOS Settings" });
    expect(motionFitnessPresentation("restricted", true).action?.kind).toBe("open_settings");
    expect(motionFitnessPresentation("authorized", true).action).toBeNull();
    expect(motionFitnessPresentation("unavailable", true)).toMatchObject({ label: "Not available", action: null });
  });

  it("keeps iOS permission separate from Location suggestions consent", () => {
    expect(motionFitnessPresentation("authorized", false).detail).toBe("Used only while location suggestions are on.");
    expect(motionFitnessPresentation("authorized", true).detail).toContain("never logs time by itself");
  });

  it("never shows a raw native status", () => {
    for (const status of ["authorized", "not_determined", "denied", "restricted", "unavailable", "unknown"] as const) {
      const copy = motionFitnessPresentation(status, true);
      expect(`${copy.label} ${copy.detail}`).not.toMatch(/not_determined|authorized|CMError|ERR_/);
    }
  });

  it("reads and requests through the native module", async () => {
    await expect(readMotionFitnessStatus()).resolves.toBe("not_determined");
    await expect(requestMotionFitness()).resolves.toBe("authorized");
  });
});
