import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The iPhone interface says block and activity (UIA-100): never timer, entry, time entry or task in
// what people read or hear — accessibility labels and hints, announcements, alerts, placeholders,
// titles and Siri phrases. Code, storage, API fields and diagnostics keep their names.
const mobileRoot = fileURLToPath(new URL("../..", import.meta.url));
const roots = ["app", "src"];
const exempt = new Set([
  "app/sheet-qa.tsx", // developer-only QA route
  // Its Calendar block labels change in open PR #317 (A9a); its wording follows once that lands.
  "src/lib/nativeCalendarPresentation.ts",
]);
const noun = /\b(timers?|entry|entries|time entr(?:y|ies)|tasks?)\b/i;
const visible =
  /(accessibilityLabel|accessibilityHint|announceForAccessibility|Alert\.alert|placeholder|title|label|message|emptyState|hint|lede|subtitle)\s*[:=(]/;
const literal = /"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function offenders(path: string) {
  const found: string[] = [];
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*|import )/.test(line)) return;
    // A visible prop or call on this line or the one before (multi-line JSX props).
    if (!visible.test(line) && !visible.test(lines[index - 1] ?? "")) return;
    for (const match of line.matchAll(literal)) {
      const text = (match[1] ?? match[2] ?? "").replace(/\$\{[^}]*\}/g, "");
      if (!text.includes(" ")) continue;
      if (noun.test(text)) found.push(`${relative(mobileRoot, path)}:${index + 1} ${text.trim()}`);
    }
  });
  // Visible JSX text.
  lines.forEach((line, index) => {
    const text = line.match(/>([^<>{}]+)</)?.[1];
    if (text && noun.test(text) && /[A-Za-z] [A-Za-z]/.test(text)) found.push(`${relative(mobileRoot, path)}:${index + 1} ${text.trim()}`);
  });
  return found;
}

describe("block wording (UIA-100)", () => {
  it("never says timer, entry or task in what people read or hear on iPhone", () => {
    const found = roots
      .flatMap((root) => files(join(mobileRoot, root)))
      .filter((path) => !exempt.has(relative(mobileRoot, path)))
      .flatMap(offenders);
    expect(found).toEqual([]);
  });

  it("keeps Siri and Shortcuts phrases in blocks", () => {
    const shortcuts = readFileSync(join(mobileRoot, "ios/Dayframe/DayframeShortcuts.swift"), "utf8");
    const phrases = [...shortcuts.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]).filter((text) => text.includes(" "));
    expect(phrases.filter((text) => noun.test(text))).toEqual([]);
  });
});
