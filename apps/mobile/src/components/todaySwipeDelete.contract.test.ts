/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  fileURLToPath(new URL("./DayframeDashboard.tsx", import.meta.url)),
  "utf8"
);
const deleteConfirmationSource = readFileSync(
  fileURLToPath(new URL("./DeleteEntryConfirmation.tsx", import.meta.url)),
  "utf8"
);
const mobileThemeSource = readFileSync(
  fileURLToPath(new URL("../lib/mobileTheme.ts", import.meta.url)),
  "utf8"
);

describe("Today history swipe-to-delete contract", () => {
  it("moves the trailing action with a UI-thread swipe instead of statically revealing it", () => {
    expect(dashboardSource).toContain("react-native-gesture-handler/ReanimatedSwipeable");
    expect(dashboardSource).not.toContain('import { Swipeable } from "react-native-gesture-handler"');
    expect(dashboardSource).toContain("const animatedStyle = useAnimatedStyle");
    expect(dashboardSource).toContain("translation.value");
    expect(dashboardSource).toContain("[-HISTORY_DELETE_ACTION_WIDTH, 0]");
    expect(dashboardSource).toContain("[0, HISTORY_DELETE_ACTION_WIDTH]");
    expect(dashboardSource).toContain("overshootRight={false}");
    expect(dashboardSource).toContain("friction={1}");
  });

  it("keeps the normal trailing inset between duration text and the danger action", () => {
    expect(dashboardSource).toContain("const HISTORY_DELETE_ACTION_BUTTON_WIDTH = 64");
    expect(dashboardSource).toContain("const HISTORY_DELETE_ACTION_GAP = 14");
    expect(dashboardSource).toContain("marginLeft: HISTORY_DELETE_ACTION_GAP");
    expect(dashboardSource).toContain("width: HISTORY_DELETE_ACTION_BUTTON_WIDTH");
  });

  it("uses the semantic brand danger colours for swipe and confirmation actions", () => {
    expect(dashboardSource).toContain("backgroundColor: theme.danger");
    expect(dashboardSource).toContain("<TrashGlyph color={theme.onDanger}");
    expect(mobileThemeSource).toContain("sheetDeleteConfirmationDelete:");
    expect(mobileThemeSource).toContain("backgroundColor: theme.danger");
    expect(mobileThemeSource).toContain("sheetDeleteConfirmationDeleteText:");
    expect(mobileThemeSource).toContain("color: theme.onDanger");
  });

  it("uses the app-owned confirmation instead of a system alert", () => {
    const historyRenderSource = dashboardSource.slice(
      dashboardSource.indexOf("renderItem={({ item }) =>"),
      dashboardSource.indexOf("ItemSeparatorComponent")
    );

    expect(historyRenderSource).toContain("setHistoryDeleteEntries(entries)");
    expect(historyRenderSource).not.toContain("Alert.alert");
    expect(dashboardSource).toContain('presentation="screen"');
    expect(deleteConfirmationSource).toContain("<Modal");
    expect(deleteConfirmationSource).toContain("accessibilityViewIsModal");
  });

  it("keeps replay functional as an explicit switch while another timer runs", () => {
    expect(dashboardSource).toContain("Switch the running timer to ${title}");
    expect(dashboardSource).toContain("const canReplay = Boolean(entry.categoryId || entry.description?.trim())");
    expect(dashboardSource).toContain("latestData.current?.activeEntry && !categoryId && !description.trim()");
  });

  it("allows confirmed grouped deletion with a temporary undo action", () => {
    expect(dashboardSource).toContain("onDeleteEntries(group.entries.map");
    expect(dashboardSource).toContain("time entries deleted");
    expect(dashboardSource).toContain("undoHistoryDeletion");
    expect(dashboardSource).toContain("}, 5000)");
  });

  it("keeps the in-app confirmation card borderless", () => {
    const cardStyle = mobileThemeSource.slice(
      mobileThemeSource.indexOf("sheetDeleteConfirmationCard:"),
      mobileThemeSource.indexOf("sheetDeleteConfirmationTitle:")
    );

    expect(cardStyle).not.toContain("borderWidth");
    expect(cardStyle).not.toContain("borderColor");
  });
});
