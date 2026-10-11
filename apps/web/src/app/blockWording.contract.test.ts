import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// The web interface says block, activity and Calendar (UIA-206): never timer, entry, time entry,
// task or Timeline in what people read or hear. Like the iPhone guard, it reads the TypeScript
// syntax tree: JSX text (also inside conditions), every string or template branch of a visible
// attribute or field (aria-label, title, placeholder, error, message, …), and the text of thrown
// or returned errors. Routes (/timeline, /api/time-entries), CSS classes, stored names, report CSV
// columns and code keep theirs.
const webRoot = process.cwd();
const roots = ["src/components", "src/app", "src/lib"];
const exempt = new Set([
  "src/lib/report-csv.ts", // export columns stay stable for existing spreadsheets
]);
// Stored defaults (not interface text) that the guard must not read as copy.
const exemptText = new Set(["Manual entry"]);
// The public integrations API keeps its documented wording for external clients.
const exemptDirectories = ["src/app/api/integrations/"];
const noun = /\b(timers?|entry|entries|time entr(?:y|ies)|tasks?|timeline)\b/i;
const VISIBLE_KEYS = new Set([
  "aria-label", "ariaLabel", "title", "placeholder", "label", "description", "help", "detail", "body", "reason", "notes",
  "error", "message", "caption", "data-label", "alt", "lede", "subtitle", "hint", "emptyState"
]);
const VISIBLE_CALLS = /(^super$)|(^|\.)(setInlineStatus|recoverMutation|setError|setStatus|setMessage|showToast|announce|errorMessage|responseError)$/;

function texts(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.flatMap((span) => [...texts(span.expression), span.literal.text])];
  }
  if (ts.isConditionalExpression(node)) return [...texts(node.whenTrue), ...texts(node.whenFalse)];
  if (ts.isBinaryExpression(node)) return [...texts(node.left), ...texts(node.right)];
  if (ts.isParenthesizedExpression(node) || ts.isJsxExpression(node) || ts.isAsExpression(node)) {
    return node.expression ? texts(node.expression) : [];
  }
  return [];
}

export function webWordingOffenders(source: string, fileName = "file.tsx") {
  const kind = fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.TSX;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const check = (node: ts.Node, candidates: string[]) => {
    const whole = candidates.join(" ");
    if (!/[A-Za-z] +[A-Za-z]/.test(whole) && !/^[A-Z][a-z]+$/.test(whole.trim())) return;
    for (const text of candidates) {
      const token = text.trim();
      // Identifier-like single tokens (paths, camelCase, kebab keys) are code, not copy.
      if ((!/\s/.test(token) && /^\/|^[a-z]+[A-Z]|[a-z0-9]+[-_./][a-z0-9]+/.test(token)) || exemptText.has(token)) continue;
      if (/\b(select|insert|update|delete)\b[\s\S]*\b(from|into|set|where)\b/i.test(whole)) continue;
      if (noun.test(text)) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart());
        found.push(`${fileName}:${line + 1} ${text.trim()}`);
      }
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) check(node, [node.text]);
    else if (ts.isJsxExpression(node) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      check(node, texts(node));
    } else if (ts.isJsxAttribute(node) && node.initializer && VISIBLE_KEYS.has(node.name.getText())) {
      check(node, texts(node.initializer));
    } else if (ts.isPropertyAssignment(node) && VISIBLE_KEYS.has(node.name.getText().replace(/["']/g, ""))) {
      check(node, texts(node.initializer));
    } else if (ts.isNewExpression(node) && /Error$/.test(node.expression.getText())) {
      // Error and its subclasses: their messages reach people through API responses and toasts.
      check(node, (node.arguments ?? []).flatMap(texts));
    } else if (ts.isParameter(node) && node.initializer && ts.isConstructorDeclaration(node.parent)) {
      // Default messages of Error constructors.
      check(node, texts(node.initializer));
    } else if ((ts.isJsxElement(node) || ts.isJsxFragment(node))) {
      // Words assembled across JSX children ("entr" + {n === 1 ? "y" : "ies"}).
      const children = node.children;
      children.forEach((child, index) => {
        const previous = children[index - 1];
        if (!ts.isJsxExpression(child) || !previous || !ts.isJsxText(previous)) return;
        const stem = previous.text.match(/[A-Za-z]+$/)?.[0];
        if (!stem) return;
        const joined = texts(child).filter((text) => /^[a-z]/.test(text)).map((text) => stem + text);
        if (joined.length) check(child, [previous.text.trim(), ...joined]);
      });
      ts.forEachChild(node, visit);
      return;
    } else if (ts.isReturnStatement(node) && node.expression) {
      // Copy a presentation helper returns.
      check(node, texts(node.expression));
    } else if (ts.isCallExpression(node) && VISIBLE_CALLS.test(node.expression.getText())) {
      check(node, node.arguments.flatMap(texts));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("block wording on web (UIA-206)", () => {
  it("never says timer, entry, task or Timeline in what people read or hear", () => {
    const found = roots
      .flatMap((root) => files(join(webRoot, root)))
      .filter((path) => !exempt.has(relative(webRoot, path)) && !exemptDirectories.some((dir) => relative(webRoot, path).startsWith(dir)))
      .flatMap((path) => webWordingOffenders(readFileSync(path, "utf8"), relative(webRoot, path)));
    expect(found).toEqual([]);
  });

  it("reads whole expressions, including class-name lines, multi-line JSX and assembled words", () => {
    const source = [
      "const a = <p className=\"hint\">Enter starts the timer</p>;",
      "const b = (",
      "  <span>",
      "    {count === 1 ? \"entry\" : \"entries\"} matched",
      "  </span>",
      ");",
      "throw new Error(`Unable to save this entry: ${status}`);",
      "const c = { error: \"This entry has no task\", key: \"timer start\" };",
      "function label() { return \"Time entry restored\"; }",
      "throw new ValidationError(\"Entries can be no longer than 24 hours.\");",
      "const d = <p>{n} entr{n === 1 ? \"y\" : \"ies\"} left</p>;",
      "class BusyError extends Error { constructor(message = \"This timer is busy.\") { super(message); } }",
      "const e = { reason: \"This entry was not saved. Please re-open it.\" };",
    ].join("\n");
    expect(webWordingOffenders(source)).toEqual([
      "file.tsx:1 Enter starts the timer",
      "file.tsx:4 entry",
      "file.tsx:4 entries",
      "file.tsx:7 Unable to save this entry:",
      "file.tsx:8 This entry has no task",
      "file.tsx:9 Time entry restored",
      "file.tsx:10 Entries can be no longer than 24 hours.",
      "file.tsx:11 entry",
      "file.tsx:11 entries",
      "file.tsx:12 This timer is busy.",
      "file.tsx:13 This entry was not saved. Please re-open it.",
    ]);
  });
});
