import type { HealthAutoLogMapping, HealthAutoLogMappings, HealthImportPreferenceKey } from "@dayframe/shared";

/**
 * The one owner of Apple Health mapping writes (UIA-085). Every change to a Health type's mapping —
 * Logs as, Use default and the type sheet's Name — goes through one serial queue per type, in the
 * order it was made, and each write merges into the saved mapping as it is when the write runs, so
 * a queued write can never undo a later or earlier one. The Name is resolved when its turn comes:
 * the newest committed Name for the type is compared against the saved Name at that moment, so it
 * is written only when it differs, whichever sheet (open or already dismissed) committed it.
 *
 * What is shown is always the saved mappings with every still-queued change laid over them; a
 * failed write drops out of that, so the screen falls back to what is saved without losing changes
 * still on their way.
 */
type Entry =
  | { kind: "patch"; patch: HealthAutoLogMapping; done: (ok: boolean) => void }
  | { kind: "name"; started: boolean; done: (ok: boolean) => void };

export type HealthMappingWriterDeps = {
  /** Reads the saved mappings (the source of truth). */
  readSaved: () => Promise<HealthAutoLogMappings>;
  /** Writes one type's whole mapping and returns every saved mapping. */
  write: (type: HealthImportPreferenceKey, mapping: HealthAutoLogMapping) => Promise<HealthAutoLogMappings>;
  /** Shows these mappings (saved, with queued changes laid over them). */
  show: (mappings: HealthAutoLogMappings) => void;
  /** Runs once a type's queue is empty again after at least one write landed. */
  settled?: (saved: HealthAutoLogMappings) => Promise<void> | void;
  /** A write failed (the screen already shows the saved mapping again). */
  failed?: (error: unknown) => void;
};

function merge(base: HealthAutoLogMapping | undefined, patch: HealthAutoLogMapping): HealthAutoLogMapping {
  return { ...(base ?? {}), ...patch };
}

function withMapping(mappings: HealthAutoLogMappings, type: HealthImportPreferenceKey, mapping: HealthAutoLogMapping) {
  const next = { ...mappings };
  if (mapping.categoryId || mapping.description) next[type] = mapping;
  else delete next[type];
  return next;
}

function nameOf(mapping: HealthAutoLogMapping | undefined) {
  return (mapping?.description ?? "").trim();
}

export function createHealthMappingWriter(deps: HealthMappingWriterDeps) {
  const queues = new Map<HealthImportPreferenceKey, Entry[]>();
  const tails = new Map<HealthImportPreferenceKey, Promise<void>>();
  const names = new Map<HealthImportPreferenceKey, string>();
  const restorers = new Map<HealthImportPreferenceKey, (savedName: string, failedName: string) => void>();
  const wrote = new Set<HealthImportPreferenceKey>();
  let shownSeq = 0;

  function queued(type: HealthImportPreferenceKey) {
    let entries = queues.get(type);
    if (!entries) {
      entries = [];
      queues.set(type, entries);
    }
    return entries;
  }

  /** Saved mappings with every queued change laid over them, in order. */
  function overlay(saved: HealthAutoLogMappings) {
    let shown = saved;
    for (const [type, entries] of queues) {
      for (const entry of entries) {
        const patch = entry.kind === "patch" ? entry.patch : { description: (names.get(type) ?? "").trim() || null };
        shown = withMapping(shown, type, merge(shown[type], patch));
      }
    }
    return shown;
  }

  async function refresh(saved?: HealthAutoLogMappings) {
    const seq = ++shownSeq;
    const base = saved ?? await deps.readSaved().catch(() => null);
    // Only the newest refresh shows, so an older read can't land over a newer one.
    if (base && seq === shownSeq) deps.show(overlay(base));
  }

  async function run(type: HealthImportPreferenceKey, entry: Entry) {
    let ok = false;
    let failedName: string | null = null;
    let saved: HealthAutoLogMappings | null = null;
    try {
      const current = await deps.readSaved();
      if (entry.kind === "patch") {
        saved = await deps.write(type, merge(current[type], entry.patch));
      } else {
        entry.started = true;
        const name = (names.get(type) ?? "").trim();
        if (name === nameOf(current[type])) {
          saved = current;
        } else {
          failedName = name;
          saved = await deps.write(type, merge(current[type], { description: name || null }));
          failedName = null;
          wrote.add(type);
        }
      }
      if (entry.kind === "patch") wrote.add(type);
      ok = true;
    } catch (error) {
      deps.failed?.(error);
    }
    const entries = queued(type);
    entries.splice(entries.indexOf(entry), 1);
    if (failedName !== null) {
      // Put the saved Name back where the newest sheet shows it, unless something newer was typed.
      const savedName = nameOf((await deps.readSaved().catch(() => ({} as HealthAutoLogMappings)))[type]);
      if ((names.get(type) ?? "").trim() === failedName) names.set(type, savedName);
      restorers.get(type)?.(savedName, failedName);
    }
    await refresh(saved ?? undefined);
    entry.done(ok);
    if (entries.length === 0 && wrote.has(type)) {
      wrote.delete(type);
      try {
        await deps.settled?.(saved ?? await deps.readSaved());
      } catch {
        // Settling (reprocessing, reload) is best effort; the mapping itself is saved.
      }
    }
  }

  function enqueue(type: HealthImportPreferenceKey, entry: Entry) {
    queued(type).push(entry);
    const tail = (tails.get(type) ?? Promise.resolve()).then(() => run(type, entry));
    tails.set(type, tail);
    void tail.finally(() => {
      if (tails.get(type) === tail) tails.delete(type);
    });
  }

  return {
    /** Changes Logs as / Use default; true once the change is saved. */
    patch(type: HealthImportPreferenceKey, patch: HealthAutoLogMapping): Promise<boolean> {
      return new Promise<boolean>((done) => {
        enqueue(type, { kind: "patch", patch, done });
        void refresh();
      });
    },
    /**
     * Commits a type's Name (the newest commit wins). `restore` is told the saved Name when this
     * Name could not be saved, so the sheet that shows it can put it back.
     */
    commitName(
      type: HealthImportPreferenceKey,
      name: string,
      restore?: (savedName: string, failedName: string) => void
    ): Promise<boolean> {
      names.set(type, name);
      if (restore) restorers.set(type, restore);
      const waiting = queued(type).find((entry) => entry.kind === "name" && !entry.started);
      if (waiting) {
        // A Name is already waiting its turn; it reads the newest Name when it runs.
        return new Promise<boolean>((done) => {
          const previous = waiting.done;
          waiting.done = (ok) => {
            previous(ok);
            done(ok);
          };
        });
      }
      return new Promise<boolean>((done) => {
        enqueue(type, { kind: "name", started: false, done });
      });
    },
    /** Stops telling a closed sheet about failed Names. */
    release(type: HealthImportPreferenceKey, restore: (savedName: string, failedName: string) => void) {
      if (restorers.get(type) === restore) restorers.delete(type);
    },
    /** Waits for every queued write of a type (tests). */
    idle(type: HealthImportPreferenceKey) {
      return tails.get(type) ?? Promise.resolve();
    }
  };
}

export type HealthMappingWriter = ReturnType<typeof createHealthMappingWriter>;
