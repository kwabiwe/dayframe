import type { MobileBootstrap } from "./api";

const listeners = new Set<(bootstrap: MobileBootstrap) => void>();

export function publishRecoveredDashboardBootstrap(bootstrap: MobileBootstrap) {
  for (const listener of listeners) listener(bootstrap);
}

export function subscribeRecoveredDashboardBootstrap(
  listener: (bootstrap: MobileBootstrap) => void
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
