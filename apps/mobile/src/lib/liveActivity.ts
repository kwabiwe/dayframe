import { NativeModules, Platform } from "react-native";
import type { MobileBootstrap } from "./api";

type LiveActivityEntry = Pick<
  NonNullable<MobileBootstrap["activeEntry"]>,
  "categoryName" | "description" | "id" | "startedAt"
>;

type DayframeLiveActivityModule = {
  start(title: string, categoryName?: string | null, startedAt?: string | null): Promise<boolean>;
  stop(): Promise<boolean>;
};

const nativeLiveActivity = NativeModules.DayframeLiveActivityModule as DayframeLiveActivityModule | undefined;

let lastSyncedLiveActivityKey: string | null = null;

export async function syncLiveActivityForEntry(entry: LiveActivityEntry | null | undefined) {
  if (Platform.OS !== "ios" || !nativeLiveActivity) return;

  if (!entry) {
    if (lastSyncedLiveActivityKey === "idle") return;
    const didStop = await nativeLiveActivity.stop().catch(() => false);
    if (didStop) lastSyncedLiveActivityKey = "idle";
    return;
  }

  const title = displayLiveActivityTitle(entry);
  const key = [entry.id, entry.startedAt, title, entry.categoryName ?? ""].join("|");
  if (lastSyncedLiveActivityKey === key) return;

  const didStart = await nativeLiveActivity.start(title, entry.categoryName, entry.startedAt).catch(() => false);
  if (didStart) lastSyncedLiveActivityKey = key;
}

function displayLiveActivityTitle(entry: LiveActivityEntry) {
  const description = entry.description?.trim();
  if (description) return description;
  const categoryName = entry.categoryName?.trim();
  if (categoryName) return categoryName;
  return "Tracking";
}
