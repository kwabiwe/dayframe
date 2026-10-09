// A page that changes what Today shows (for example setup pinning quick starts) asks Today to
// read again when it is next focused, instead of waiting for the periodic reconcile.
let pending = false;

export function requestDashboardRefresh() {
  pending = true;
}

/** True once per request; Today calls it when it gains focus. */
export function takeDashboardRefresh() {
  const was = pending;
  pending = false;
  return was;
}
