import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The interface says "activity"/"activities"; storage, API fields, code and exports keep
// `category` (.codex/reference/product-model.md). This guards user-facing text only.
const repoRoot = join(process.cwd(), "../..");
const sourceRoots = ["apps/web/src", "apps/mobile/src", "apps/mobile/app"];
// Report CSV exports keep their "Category" column so existing spreadsheets keep working.
const exportFiles = new Set(["apps/web/src/lib/report-csv.ts"]);

const literal = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|>([^<>{}]+)</g;
const sql = /\b(select|insert|update|delete|where|join|returning|coalesce)\b/i;
const word = /(?<![\w\-:/.#])(categor(?:y|ies)|uncategori[sz]ed)(?![\w\-:])/i;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function userFacingCategoryText(path: string) {
  const found: string[] = [];
  readFileSync(path, "utf8").split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (/^(import |\/\/|\*|\/\*)/.test(trimmed)) return;
    for (const match of line.matchAll(literal)) {
      const text = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").replace(/\$\{[^}]*\}/g, "");
      if (sql.test(text) || /^[a-z]+$/.test(text) || text.startsWith("/")) continue;
      if (word.test(text)) found.push(`${relative(repoRoot, path)}:${index + 1} ${text.trim()}`);
    }
  });
  // JSX text that spans several lines.
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/>\s*([^<>{}]*?)\s*</gs)) {
    const text = match[1];
    if (!text.includes("\n") && !/\s{2,}/.test(match[0])) continue;
    if (/[;=()]/.test(text) || sql.test(text)) continue;
    if (word.test(text)) {
      found.push(`${relative(repoRoot, path)}:${source.slice(0, match.index).split("\n").length} ${text.trim()}`);
    }
  }
  return found;
}

describe("activity wording", () => {
  it("never shows 'category' or 'uncategorized' to people on web or iPhone", () => {
    const offenders = sourceRoots
      .flatMap((root) => sourceFiles(join(repoRoot, root)))
      .filter((path) => !exportFiles.has(relative(repoRoot, path)))
      .flatMap(userFacingCategoryText);
    expect(offenders).toEqual([]);
  });
});
