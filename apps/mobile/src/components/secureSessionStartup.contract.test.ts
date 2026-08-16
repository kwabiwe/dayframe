import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dashboardSource = readFileSync(
  fileURLToPath(new URL("./DayframeDashboard.tsx", import.meta.url)),
  "utf8"
);

describe("secure session startup contract", () => {
  it("waits for active iOS app state before the initial authenticated load", () => {
    expect(dashboardSource).toContain('if (AppState.currentState === "active")');
    expect(dashboardSource).toContain('if (state !== "active") return;');
    expect(dashboardSource).toContain('if (AppState.currentState !== "active") return;');
  });

  it("uses one branded post-auth opening state and clears the password only after load", () => {
    const submitAuth = dashboardSource.slice(
      dashboardSource.indexOf("async function submitAuth()"),
      dashboardSource.indexOf("const enteringStyle")
    );
    const openingIndex = submitAuth.indexOf('setAuthState("opening")');
    const loadIndex = submitAuth.indexOf("await load({ throwOnError: true })");
    const clearIndex = submitAuth.lastIndexOf('setAuthPassword("")');

    expect(openingIndex).toBeGreaterThan(-1);
    expect(openingIndex).toBeLessThan(loadIndex);
    expect(loadIndex).toBeLessThan(clearIndex);
    expect(submitAuth.slice(submitAuth.indexOf("} catch"))).not.toContain('setAuthPassword("")');
    expect(dashboardSource).toContain('if (authState === "opening")');
    expect(dashboardSource).toContain("Opening Dayframe…");
    expect(dashboardSource).toContain('accessibilityRole="progressbar"');
  });
});
