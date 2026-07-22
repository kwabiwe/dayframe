import { NativeModules, Platform } from "react-native";
import { paletteColorFor } from "@dayframe/shared";
import type { MobileBootstrap } from "./api";

type LiveActivityEntry = Pick<
  NonNullable<MobileBootstrap["activeEntry"]>,
  "categoryColor" | "categoryName" | "description" | "id" | "startedAt"
>;

type DayframeLiveActivityModule = {
  start(
    title: string,
    categoryName?: string | null,
    categoryColor?: string | null,
    startedAt?: string | null
  ): Promise<boolean>;
  stop(): Promise<boolean>;
};

const nativeLiveActivity = NativeModules.DayframeLiveActivityModule as DayframeLiveActivityModule | undefined;

let lastSyncedLiveActivityKey: string | null = null;
let requestedEntry: LiveActivityEntry | null = null;
let reconciliation: Promise<void> | null = null;

export async function syncLiveActivityForEntry(entry: LiveActivityEntry | null | undefined) {
  if (Platform.OS !== "ios" || !nativeLiveActivity) return;

  requestedEntry = entry ?? null;
  if (!reconciliation) {
    reconciliation = reconcileLatestEntry().finally(() => {
      reconciliation = null;
    });
  }
  await reconciliation;
}

async function reconcileLatestEntry() {
  while (true) {
    const entry = requestedEntry;
    const requestedKey = liveActivityKey(entry);
    if (lastSyncedLiveActivityKey === requestedKey) return;

    if (!entry) {
      const didStop = await nativeLiveActivity!.stop().catch(() => false);
      if (requestedEntry !== entry) continue;
      if (didStop) lastSyncedLiveActivityKey = requestedKey;
      return;
    }

    const title = displayLiveActivityTitle(entry);
    const categoryColor = entry.categoryName
      ? paletteColorFor(entry.categoryColor ?? entry.categoryName, entry.categoryName, "dark")
      : null;
    const didStart = await nativeLiveActivity!.start(
      title,
      entry.categoryName,
      categoryColor,
      entry.startedAt
    ).catch(() => false);
    if (requestedEntry !== entry) continue;
    if (didStart) lastSyncedLiveActivityKey = requestedKey;
    return;
  }
}

function liveActivityKey(entry: LiveActivityEntry | null) {
  if (!entry) return "idle";
  const title = displayLiveActivityTitle(entry);
  const categoryColor = entry.categoryName
    ? paletteColorFor(entry.categoryColor ?? entry.categoryName, entry.categoryName, "dark")
    : null;
  return [entry.id, entry.startedAt, title, entry.categoryName ?? "", categoryColor ?? ""].join("|");
}

function displayLiveActivityTitle(entry: LiveActivityEntry) {
  const description = entry.description?.trim();
  if (description) return description;
  const categoryName = entry.categoryName?.trim();
  if (categoryName) return categoryName;
  return "Tracking";
}
