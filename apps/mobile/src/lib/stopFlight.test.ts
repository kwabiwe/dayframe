import { describe, expect, it } from "vitest";
import { STOP_FLIGHT, flightNodeRef, isUsableFrame, measureFlightNode, stopFlightPose } from "./stopFlight";

const from = { height: 230, width: 370, x: 16, y: 260 };
const to = { height: 46, width: 34, x: 32, y: 900 };

describe("stopFlightPose", () => {
  it("starts at rest on the live block", () => {
    expect(stopFlightPose(0, from, to)).toEqual({ opacity: 1, scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 });
  });

  it("squashes first, as in the prototype's 16% keyframe", () => {
    const pose = stopFlightPose(STOP_FLIGHT.squashAt, from, to);
    expect(pose).toMatchObject({ opacity: 1, scaleX: 1.02, scaleY: 0.94, translateX: 0, translateY: 6 });
  });

  it("ends with its centre on the row block, at the row block's size", () => {
    const pose = stopFlightPose(1, from, to);
    expect(pose.scaleX).toBeCloseTo(34 / 370);
    expect(pose.scaleY).toBeCloseTo(46 / 230);
    expect(pose.translateX).toBeCloseTo(32 + 17 - (16 + 185));
    expect(pose.translateY).toBeCloseTo(900 + 23 - (260 + 115));
    expect(pose.opacity).toBe(STOP_FLIGHT.endOpacity);
  });

  it("only flies to measured frames", () => {
    expect(isUsableFrame(to)).toBe(true);
    expect(isUsableFrame(null)).toBe(false);
    expect(isUsableFrame({ ...to, width: 0 })).toBe(false);
    expect(isUsableFrame({ ...to, y: Number.NaN })).toBe(false);
  });
});

describe("flight node registry", () => {
  const view = (y: number) => ({ measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) => callback(32, y, 34, 46) }) as never;

  it("measures the newest view still mounted under a key, so one leaving never strands another", async () => {
    const group = flightNodeRef("row:e1");
    const child = flightNodeRef("row:e1");
    group(view(400));
    child(view(500));
    expect(await measureFlightNode("row:e1")).toMatchObject({ y: 500 });
    // The expanded child collapses: the group's row is still there to land on.
    child(null);
    expect(await measureFlightNode("row:e1")).toMatchObject({ y: 400 });
    group(null);
    expect(await measureFlightNode("row:e1")).toBeNull();
  });

  it("ignores a view that measures as nothing", async () => {
    const ref = flightNodeRef("row:e2");
    ref({ measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) => callback(0, 0, 0, 0) } as never);
    expect(await measureFlightNode("row:e2")).toBeNull();
    ref(null);
  });
});
