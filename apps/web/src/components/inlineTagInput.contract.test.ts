import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./InlineTagInput.tsx", import.meta.url)),
  "utf8"
);
const iconSource = readFileSync(fileURLToPath(new URL("./TagIcon.tsx", import.meta.url)), "utf8");
const editDialogSource = readFileSync(fileURLToPath(new URL("./EditTimeEntryDialog.tsx", import.meta.url)), "utf8");
const timerSource = readFileSync(fileURLToPath(new URL("./PersistentTimerBar.tsx", import.meta.url)), "utf8");
const styles = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

describe("web tag editor interaction contract", () => {
  it("uses the shared solid rounded tag silhouette", () => {
    expect(source).toContain("<TagIcon size={15} />");
    expect(iconSource).toContain('fill="currentColor"');
    expect(iconSource).toContain('fillRule="evenodd"');
  });

  it("opens an icon-triggered search/select/create picker with mobile-safe semantics", () => {
    expect(source).toContain('aria-label="Add or filter tags"');
    expect(source).toContain('placeholder="Add/filter tags"');
    expect(source).toContain("pickerMatches.map");
    expect(source).toContain("pickerCreateName");
    expect(source).toContain("aria-pressed={selected}");
  });

  it("keeps manual hashtag entry but consumes the command into separate selected-tag state", () => {
    expect(source).toContain("findActiveHashtag");
    expect(source).toContain("consumeActiveHashtag");
    expect(source).toContain("onSelectedTagNamesChange");
    expect(source).not.toContain("replaceActiveHashtag");
    expect(source).not.toContain("tagNamesFromDescription");
    expect(source).not.toContain("Type # to add a tag");
  });

  it("makes every selected tag directly removable", () => {
    expect(source).toContain("selectedTagNames.map");
    expect(source).toContain("Remove tag ${tagName}");
    expect(source).toContain("onClick={() => toggleSelectedTag(tagName)}");
    expect(source).toContain('className="inline-selected-tag"');
    expect(source).toContain('#{tagName}');
    expect(source).toContain("selectVisibleTags(selectedTagNames");
    expect(source).toContain('className="inline-selected-tag-overflow"');
    expect(source).toContain('<X aria-hidden="true" size={12} strokeWidth={1.6} />');
    expect(editDialogSource).toContain("<InlineTagInput");
    expect(timerSource).toContain("<InlineTagInput");
    expect(styles).toMatch(/\.inline-selected-tag,\s*\.inline-selected-tag-overflow\s*\{[^}]*border-radius:\s*6px;[^}]*background:\s*transparent;/s);
    expect(styles).toMatch(/\.inline-selected-tag:hover,\s*\.inline-selected-tag:focus-visible\s*\{[^}]*background:\s*var\(--accent-soft\);[^}]*color:\s*var\(--accent-text\);/s);
  });
});
