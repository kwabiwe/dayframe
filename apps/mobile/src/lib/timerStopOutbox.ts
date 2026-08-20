import AsyncStorage from "@react-native-async-storage/async-storage";

const TIMER_STOP_OUTBOX_KEY = "dayframe.timerStopOutbox.v1";
let timerStopOutboxMutationTail: Promise<void> = Promise.resolve();
let fallbackEventSequence = 0;

export type TimerStopOwner = {
  userId: string;
  workspaceId: string;
};

export type TimerStopTarget =
  | { targetEntryId: string; optimisticEntryId?: never }
  | { optimisticEntryId: string; targetEntryId?: never };

export type PendingTimerStop = TimerStopOwner & {
  clientEventId: string;
  occurredAt: string;
  queuedAt: string;
  targetEntryId?: string;
  optimisticEntryId?: string;
  failureCount?: number;
  failureKind?: "retryable" | "permanent";
  failedAt?: string;
  lastError?: string;
  lastStatusCode?: number;
};

export async function getOrCreatePendingStop(input: {
  owner: TimerStopOwner;
  target: TimerStopTarget;
  occurredAt?: string;
}) {
  return withTimerStopOutboxMutation(async () => {
    const outbox = await readPendingTimerStopsUnlocked();
    const existing = outbox.find((item) =>
      timerStopOwnerMatches(item, input.owner) && sameTimerStopTarget(item, input.target)
    );
    if (existing) return existing;

    const now = new Date().toISOString();
    const occurredAt = validIso(input.occurredAt) ?? now;
    const next: PendingTimerStop = {
      clientEventId: generatedStopEventId(),
      occurredAt,
      queuedAt: now,
      userId: requiredText(input.owner.userId, "userId"),
      workspaceId: requiredText(input.owner.workspaceId, "workspaceId"),
      ...("targetEntryId" in input.target
        ? { targetEntryId: requiredText(input.target.targetEntryId, "targetEntryId") }
        : { optimisticEntryId: requiredText(input.target.optimisticEntryId, "optimisticEntryId") })
    };
    await writePendingTimerStops([...outbox, next]);
    return next;
  });
}

export function readPendingTimerStops(): Promise<PendingTimerStop[]> {
  return withTimerStopOutboxMutation(readPendingTimerStopsUnlocked);
}

async function readPendingTimerStopsUnlocked(): Promise<PendingTimerStop[]> {
  const raw = await AsyncStorage.getItem(TIMER_STOP_OUTBOX_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await writePendingTimerStops([]);
    return [];
  }
  if (!Array.isArray(parsed)) {
    await writePendingTimerStops([]);
    return [];
  }
  const recovered = parsed.flatMap((item) => {
    const pending = parsePendingTimerStop(item);
    return pending ? [pending] : [];
  });
  if (recovered.length !== parsed.length) await writePendingTimerStops(recovered);
  return recovered;
}

export async function removePendingTimerStop(clientEventId: string) {
  return withTimerStopOutboxMutation(async () => {
    const outbox = await readPendingTimerStopsUnlocked();
    const next = outbox.filter((item) => item.clientEventId !== clientEventId);
    if (next.length === outbox.length) return false;
    await writePendingTimerStops(next);
    return true;
  });
}

export async function markPendingTimerStopFailure(
  clientEventId: string,
  input: {
    message: string;
    failureKind: "retryable" | "permanent";
    statusCode?: number;
  }
) {
  return withTimerStopOutboxMutation(async () => {
    const outbox = await readPendingTimerStopsUnlocked();
    let updated: PendingTimerStop | null = null;
    const next = outbox.map((item) => {
      if (item.clientEventId !== clientEventId) return item;
      updated = {
        ...item,
        failedAt: new Date().toISOString(),
        failureCount: (item.failureCount ?? 0) + 1,
        failureKind: input.failureKind,
        lastError: input.message,
        ...(input.statusCode === undefined ? {} : { lastStatusCode: input.statusCode })
      };
      return updated;
    });
    if (updated) await writePendingTimerStops(next);
    return updated;
  });
}

export async function resolvePendingTimerStopTargets(
  correlations: ReadonlyMap<string, string>,
  owner?: TimerStopOwner
) {
  if (correlations.size === 0) return readPendingTimerStops();
  return withTimerStopOutboxMutation(async () => {
    const outbox = await readPendingTimerStopsUnlocked();
    let changed = false;
    const next = outbox.map((item) => {
      if (owner && !timerStopOwnerMatches(item, owner)) return item;
      if (!item.optimisticEntryId || item.targetEntryId) return item;
      const targetEntryId = correlations.get(item.optimisticEntryId);
      if (!targetEntryId) return item;
      changed = true;
      return { ...item, targetEntryId };
    });
    if (changed) await writePendingTimerStops(next);
    return next;
  });
}

export async function removePendingTimerStopsForTarget(
  owner: TimerStopOwner,
  target: TimerStopTarget
) {
  return withTimerStopOutboxMutation(async () => {
    const outbox = await readPendingTimerStopsUnlocked();
    const removed = outbox.filter((item) =>
      timerStopOwnerMatches(item, owner) && sameTimerStopTarget(item, target)
    );
    if (removed.length === 0) return [];
    const removedIds = new Set(removed.map((item) => item.clientEventId));
    await writePendingTimerStops(outbox.filter((item) => !removedIds.has(item.clientEventId)));
    return removed;
  });
}

export function pendingTimerStopsForOwner(
  pendingStops: readonly PendingTimerStop[],
  owner: TimerStopOwner
) {
  return pendingStops.filter((item) => timerStopOwnerMatches(item, owner));
}

export function timerStopOwnerMatches(
  pendingStop: Pick<PendingTimerStop, "userId" | "workspaceId">,
  owner: TimerStopOwner
) {
  return pendingStop.userId === owner.userId && pendingStop.workspaceId === owner.workspaceId;
}

function withTimerStopOutboxMutation<Result>(operation: () => Promise<Result>) {
  const result = timerStopOutboxMutationTail.catch(() => undefined).then(operation);
  timerStopOutboxMutationTail = result.then(() => undefined, () => undefined);
  return result;
}

function sameTimerStopTarget(item: PendingTimerStop, target: TimerStopTarget) {
  if (target.targetEntryId) return item.targetEntryId === target.targetEntryId;
  return item.optimisticEntryId === target.optimisticEntryId;
}

async function writePendingTimerStops(outbox: readonly PendingTimerStop[]) {
  await AsyncStorage.setItem(TIMER_STOP_OUTBOX_KEY, JSON.stringify(outbox));
}

function parsePendingTimerStop(value: unknown): PendingTimerStop | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const clientEventId = optionalText(item.clientEventId);
  const occurredAt = validIso(item.occurredAt);
  const queuedAt = validIso(item.queuedAt);
  const userId = optionalText(item.userId);
  const workspaceId = optionalText(item.workspaceId);
  const targetEntryId = optionalText(item.targetEntryId);
  const optimisticEntryId = optionalText(item.optimisticEntryId);
  const failedAt = validIso(item.failedAt);
  const lastError = optionalText(item.lastError);
  if (
    !clientEventId ||
    !occurredAt ||
    !queuedAt ||
    !userId ||
    !workspaceId ||
    (!targetEntryId && !optimisticEntryId)
  ) {
    return null;
  }
  return {
    clientEventId,
    occurredAt,
    queuedAt,
    userId,
    workspaceId,
    ...(targetEntryId ? { targetEntryId } : {}),
    ...(optimisticEntryId ? { optimisticEntryId } : {}),
    ...(typeof item.failureCount === "number" && Number.isFinite(item.failureCount)
      ? { failureCount: Math.max(0, Math.trunc(item.failureCount)) }
      : {}),
    ...(item.failureKind === "retryable" || item.failureKind === "permanent"
      ? { failureKind: item.failureKind }
      : {}),
    ...(failedAt ? { failedAt } : {}),
    ...(lastError ? { lastError } : {}),
    ...(typeof item.lastStatusCode === "number" && Number.isFinite(item.lastStatusCode)
      ? { lastStatusCode: Math.trunc(item.lastStatusCode) }
      : {})
  };
}

function generatedStopEventId() {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const randomUuid = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
  if (randomUuid) return `mobile-timer-stop:${randomUuid}`;
  fallbackEventSequence += 1;
  return `mobile-timer-stop:${Date.now()}:${fallbackEventSequence}`;
}

function requiredText(value: unknown, field: string) {
  const text = optionalText(value);
  if (!text) throw new Error(`${field} is required for timer Stop recovery.`);
  return text;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validIso(value: unknown) {
  const text = optionalText(value);
  return text && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : null;
}
