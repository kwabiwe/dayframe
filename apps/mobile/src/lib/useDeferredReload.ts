import { useCallback, useEffect, useState } from "react";

/**
 * A reload asked for while Dayframe may be away (Calendar's Health reprocess; Codex r3 on #615): it runs once `ready`
 * (in front and signed in), whichever comes last — the request or readiness — and once per request.
 */
export function useDeferredReload(ready: boolean, reload: () => void) {
  const [pending, setPending] = useState(0);
  const [done, setDone] = useState(0);
  useEffect(() => {
    if (!ready || pending === done) return;
    setDone(pending);
    reload();
    // The latest reload is read when it runs; only readiness and a new request start it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pending, done]);
  return useCallback(() => setPending((count) => count + 1), []);
}
