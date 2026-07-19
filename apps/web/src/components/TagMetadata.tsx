import { Tag } from "lucide-react";

export function TagMetadata({ tagNames, active = false }: { tagNames: string[]; active?: boolean }) {
  if (tagNames.length === 0) return null;
  const label = tagNames.join(" · ");
  return (
    <span className={`tag-metadata${active ? " is-active" : ""}`} aria-label={`Tags: ${label}`}>
      <Tag aria-hidden="true" size={13} strokeWidth={1.7} />
      <span>{label}</span>
    </span>
  );
}
