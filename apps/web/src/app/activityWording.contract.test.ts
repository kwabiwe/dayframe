import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The interface says "activity"/"activities"; storage, API fields, code and exports keep
// `category` (.codex/reference/product-model.md). This guards user-facing text only.
const repoRoot = join(process.cwd(), "../..");
const sourceRoots = ["apps/web/src", "apps/mobile/src", "apps/mobile/app", "packages/shared/src"];
const swiftRoots = ["apps/mobile/ios/Dayframe", "apps/mobile/ios/DayframeLiveActivity", "apps/mobile/modules"];
// Report CSV exports keep their "Category" column so existing spreadsheets keep working.
const exportFiles = new Set(["apps/web/src/lib/report-csv.ts"]);

const literal = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|>([^<>{}]+)</g;
// Only text shaped like SQL is skipped: placeholders, or a statement keyword with its clause.
const sql = /\$\d|\b(select|delete)\b[\s\S]*\bfrom\b|\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bjoin\b|\breturning\b|\bcoalesce\(/i;
const word = /(?<![\w\-:/.#])(categor(?:y|ies)|uncategori[sz]ed)(?![\w\-:])/i;

function sourceFiles(directory: string, extension = /\.(ts|tsx)$/): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "Tests" || name === "node_modules" ? [] : sourceFiles(path, extension);
    return extension.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function swiftCategoryText(path: string) {
  return readFileSync(path, "utf8").split("\n").flatMap((line, index) =>
    [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map((match) => match[1].replace(/\\\([^)]*\)/g, ""))
      .filter((text) => !/^[a-z]+$/.test(text) && word.test(text))
      .map((text) => `${relative(repoRoot, path)}:${index + 1} ${text}`)
  );
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

  it("never shows it in the iPhone app's Swift text either", () => {
    const offenders = swiftRoots.flatMap((root) => sourceFiles(join(repoRoot, root), /\.swift$/)).flatMap(swiftCategoryText);
    expect(offenders).toEqual([]);
  });
});
