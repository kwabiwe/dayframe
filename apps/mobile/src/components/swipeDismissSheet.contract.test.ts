import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./SwipeDismissSheet.tsx", import.meta.url)),
  "utf8"
);

describe("SwipeDismissSheet contract", () => {
  it("tracks downward handle movement and supports distance and velocity dismissal", () => {
    expect(source).toContain("dragY.setValue(Math.max(0, gesture.dy))");
    expect(source).toContain("gesture.dy >= DISMISS_DISTANCE");
    expect(source).toContain("gesture.vy >= DISMISS_VELOCITY");
  });

  it("returns an incomplete gesture to rest", () => {
    expect(source).toContain("toValue: 0");
    expect(source).toContain("onPanResponderTerminate: settle");
  });

  it("owns gestures only from a dedicated handle so form controls and scrolling remain interactive", () => {
    expect(source).toContain("style={HANDLE_TOUCH_STYLE}");
    expect(source).toContain("{...responder.panHandlers}");
    expect(source).not.toContain("children={");
  });
});
