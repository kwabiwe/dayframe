import type { LocationReviewEvidenceDto } from "@dayframe/shared";

export type LocationEvidenceMapMode =
  | "observed_route"
  | "endpoint_estimate"
  | "detected_area"
  | "mapped_evidence"
  | "no_mapped_evidence";

export function locationEvidenceMapMode(evidence: LocationReviewEvidenceDto): LocationEvidenceMapMode {
  if (evidence.map.route?.coordinates.length) return "observed_route";
  if (evidence.map.straightLineFallback?.coordinates.length) return "endpoint_estimate";
  if (evidence.map.centre) return "detected_area";
  if (
    evidence.map.acceptedSamples.length ||
    evidence.map.rejectedSamples.some((sample) => sample.point) ||
    evidence.map.anchors.some((anchor) => anchor.point) ||
    evidence.map.nearbySavedPlaces.length
  ) return "mapped_evidence";
  return "no_mapped_evidence";
}

export function locationEvidenceModeLabel(mode: LocationEvidenceMapMode) {
  if (mode === "observed_route") return "Observed route";
  if (mode === "endpoint_estimate") return "Endpoint estimate";
  if (mode === "detected_area") return "Detected area";
  if (mode === "mapped_evidence") return "Mapped evidence";
  return "No mapped evidence";
}

export function locationEvidenceCaption(
  evidence: LocationReviewEvidenceDto,
  mode = locationEvidenceMapMode(evidence)
) {
  const samples = evidence.map.acceptedSamples.length;
  const anchors = evidence.map.anchors.filter((anchor) => anchor.point).length;
  if (mode === "observed_route") {
    return `${count(samples, "mapped sample")} and ${count(anchors, "arrival or departure anchor")} support the recorded route.`;
  }
  if (mode === "endpoint_estimate") {
    return "Only the journey endpoints are available. The dashed line is an estimate, not a recorded route.";
  }
  if (mode === "detected_area") {
    return `${count(samples, "mapped sample")} support the detected centre and uncertainty area.`;
  }
  if (mode === "mapped_evidence") {
    return `${count(samples, "mapped sample")} and ${count(anchors, "arrival or departure anchor")} are available for inspection.`;
  }
  if (evidence.evidenceExpired) {
    return "Raw location evidence has expired. The derived time window remains available to resolve.";
  }
  if (evidence.rawEvidenceAvailable) {
    return "Retained evidence is attached to this item, but it has no coordinates to plot.";
  }
  return "No coordinate samples or anchors are attached to this item.";
}

export function locationEvidenceRetentionLabel(evidence: LocationReviewEvidenceDto) {
  if (evidence.evidenceExpired) {
    return "Raw evidence expired; the derived time window remains available.";
  }
  if (evidence.rawEvidenceAvailable && evidence.evidenceExpiresAt) {
    return `Raw evidence is retained until ${formatDateTime(evidence.evidenceExpiresAt)}.`;
  }
  if (evidence.rawEvidenceAvailable) return "Raw evidence is temporarily retained.";
  return "No raw evidence is attached to this item.";
}

export function hasLocationMapGeometry(evidence: LocationReviewEvidenceDto) {
  return locationEvidenceMapMode(evidence) !== "no_mapped_evidence";
}

function count(value: number, label: string) {
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
