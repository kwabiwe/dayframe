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
} & (
  | { kind: "patch"; patch: HealthAutoLogMapping }
  // `name` is this commit's Name, updated while it waits by newer commits it absorbs.
  | { kind: "name"; started: boolean; name: string }
);

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
  /**
   * Runs once a type's queue is empty again after a write landed (reprocessing). `isCurrent`
   * says whether the account that made the change is still signed in; check it before each request.
   */
  settle?: (
    saved: HealthAutoLogMappings,
    isCurrent: () => Promise<boolean>,
    origin: A
  ) => Promise<void> | void;
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
  // The last saved mappings read or written: what is shown is laid over it at once, so a change
  // shows the moment it is made (a reopened sheet always starts from it).
  let cache: HealthAutoLogMappings | null = null;
  let readSeq = 0;

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
        const patch = entry.kind === "patch" ? entry.patch : { description: entry.name.trim() || null };
        shown = withMapping(shown, type, merge(shown[type], patch));
      }
    }
    return shown;
  }

  /** Shows the cached saved mappings with queued changes laid over them, synchronously. */
  function publish() {
    if (!cache) return;
    const shown = overlay(cache);
    for (const listener of listeners) listener.show(shown);
  }

  /** Re-reads the saved mappings, then publishes (an older read never lands over a newer one). */
  async function refresh() {
    const seq = ++readSeq;
    const saved = await deps.readSaved().catch(() => null);
    if (saved && seq === readSeq) cache = saved;
    publish();
  }

  function remember(saved: HealthAutoLogMappings) {
    readSeq += 1;
    cache = saved;
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
    let landed = false;
    if (entry.kind === "name") entry.started = true;
    // A change from an account that is no longer signed in is dropped: no write, alert or restore.
    // The account is checked before the read, before the write and after it.
    if (await current(entry)) {
      let attempted: string | null = null;
      try {
        const saving = await deps.readSaved();
        remember(saving);
        if (entry.kind === "name") attempted = entry.name.trim();
        if (await current(entry)) {
          if (entry.kind === "patch") {
            remember(await deps.write(type, merge(saving[type], entry.patch)));
            landed = true;
          } else if (attempted !== nameOf(saving[type])) {
            remember(await deps.write(type, merge(saving[type], { description: attempted || null })));
            landed = true;
          }
          ok = true;
        }
      } catch (error) {
        if (await current(entry)) {
          for (const listener of listeners) listener.failed?.(error);
          // A Name that could not be read or written: the sheet gets the saved Name back.
          // Only this commit's Name failed; a later queued Name is left to run.
          if (entry.kind === "name") failedName = attempted ?? entry.name.trim();
        }
      }
      if (landed && await current(entry)) wrote.add(type);
    }
    const entries = queued(type);
    entries.splice(entries.indexOf(entry), 1);
    if (failedName !== null) {
      // Put the saved Name back where the open sheet shows it, unless something newer was typed.
      const savedName = nameOf(cache?.[type]);
      if ((names.get(type) ?? "").trim() === failedName) names.set(type, savedName);
      restorers.get(type)?.(savedName, failedName);
    }
    publish();
    entry.done(ok);
    if (entries.length === 0 && wrote.has(type)) {
      wrote.delete(type);
      const isCurrent = () => current(entry);
      // Reprocessing runs only for the account that made the change, checked before each request.
      const origin = await entry.authority.catch(() => null);
      if (origin !== null && await isCurrent()) {
        try {
          await deps.settle?.(cache ?? await deps.readSaved(), isCurrent, origin);
        } catch {
          // Settling (reprocessing) is best effort; the mapping itself is saved.
        }
        if (await isCurrent()) for (const listener of listeners) listener.settled?.();
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
      if (cache) listener.show(overlay(cache));
      void refresh();
      return () => {
        listeners.delete(listener);
      };
    },
    /** Shows the saved mappings, with queued changes laid over them, again. */
    refresh: () => refresh(),
    /** What a screen shows now (saved with queued changes), or null before the first read. */
    shown: () => (cache ? overlay(cache) : null),
    /** Changes Logs as / Use default; true once the change is saved. */
    patch(type: HealthImportPreferenceKey, patch: HealthAutoLogMapping): Promise<boolean> {
      return new Promise<boolean>((done) => {
        enqueue(type, { kind: "patch", patch, done, stale: false, authority: deps.capture() });
        publish();
      });
    },
    /** Commits a type's Name (the newest commit wins); true once it is saved. */
    commitName(type: HealthImportPreferenceKey, name: string): Promise<boolean> {
      names.set(type, name);
      const waiting = queued(type).find((entry) => entry.kind === "name" && !entry.started && !entry.stale);
      const committed = waiting
        // A Name is already waiting its turn; it reads the newest Name when it runs.
        ? new Promise<boolean>((done) => {
            if (waiting.kind === "name") waiting.name = name;
            const previous = waiting.done;
            waiting.done = (ok) => {
              previous(ok);
              done(ok);
            };
          })
        : new Promise<boolean>((done) => {
            enqueue(type, { kind: "name", started: false, name, done, stale: false, authority: deps.capture() });
          });
      publish();
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
