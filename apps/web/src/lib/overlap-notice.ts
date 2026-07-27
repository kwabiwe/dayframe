import { analyzeTimeIntervals, type TimeIntervalInput } from "@dayframe/shared";

export type OverlapPeerEntry = {
  id: string;
  startedAt: string;
  stoppedAt: string | null;
  description?: string | null;
  categoryName?: string | null;
};

export function overlapNoticeForCandidate({
  candidate,
  entries,
  excludeEntryId,
  now = new Date()
}: {
  candidate: Omit<TimeIntervalInput, "id">;
  entries: ReadonlyArray<OverlapPeerEntry>;
  excludeEntryId?: string | null;
  now?: Date;
}) {
  const candidateId = "__dayframe_overlap_candidate__";
  const analysis = analyzeTimeIntervals(
    [
      ...entries
        .filter((entry) => entry.id !== excludeEntryId)
        .map((entry) => ({ id: entry.id, startedAt: entry.startedAt, stoppedAt: entry.stoppedAt })),
      { id: candidateId, ...candidate }
    ],
    { now }
  );
  return analysis.entries.find((entry) => entry.id === candidateId) ?? null;
}
