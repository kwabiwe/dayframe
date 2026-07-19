import { TagIcon } from "@/components/TagIcon";

export function TagMetadata({ tagNames, active = false }: { tagNames: string[]; active?: boolean }) {
  if (tagNames.length === 0) return null;
  const label = tagNames.join(" · ");
  return (
    <span className={`tag-metadata${active ? " is-active" : ""}`} aria-label={`Tags: ${label}`}>
      <TagIcon size={13} />
      <span>{label}</span>
    </span>
  );
}
