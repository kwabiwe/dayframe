/** The canonical Reports facets for an already workspace- and user-scoped time_entries alias te. */
export function reportEntryFacetPredicates(
  { tags = [], places = [], sources = [], description = "" }: {
    tags?: readonly string[];
    places?: readonly string[];
    sources?: readonly string[];
    description?: string;
  },
  param: (value: unknown) => string,
) {
  const where: string[] = [];
  if (tags.length > 0) {
    const tagIds = param(tags);
    where.push(`exists (
      select 1
      from time_entry_tags filter_tet
      join tags filter_tag
        on filter_tag.workspace_id = filter_tet.workspace_id and filter_tag.id = filter_tet.tag_id
      where filter_tet.workspace_id = te.workspace_id
        and filter_tet.time_entry_id = te.id
        and filter_tag.id = any(${tagIds}::uuid[])
    )`);
  }

  const selectedPlaceIds = places.filter((id) => id !== "no-place");
  const includesNoPlace = places.includes("no-place");
  if (selectedPlaceIds.length > 0 || includesNoPlace) {
    const parts: string[] = [];
    if (selectedPlaceIds.length > 0) parts.push(`te.place_id = any(${param(selectedPlaceIds)}::uuid[])`);
    if (includesNoPlace) parts.push(`te.place_id is null and te.place_label is null`);
    where.push(`(${parts.join(" or ")})`);
  }

  if (sources.length > 0) {
    where.push(`te.source = any(${param(sources)}::text[])`);
  }

  if (description) {
    where.push(`position(lower(${param(description)}) in lower(coalesce(te.description, ''))) > 0`);
  }
  return where;
}
