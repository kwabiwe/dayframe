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

/** Identity of the monitored places Settings last re-registered (I1: skip identical refreshes). */
export function settingsGeofenceKey(
  userId: string,
  workspaceId: string,
  places: ReadonlyArray<{ id: string; latitude?: number | null; longitude?: number | null; radiusMeters: number; priority?: number; loggingEnabled?: boolean; role?: string | null }>
) {
  return JSON.stringify([userId, workspaceId, places.map((place) => [
    place.id, place.latitude ?? null, place.longitude ?? null, place.radiusMeters, place.priority ?? null,
    place.loggingEnabled ?? null, place.role ?? null
  ])]);
}
