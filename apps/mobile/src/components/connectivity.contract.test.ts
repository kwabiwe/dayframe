import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("connectivity status ownership", () => {
  it("mounts one presentation and announcement provider above navigation", () => {
    const layout = source("../../app/_layout.tsx");
    const dashboard = source("./DayframeDashboard.tsx");
    const content = [
      source("./ActiveTimerEditSheet.tsx"),
      source("./FloatingDatePicker.tsx"),
      source("./OverflowMenu.tsx"),
      source("../../app/place-editor.tsx"),
      source("../../app/places.tsx"),
      source("../../app/review.tsx"),
      source("../../app/review/[id].tsx"),
      source("../../app/settings.tsx")
    ].join("\n");

    expect(count(layout, "<ConnectivityStatusProvider>")).toBe(1);
    expect(layout).not.toContain("ConnectivityStatusOverlay");
    expect(count(dashboard, "<ConnectivityStatusIndicator")).toBe(1);
    expect(dashboard).toContain("function DashboardBrandLockup");
    expect(content).not.toContain("ConnectivityStatusIndicator");
    expect(content).not.toContain("ConnectivityStatusProvider");
  });

  it("keeps a fixed icon slot beside the shared wordmark with one revisitable label", () => {
    const status = source("./ConnectivityStatusStrip.tsx");
    const dashboard = source("./DayframeDashboard.tsx");

    expect(dashboard.indexOf("<DayframeBrand")).toBeLessThan(
      dashboard.indexOf("<ConnectivityStatusIndicator")
    );
    expect(status).toContain("width: 44");
    expect(status).toContain("height: 44");
    expect(status).toContain("accessibilityLabel={viewModel.accessibilityLabel}");
    expect(status).toContain('accessibilityRole="text"');
    expect(status).toContain('accessibilityRole="button"');
    expect(dashboard).toContain('params: { section: "sync" }');
    expect(status).not.toContain("<Text");
  });

  it("rotates only the syncing arrows and preserves a Reduce Motion path", () => {
    const status = source("./ConnectivityStatusStrip.tsx");

    expect(status).toContain('variant !== "syncing" || reduceMotion');
    expect(status).toContain("withRepeat(");
    expect(status).toContain("Easing.linear");
    expect(status).toContain("cancelAnimation(rotation)");
    expect(status).toContain("useReduceMotionPreference()");
  });

  it("keeps retryable connectivity delivery silent and local failures actionable", () => {
    const dashboard = source("./DayframeDashboard.tsx");
    const settings = source("../../app/settings.tsx");

    expect(dashboard).toContain("isRetryableMobileConnectivityFailure(error)");
    expect(dashboard).toContain("!expectedConnectivityFailure");
    expect(dashboard).not.toContain('Alert.alert("Dayframe API"');
    expect(settings).toContain("!isRetryableMobileConnectivityFailure(error)");
    expect(settings).not.toContain('Alert.alert("Dayframe API"');
    expect(dashboard).toContain("Check available storage and try again.");
    expect(dashboard).toContain("Check Sync and diagnostics for details.");
  });

  it("routes permanently rejected timer Stops to attention diagnostics", () => {
    const status = source("./ConnectivityStatusStrip.tsx");
    const settings = source("../../app/settings.tsx");
    const projection = source("../lib/durableLocalProjection.ts");

    expect(status).toContain("durableWork.timerStopNeedsAttentionCount");
    expect(projection).toContain('stop.failureKind !== "permanent"');
    expect(settings).toContain("Timer Stop rejected");
    expect(settings).toContain("retryTimerStopSyncIssue");
    expect(settings).toContain("discardTimerStopSyncIssue");
    expect(settings).toContain("TimerStopIssueActions");
  });
});

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function count(value: string, needle: string) {
  return value.split(needle).length - 1;
}
