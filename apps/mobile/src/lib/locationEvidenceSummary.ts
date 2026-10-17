import type { LocationReviewEvidenceDto } from "@dayframe/shared";

// Location evidence's one-line account of what a suggestion rests on, under the map, and the details
// it opens to (owner, 17 Oct 2026): "Based on 42 readings · 25-min gap".

/** Gaps shorter than this are ordinary pauses between readings, not worth naming. */
const NOTABLE_GAP_SECONDS = 5 * 60;

export function locationEvidenceLine(evidence: Pick<LocationReviewEvidenceDto, "map" | "evidenceExpired" | "rawEvidenceAvailable">) {
  if (evidence.evidenceExpired || !evidence.rawEvidenceAvailable) return "Its readings are no longer kept";
  const readings = evidence.map.acceptedSamples.length;
  if (readings === 0) return null;
  const longestGap = evidence.map.gaps.reduce((longest, gap) => Math.max(longest, gap.durationSeconds), 0);
  const gap = longestGap >= NOTABLE_GAP_SECONDS ? ` · ${Math.round(longestGap / 60)}-min gap` : "";
  return `Based on ${readings} ${readings === 1 ? "reading" : "readings"}${gap}`;
}

/** What the line opens to: each notable gap, readings left out, and the server's own summary. */
export function locationEvidenceDetails(
  evidence: Pick<LocationReviewEvidenceDto, "map" | "textualSummary">,
  formatTime: (iso: string) => string
) {
  const lines = evidence.map.gaps
    .filter((gap) => gap.durationSeconds >= NOTABLE_GAP_SECONDS)
    .map((gap) => `No readings ${formatTime(gap.startedAt)}–${formatTime(gap.stoppedAt)} (${Math.round(gap.durationSeconds / 60)} min)`);
  const leftOut = evidence.map.rejectedSamples.length;
  if (leftOut > 0) lines.push(`${leftOut} ${leftOut === 1 ? "reading was" : "readings were"} left out as too imprecise`);
  if (evidence.textualSummary.trim()) lines.push(evidence.textualSummary.trim());
  return lines;
}

/** A name Dayframe learned for this kind of visit or trip (the card's title then), to offer in Name. */
export function learnedLocationName(item: { title?: string | null; rawPayload?: Record<string, unknown> | null } | null | undefined) {
  if (item?.rawPayload?.nameSource !== "learned") return null;
  const name = item.title?.trim();
  return name ? name : null;
}
