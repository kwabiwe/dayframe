/**
 * The Apple Health type sheet's Name (UIA-085): a draft saved one request at a time, and the latest
 * draft always wins. A commit while a save is on its way waits for it, then saves whatever the
 * draft is by then (including a return to the original Name). A failed save stays retryable and
 * puts the last confirmed Name back unless something newer was typed meanwhile.
 */
export function createNameCommitter(input: {
  initial: string;
  readDraft: () => string;
  showDraft: (value: string) => void;
  save: (name: string) => Promise<boolean>;
}) {
  let saved = input.initial.trim();
  let inflight: Promise<void> | null = null;
  let again = false;
  function commit(): Promise<void> {
    if (inflight) {
      again = true;
      return inflight;
    }
    const next = input.readDraft().trim();
    if (next === saved) return Promise.resolve();
    inflight = input.save(next).then((ok) => {
      inflight = null;
      if (ok) saved = next;
      else if (input.readDraft().trim() === next) input.showDraft(saved);
      if (again) {
        again = false;
        return commit();
      }
    });
    return inflight;
  }
  return commit;
}
