export const SETTINGS_SNAPSHOT_TTL_MS = 30_000;
export const SETTINGS_HEALTH_SNAPSHOT_TTL_MS = 60_000;

export type SettingsRefreshTrigger = "navigation" | "focus" | "pull";

export function isFreshSettingsSnapshot(
  updatedAt: number | null | undefined,
  now = Date.now(),
  ttlMs = SETTINGS_SNAPSHOT_TTL_MS
) {
  return typeof updatedAt === "number" && updatedAt > 0 && now - updatedAt < ttlMs;
}

export function shouldRefreshSettingsSnapshot(
  updatedAt: number | null | undefined,
  now = Date.now(),
  ttlMs = SETTINGS_SNAPSHOT_TTL_MS
) {
  return !isFreshSettingsSnapshot(updatedAt, now, ttlMs);
}

export function shouldShowSettingsRefreshSpinner(trigger: SettingsRefreshTrigger) {
  return trigger === "pull";
}

/**
 * Identity of the saved places Settings last handed to the location catalogue and region
 * registration (I1: skip identical refreshes). Every field of every place is included, so a change
 * to anything the catalogue consumes (name, role, default activity or description, radius, logging)
 * refreshes it; only a byte-identical list is skipped.
 */
export function settingsGeofenceKey(userId: string, workspaceId: string, places: ReadonlyArray<object>) {
  return JSON.stringify([userId, workspaceId, places.map(stableJson)]);
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value ?? null;
  return Object.keys(value).sort().map((key) => [key, stableJson((value as Record<string, unknown>)[key])]);
}
