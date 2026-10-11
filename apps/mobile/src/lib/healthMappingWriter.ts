import type { HealthAutoLogMapping, HealthAutoLogMappings, HealthImportPreferenceKey } from "@dayframe/shared";

/**
 * The one owner of Apple Health mapping writes (UIA-085), for the whole app process rather than
 * one Settings screen, so a write queued before Settings closed stays ordered with writes made
 * after it opens again. Every change to a Health type's mapping — Logs as, Use default and the
 * type sheet's Name — goes through one serial queue per type, in the order it was made, and each
 * write merges into the saved mapping as it is when the write runs, so a queued write can never
 * undo a later or earlier one. The Name is resolved when its turn comes: the newest committed Name
 * for the type is compared against the saved Name at that moment, so it is written only when it
 * differs, whichever sheet (open or already dismissed) committed it.
 *
 * Each change is pinned to the account it was made in: it is written, and its reprocessing runs,
 * only while that account is still the signed-in one. An account change drops every
 * change still waiting, so nothing queued by one account acts under another.
 *
 * What a screen shows is the saved mappings with every still-queued change laid over them; a
 * failed write drops out of that, so the screen falls back to what is saved without losing changes
 * still on their way. The newest open sheet for a type is told the saved Name when its Name fails.
 */
type Entry<A> = {
  authority: Promise<A | null>;
  done: (ok: boolean) => void;
  stale: boolean;
} & ({ kind: "patch"; patch: HealthAutoLogMapping } | { kind: "name"; started: boolean });

export type HealthMappingWriterDeps<A> = {
  /** Reads the saved mappings (the source of truth). */
  readSaved: () => Promise<HealthAutoLogMappings>;
  /** Writes one type's whole mapping and returns every saved mapping. */
  write: (type: HealthImportPreferenceKey, mapping: HealthAutoLogMapping) => Promise<HealthAutoLogMappings>;
  /** The account a change is made in (null when signed out). */
  capture: () => Promise<A | null>;
  /** Whether that account is still the signed-in one. */
  stillCurrent: (authority: A) => Promise<boolean>;
  /** Calls back on every account change. */
  onAccountChange: (listener: () => void) => () => void;
  /** Runs once a type's queue is empty again after a write landed (reprocessing). */
  settle?: (saved: HealthAutoLogMappings) => Promise<void> | void;
};

export type HealthMappingListener = {
  /** Shows these mappings (saved, with queued changes laid over them). */
  show: (mappings: HealthAutoLogMappings) => void;
  /** A write failed (what is shown is already the saved mapping again). */
  failed?: (error: unknown) => void;
  /** A type's writes landed and reprocessing finished (reload what depends on them). */
  settled?: () => void;
};

type Restorer = (savedName: string, failedName: string) => void;

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

export function createHealthMappingWriter<A>(deps: HealthMappingWriterDeps<A>) {
  const queues = new Map<HealthImportPreferenceKey, Entry<A>[]>();
  const tails = new Map<HealthImportPreferenceKey, Promise<void>>();
  const names = new Map<HealthImportPreferenceKey, string>();
  const restorers = new Map<HealthImportPreferenceKey, Restorer>();
  const wrote = new Set<HealthImportPreferenceKey>();
  const listeners = new Set<HealthMappingListener>();
  let shownSeq = 0;

  // Nothing queued by one account acts under another: waiting changes are dropped on a switch.
  deps.onAccountChange(() => {
    for (const entries of queues.values()) for (const entry of entries) entry.stale = true;
    names.clear();
    restorers.clear();
    wrote.clear();
  });

  function queued(type: HealthImportPreferenceKey) {
    let entries = queues.get(type);
    if (!entries) {
      entries = [];
      queues.set(type, entries);
    }
    return entries;
  }

  /** Saved mappings with every live queued change laid over them, in order. */
  function overlay(saved: HealthAutoLogMappings) {
    let shown = saved;
    for (const [type, entries] of queues) {
      for (const entry of entries) {
        if (entry.stale) continue;
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
    if (!base || seq !== shownSeq) return;
    const shown = overlay(base);
    for (const listener of listeners) listener.show(shown);
  }

  async function current(entry: Entry<A>) {
    if (entry.stale) return false;
    const authority = await entry.authority.catch(() => null);
    if (authority === null || entry.stale) return false;
    return deps.stillCurrent(authority).catch(() => false);
  }

  async function run(type: HealthImportPreferenceKey, entry: Entry<A>) {
    let ok = false;
    let failedName: string | null = null;
    let saved: HealthAutoLogMappings | null = null;
    if (entry.kind === "name") entry.started = true;
    // A change from a session that is no longer current is dropped without a write or an alert.
    const live = await current(entry);
    if (live) {
      try {
        const saving = await deps.readSaved();
        if (entry.kind === "patch") {
          saved = await deps.write(type, merge(saving[type], entry.patch));
          wrote.add(type);
        } else {
          const name = (names.get(type) ?? "").trim();
          if (name === nameOf(saving[type])) {
            saved = saving;
          } else {
            failedName = name;
            saved = await deps.write(type, merge(saving[type], { description: name || null }));
            failedName = null;
            wrote.add(type);
          }
        }
        ok = true;
      } catch (error) {
        for (const listener of listeners) listener.failed?.(error);
      }
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
      // Reprocessing runs under the session that made the change, and only while it is current.
      if (await current(entry)) {
        try {
          await deps.settle?.(saved ?? await deps.readSaved());
        } catch {
          // Settling (reprocessing) is best effort; the mapping itself is saved.
        }
        for (const listener of listeners) listener.settled?.();
      }
    }
  }

  function enqueue(type: HealthImportPreferenceKey, entry: Entry<A>) {
    queued(type).push(entry);
    const tail = (tails.get(type) ?? Promise.resolve()).then(() => run(type, entry));
    tails.set(type, tail);
    void tail.finally(() => {
      if (tails.get(type) === tail) tails.delete(type);
    });
  }

  return {
    /** Shows the mappings to a screen while it is open; returns its unsubscribe. */
    subscribe(listener: HealthMappingListener) {
      listeners.add(listener);
      void refresh();
      return () => {
        listeners.delete(listener);
      };
    },
    /** Shows the saved mappings, with queued changes laid over them, again. */
    refresh: () => refresh(),
    /** Changes Logs as / Use default; true once the change is saved. */
    patch(type: HealthImportPreferenceKey, patch: HealthAutoLogMapping): Promise<boolean> {
      return new Promise<boolean>((done) => {
        enqueue(type, { kind: "patch", patch, done, stale: false, authority: deps.capture() });
        void refresh();
      });
    },
    /** Commits a type's Name (the newest commit wins); true once it is saved. */
    commitName(type: HealthImportPreferenceKey, name: string): Promise<boolean> {
      names.set(type, name);
      const waiting = queued(type).find((entry) => entry.kind === "name" && !entry.started && !entry.stale);
      const committed = waiting
        // A Name is already waiting its turn; it reads the newest Name when it runs.
        ? new Promise<boolean>((done) => {
            const previous = waiting.done;
            waiting.done = (ok) => {
              previous(ok);
              done(ok);
            };
          })
        : new Promise<boolean>((done) => {
            enqueue(type, { kind: "name", started: false, done, stale: false, authority: deps.capture() });
          });
      void refresh();
      return committed;
    },
    /**
     * The open sheet for a type, told the saved Name when a Name fails so it can put it back
     * (from the moment it opens, not only after its own first commit). Returns its release.
     */
    attach(type: HealthImportPreferenceKey, restore: Restorer) {
      restorers.set(type, restore);
      return () => {
        if (restorers.get(type) === restore) restorers.delete(type);
      };
    },
    /** Waits for every queued write of a type (tests). */
    idle(type: HealthImportPreferenceKey) {
      return tails.get(type) ?? Promise.resolve();
    }
  };
}

export type HealthMappingWriter = ReturnType<typeof createHealthMappingWriter<unknown>>;
