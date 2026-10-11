/// <reference types="node" />

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const screen = read("../../app/onboarding.tsx");
const layout = read("../../app/_layout.tsx");
const settings = read("../../app/settings.tsx");
const dashboard = read("../components/DayframeDashboard.tsx");

describe("onboarding contract (Blocks 8-1a)", () => {
  it("is reached from Settings, and offered right after sign-in only (8-1c), never on launch", () => {
    expect(settings).toContain('router.push("/onboarding")');
    expect(dashboard.match(/router\.push\("\/onboarding"\)/g)).toHaveLength(1);
    expect(dashboard).toMatch(/setAuthPassword\(""\);\n      void offerOnboardingAfterSignIn\(\);/);
  });

  it("pins quick starts with the Settings activity update and keeps the six-pin limit (8-1c)", () => {
    expect(screen).toContain("updateCategory(activity.id, { isPinned: pin })");
    expect(screen).toContain("pinnedCount >= ONBOARDING_PIN_LIMIT");
  });

  it("can't be swiped away half-way through a permission", () => {
    expect(layout).toMatch(/name="onboarding"[\s\S]{0,160}gestureEnabled: false/);
  });

  it("asks iOS for While Using first, then explains before asking for Always", () => {
    const foreground = screen.indexOf("requestForegroundLocationPermission()");
    // Always goes through the shared requester, which remembers a decline (UIA-111).
    const background = screen.indexOf("requestAlwaysLocationPermission()");
    expect(foreground).toBeGreaterThan(-1);
    expect(background).toBeGreaterThan(foreground);
    expect(screen).toContain("One more step for drives");
  });

  it("switches on suggestions only after Always, the same way Settings does", () => {
    expect(screen).toMatch(/async function finishAlways[\s\S]*ensureAutomaticLoggingCategories\(\["commute"\]\)[\s\S]*setLocationLearningEnabled\(true/);
  });

  it("decides suggestions from the account's own consent, and offers it when Always was already allowed", () => {
    expect(screen).toContain('enabled = suggestionsStateFrom(await getLocationVisitDiagnostics()) === "on";');
    expect(screen).toContain("suggestions: diagnostics ? suggestionsStateFrom(diagnostics)");
    expect(screen).toContain('testID="onboarding-suggestions-on"');
  });

  it("opens Today at the end, starts each step at its top with VoiceOver on its heading", () => {
    expect(screen).toContain('router.dismissTo("/(tabs)/today")');
    expect(screen).toContain("key={step} style={styles.body}");
    expect(screen).toContain("AccessibilityInfo.setAccessibilityFocus(handle)");
  });

  it("fences late answers by session, not only by account", () => {
    expect(screen).toContain("subscribeAuthenticatedSession(bump)");
    expect(screen).toContain("subscribeMobileSignedOut(bump)");
    // Covered by another page: a pending answer no longer applies.
    expect(screen).toMatch(/useFocusEffect\(useCallback\(\(\) => \{[\s\S]{0,400}return \(\) => \{\n      sessionEpoch.current \+= 1;/);
  });

  it("never lets a stalled switch-on trap setup (Codex r3)", () => {
    expect(screen).toContain("const SWITCH_ON_DEADLINE_MS = 15_000;");
    expect(screen).toMatch(/Promise\.race\(\[\n      switchOn,/);
  });

  it("shows Health and the reminder as on only after their saves succeed (8-1b)", () => {
    expect(screen).toContain("const saved = await applyHealthPick(pick).then(() => true, () => false);");
    expect(screen).toContain("const saved = await setReviewNudgeEnabled(owner.current, true).then((state) => state.enabled, () => false);");
    expect(screen).toContain('testID="onboarding-health-retry"');
    expect(screen).toContain('testID="onboarding-reminders-retry"');
  });

  it("reloads activities when Quick starts opens, with Try again, and asks Today to refresh after a pin (Codex r1 on #278)", () => {
    expect(screen).toContain('if (step === "activities") void loadActivities();');
    expect(screen).toContain('testID="onboarding-activities-retry"');
    expect(screen).toContain("requestDashboardRefresh();");
    expect(dashboard).toContain('if (takeDashboardRefresh() && authState === "authenticated") void load({ silent: true });');
  });

  it("never starts a timer or writes time", () => {
    expect(screen).not.toMatch(/startTimer|stopTimer|createTimeEntry|queueEvent|enqueue/);
  });

  it("keeps one owner for step movement and a Reduce Motion fade", () => {
    expect(screen).toContain("entering={reduceMotion ? localPresenceEntering(true) : stepEntering(direction)}");
    expect(screen).toContain("key={`${step}:${answers.locationStage}`}");
  });

  it("offers iOS Settings when the one Always prompt was already used, and finishes on return (UIA-111)", () => {
    expect(screen).toContain('label={alwaysNeedsSettings ? "Open Settings" : "Continue to iOS prompt"}');
    expect(screen).toContain("const needed = await locationAccessNeedsIosSettings()");
    expect(screen).toMatch(/if \(alwaysNeedsSettings\) \{\s*void Linking\.openSettings\(\);/);
    expect(screen).toContain('if (state === "active") void check();');
  });

  it("runs one step at a time, so the return from the Always sheet can't switch on twice (Codex r5 on #324)", () => {
    expect(screen).toContain("const running = useRef(false);");
    expect(screen).toMatch(/if \(running\.current\) return;\s*running\.current = true;/);
    expect(screen).not.toMatch(/if \(busy\) return;/);
    // The Settings-return check stands aside while a step owns the answer.
    expect(screen).toMatch(/const check = async \(\) => \{[\s\S]*?if \(running\.current\) return;/);
  });

  it("every While Using request goes through the one requester that reconciles Always history (Codex r5 on #324)", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const walk = (directory: string): string[] => readdirSync(join(root, directory)).flatMap((name) => {
      const path = join(directory, name);
      if (statSync(join(root, path)).isDirectory()) return walk(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
    });
    const callers = ["app", "src"].flatMap(walk)
      .filter((path) => readFileSync(join(root, path), "utf8").includes("Location.requestForegroundPermissionsAsync"));
    expect(callers).toEqual([join("src", "lib", "geofence.ts")]);
  });
});
