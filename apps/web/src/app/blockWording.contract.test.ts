import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The web interface says block, activity and Calendar (UIA-206): never timer, entry, time entry,
// task or Timeline in what people read or hear — labels, titles, placeholders, help, errors and
// visible text. Code, routes (/timeline, /api/time-entries), storage and CSS names keep theirs.
const webRoot = join(process.cwd());
const roots = ["src/components", "src/app"];
const noun = /\b(timers?|entry|entries|time entr(?:y|ies)|tasks?|timeline)\b/i;
const visible =
  /(aria-label|ariaLabel|title|placeholder|label|description|help|detail|body|error|message|caption)\s*[:=(]|setInlineStatus\(|recoverMutation\(|new Error\(|errorMessage\(|responseError\(/;
const literal = /"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "api" ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function offenders(path: string) {
  const found: string[] = [];
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*|import )/.test(line) || /className=/.test(line)) return;
    if (visible.test(line) || visible.test(lines[index - 1] ?? "")) {
      for (const match of line.matchAll(literal)) {
        const text = (match[1] ?? match[2] ?? "").replace(/\$\{[^}]*\}/g, " ");
        if (!/[A-Za-z] [A-Za-z]/.test(text) || /^\/|[a-z0-9]+-[a-z0-9]+/.test(text)) continue;
        if (noun.test(text)) found.push(`${relative(webRoot, path)}:${index + 1} ${text.trim()}`);
      }
    }
    const jsx = line.match(/>([^<>{}]+)</)?.[1];
    if (jsx && /[A-Za-z] [A-Za-z]/.test(jsx) && noun.test(jsx)) found.push(`${relative(webRoot, path)}:${index + 1} ${jsx.trim()}`);
  });
  return found;
}

describe("block wording on web (UIA-206)", () => {
  it("never says timer, entry, task or Timeline in what people read or hear", () => {
    expect(roots.flatMap((root) => files(join(webRoot, root))).flatMap(offenders)).toEqual([]);
  });
});
