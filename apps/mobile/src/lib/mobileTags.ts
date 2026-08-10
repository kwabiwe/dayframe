import type { MobileBootstrap, MobileTag } from "./api";

export function mergePersistedMobileTag(
  data: MobileBootstrap | null,
  tag: MobileTag
): MobileBootstrap | null {
  if (!data) return data;
  const tags = (data.tags ?? [])
    .filter((candidate) => candidate.normalizedName !== tag.normalizedName);
  tags.push(tag);
  tags.sort((left, right) => left.name.localeCompare(right.name));
  return { ...data, tags };
}
