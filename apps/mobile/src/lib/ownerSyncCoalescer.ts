/** One active pass and at most one explicit follow-up per owner. */
export function createOwnerSyncCoalescer<Result>() {
  type Entry = { active: Promise<Result>; followUp?: Promise<Result> };
  const entries = new Map<string, Entry>();
  return {
    run(
      owner: string,
      manual: boolean,
      operation: (manual: boolean) => Promise<Result>,
      persistManual: () => Promise<void>
    ) {
      const current = entries.get(owner);
      if (current) {
        if (!manual) return current.followUp ?? current.active;
        if (current.followUp) return current.followUp;
        const saved = persistManual();
        // Observe storage failure immediately; the caller still receives it.
        void saved.catch(() => {});
        current.followUp = current.active
          .catch(() => undefined)
          .then(async () => {
            await saved;
            return operation(true);
          })
          .finally(() => {
            if (entries.get(owner) === current) entries.delete(owner);
          });
        return current.followUp;
      }
      const entry: Entry = {
        active: Promise.resolve()
          .then(async () => {
            if (manual) await persistManual();
            return operation(manual);
          })
          .finally(() => {
            if (!entry.followUp && entries.get(owner) === entry) entries.delete(owner);
          })
      };
      entries.set(owner, entry);
      return entry.active;
    }
  };
}
