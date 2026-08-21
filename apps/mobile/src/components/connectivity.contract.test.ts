import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stripSource = source("./ConnectivityStatusStrip.tsx");
const visualStripSource = between(
  stripSource,
  "export function ConnectivityStatusStrip",
  "export function ConnectivityAnnouncement"
);
const layoutSource = source("../../app/_layout.tsx");
const dashboardSource = source("./DayframeDashboard.tsx");
const connectivityStateSource = source("../lib/connectivityState.ts");
const reviewSource = source("../../app/review.tsx");
const evidenceSource = source("../../app/review/[id].tsx");
const screenSources = [
  dashboardSource,
  reviewSource,
  evidenceSource,
  source("../../app/place-editor.tsx"),
  source("../../app/places.tsx"),
  source("../../app/settings.tsx")
];
const modalSources = [
  source("./ActiveTimerEditSheet.tsx"),
  source("./OverflowMenu.tsx"),
  source("../../app/places.tsx"),
  source("../../app/settings.tsx"),
  source("./FloatingDatePicker.tsx")
];

describe("global connectivity presentation contract", () => {
  it("owns one provider and one nonvisual root announcement above navigation", () => {
    expect(count(layoutSource, "<ConnectivityProvider>")).toBe(1);
    expect(count(layoutSource, "<ConnectivityAnnouncement />")).toBe(1);
    expect(layoutSource.indexOf("<ThemedStack />")).toBeLessThan(
      layoutSource.indexOf("<ConnectivityAnnouncement />")
    );
  });

  it("keeps the passive strip icon-free, single-line, in-flow, and local-motion owned", () => {
    expect(visualStripSource).not.toMatch(/\bModal\b/);
    expect(visualStripSource).not.toMatch(/\bPressable\b|\bButton\b|\bSvg\b/);
    expect(visualStripSource).toContain('pointerEvents="none"');
    expect(visualStripSource).toContain("theme.surfaceMuted");
    expect(stripSource).toContain("minHeight: 36");
    expect(stripSource).toContain("maxHeight: 36");
    expect(stripSource).toContain("numberOfLines={1}");
    expect(visualStripSource).not.toContain('position: "absolute"');
    expect(stripSource).toContain("localPresenceEntering");
    expect(stripSource).toContain("localPresenceExiting");
    expect(stripSource).toContain("localLayoutTransition");
    expect(stripSource).toContain("useReduceMotionPreference");
  });

  it("places the same in-flow strip below screen and sheet headers without duplicate announcements", () => {
    for (const screenSource of screenSources) {
      expect(screenSource).toContain("<ConnectivityStatusStrip");
    }
    for (const modalSource of modalSources) {
      expect(modalSource).toContain("<ConnectivityStatusStrip");
    }
    expect(stripSource).toContain("export function ConnectivityAnnouncement");
    expect(stripSource).toContain('accessibilityRole="alert"');
  });

  it("uses the approved wording and never derives success from reachability alone", () => {
    expect(connectivityStateSource).toContain("Offline — changes will sync later");
    expect(connectivityStateSource).toContain("Back online, syncing…");
    expect(connectivityStateSource).toContain("All changes synced");
    expect(connectivityStateSource).toContain("Some changes haven’t synced");
    expect(connectivityStateSource).toContain('recoveryStatus: "idle"');
  });
});

describe("reconnect integration contracts", () => {
  it("keeps durable recovery in the dependency-safe order and excludes Health import", () => {
    const recovery = between(
      dashboardSource,
      "async function reconcileAfterConnectivityRestored",
      "reconnectRecoveryPass.current = reconcileAfterConnectivityRestored"
    );
    const steps = [
      'name: "timer_stops_ready"',
      'name: "activity_queue"',
      'name: "timer_stops_after_correlation"',
      'name: "review_outbox"',
      'name: "location_intelligence"',
      'name: "bootstrap"'
    ];
    for (let index = 1; index < steps.length; index += 1) {
      expect(recovery.indexOf(steps[index - 1])).toBeLessThan(
        recovery.indexOf(steps[index])
      );
    }
    expect(recovery).not.toContain("importHealthKit");
    expect(recovery).toContain("load({ silent: true, throwOnError: true })");
    expect(recovery).toContain("reviewConnectivityRecoveryStepResult(result)");
    expect(recovery).toContain("locationConnectivityRecoveryStepResult(result)");
  });

  it("queues a known-offline timer Start immediately and requests same-epoch recovery after durable fallback", () => {
    const startPath = between(
      dashboardSource,
      "async function startTaskWith",
      "function rejectOptimisticTimerStart"
    );
    expect(startPath.indexOf("connectivityCurrent.current.isOffline")).toBeLessThan(
      startPath.indexOf("const result = await startTimer")
    );
    expect(startPath).toContain("await queueOptimisticStart()");
    expect(startPath).toContain("queuedTimerStartRecoveryRequested.current = true");
    expect(dashboardSource).toContain("queuedWorkArrived: true");
  });

  it("promotes only a current cached session and suppresses the generic opening alert only for known-offline cached use", () => {
    expect(dashboardSource).toContain("await readAuthenticatedSessionSnapshot()");
    expect(dashboardSource).toContain('sessionRead?.status === "authenticated"');
    expect(dashboardSource).toContain("cachedOfflineDashboardAvailable");
    expect(dashboardSource).toContain(
      "connectivityCurrent.current.isOffline && latestData.current !== null"
    );
  });

  it("keeps Review offline-capable and refreshes cached ownership silently after reconnect", () => {
    expect(reviewSource).toContain("useConnectivity()");
    expect(reviewSource).toContain("synchroniseReviewMutations({ force: true })");
    expect(reviewSource).toContain("startEvidencePrefetch");
    expect(reviewSource).toContain("skipReprocess: true");
    expect(reviewSource).not.toContain("Offline ·");
    expect(reviewSource).not.toMatch(/disabled=\{isOffline\}/);
  });

  it("revalidates mounted evidence through the safe cache path without remounting the editor", () => {
    expect(evidenceSource).toContain("useConnectivity()");
    expect(count(evidenceSource, "revalidateLocationReviewEvidence({")).toBeGreaterThanOrEqual(2);
    expect(evidenceSource).toContain("getActiveReviewAccountIdentity()");
    expect(evidenceSource).toContain("setReloadSequence((current) => current + 1)");
    expect(evidenceSource).not.toContain("key={evidence.reviewItemId}");
    expect(evidenceSource).toContain("Showing evidence saved on this iPhone");
    expect(evidenceSource).toContain(
      "Couldn’t refresh this evidence · showing the saved copy"
    );
  });
});

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function count(value: string, needle: string) {
  return value.split(needle).length - 1;
}

function between(value: string, start: string, end: string) {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex);
  return value.slice(startIndex, endIndex);
}
