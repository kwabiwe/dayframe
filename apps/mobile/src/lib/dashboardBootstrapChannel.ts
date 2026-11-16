import type { MobileBootstrap } from "./api";

export type RecoveredDashboardBootstrapEvent =
  | { publicationId: number; type: "started" }
  | { publicationId: number; type: "abandoned" }
  | { bootstrap: MobileBootstrap; serverBootstrap: MobileBootstrap; publicationId: number; requestedAt: number; type: "completed" };

const listeners = new Set<(event: RecoveredDashboardBootstrapEvent) => void>();
let publicationSequence = 0;

export function beginRecoveredDashboardBootstrapPublication(requestedAt: number) {
  const publicationId = ++publicationSequence;
  let settled = false;
  publish({ publicationId, type: "started" });
  return {
    abandon() {
      if (settled) return;
      settled = true;
      publish({ publicationId, type: "abandoned" });
    },
    publish(bootstrap: MobileBootstrap, serverBootstrap: MobileBootstrap) {
      if (settled) return;
      settled = true;
      publish({ bootstrap, serverBootstrap, publicationId, requestedAt, type: "completed" });
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
