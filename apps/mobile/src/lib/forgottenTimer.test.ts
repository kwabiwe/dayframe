import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeForgottenTimerOpens } from "./forgottenTimer";

const notifications = vi.hoisted(() => ({
  addNotificationResponseReceivedListener: vi.fn(),
  getLastNotificationResponseAsync: vi.fn(),
  clearLastNotificationResponseAsync: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("expo-notifications", () => notifications);
vi.mock("react-native", () => ({ NativeModules: {} }));
vi.mock("./config", () => ({ DAYFRAME_API_BASE: "https://test.invalid" }));
vi.mock("./mobile-network", () => ({}));
vi.mock("./secure-session", () => ({}));

function response(data: Record<string, unknown>) {
  return { notification: { request: { content: { data } } } };
}

describe("forgotten timer notification opens", () => {
  const remove = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    notifications.addNotificationResponseReceivedListener.mockReturnValue({ remove });
    notifications.getLastNotificationResponseAsync.mockResolvedValue(null);
  });

  it("reads a cold open from the native response and consumes it for the exact entry", async () => {
    const reminder = response({ kind: "forgotten-timer", entryId: "overdue-entry" });
    notifications.getLastNotificationResponseAsync.mockResolvedValueOnce(reminder);
    const onOpen = vi.fn();
    const stop = await subscribeForgottenTimerOpens(onOpen);

    expect(onOpen).toHaveBeenCalledExactlyOnceWith("overdue-entry");
    expect(notifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("leaves other notifications intact and ignores replies after the subscriber is removed", async () => {
    notifications.getLastNotificationResponseAsync.mockResolvedValueOnce(response({ kind: "review-nudge" }));
    const onOpen = vi.fn();
    const stop = await subscribeForgottenTimerOpens(onOpen);
    const [handle] = notifications.addNotificationResponseReceivedListener.mock.calls[0]!;
    handle(response({ kind: "forgotten-timer", entryId: null }));
    stop();
    handle(response({ kind: "forgotten-timer", entryId: "overdue-entry" }));

    expect(onOpen).not.toHaveBeenCalled();
    expect(notifications.clearLastNotificationResponseAsync).not.toHaveBeenCalled();
  });
});
