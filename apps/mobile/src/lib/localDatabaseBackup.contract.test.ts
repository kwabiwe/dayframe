import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Dayframe's SQLite journals hold precise location and Health data that logout and Delete recent
// evidence must be able to remove, so they stay out of iCloud and computer backups (stability audit
// 22 Oct 2026, location-5). Device check: a backup made after the first launch of this build lists no
// Documents/SQLite files.

const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(`${mobileRoot}${path}`, "utf8");

describe("local database backup exclusion", () => {
  it("excludes Documents/SQLite from backup at launch, before React Native can open a database", () => {
    const appDelegate = read("ios/Dayframe/AppDelegate.swift");
    const call = appDelegate.indexOf("DayframeLocalDatabaseBackup.exclude()");
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(appDelegate.indexOf("factory.startReactNative"));
    const helper = appDelegate.slice(appDelegate.indexOf("private enum DayframeLocalDatabaseBackup"));
    expect(helper).toContain("urls(for: .documentDirectory, in: .userDomainMask)");
    expect(helper).toContain('appendingPathComponent("SQLite", isDirectory: true)');
    expect(helper).toContain("values.isExcludedFromBackup = true");
  });

  it("matches expo-sqlite's default directory, which every Dayframe database uses", () => {
    const require = createRequire(import.meta.url);
    const sqliteRoot = require.resolve("expo-sqlite/package.json").replace(/package\.json$/, "");
    const module = readFileSync(`${sqliteRoot}ios/SQLiteModule.swift`, "utf8");
    expect(module).toContain('documentDirectory?.appendingPathComponent("SQLite")');
    for (const path of ["src/lib/location/store.ts", "src/lib/healthSyncStore.ts", "src/lib/reviewSyncStore.ts"]) {
      const opens = [...read(path).matchAll(/openDatabaseAsync\(([^)]*)\)/g)].map((match) => match[1]);
      expect(opens, path).toHaveLength(1);
      // A second argument could move the file to a directory the exclusion does not cover.
      expect(opens[0], path).not.toContain(",");
    }
  });
});
