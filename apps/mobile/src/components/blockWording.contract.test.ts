import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// The iPhone interface says block and activity (UIA-100): never timer, entry, time entry or task in
// what people read or hear. The guard reads the TypeScript syntax tree, so it sees whole
// expressions: JSX text (also inside conditions), every string or template branch of a visible
// prop or object field (accessibilityLabel, title, message, …), and the text arguments of alerts
// and announcements. Code, storage, API fields and diagnostics keep their names.
const mobileRoot = fileURLToPath(new URL("../..", import.meta.url));
const roots = ["app", "src"];
const exempt = new Set([
  "app/sheet-qa.tsx", // developer-only QA route
  // Its Calendar block labels change in open PR #317 (A9a); its wording follows once that lands.
  "src/lib/nativeCalendarPresentation.ts",
]);
export const BLOCK_WORDING_NOUN = /\b(timers?|entry|entries|time entr(?:y|ies)|tasks?)\b/i;
const VISIBLE_KEYS = new Set([
  "accessibilityLabel", "accessibilityHint", "placeholder", "title", "label", "message", "body",
  "subtitle", "hint", "lede", "emptyState", "detail", "text", "caption", "privacy", "accessibilityValue"
]);
const VISIBLE_CALLS = /(^|\.)(alert|announceForAccessibility|showNotice|setNotice|setStatus|setMessage|setValidationError|setError|setNote|setSyncHelpNote|Alert\.alert)$/;

/** Every piece of literal text an expression can evaluate to (both branches of a condition). */
function texts(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.flatMap((span) => [...texts(span.expression), span.literal.text])];
  }
  if (ts.isConditionalExpression(node)) return [...texts(node.whenTrue), ...texts(node.whenFalse)];
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    // A comparison renders nothing; `a && "Text"` renders its right side; `||`, `??` and `+` either.
    if (operator === ts.SyntaxKind.EqualsEqualsEqualsToken || operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        operator === ts.SyntaxKind.EqualsEqualsToken || operator === ts.SyntaxKind.ExclamationEqualsToken) return [];
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return texts(node.right);
    return [...texts(node.left), ...texts(node.right)];
  }
  if (ts.isParenthesizedExpression(node) || ts.isJsxExpression(node)) return node.expression ? texts(node.expression) : [];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(texts);
  return [];
}

export function blockWordingOffenders(source: string, fileName = "file.tsx") {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const check = (node: ts.Node, candidates: string[], alwaysVisible = false) => {
    // Words people read: JSX text always; elsewhere the expression as a whole reads as words (words
    // separated by any whitespace, or one capitalised word). Only a single identifier-like token
    // (camelCase, a path or a kebab key) is treated as code.
    const whole = candidates.join(" ");
    const reads = alwaysVisible || /[A-Za-z][^A-Za-z0-9]+[A-Za-z]/.test(whole) || /^[A-Z][a-z]+\W*$/.test(whole.trim());
    if (!reads) return;
    for (const text of candidates) {
      const token = text.trim();
      if (!/\s/.test(token) && /^[a-z]+[A-Z]|[a-z0-9]+[-_./][a-z0-9]+/.test(token)) continue;
      if (BLOCK_WORDING_NOUN.test(text)) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart());
        found.push(`${fileName}:${line + 1} ${text.trim()}`);
      }
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) check(node, [node.text], true);
    else if (ts.isJsxExpression(node) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      check(node, texts(node));
    } else if (ts.isJsxAttribute(node) && node.initializer && VISIBLE_KEYS.has(node.name.getText())) {
      check(node, texts(node.initializer));
    } else if (ts.isPropertyAssignment(node) && VISIBLE_KEYS.has(node.name.getText().replace(/["']/g, ""))) {
      check(node, texts(node.initializer));
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

describe("block wording (UIA-100)", () => {
  it("never says timer, entry or task in what people read or hear on iPhone", () => {
    const found = roots
      .flatMap((root) => files(join(mobileRoot, root)))
      .filter((path) => !exempt.has(relative(mobileRoot, path)))
      .flatMap((path) => blockWordingOffenders(readFileSync(path, "utf8"), relative(mobileRoot, path)));
    expect(found).toEqual([]);
  });

  it("reads whole expressions: JSX text, conditions, multi-line props and template branches", () => {
    const source = [
      "const a = <Text>Timer</Text>;",
      "const b = <Text>{busy ? \"Saving the entry\" : \"Save\"}</Text>;",
      "const c = <Pressable",
      "  accessibilityLabel={",
      "    open",
      "      ? `Close ${name}`",
      "      : `Open ${count} ${count === 1 ? \"entry\" : \"entries\"}`",
      "  }",
      "/>;",
      "Alert.alert(\"Timer not saved\", \"Try again.\");",
      "const d = { title: \"Work\", internalLookup: \"timer start\" };",
      "const e = <Text>Timer:</Text>;",
      "const f = <Text>Stop",
      "  timer</Text>;",
      "const g = <Text>Timer is read-only</Text>;",
      "const h = <Text>{kind === \"timer\" && \"Recording\"}</Text>;",
      "setValidationError(\"Timers can be no longer than 24 hours.\");",
    ].join("\n");
    expect(blockWordingOffenders(source)).toEqual([
      "file.tsx:1 Timer",
      "file.tsx:2 Saving the entry",
      "file.tsx:4 entry",
      "file.tsx:4 entries",
      "file.tsx:10 Timer not saved",
      "file.tsx:12 Timer:",
      "file.tsx:13 Stop\n  timer",
      "file.tsx:15 Timer is read-only",
      "file.tsx:17 Timers can be no longer than 24 hours.",
    ]);
  });

  it("keeps the app's Swift text in blocks: Siri phrases and the Live Activity", () => {
    const swift = ["ios/Dayframe/DayframeShortcuts.swift", "ios/DayframeLiveActivity/DayframeTimerLiveActivity.swift"]
      .map((path) => readFileSync(join(mobileRoot, path), "utf8"));
    const phrases = swift.flatMap((source) => [...source.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]))
      .map((text) => text.replace(/\\\([^)]*\)/g, " "))
      .filter((text) => /[A-Za-z]/.test(text) && (text.includes(" ") || /^[A-Z]/.test(text)));
    expect(phrases.filter((text) => BLOCK_WORDING_NOUN.test(text))).toEqual([]);
  });
});
