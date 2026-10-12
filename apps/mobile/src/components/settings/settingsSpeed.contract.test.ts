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
    // The session's first open shows Today's bootstrap for the same account, display only: never
    // `data`, so steppers, places and location writes wait for Settings' own refresh (Codex r1);
    // dropped on any sign-out, session or account change while open, and re-checked each render (r2).
    expect(body).toContain("const [initialSeed, setTodaySeed] = useState(() => cachedSnapshot?.data ? null : readTodayBootstrapForSettings(getActiveMobileAccountSnapshot()));");
    expect(body).toContain("[subscribeMobileSignedOut(drop), subscribeAuthenticatedSession(drop), subscribeActiveMobileAccount(drop)]");
    expect(body).toContain("const todaySeed = initialSeed && readTodayBootstrapForSettings(getActiveMobileAccountSnapshot()) === initialSeed ? initialSeed : null;");
    expect(body.match(/todaySeed\b/g)).toHaveLength(4); // defined, user, workspace label, Activities summary
    expect(body).not.toMatch(/setData(AndCache)?\((initialSeed|todaySeed)/);
    // Up to the first effect after the seed's subscription effect.
    const seedEffect = body.indexOf("useEffect(", body.indexOf("const [initialSeed"));
    const beforeFirstEffect = body.slice(0, body.indexOf("useEffect(", seedEffect + 1));
    expect(beforeFirstEffect).not.toMatch(/await\s/);
  });

  it("defers every mount-time read until the transition settles", () => {
    // Behaviour of the gate itself: src/lib/settingsTransition.test.ts.
    expect(settings).toMatch(/useFocusEffect\(useCallback\(\(\) => \{\s*focusGate\.focus\(\);\s*return \(\) => focusGate\.blur\(\);/);
    expect(settings).toContain('navigation.addListener("transitionEnd"');
    expect(settings).not.toContain("InteractionManager");
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

  it("refreshes on focus (open and Back) only after the transition, cancelled when the page leaves", () => {
    const focus = body.slice(body.indexOf("useFocusEffect("), body.indexOf("[load, reloadThemePreference, settingsSection]"));
    expect(focus).toContain("return afterSettingsTransition(transitionGate(), () => {");
    expect(focus.indexOf("afterSettingsTransition")).toBeLessThan(focus.indexOf("load({ silent: true, trigger: \"focus\" })"));
  });

  it("re-registers monitored places only when the set changes", () => {
    expect(body).toContain("if (geofenceKey === lastSettingsGeofenceKey)");
    expect(settings).toMatch(/subscribeMobileSignedOut\(\(\) => \{\s*clearSettingsSnapshot\(\);\s*lastSettingsGeofenceKey = null;/);
  });

  it("keeps the Back control free of async guards", () => {
    expect(body).toMatch(/function goBack\(\) \{\s*router\.back\(\);\s*\}/);
  });
});

describe("Review Fix opens Sync help, which lists the same rejections (I1)", () => {
  const review = readFileSync(resolve(__dirname, "../../../app/review.tsx"), "utf8");
  it("routes Fix to Sync help and names it in the card copy", () => {
    expect(review).toContain('router.push({ pathname: "/settings", params: { from: "review", section: "sync" } })');
    expect(review).not.toContain("needs attention in Settings");
    expect(review).toContain("Tap Fix above to choose what to do in Sync help.");
    // Fix shows only for real rejections, the same set Sync help lists (listReviewSyncIssues).
    expect(review).toContain("const attention = diagnostics.needsAttentionCount > 0;");
  });
});
