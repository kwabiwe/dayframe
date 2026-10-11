/**
 * The Apple Health type sheet's Name (UIA-085): saved one request at a time per Health type, in
 * the order the edits were made, and the latest draft always wins. A commit while a save is on its
 * way waits for it, then saves whatever the draft is by then (including a return to the original
 * Name). A sheet opened again for the same type queues behind the previous sheet's saves, so an
 * older draft can never land after a newer one. A failed save stays retryable and puts the last
 * confirmed Name back unless something newer was typed meanwhile.
 */
const queues = new Map<string, Promise<void>>();

export function createNameCommitter(input: {
  key: string;
  initial: string;
  readDraft: () => string;
  showDraft: (value: string) => void;
  save: (name: string) => Promise<boolean>;
}) {
  let saved = input.initial.trim();
  let inflight: Promise<void> | null = null;
  let again = false;

  async function saveOnce() {
    const next = input.readDraft().trim();
    if (next === saved) return;
    const ok = await input.save(next).catch(() => false);
    if (ok) saved = next;
    else if (input.readDraft().trim() === next) input.showDraft(saved);
  }

  async function drain() {
    do {
      again = false;
      await saveOnce();
    } while (again);
  }

  return function commit(): Promise<void> {
    if (inflight) {
      again = true;
      return inflight;
    }
    // Nothing queued for this type: start now; otherwise after the earlier sheet's saves.
    const prior = queues.get(input.key);
    const run = (prior ? prior.then(drain) : drain()).finally(() => {
      inflight = null;
      if (queues.get(input.key) === run) queues.delete(input.key);
    });
    inflight = run;
    queues.set(input.key, run);
    return run;
  };
}
