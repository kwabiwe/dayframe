/**
 * In-process notes of optimistic block IDs that durable work was just written for (an activity event,
 * an Edit/Delete or a Stop), so correlation pruning can never leave such work without its mapping
 * (Codex r1 on #552). Each admission notes its ID before its own write. Pruning skips IDs noted in the
 * last day and restores, under the correlation lock, any record it removed that is noted afterwards.
 * No dependencies, so every store can import it.
 */
const NOTE_RETENTION_MS = 24 * 60 * 60 * 1_000;
const notedAt = new Map<string, number>();
let listener: ((localId: string) => void) | null = null;

export function noteTimerEntryIdReference(localId: string | undefined | null) {
  if (!localId) return;
  notedAt.set(localId, Date.now());
  listener?.(localId);
}

export function wasTimerEntryIdNotedRecently(localId: string, nowMs = Date.now()) {
  const at = notedAt.get(localId);
  return at !== undefined && nowMs - at <= NOTE_RETENTION_MS;
}

export function forgetStaleTimerEntryIdNotes(nowMs = Date.now()) {
  for (const [localId, at] of notedAt) {
    if (nowMs - at > NOTE_RETENTION_MS) notedAt.delete(localId);
  }
}

/** One listener: the correlation store's restore of a just-pruned record. */
export function setTimerEntryIdNoteListener(next: ((localId: string) => void) | null) {
  listener = next;
}

export function __resetTimerEntryIdNotesForTests() {
  notedAt.clear();
}
