import { NativeModules, Platform } from "react-native";
import { paletteColorFor } from "@dayframe/shared";
import { enqueueEvents, type MobileBootstrap, type QueuedEvent } from "./api";
import {
  mobileAccountOwnersEqual,
  readActiveMobileAccount,
  type MobileAccountOwner
} from "./mobileAccount";

type NativeShortcutQueuedEvent = {
  localId: string;
  source?: string;
  type?: NativeShortcutEventType;
  occurredAt?: string;
  categoryId?: string;
  description?: string;
  rawPayload?: Record<string, unknown>;
  userId?: string;
  workspaceId?: string;
};

type NativeShortcutEventType = "shortcut_action" | "timer_stop";

type NativeShortcutQueueModule = {
  setShortcutCatalog?: (value: string) => Promise<void>;
  pendingShortcutEvents?: () => Promise<unknown>;
  removeShortcutEvents?: (localIds: string[]) => Promise<number>;
};

const nativeShortcutQueue = NativeModules.DayframeLiveActivityModule as NativeShortcutQueueModule | undefined;

export function syncShortcutCatalog(
  data: Pick<MobileBootstrap, "categories" | "user" | "workspace"> | null | undefined
) {
  if (Platform.OS !== "ios") return;

  if (!data?.workspace) return;

  const catalog = {
    workspace: {
      id: data.workspace.id,
      name: data.workspace.name
    },
    user: { id: data.user.id },
    categories: data.categories
      .map((category) => ({
        color: paletteColorFor(category.color, category.name, "dark"),
        id: category.id,
        lightColor: paletteColorFor(category.color, category.name, "light"),
        name: category.name
      }))
      .filter((category) => category.name.trim().length > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
  };

  try {
    writeShortcutCatalog(JSON.stringify(catalog));
  } catch {
    // Shortcut options are a convenience cache; timer actions still work without it.
  }
}

export function clearShortcutCatalog() {
  if (Platform.OS !== "ios") return;
  try {
    writeShortcutCatalog("");
  } catch {
    // The catalog contains no secret; clearing it is a best-effort logout boundary.
  }
}

/** Written natively, which skips an unchanged value: React Native's `Settings` module would forward
 * every UserDefaults change to JS (AGENTS.md Mobile Patterns). */
function writeShortcutCatalog(value: string) {
  void nativeShortcutQueue?.setShortcutCatalog?.(value).catch(() => undefined);
}

export async function clearActiveOwnerNativeShortcutQueue(owner: MobileAccountOwner) {
  if (Platform.OS !== "ios") return 0;
  if (!nativeShortcutQueue?.pendingShortcutEvents || !nativeShortcutQueue.removeShortcutEvents) {
    return 0;
  }

  const localIds = parseNativeShortcutQueue(await nativeShortcutQueue.pendingShortcutEvents())
    .filter((event) =>
      nativeEventBelongsToOwner(event, owner) || (!event.userId && !event.workspaceId)
    )
    .map((event) => event.localId);
  if (!localIds.length) return 0;
  return nativeShortcutQueue.removeShortcutEvents(localIds);
}

export async function getNativeShortcutPendingCount(owner: MobileAccountOwner) {
  if (Platform.OS !== "ios" || !nativeShortcutQueue?.pendingShortcutEvents) return 0;
  const events = parseNativeShortcutQueue(await nativeShortcutQueue.pendingShortcutEvents());
  return events.filter((event) => nativeEventCanTransferToOwner(event, owner)).length;
}

export async function drainNativeShortcutQueue(requestedOwner?: MobileAccountOwner) {
  if (Platform.OS !== "ios") return { transferredCount: 0, transferredLocalIds: [] as string[] };
  if (!nativeShortcutQueue?.pendingShortcutEvents || !nativeShortcutQueue.removeShortcutEvents) {
    return { transferredCount: 0, transferredLocalIds: [] as string[] };
  }

  const owner = requestedOwner ?? await readActiveMobileAccount();
  if (!owner) return { transferredCount: 0, transferredLocalIds: [] as string[] };
  const events = parseNativeShortcutQueue(await nativeShortcutQueue.pendingShortcutEvents())
    .filter((event) => nativeEventCanTransferToOwner(event, owner));
  if (!events.length) return { transferredCount: 0, transferredLocalIds: [] as string[] };

  // One queue write for the whole native backlog (stability audit 22 Oct 2026, iphone-timer-sync-8).
  const { acceptedCount, error } = await enqueueEvents(events.map((event) => ({
    owner,
    localId: event.localId,
    source: "shortcut" as const,
    type: event.type,
    occurredAt: event.occurredAt,
    categoryId: event.categoryId,
    description: event.description,
    rawPayload: event.rawPayload
  })));
  const transferredLocalIds = events.slice(0, acceptedCount).map((event) => event.localId);
  const transferredCount = transferredLocalIds.length;
  if (error !== undefined) {
    if (transferredLocalIds.length) {
      await nativeShortcutQueue.removeShortcutEvents(transferredLocalIds).catch(() => 0);
    }
    throw error;
  }

  await nativeShortcutQueue.removeShortcutEvents(transferredLocalIds);
  return { transferredCount, transferredLocalIds };
}

/**
 * The Lock Screen Stops of this account still waiting in the native queue, read without moving them
 * (Codex r1 on #578): the Dashboard shows their blocks stopped before the queue is transferred, which
 * waits for a fetch that offline never succeeds. Only entry-scoped Stops that name their block.
 */
export async function readPendingNativeEntryStops(owner: MobileAccountOwner): Promise<QueuedEvent[]> {
  if (Platform.OS !== "ios" || !nativeShortcutQueue?.pendingShortcutEvents) return [];
  const events = parseNativeShortcutQueue(await nativeShortcutQueue.pendingShortcutEvents().catch(() => null));
  return events.flatMap((event) =>
    nativeEventBelongsToOwner(event, owner) &&
      event.type === "timer_stop" &&
      event.rawPayload.stopScope === "entry" &&
      typeof event.rawPayload.targetEntryId === "string"
      ? [{
          ...owner,
          localId: event.localId,
          source: "shortcut" as const,
          type: event.type,
          occurredAt: event.occurredAt,
          queuedAt: event.occurredAt.toISOString(),
          rawPayload: event.rawPayload
        }]
      : []
  );
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
    rawPayload: isRecord(value.rawPayload) ? value.rawPayload : {},
    userId: stringValue(value.userId),
    workspaceId: stringValue(value.workspaceId)
  };
}

function nativeEventBelongsToOwner(
  event: Pick<NativeShortcutQueuedEvent, "userId" | "workspaceId">,
  owner: MobileAccountOwner
) {
  if (!event.userId || !event.workspaceId) return false;
  return mobileAccountOwnersEqual(event as MobileAccountOwner, owner);
}

function nativeEventCanTransferToOwner(
  event: Pick<NativeShortcutQueuedEvent, "userId" | "workspaceId">,
  owner: MobileAccountOwner
) {
  const isLegacyUnscopedEvent = !event.userId && !event.workspaceId;
  return isLegacyUnscopedEvent || nativeEventBelongsToOwner(event, owner);
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
