import type { LocationReviewEvidenceDto } from "@dayframe/shared";

/**
 * The visit a nearby list is ranked for: its centre, and its times (which set the dwell the ranker weighs). A
 * change ranks it again, and a guess made for another key is never used (Codex r1 on #620).
 */
export function nearbyProposalKey(centre: { latitude: number; longitude: number } | null,
  evidence: Pick<LocationReviewEvidenceDto, "segment"> | null) {
  return [centre?.latitude ?? "", centre?.longitude ?? "", evidence?.segment.startedAt ?? "", evidence?.segment.stoppedAt ?? ""].join("|");
}
