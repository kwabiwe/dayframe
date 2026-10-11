/**
 * The Apple Health type sheet's Name (UIA-085): a draft saved once per value. It isn't sent again
 * while that value is on its way; a failed save stays retryable and puts the last confirmed Name
 * back unless something newer was typed meanwhile.
 */
export function createNameCommitter(input: {
  initial: string;
  readDraft: () => string;
  showDraft: (value: string) => void;
  save: (name: string) => Promise<boolean>;
}) {
  let saved = input.initial.trim();
  let sending: string | null = null;
  return function commit() {
    const next = input.readDraft().trim();
    if (next === saved || next === sending) return Promise.resolve();
    sending = next;
    return input.save(next).then((ok) => {
      if (sending === next) sending = null;
      if (ok) saved = next;
      else if (input.readDraft().trim() === next) input.showDraft(saved);
    });
  };
}
