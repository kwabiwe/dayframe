/**
 * Named patterns on Today (location v3 PR 14, PRD D19 A9). The server tags each block of a named
 * A → B → A with one `locationGroup`; a Today list shows it as one row only while all of its parts
 * sit next to each other in its order, finished and within three hours, so an edit that moved a
 * part away, a deleted part or a block logged in between leaves the parts as their own rows.
 */
/** `parts`: how many blocks the pattern has; a row forms only while all of them sit together. */
export type NamedPatternTag = { key: string; name: string; parts?: number };

export type NamedPatternItem = {
  id: string;
  startedAt: string;
  stoppedAt: string | null;
  locationGroup?: NamedPatternTag | null;
};

export const NAMED_PATTERN_SPAN_MS = 3 * 60 * 60 * 1000;

/** Each grouped block's row key (`named:<server key>`) and name, by block id. */
export function namedPatternRuns(items: readonly NamedPatternItem[]) {
  const runs = new Map<string, { key: string; name: string }>();
  let index = 0;
  while (index < items.length) {
    const group = items[index].locationGroup;
    let end = index;
    while (group && end + 1 < items.length && items[end + 1].locationGroup?.key === group.key) end += 1;
    const run = items.slice(index, end + 1);
    index = end + 1;
    if (!group || run.length < 2 || (group.parts !== undefined && run.length !== group.parts)) continue;
    if (run.some((item) => !item.stoppedAt)) continue;
    const starts = run.map((item) => Date.parse(item.startedAt));
    const stops = run.map((item) => Date.parse(item.stoppedAt!));
    if (starts.some(Number.isNaN) || stops.some(Number.isNaN)) continue;
    if (Math.max(...stops) - Math.min(...starts) > NAMED_PATTERN_SPAN_MS) continue;
    for (const item of run) runs.set(item.id, { key: `named:${group.key}`, name: group.name });
  }
  return runs;
}
