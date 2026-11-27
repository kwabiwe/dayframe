import { describe, expect, it, vi } from "vitest";
import { installDayframeForegroundNotificationHandler } from "./reviewNudgeNative";

const notifications = vi.hoisted(() => ({ setNotificationHandler: vi.fn() }));
vi.mock("expo-notifications", () => notifications);
vi.mock("react-native", () => ({ NativeModules: {} }));
vi.mock("./config", () => ({ DAYFRAME_API_BASE: "https://test.invalid" }));
vi.mock("./mobile-network", () => ({}));
vi.mock("./secure-session", () => ({}));

describe("Dayframe foreground notifications", () => {
  it("shows only the current account's Review alert and the current block's eight-hour alert", async () => {
    const isCurrentAccount = vi.fn(async (key: string | null) => key === "current-account");
    const isCurrentForgottenTimer = vi.fn(async (id: string) => id === "current-block");
    installDayframeForegroundNotificationHandler({ isCurrentAccount, isCurrentForgottenTimer });
    const [{ handleNotification }] = notifications.setNotificationHandler.mock.lastCall!;
    const handle = (data: Record<string, unknown>) => handleNotification({ request: data.kind === "forgotten-timer" ? {
      content: { data: null },
      trigger: { type: "push", payload: data }
    } : { content: { data } } });

    for (const [data, show] of [
      [{ kind: "review-nudge", accountKey: "current-account" }, true],
      [{ kind: "review-nudge", accountKey: "old-account" }, false],
      [{ kind: "forgotten-timer", entryId: "current-block" }, true],
      [{ kind: "forgotten-timer", entryId: "finished-block" }, false],
      [{ kind: "forgotten-timer", entryId: null }, false],
      [{ kind: "tracking-stopped" }, false]
    ] as const) {
      expect(await handle(data)).toEqual({
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: false
      });
    }
    expect(isCurrentForgottenTimer.mock.calls).toEqual([["current-block"], ["finished-block"]]);
  });
});
