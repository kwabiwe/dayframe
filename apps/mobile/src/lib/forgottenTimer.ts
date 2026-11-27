import { NativeModules } from "react-native";
import type { Notification } from "expo-notifications";
import { DAYFRAME_API_BASE } from "./config";
import type { MobileAccountOwner } from "./mobileAccount";
import { mobileJsonRequest, StaleMobileSessionResponseError } from "./mobile-network";
import { isAuthenticatedSessionSnapshotCurrent, readOwnedAuthenticatedSessionSnapshot } from "./secure-session";

export const FORGOTTEN_TIMER_AGE_MS = 8 * 60 * 60 * 1000;

export function forgottenTimerEntryId(notification: Notification) {
  const { trigger, content } = notification.request;
  // Expo exposes the outer APNs fields on the push trigger. The content data for a
  // remote notification is populated only from the optional APNs `body` object.
  const data = trigger && "type" in trigger && trigger.type === "push"
    ? trigger.payload ?? content.data
    : content.data;
  return data?.kind === "forgotten-timer" && typeof data.entryId === "string" ? data.entryId : null;
}

async function request(owner: MobileAccountOwner, path: string, method: string, body?: unknown, signal?: AbortSignal) {
  const session = await readOwnedAuthenticatedSessionSnapshot(owner);
  if (session.status !== "authenticated") throw new StaleMobileSessionResponseError();
  return mobileJsonRequest(`${DAYFRAME_API_BASE}/api/timer-reminders/${path}`, {
    method,
    signal,
    headers: {
      Authorization: `Bearer ${session.snapshot.token}`,
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  }, {
    timeoutMilliseconds: 8_000,
    timeoutMessage: "Dayframe couldn’t reach timer reminders. Try again.",
    isCurrent: () => isAuthenticatedSessionSnapshotCurrent(session.snapshot)
  });
}

export async function forgottenTimerAvailable(owner: MobileAccountOwner, entryId: string, signal: AbortSignal) {
  const { response, body } = await request(owner, encodeURIComponent(entryId), "GET", undefined, signal);
  return response.ok && body?.available === true;
}

type ReminderResponse =
  | { action: "keep" }
  | { action: "stop"; commandId: string }
  | { action: "end"; commandId: string; stoppedAt: string };

export async function respondToForgottenTimer(owner: MobileAccountOwner, entryId: string, response: ReminderResponse) {
  const result = await request(owner, encodeURIComponent(entryId), "POST", response);
  if (result.response.ok) return "saved";
  if (result.response.status === 409) return "changed";
  throw new Error("The block response could not be saved.");
}

export async function readForgottenTimerAlerts(owner: MobileAccountOwner) {
  const { response, body } = await request(owner, "device", "GET");
  return response.ok && typeof body?.enabled === "boolean" ? body.enabled : null;
}

export async function setForgottenTimerAlerts(owner: MobileAccountOwner, enabled: boolean) {
  if (!enabled) return (await request(owner, "device", "DELETE")).response.ok ? "saved" : "unavailable";
  const { readReviewNudgePermission, requestReviewNudgePermission } = await import("./reviewNudgeNative");
  const permission = await readReviewNudgePermission();
  if (permission === "denied" || (permission !== "granted" && await requestReviewNudgePermission() !== "granted")) {
    return "denied";
  }
  const environment = await NativeModules.DayframeLiveActivityModule?.apnsEnvironment?.();
  if (environment !== "development" && environment !== "production") return "unavailable";
  const { getDevicePushTokenAsync } = await import("expo-notifications");
  const token = await getDevicePushTokenAsync();
  if (token.type !== "ios" || typeof token.data !== "string") return "unavailable";
  return (await request(owner, "device", "POST", { token: token.data, environment })).response.ok
    ? "saved" : "unavailable";
}

export async function subscribeForgottenTimerOpens(onOpen: (entryId: string) => void) {
  const notifications = await import("expo-notifications");
  let live = true;
  const handle = (response: import("expo-notifications").NotificationResponse | null) => {
    if (!live || !response) return;
    const entryId = forgottenTimerEntryId(response.notification);
    if (entryId === null) return;
    onOpen(entryId);
    void notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  };
  const subscription = notifications.addNotificationResponseReceivedListener(handle);
  void notifications.getLastNotificationResponseAsync().then(handle).catch(() => undefined);
  return () => {
    live = false;
    subscription.remove();
  };
}
