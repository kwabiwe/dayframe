/**
 * The accuracy trial's admission guard (card K), reachable from modules that can't import `geofence.ts` statically
 * (it imports them): `geofence.ts` registers it when it loads, and capture admission paths arm it before their first
 * await, so options a relaunch may have inherited are never left unguarded while admission waits (Codex r22 on #619).
 */
let admissionGuard: (() => void) | null = null;

export function registerLocationAdmissionGuard(guard: () => void) {
  admissionGuard = guard;
}

export function armLocationAdmissionGuard() {
  admissionGuard?.();
}
