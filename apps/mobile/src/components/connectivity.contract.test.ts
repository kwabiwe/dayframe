import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const bannerSource = source("./ConnectivityBanner.tsx");
const layoutSource = source("../../app/_layout.tsx");
const dashboardSource = source("./DayframeDashboard.tsx");
const reviewSource = source("../../app/review.tsx");
const evidenceSource = source("../../app/review/[id].tsx");
const modalSources = [
  source("./ActiveTimerEditSheet.tsx"),
  source("./OverflowMenu.tsx"),
  source("../../app/places.tsx"),
  source("../../app/settings.tsx")
];

describe("global connectivity presentation contract", () => {
  it("owns one provider and one persistent root banner above navigation", () => {
    expect(count(layoutSource, "<ConnectivityProvider>")).toBe(1);
    expect(count(layoutSource, "<ConnectivityBanner />")).toBe(1);
    expect(layoutSource.indexOf("<ThemedStack />")).toBeLessThan(
      layoutSource.indexOf("<ConnectivityBanner />")
    );
  });

  it("keeps the passive banner non-interactive, token-led, accessible, and local-motion owned", () => {
    expect(bannerSource).not.toMatch(/\bModal\b/);
    expect(bannerSource).not.toMatch(/\bPressable\b|\bButton\b/);
    expect(bannerSource).toContain('pointerEvents="none"');
    expect(bannerSource).toContain("theme.surfaceMuted");
    expect(bannerSource).toContain("theme.success");
    expect(bannerSource).toContain('accessibilityRole={');
    expect(bannerSource).toContain('"alert"');
    expect(bannerSource).toContain("localPresenceEntering");
    expect(bannerSource).toContain("localPresenceExiting");
    expect(bannerSource).toContain("useReduceMotionPreference");
  });

  it("mirrors presentation in every existing React Native Modal without duplicate announcements", () => {
    for (const modalSource of modalSources) {
      expect(modalSource).toContain("<Modal");
      expect(modalSource).toContain(
        "<ConnectivityBanner suppressAccessibilityAnnouncement />"
      );
    }
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
    expect(recovery).toContain("load({ silent: true })");
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
