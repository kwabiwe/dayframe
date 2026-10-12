import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// W10 (owner, 11 Oct): text buttons carry an icon only when they are a primary action; the current
// page's navigation icon is coral; text selection is never coral (UIA-314).
const webRoot = process.cwd();
const css = readFileSync(join(webRoot, "src/app/globals.css"), "utf8");

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

// Every text button, link button or summary in app/ and components/ is checked. Exempt: primary
// actions, and controls that are not text buttons — navigation, pickers and field triggers, menu,
// listbox and popover rows, chips and activity blocks — plus the Review deck's decision row
// (Log it / Skip / Edit name with their keys), as on the iPhone deck and the prototype.
const PRIMARY = /\b(?:df-rbtn--live|df-rbtn--primary|ui-button-primary|industrial-button-primary|landing-primary-action)\b/;
const NOT_A_TEXT_BUTTON = /\b(?:df-nav|df-tabbar|df-brand|df-side-search|df-profile-pop-rows|df-rchip|df-fchip|df-quick-button|df-lnew|swiss-category-trigger|timeline-period-trigger|df-range-trigger|dayframe-date-time-trigger|swiss-timer-actions-menu|fill-list-action|swiss-task-suggestions-list|calendar-entry-primary)\b/;
// SignOutControl draws its icon only when the profile menu's row asks for it (showIcon).
const EXEMPT_FILES = new Set(["src/components/review/ReviewDeck.tsx", "src/components/TimerPanel.tsx", "src/components/SignOutControl.tsx"]);
const CANDIDATES = new Set(["button", "a", "Link", "Button", "summary"]);

function attribute(element: ts.JsxOpeningLikeElement, name: string) {
  const found = element.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText() === name);
  return found && ts.isJsxAttribute(found) ? found.initializer?.getText() ?? "true" : "";
}

/** A capitalised JSX element anywhere among the children, conditional ones included. */
function containsIcon(node: ts.Node): boolean {
  if ((ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node))) {
    const tag = (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText();
    if (/^[A-Z]/.test(tag)) return true;
    if (ts.isJsxElement(node) && tag !== "span") return false;
  }
  return ts.forEachChild(node, (child) => containsIcon(child) || undefined) ?? false;
}

function iconTextButtons(path: string) {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node, context: string) => {
    let next = context;
    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      const tag = opening.tagName.getText();
      const own = `${attribute(opening, "className")} role=${attribute(opening, "role")}`;
      next = `${context} ${own}`;
      // A <summary> is a disclosure (with its chevron) unless it is styled as a button.
      const disclosure = tag === "summary" && !/\b(?:df-rbtn|ui-button)\b/.test(own);
      if (CANDIDATES.has(tag) && !disclosure && !PRIMARY.test(own) && !NOT_A_TEXT_BUTTON.test(next) && !/role=("|\{")?(?:menu|menuitem|option|listbox)/.test(next) &&
          !(tag === "Button" && /"(?:primary|danger)"/.test(attribute(opening, "variant")))) {
        const hasText = node.children.some((child) => (ts.isJsxText(child) && child.text.trim().length > 0) ||
          (ts.isJsxExpression(child) && child.expression !== undefined && !containsIcon(child)) ||
          (ts.isJsxElement(child) && child.openingElement.tagName.getText() === "span"));
        const hasIcon = node.children.some((child) => !ts.isJsxText(child) && containsIcon(child) &&
          !(ts.isJsxElement(child) && child.openingElement.tagName.getText() === "span"));
        if (hasIcon && hasText) found.push(`${relative(webRoot, path)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
    }
    ts.forEachChild(node, (child) => visit(child, next));
  };
  visit(file, "");
  return found;
}

describe("web buttons, navigation and selection (W10)", () => {
  it("secondary text buttons are text only", () => {
    const offenders = [...files(join(webRoot, "src/components")), ...files(join(webRoot, "src/app"))]
      .filter((path) => !EXEMPT_FILES.has(relative(webRoot, path)))
      .flatMap(iconTextButtons);
    expect(offenders).toEqual([]);
  });

  it("the current page's navigation icon is coral, its label neutral", () => {
    // accent-text: 5.09:1 on the selected neutral in Daylight (the iPhone's selected-tab token).
    expect(css).toMatch(/\.df-nav a\[aria-current="page"\] > svg \{\s*color: var\(--accent-text\);/);
    expect(css).toMatch(/\.df-tabbar a\[aria-current="page"\] \.df-tab-icon > svg \{\s*color: var\(--accent-text\);/);
  });

  it("text selection is neutral, never coral", () => {
    const start = css.indexOf("\n::selection {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).not.toMatch(/accent|coral/);
    expect(rule).toContain("background: var(--text-secondary);");
    expect(rule).toContain("color: var(--surface);");
  });
});
