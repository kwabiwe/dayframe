import { TagIcon } from "@/components/TagIcon";
import { selectVisibleTags } from "@/lib/tag-display";

export function TagMetadata({
  tagNames,
  active = false,
  compact = false
}: {
  tagNames: string[];
  active?: boolean;
  compact?: boolean;
}) {
  if (tagNames.length === 0) return null;
  const label = tagNames.join(" · ");
  const summary = selectVisibleTags(tagNames);
  return (
    <span className={`tag-metadata${active ? " is-active" : ""}${compact ? " is-compact" : ""}`} aria-label={`Tags: ${label}`}>
      {!compact ? <TagIcon size={13} /> : null}
      <span>
        {compact ? summary.visible.map((name) => `#${name}`).join(" ") : label}
        {compact && summary.hiddenCount ? ` +${summary.hiddenCount}` : ""}
      </span>
    </span>
  );
}
