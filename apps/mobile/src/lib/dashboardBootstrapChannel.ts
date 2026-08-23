import type { MobileBootstrap } from "./api";

export type RecoveredDashboardBootstrapEvent =
  | { publicationId: number; type: "started" }
  | { bootstrap: MobileBootstrap; publicationId: number; type: "completed" };

const listeners = new Set<(event: RecoveredDashboardBootstrapEvent) => void>();
let publicationSequence = 0;

export function beginRecoveredDashboardBootstrapPublication() {
  const publicationId = ++publicationSequence;
  publish({ publicationId, type: "started" });
  return {
    publish(bootstrap: MobileBootstrap) {
      publish({ bootstrap, publicationId, type: "completed" });
    }
  };
}

export function subscribeRecoveredDashboardBootstrap(
  listener: (event: RecoveredDashboardBootstrapEvent) => void
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(event: RecoveredDashboardBootstrapEvent) {
  for (const listener of listeners) listener(event);
}
