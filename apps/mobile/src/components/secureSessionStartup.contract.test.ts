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
    expect(dashboardSource).toContain('AppState.addEventListener("change", (state) => {');
    expect(dashboardSource).toContain("subscription.remove();");
  });

  it("uses one branded post-auth opening state and clears the password only after load", () => {
    const submitAuth = dashboardSource.slice(
      dashboardSource.indexOf("async function submitAuth()"),
      dashboardSource.indexOf("const enteringStyle")
    );
    const openingIndex = submitAuth.indexOf('setAuthState("opening")');
    const preserveIndex = submitAuth.indexOf("preserveAuthPasswordOnSignedOut.current = true");
    const loadIndex = submitAuth.indexOf("await load({");
    const clearIndex = submitAuth.lastIndexOf('setAuthPassword("")');

    expect(openingIndex).toBeGreaterThan(-1);
    expect(openingIndex).toBeLessThan(preserveIndex);
    expect(preserveIndex).toBeLessThan(loadIndex);
    expect(loadIndex).toBeLessThan(clearIndex);
    expect(submitAuth).toContain("preserveAuthFormOnAuthRequired: true");
    expect(submitAuth).toContain("preserveAuthPasswordOnSignedOut.current = false");
    expect(submitAuth.slice(submitAuth.indexOf("} catch"))).not.toContain('setAuthPassword("")');
    expect(dashboardSource).toContain('if (authState === "opening")');
    expect(dashboardSource).toContain("Opening Dayframe…");
    expect(dashboardSource).toContain('accessibilityRole="progressbar"');
  });

  it("preserves the entered password when the accepted session is rejected during opening", () => {
    const signedOutTransition = dashboardSource.slice(
      dashboardSource.indexOf("const transitionToSignedOut"),
      dashboardSource.indexOf("const changeReportRange")
    );
    const loadAuthFailure = dashboardSource.slice(
      dashboardSource.indexOf("const load = useCallback"),
      dashboardSource.indexOf("loadRef.current = load")
    );

    expect(signedOutTransition).toContain(
      'if (!options?.preserveAuthPassword) setAuthPassword("")'
    );
    expect(signedOutTransition).toContain(
      "preserveAuthPassword: preserveAuthPasswordOnSignedOut.current"
    );
    expect(loadAuthFailure).toContain(
      "preserveAuthPassword: options?.preserveAuthFormOnAuthRequired"
    );
  });
});
