/// <reference types="node" />

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const obsoleteComponent = ["Delete", "Entry", "Confirmation"].join("");
const obsoleteIdentifiers = [
  obsoleteComponent,
  ["delete", "Confirmation", "Visible"].join(""),
  ["sheet", "Delete", "Confirmation"].join(""),
  ["screen", "Delete", "Confirmation", "Overlay"].join(""),
  ["delete", "Confirmation", "Modal", "Root"].join("")
];
const obsoleteCopy = [
  ["Delete", " entry", "?"].join(""),
  ["This time entry will be removed.", " This cannot be undone."].join("")
];

describe("direct Delete and Undo structural contract", () => {
  it("does not retain the obsolete confirmation component, identifiers or copy", () => {
    const componentPath = fileURLToPath(new URL(`./${obsoleteComponent}.tsx`, import.meta.url));
    expect(existsSync(componentPath)).toBe(false);

    const violations = trackedTextFiles().flatMap((relativePath) => {
      const source = readFileSync(`${repositoryRoot}/${relativePath}`, "utf8");
      return [...obsoleteIdentifiers, ...obsoleteCopy]
        .filter((forbidden) => source.includes(forbidden))
        .map((forbidden) => `${relativePath}: ${forbidden}`);
    });

    expect(violations).toEqual([]);
  });
});

function trackedTextFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot }
  ).toString("utf8");
  return output
    .split("\0")
    .filter(Boolean)
    .filter((relativePath) => existsSync(`${repositoryRoot}/${relativePath}`))
    .filter((relativePath) => /\.(?:cjs|css|html|js|json|md|mjs|sql|swift|ts|tsx|txt|yml|yaml)$/.test(relativePath));
}
