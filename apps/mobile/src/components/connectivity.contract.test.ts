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

  it("keeps a fixed, non-interactive icon slot beside the shared wordmark", () => {
    const status = source("./ConnectivityStatusStrip.tsx");
    const dashboard = source("./DayframeDashboard.tsx");

    expect(dashboard.indexOf("<DayframeBrand")).toBeLessThan(
      dashboard.indexOf("<ConnectivityStatusIndicator")
    );
    expect(status).toContain("width: 44");
    expect(status).toContain("height: 44");
    expect(status).toContain("size={34}");
    expect(status).toContain("translateY: 1");
    expect(status).toContain("tintColor={theme.textSecondary}");
    expect(status).toContain("accessibilityLabel={viewModel.accessibilityLabel}");
    expect(status).toContain('accessibilityRole="text"');
    // The slot is never a button: attention moved to the account avatar.
    expect(status).not.toContain("Pressable");
    expect(status).toContain('pointerEvents="none"');
    expect(status).not.toContain("<Text");
    expect(dashboard).toContain("<ConnectivityStatusIndicator isFocused={isFocused} />");
  });

  it("shows only offline and back online, with no sync arrows, synced check or attention icon", () => {
    const status = source("./ConnectivityStatusStrip.tsx");

    expect(status).toContain('offline: "icloud.slash"');
    expect(status).toContain('online: "checkmark.icloud"');
    expect(status).not.toContain("arrow.triangle.2.circlepath");
    expect(status).not.toContain("xmark.icloud");
    expect(status).not.toContain("withRepeat(");
    expect(status).not.toContain("timerBackgroundExecution");
    expect(status).toContain("useReduceMotionPreference()");
  });

  it("badges the avatar for rejected changes and routes it to Sync help on every tab", () => {
    const status = source("./ConnectivityStatusStrip.tsx");
    const dashboard = source("./DayframeDashboard.tsx");
    const avatar = source("./today/AccountAvatarButton.tsx");

    expect(status).toContain("durableWork.timeEntryNeedsAttentionCount + durableWork.timerStopNeedsAttentionCount");
    expect(status).toContain("export function useSyncAttentionCount()");
    expect(avatar).toContain('onPress(attention ? "sync" : "settings")');
    expect(avatar).toContain('testID="account-avatar-attention"');
    expect(dashboard.match(/attentionCount=\{syncAttentionCount\}/g)).toHaveLength(3);
    expect(dashboard.match(/onPress=\{openAccount\}/g)).toHaveLength(3);
    expect(dashboard).toContain('router.push({ pathname: "/settings", params: { section: "sync" } })');
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
    expect(dashboard).toContain("Check Settings, Sync help for details.");
  });

  it("routes permanently rejected timer Stops to attention diagnostics", () => {
    const status = source("./ConnectivityStatusStrip.tsx");
    const settings = source("../../app/settings.tsx");
    const projection = source("../lib/durableLocalProjection.ts");

    expect(status).toContain("durableWork.timerStopNeedsAttentionCount");
    expect(projection).toContain('stop.failureKind !== "permanent"');
    expect(settings).toContain("Timer stop not accepted");
    expect(settings).toContain("retryTimerStopSyncIssue");
    expect(settings).toContain("discardTimerStopSyncIssue");
    // Each rejected Stop keeps its own Retry and Discard (Sync help › Needs attention).
    expect(settings).toContain('accessibilityLabel="Retry rejected timer Stop"');
    expect(settings).toContain('accessibilityLabel="Discard rejected timer Stop"');
    expect(settings).toContain("onPress={() => retryTimerStopIssue(issue.clientEventId)}");
    expect(settings).toContain("onPress={() => confirmDiscardTimerStopIssue(issue.clientEventId)}");
  });
});

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function count(value: string, needle: string) {
  return value.split(needle).length - 1;
}
