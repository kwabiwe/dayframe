import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function runtimeTypeScriptFiles(directoryUrl: URL): string[] {
  const directory = fileURLToPath(directoryUrl);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const childUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    if (entry.isDirectory()) return runtimeTypeScriptFiles(childUrl);
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) return [];
    return [fileURLToPath(childUrl)];
  });
}

describe("mobile network session contract", () => {
  it("routes runtime API traffic through the cookie-free mobile boundary", () => {
    const files = [
      ...runtimeTypeScriptFiles(new URL("../", import.meta.url)),
      ...runtimeTypeScriptFiles(new URL("../../app/", import.meta.url))
    ];
    const boundary = fileURLToPath(new URL("./mobile-network.ts", import.meta.url));
    const offenders = files
      .filter((file) => file !== boundary)
      .filter((file) => /\bfetch\s*\(/.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });
});
