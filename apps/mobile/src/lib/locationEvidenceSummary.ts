import type { LocationReviewEvidenceDto } from "@dayframe/shared";

// Location evidence's one-line account of what a suggestion rests on, under the map, and the details
// it opens to (owner, 17 Oct 2026): "Based on 42 readings · 25-min gap". The counts are the segment's
// own (every reading it rests on, not the map's thinned subset); the gaps are the ones the server
// reports (silences long enough to matter, Codex r1 on #481).

type EvidenceSummaryInput = Pick<LocationReviewEvidenceDto, "map" | "segment" | "evidenceExpired" | "rawEvidenceAvailable">;

export function locationEvidenceLine(evidence: EvidenceSummaryInput) {
  if (evidence.evidenceExpired) return "Its readings are no longer kept";
  if (!evidence.rawEvidenceAvailable) return "Its readings aren't available";
  const readings = evidence.segment.evidenceCount;
  if (readings <= 0) return null;
  const longestGap = evidence.map.gaps.reduce((longest, gap) => Math.max(longest, gap.durationSeconds), 0);
  const gap = longestGap >= 60 ? ` · ${Math.round(longestGap / 60)}-min gap` : "";
  return `Based on ${readings} ${readings === 1 ? "reading" : "readings"}${gap}`;
}

/** What the line opens to: each gap, readings left out, and the server's own summary. */
export function locationEvidenceDetails(
  evidence: Pick<LocationReviewEvidenceDto, "map" | "segment" | "textualSummary">,
  formatTime: (iso: string) => string
) {
  const lines = evidence.map.gaps.map((gap) =>
    `No readings ${formatTime(gap.startedAt)}–${formatTime(gap.stoppedAt)} (${Math.round(gap.durationSeconds / 60)} min)`);
  const leftOut = evidence.segment.rejectedEvidenceCount;
  if (leftOut > 0) lines.push(`${leftOut} ${leftOut === 1 ? "reading was" : "readings were"} left out`);
  if (evidence.textualSummary.trim()) lines.push(evidence.textualSummary.trim());
  return lines;
}

/** A name Dayframe learned for this kind of visit or trip (the card's title then), to offer in Name. */
export function learnedLocationName(item: { title?: string | null; rawPayload?: Record<string, unknown> | null } | null | undefined) {
  if (item?.rawPayload?.nameSource !== "learned") return null;
  const name = item.title?.trim();
  return name ? name : null;
}
