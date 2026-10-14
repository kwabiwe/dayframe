import { NativeModules, Platform, Settings } from "react-native";
import { paletteColorFor } from "@dayframe/shared";
import { enqueueEvent, readQueue, subscribeActivityQueue, type MobileBootstrap } from "./api";
import {
  mobileAccountOwnersEqual,
  readActiveMobileAccount,
  subscribeActiveMobileAccount,
  type MobileAccountOwner
} from "./mobileAccount";

const SHORTCUT_CATALOG_KEY = "dayframe.shortcutCatalog.v1";

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
  pendingShortcutEvents?: () => Promise<unknown>;
  removeShortcutEvents?: (localIds: string[]) => Promise<number>;
  pendingShortcutStartMarkers?: () => Promise<unknown>;
  addPendingShortcutStartMarkers?: (markers: Array<{ localId: string; userId: string; workspaceId: string }>) => Promise<number>;
  markPendingShortcutStartsReconciled?: (userId: string, workspaceId: string) => Promise<boolean>;
  clearPendingShortcutStartMarkers?: (localIds: string[]) => Promise<number>;
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
    Settings.set({ [SHORTCUT_CATALOG_KEY]: JSON.stringify(catalog) });
  } catch {
    // Shortcut options are a convenience cache; timer actions still work without it.
  }
}

export function clearShortcutCatalog() {
  if (Platform.OS !== "ios") return;
  try {
    Settings.set({ [SHORTCUT_CATALOG_KEY]: "" });
  } catch {
    // The catalog contains no secret; clearing it is a best-effort logout boundary.
  }
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
  const removed = await nativeShortcutQueue.removeShortcutEvents(localIds);
  await reconcilePendingShortcutStartMarkers(owner).catch(() => 0);
  return removed;
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
  if (!events.length) {
    await reconcilePendingShortcutStartMarkers(owner).catch(() => 0);
    return { transferredCount: 0, transferredLocalIds: [] as string[] };
  }

  let transferredCount = 0;
  const transferredLocalIds: string[] = [];
  try {
    for (const event of events) {
      await enqueueEvent({
        owner,
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
  await reconcilePendingShortcutStartMarkers(owner).catch(() => 0);
  return { transferredCount, transferredLocalIds };
}

/**
 * Brings the native pending-Start markers (see `DayframePendingShortcutStarts`) in line with both queues
 * for an account: every Shortcut Start still queued anywhere, including one an older build moved into the
 * app queue, has a marker (even permanently failed: Sync help can retry it); a marker whose Start left both
 * queues (delivered, discarded, removed at logout) is cleared. The native queue is read before the app
 * queue, so a Start moving between them is never missed. Then the account is marked reconciled: until
 * that first run the Stop intent never resolves a running entry on the server (Codex r3 on #403).
 * Runs one at a time.
 */
export function reconcilePendingShortcutStartMarkers(requestedOwner?: MobileAccountOwner) {
  const run = reconcileTail.catch(() => 0).then(() => reconcileUnserialised(requestedOwner));
  reconcileTail = run.catch(() => 0);
  return run;
}
let reconcileTail: Promise<unknown> = Promise.resolve();

async function reconcileUnserialised(requestedOwner?: MobileAccountOwner) {
  if (Platform.OS !== "ios") return 0;
  const markersModule = nativeShortcutQueue;
  if (
    !markersModule?.pendingShortcutStartMarkers || !markersModule.clearPendingShortcutStartMarkers ||
    !markersModule.addPendingShortcutStartMarkers || !markersModule.markPendingShortcutStartsReconciled ||
    !markersModule.pendingShortcutEvents
  ) return 0;
  const owner = requestedOwner ?? await readActiveMobileAccount();
  if (!owner) return 0;
  const nativePending = parseNativeShortcutQueue(await markersModule.pendingShortcutEvents());
  const appQueue = await readQueue(owner);
  const stillQueued = new Set([...nativePending.map((event) => event.localId), ...appQueue.map((event) => event.localId)]);
  const raw = await markersModule.pendingShortcutStartMarkers();
  const marked = new Set((Array.isArray(raw) ? raw : []).filter(isRecord).filter((marker) =>
    marker.userId === owner.userId && marker.workspaceId === owner.workspaceId && typeof marker.localId === "string"
  ).map((marker) => marker.localId as string));
  const missing = appQueue
    .filter((event) => event.source === "shortcut" && event.type === "shortcut_action" && !marked.has(event.localId))
    .map((event) => ({ localId: event.localId, userId: owner.userId, workspaceId: owner.workspaceId }));
  if (missing.length) await markersModule.addPendingShortcutStartMarkers(missing);
  const settled = [...marked].filter((localId) => !stillQueued.has(localId));
  if (settled.length) await markersModule.clearPendingShortcutStartMarkers(settled);
  await markersModule.markPendingShortcutStartsReconciled(owner.userId, owner.workspaceId);
  return settled.length;
}

/** Keeps the markers in step with the activity queue while the app runs; returns the unsubscribe. */
export function startPendingShortcutStartReconciliation() {
  const reconcile = () => void reconcilePendingShortcutStartMarkers().catch(() => 0);
  reconcile();
  const unsubscribeQueue = subscribeActivityQueue(reconcile);
  const unsubscribeAccount = subscribeActiveMobileAccount(reconcile);
  return () => {
    unsubscribeQueue();
    unsubscribeAccount();
  };
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
