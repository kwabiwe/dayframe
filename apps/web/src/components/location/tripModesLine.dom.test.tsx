// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripLeg } from "@dayframe/shared";
import { TripModesLine } from "./LocationListRows";

afterEach(cleanup);

const leg = (mode: TripLeg["mode"], minute: number): TripLeg => ({
  startedAt: new Date(Date.UTC(2026, 9, 27, 9, minute)).toISOString(),
  stoppedAt: new Date(Date.UTC(2026, 9, 27, 9, minute + 5)).toISOString(),
  mode,
  confidence: "sure",
  distanceMeters: 500
} as TripLeg);

describe("a trip's modes line (card D item 12)", () => {
  it("shows at most three legs, then +N, and still names every leg", () => {
    const legs = [leg("walking", 0), leg("bus", 5), leg("walking", 10), leg("train", 15), leg("walking", 20)];
    const { container } = render(<TripModesLine legs={legs} route="Home → Work" />);
    const line = container.querySelector(".timeline-trip-modes")!;
    expect(line.querySelectorAll("svg")).toHaveLength(3);
    expect(line.textContent).toContain("· +2");
    expect(line.getAttribute("aria-label")?.split(", ")).toHaveLength(5);
  });

  it("adds nothing for three legs or fewer", () => {
    const { container } = render(<TripModesLine legs={[leg("walking", 0), leg("bus", 5), leg("walking", 10)]} />);
    expect(container.textContent).not.toContain("+");
  });
});
