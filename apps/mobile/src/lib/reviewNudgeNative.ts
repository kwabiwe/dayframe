// The only file that talks to expo-notifications for the evening Review reminder, so the
// planner and store stay testable without the native module.
import * as Notifications from "expo-notifications";

export const REVIEW_NUDGE_NOTIFICATION_ID = "dayframe-review-nudge";

export type ReviewNudgePermission = "granted" | "denied" | "undetermined";

function permissionFrom(status: Notifications.NotificationPermissionsStatus): ReviewNudgePermission {
  if (status.granted) return "granted";
  const provisional = status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (provisional) return "granted";
  return status.canAskAgain ? "undetermined" : "denied";
}

export async function readReviewNudgePermission(): Promise<ReviewNudgePermission> {
  return permissionFrom(await Notifications.getPermissionsAsync());
}

export async function requestReviewNudgePermission(): Promise<ReviewNudgePermission> {
  return permissionFrom(await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true }
  }));
}

export async function scheduleReviewNudge(fireAt: Date, body: string, accountKey: string) {
  await Notifications.cancelScheduledNotificationAsync(REVIEW_NUDGE_NOTIFICATION_ID).catch(() => undefined);
  await Notifications.scheduleNotificationAsync({
    identifier: REVIEW_NUDGE_NOTIFICATION_ID,
    content: { title: "Dayframe", body, data: { kind: "review-nudge", accountKey }, sound: "default" },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt }
  });
}

export async function cancelReviewNudge() {
  await Notifications.cancelScheduledNotificationAsync(REVIEW_NUDGE_NOTIFICATION_ID);
}

/** Calls `onOpen` with the reminder's account key when the person taps it (also on a cold start). */
export function subscribeReviewNudgeOpens(onOpen: (accountKey: string | null) => void) {
  const handle = (response: Notifications.NotificationResponse | null) => {
    const data = response?.notification.request.content.data as { kind?: unknown; accountKey?: unknown } | undefined;
    if (data?.kind !== "review-nudge") return;
    onOpen(typeof data.accountKey === "string" ? data.accountKey : null);
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    handle(response);
    if (response) void Notifications.clearLastNotificationResponseAsync();
  }).catch(() => undefined);
  return () => subscription.remove();
}
