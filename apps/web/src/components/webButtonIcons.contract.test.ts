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

// Non-primary text buttons by class. The Review deck's decision row (Log it / Skip / Edit name with
// their keys) keeps its icons, as on the iPhone deck and the prototype.
const SECONDARY = /\bdf-rbtn\b(?![^"`]*df-rbtn--(?:live|primary))|\bui-button-secondary\b|\bindustrial-button\b(?!-)/;
const EXEMPT_FILES = new Set(["src/components/review/ReviewDeck.tsx"]);

function iconTextButtons(path: string) {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const className = node.openingElement.attributes.properties
        .find((property) => ts.isJsxAttribute(property) && property.name.getText() === "className");
      const classText = className && ts.isJsxAttribute(className) ? className.initializer?.getText() ?? "" : "";
      if (SECONDARY.test(classText)) {
        const hasIcon = node.children.some((child) => (ts.isJsxSelfClosingElement(child) || ts.isJsxElement(child)) &&
          /^[A-Z]/.test((ts.isJsxElement(child) ? child.openingElement : child).tagName.getText()));
        const hasText = node.children.some((child) => (ts.isJsxText(child) && child.text.trim().length > 0) || ts.isJsxExpression(child));
        if (hasIcon && hasText) found.push(`${relative(webRoot, path)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("web buttons, navigation and selection (W10)", () => {
  it("secondary text buttons are text only", () => {
    const offenders = files(join(webRoot, "src/components"))
      .filter((path) => !EXEMPT_FILES.has(relative(webRoot, path)))
      .flatMap(iconTextButtons);
    expect(offenders).toEqual([]);
  });

  it("the current page's navigation icon is coral, its label neutral", () => {
    expect(css).toMatch(/\.df-nav a\[aria-current="page"\] > svg \{\s*color: var\(--accent\);/);
    expect(css).toMatch(/\.df-tabbar a\[aria-current="page"\] \.df-tab-icon > svg \{\s*color: var\(--accent\);/);
  });

  it("text selection is neutral, never coral", () => {
    const start = css.indexOf("\n::selection {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).not.toMatch(/accent|coral/);
    expect(rule).toContain("color-mix(in srgb, var(--text-primary) 22%, transparent)");
  });
});
