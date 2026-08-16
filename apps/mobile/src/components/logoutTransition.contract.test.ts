import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const componentRoot = fileURLToPath(new URL("./", import.meta.url));
const dashboard = readFileSync(`${componentRoot}DayframeDashboard.tsx`, "utf8");
const settings = readFileSync(`${componentRoot}../../app/settings.tsx`, "utf8");

describe("mobile logout transition contract", () => {
  it("prepares the shared signed-out destination before one native stack dismissal", () => {
    const transition = settings.slice(
      settings.indexOf("const finishSignedOutNavigation"),
      settings.indexOf("const clampSettingsScroll")
    );
    const completeSignOut = settings.slice(settings.indexOf("async function completeSignOut()"));
    const publishIndex = transition.indexOf("publishMobileSignedOut();");
    const frameIndex = transition.indexOf("requestAnimationFrame(() => {");
    const dismissIndex = transition.indexOf("router.dismissAll();");

    expect(publishIndex).toBeGreaterThan(-1);
    expect(frameIndex).toBeGreaterThan(publishIndex);
    expect(dismissIndex).toBeGreaterThan(frameIndex);
    expect(completeSignOut).not.toContain('router.replace("/")');
    expect(completeSignOut).not.toContain("setDataAndCache(null)");
    expect(completeSignOut).toContain("finishSignedOutNavigation();");
  });

  it("keeps Settings complete during cleanup and gates repeated logout actions", () => {
    expect(settings).toContain("if (signingOutRef.current) return;");
    expect(settings).toContain("if (signedOutNavigationScheduledRef.current) return;");
    expect(settings).toContain('signingOut ? "Logging out..." : "Log out"');
    expect(settings).toContain("clearSettingsSnapshot();");
    expect(settings).toContain("accessibilityState={{ disabled: signingOut }}");
    expect(settings).toContain("<Stack.Screen options={{ gestureEnabled: !signingOut }} />");
  });

  it("lets the mounted dashboard invalidate stale work and become signed out synchronously", () => {
    expect(dashboard).toContain("subscribeMobileSignedOut(() => transitionToSignedOut({");
    expect(dashboard).toContain("dashboardMutationRevision.current += 1;");
    expect(dashboard).toContain("latestData.current = null;");
    expect(dashboard).toContain('setAuthState("signedOut")');
  });
});
