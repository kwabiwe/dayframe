import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The card kit (owner, 31 Oct 2026): one label, one field, one time field, one 36 px button, one header and footer on
// every card. A card that brings its own treatment fails here.
const root = join(process.cwd(), "src");
const styles = readFileSync(join(root, "app/globals.css"), "utf8");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

const LABELS = [".calendar-compact-field-label", ".df-ce-label", ".df-start-field-label", ".location-correction-time > span", ".ui-field > label"];

function rulesFor(selector: string) {
  return [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, head]) =>
    head.split(",").some((part) => part.trim().endsWith(selector)));
}

describe("the card kit", () => {
  it("has one sentence-case label", () => {
    for (const selector of LABELS) {
      const rules = rulesFor(selector);
      expect(rules.length, selector).toBeGreaterThan(0);
      for (const [, , body] of rules) {
        expect(body, selector).not.toContain("text-transform");
        expect(body, selector).not.toMatch(/letter-spacing: 0\.\d/);
      }
    }
  });

  it("gives every card button the control height", () => {
    const kit = styles.slice(styles.indexOf("The card kit (owner, 31 Oct 2026)"));
    expect(kit).toMatch(/:root :is\(\.df-rbtn, \.df-rbtn--sm, \.ui-dialog \.ui-button, \.ui-dialog \.ui-button\.is-compact, \.calendar-compact-save, \.calendar-compact-cancel\) \{\s*min-height: var\(--web-control-height\);/);
    expect(kit).toMatch(/\.time-entry-quick-editor-modal\) \{\s*--web-control-height: 36px;/);
  });

  it("keeps fields fill-led: no border at rest or after a click, the ring for the keyboard only", () => {
    const kit = styles.slice(styles.indexOf("The card kit (owner, 31 Oct 2026)"));
    expect(kit).toMatch(/:root :is\(\.ui-control, \.ui-compound-control, \.location-correction-save input\):is\(:focus, :focus-within\) \{\s*border-color: transparent;/);
    // A floating list's search rings on a key only, never when its panel focuses it (useKeyboardFocusRing keyboardOnly).
    expect(kit).toMatch(/\.ui-compound-control:not\(\.df-flist-search\):has\(\[data-kb-focus\]\) \{\s*border-color: var\(--web-focus-border\);/);
  });

  it("types every time in the shared field, never the browser's picker or a calendar icon in the box", () => {
    for (const file of sources(join(root, "components"))) {
      expect(readFileSync(file, "utf8"), file).not.toContain('type="time"');
    }
    const editor = readFileSync(join(root, "components/TimeEntryQuickEditor.tsx"), "utf8");
    expect(editor).not.toContain("iconOnly");
    expect(editor).toContain('triggerClassName="df-card-date"');
  });

  it("gives the block editor the dialogs' header", () => {
    expect(rulesFor(".df-ed-head h2")[0][2]).toMatch(/font-size: 16px;\s*font-weight: var\(--fw-strong\);/);
    expect(rulesFor(".ui-dialog-header h2").at(-1)?.[2]).toMatch(/font-size: 16px;\s*font-weight: var\(--fw-strong\);/);
  });
});
