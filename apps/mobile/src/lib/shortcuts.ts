import { NativeModules, Platform, Settings } from "react-native";
import { paletteColorFor } from "@dayframe/shared";
import { enqueueEvent, type MobileBootstrap } from "./api";

const SHORTCUT_CATALOG_KEY = "dayframe.shortcutCatalog.v1";

type NativeShortcutQueuedEvent = {
  localId: string;
  source?: string;
  type?: NativeShortcutEventType;
  occurredAt?: string;
  categoryId?: string;
  description?: string;
  rawPayload?: Record<string, unknown>;
};

type NativeShortcutEventType = "shortcut_action" | "timer_stop";

type NativeShortcutQueueModule = {
  pendingShortcutEvents?: () => Promise<unknown>;
  removeShortcutEvents?: (localIds: string[]) => Promise<number>;
};

const nativeShortcutQueue = NativeModules.DayframeLiveActivityModule as NativeShortcutQueueModule | undefined;

export function syncShortcutCatalog(data: Pick<MobileBootstrap, "categories" | "workspace"> | null | undefined) {
  if (Platform.OS !== "ios") return;

  if (!data?.workspace) return;

  const catalog = {
    workspace: {
      id: data.workspace.id,
      name: data.workspace.name
    },
    categories: data.categories
      .map((category) => ({
        color: paletteColorFor(category.color, category.name, "dark"),
        id: category.id,
        name: category.name
      }))
      .filter((category) => category.name.trim().length > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
  };

  try {
    Settings.set({ [SHORTCUT_CATALOG_KEY]: JSON.stringify(catalog) });
  } catch {
    // Shortcut options are a convenience cache; timer actions still work without it.
  }
}

export async function drainNativeShortcutQueue() {
  if (Platform.OS !== "ios") return { transferredCount: 0, transferredLocalIds: [] as string[] };
  if (!nativeShortcutQueue?.pendingShortcutEvents || !nativeShortcutQueue.removeShortcutEvents) {
    return { transferredCount: 0, transferredLocalIds: [] as string[] };
  }

  const events = parseNativeShortcutQueue(await nativeShortcutQueue.pendingShortcutEvents());
  if (!events.length) return { transferredCount: 0, transferredLocalIds: [] as string[] };

  let transferredCount = 0;
  const transferredLocalIds: string[] = [];
  try {
    for (const event of events) {
      await enqueueEvent({
        localId: event.localId,
        source: "shortcut",
        type: event.type,
        occurredAt: event.occurredAt,
        categoryId: event.categoryId,
        description: event.description,
        rawPayload: event.rawPayload
      });
      transferredCount += 1;
      transferredLocalIds.push(event.localId);
    }
  } catch (error) {
    if (transferredLocalIds.length) {
      await nativeShortcutQueue.removeShortcutEvents(transferredLocalIds).catch(() => 0);
    }
    throw error;
  }

  await nativeShortcutQueue.removeShortcutEvents(transferredLocalIds);
  return { transferredCount, transferredLocalIds };
}

function parseNativeShortcutQueue(value: unknown) {
  try {
    const parsed = Array.isArray(value)
      ? value
      : typeof value === "string" && value.trim()
        ? JSON.parse(value) as unknown
        : [];
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item) => {
      const event = normalizeNativeShortcutEvent(item);
      return event ? [event] : [];
    });
  } catch {
    return [];
  }
}

function normalizeNativeShortcutEvent(value: unknown) {
  if (!isRecord(value)) return null;
  const localId = stringValue(value.localId);
  if (!localId) return null;
  const type = nativeShortcutEventType(value.type);
  if (!type) return null;

  const occurredAt = typeof value.occurredAt === "string" ? new Date(value.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) return null;

  return {
    localId,
    type,
    occurredAt,
    categoryId: stringValue(value.categoryId),
    description: stringValue(value.description),
    rawPayload: isRecord(value.rawPayload) ? value.rawPayload : {}
  };
}

function nativeShortcutEventType(value: unknown): NativeShortcutEventType | null {
  return value === "shortcut_action" || value === "timer_stop" ? value : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
