import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const auth = source("./AuthForm.tsx");
const inlineTags = source("./InlineTagInput.tsx");
const places = source("./PlaceSearchCombobox.tsx");
const reports = source("./ReportFiltersPanel.tsx");
const styles = source("../app/globals.css");

describe("web focus and control contracts", () => {
  it("assigns one compound focus owner to fields with nested actions", () => {
    expect(auth).toContain('className="ui-compound-control auth-password-field"');
    expect(inlineTags).toContain('className="ui-compound-control inline-tag-input-anchor"');
    expect(inlineTags).toContain('className="ui-compound-control inline-tag-picker-search"');
    expect(places).toContain('className="ui-compound-control place-search-control"');
    expect(styles).toMatch(/\.ui-compound-control:focus-within \{[^}]*border-color: var\(--web-focus-border\);/s);
    expect(styles).toMatch(/\.ui-compound-control > input \{[^}]*border: 0;[^}]*outline: 0;/s);
  });

  it("reserves field border width and preserves invalid state while focused", () => {
    expect(styles).toContain("--web-control-border-width: 2px;");
    expect(styles).toMatch(/input\[aria-invalid="true"\]:focus-visible,[\s\S]*box-shadow: inset 0 -2px 0 var\(--danger\);/);
    expect(styles).toMatch(/\.report-multi-select-trigger:focus-visible,[^{]*\{[^}]*outline: 2px solid currentColor;[^}]*outline-offset: 2px;/s);
    expect(reports).toContain('className="ui-control"');
  });

  it("keeps standalone actions on the external focus-ring path", () => {
    expect(styles).toMatch(/button:focus-visible,[\s\S]*outline: 2px solid var\(--focus\);[\s\S]*outline-offset: 2px;/);
    expect(styles).toContain(".focus-ring:not(input, select, textarea):focus-visible");
  });
});
