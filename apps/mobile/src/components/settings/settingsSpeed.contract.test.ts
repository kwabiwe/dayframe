import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// I1 (docs/investigations/2026-10-12-ios-settings-speed.md): every Settings page paints from its
// cached snapshot; mount-time reads wait for the push transition and nothing awaits the network
// before the first frame or on Back.
const settings = readFileSync(resolve(__dirname, "../../../app/settings.tsx"), "utf8");
const body = settings.slice(settings.indexOf("export default function SettingsScreen()"));

function effectStarting(marker: string) {
  const start = body.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  return body.slice(start, body.indexOf("}, [", start));
}

describe("Settings opens instantly (I1)", () => {
  it("starts from the cached snapshot, never an awaited fetch, in first render", () => {
    expect(body).toContain("useState<MobileBootstrap | null>(cachedSnapshot?.data ?? null)");
    const beforeFirstEffect = body.slice(0, body.indexOf("useEffect("));
    expect(beforeFirstEffect).not.toMatch(/await\s/);
  });

  it("defers every mount-time read until the transition settles", () => {
    expect(settings).toContain("InteractionManager.runAfterInteractions(() => setReady(true))");
    for (const marker of [
      "if (!transitionReady) return;\n    void refreshQueueLatest();",
      "if (!transitionReady) return;\n    void refreshReviewNudge();",
      "if (!transitionReady) return;\n    const refreshMotion",
      "if (!transitionReady) return;\n    if (settingsSection !== \"index\" && settingsSection !== \"health\") return;",
      "if (!transitionReady) return;\n    if (settingsSection !== \"index\" && settingsSection !== \"automations\") return;"
    ]) {
      expect(effectStarting(marker)).toContain("transitionReady");
    }
    expect(body).toContain("if (transitionReady) readIosSettingsNeed();");
  });

  it("subscribes to outbox changes at once but reads them only after the transition", () => {
    for (const subscribe of ["subscribeReviewSync", "subscribeTimeEntryOutbox", "subscribeTimerStopOutbox", "subscribeActivityQueue"]) {
      const at = body.indexOf(`${subscribe}(`);
      expect(at, subscribe).toBeGreaterThan(-1);
      // No eager opening read sits directly before the subscription.
      expect(body.slice(at - 120, at)).not.toMatch(/void refresh\w+\(\);\s*(return|const unsubscribe = )?\s*$/);
    }
  });

  it("refreshes on focus (open and Back) only after interactions, cancelled when the page leaves", () => {
    const focus = body.slice(body.indexOf("useFocusEffect("), body.indexOf("[load, reloadThemePreference, settingsSection]"));
    expect(focus).toContain("InteractionManager.runAfterInteractions(");
    expect(focus).toContain("return () => task.cancel();");
    expect(focus.indexOf("runAfterInteractions")).toBeLessThan(focus.indexOf("load({ silent: true, trigger: \"focus\" })"));
  });

  it("re-registers monitored places only when the set changes", () => {
    expect(body).toContain("if (geofenceKey === lastSettingsGeofenceKey)");
    expect(settings).toMatch(/subscribeMobileSignedOut\(\(\) => \{\s*clearSettingsSnapshot\(\);\s*lastSettingsGeofenceKey = null;/);
  });

  it("keeps the Back control free of async guards", () => {
    expect(body).toMatch(/function goBack\(\) \{\s*router\.back\(\);\s*\}/);
  });
});
