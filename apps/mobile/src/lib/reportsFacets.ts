import {
  normalizeTagName,
  REPORT_SOURCE_LABELS,
  type ReportFacetFilters,
  type ReportSource,
  type ReportSummaryRequest,
} from "@dayframe/shared";
import type { MobileTag, MobileTimeEntry } from "./api";

export type ReportFacetOption = { id: string; label: string };
export type ReportFacetOptions = {
  tags: ReportFacetOption[];
  places: ReportFacetOption[];
};

export function reportRequestWithFacets(request: ReportSummaryRequest, facets: ReportFacetFilters): ReportSummaryRequest {
  const { tags, places, sources, description } = facets;
  const trimmed = description?.trim();
  if (!tags?.length && !places?.length && !sources?.length && !trimmed) return request;
  return {
    ...request,
    filters: {
      ...(tags?.length ? { tags: [...tags].sort() } : {}),
      ...(places?.length ? { places: [...places].sort() } : {}),
      ...(sources?.length ? { sources: [...sources].sort() } : {}),
      ...(trimmed ? { description: trimmed } : {}),
    },
  };
}

export function reportEntryMatchesFacets(
  entry: MobileTimeEntry,
  { tags, places, sources, description }: ReportFacetFilters,
  tagCatalog: readonly MobileTag[],
) {
  if (sources?.length && !sources.includes(entry.source as ReportSource)) return false;
  if (places?.length) {
    const place = entry.placeId ?? (entry.placeName == null ? "no-place" : null);
    if (place === null || !places.includes(place)) return false;
  }
  if (description && !(entry.description ?? "").toLowerCase().includes(description.toLowerCase())) return false;
  if (!tags?.length) return true;
  if (!entry.tagNames) return entry.tags?.some((tag) => tags.includes(tag.id)) ?? false;
  const selectedNames = new Set([...tagCatalog, ...(entry.tags ?? [])]
    .filter((tag) => tags.includes(tag.id)).map((tag) => tag.normalizedName));
  // The optimistic timer and editor can own tag names before the server can resolve their IDs.
  return entry.tagNames.some((name) => {
    try {
      return selectedNames.has(normalizeTagName(name).normalizedName);
    } catch {
      return false;
    }
  });
}

export function reportFacetChips(facets: ReportFacetFilters, options: ReportFacetOptions) {
  const chips = (["tags", "places", "sources"] as const).flatMap((kind) =>
    (facets[kind] ?? []).map((value) => ({
      kind,
      value,
      label: kind === "sources"
        ? REPORT_SOURCE_LABELS[value as ReportSource]
        : options[kind].find((option) => option.id === value)?.label ?? (kind === "tags" ? "Unavailable tag" : "Unavailable place"),
    })),
  );
  const description = facets.description?.trim();
  return [
    ...chips,
    ...(description ? [{ kind: "description" as const, value: description, label: `“${description}”` }] : []),
  ];
}
