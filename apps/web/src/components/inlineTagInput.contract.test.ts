import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./InlineTagInput.tsx", import.meta.url)),
  "utf8"
);
const iconSource = readFileSync(fileURLToPath(new URL("./TagIcon.tsx", import.meta.url)), "utf8");
const quickEditorSource = readFileSync(fileURLToPath(new URL("./TimeEntryQuickEditor.tsx", import.meta.url)), "utf8");
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
    expect(source).toContain('className="inline-selected-tag-visual"');
    expect(source).toContain('#{tagName}');
    expect(source).toContain("selectVisibleTags(selectedTagNames");
    expect(source).toContain('className="inline-selected-tag-overflow"');
    expect(source).toContain('<X aria-hidden="true" size={12} strokeWidth={1.6} />');
    expect(quickEditorSource).toContain("<InlineTagInput");
    expect(timerSource).toContain("<InlineTagInput");
  });

  it("can portal both tag surfaces without losing containment or Escape focus return", () => {
    expect(source).toContain("maybePortal(");
    expect(source).toContain("suggestionsPanelRef");
    expect(source).toContain("pickerPanelRef");
    expect(source).toContain("time-entry-quick-editor-nested-surface");
    expect(source).toContain("pickerTriggerRef.current?.focus()");
  });

  it("separates the accessible hit target from the compact visible tag fill", () => {
    expect(styles).toMatch(/\.inline-tag-input-anchor \{[^}]*--inline-selected-tag-target-height:\s*44px;[^}]*--inline-selected-tag-visual-height:\s*24px;/s);
    expect(styles).toMatch(/\.inline-selected-tag,\s*\.inline-selected-tag-overflow\s*\{[^}]*height:\s*var\(--inline-selected-tag-target-height\);[^}]*background:\s*transparent;[^}]*font-weight:\s*400;/s);
    expect(styles).toMatch(/\.inline-selected-tag-visual,\s*\.inline-selected-tag-overflow-visual\s*\{[^}]*height:\s*var\(--inline-selected-tag-visual-height\);[^}]*border-radius:\s*6px;[^}]*background:\s*transparent;/s);
    expect(styles).toMatch(/\.inline-selected-tag:hover \.inline-selected-tag-visual\s*\{[^}]*background:\s*var\(--accent-soft\);[^}]*color:\s*var\(--accent-text\);/s);
    expect(styles).not.toMatch(/\.inline-selected-tag:focus-visible \.inline-selected-tag-visual\s*\{[^}]*var\(--accent/s);
    expect(styles).toMatch(/\.inline-selected-tag:focus-visible \.inline-selected-tag-visual,[\s\S]*box-shadow:\s*inset 0 0 0 2px var\(--focus\);/s);
    expect(styles).toMatch(/\.inline-selected-tag-overflow:hover \.inline-selected-tag-overflow-visual,[\s\S]*background:\s*var\(--surface-muted\);/s);
  });

  it("measures the same normal-weight label and thin X used by visible tags", () => {
    expect(source).toMatch(/className="inline-selected-tag-visual" data-tag-measure[^>]*>[\s\S]*#\{tagName\}[\s\S]*<X size=\{12\} strokeWidth=\{1\.6\}/);
    expect(styles).toMatch(/\.inline-tag-measurer > span \{[^}]*font-size:\s*11px;[^}]*font-weight:\s*400;/s);
  });
});
