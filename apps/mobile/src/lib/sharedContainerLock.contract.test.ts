import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// TestFlight 124 was killed with 0xDEAD10CC (22 Oct 2026): the shortcut queue held its App Group file lock
// while a UserDefaults change made React Native serialise every default to JS, and iOS suspended the
// process with the lock held. These checks keep every native file lock inside DayframeSharedFileLock.

const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));
const nativeRoots = ["ios/Dayframe", "ios/DayframeLiveActivity", "modules"];
const lockHelper = "ios/Dayframe/DayframeSharedFileLock.swift";

function nativeSources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return name === "Tests" || name === "node_modules" ? [] : nativeSources(path);
    }
    return /\.(swift|m|mm)$/.test(name) ? [path] : [];
  });
}

function read(path: string) {
  return readFileSync(`${mobileRoot}${path}`, "utf8");
}

/** The closure passed at each call of `name`, found by matching braces from the call. */
function closureBodies(source: string, name: string) {
  const bodies: string[] = [];
  let from = 0;
  while ((from = source.indexOf(`${name}`, from)) !== -1) {
    const call = from;
    from += name.length;
    if (source.slice(Math.max(0, call - 20), call).includes("func ")) continue;
    const open = source.indexOf("{", call);
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) {
        bodies.push(source.slice(open, index + 1));
        break;
      }
    }
  }
  return bodies;
}

function functionBody(source: string, signature: string) {
  const start = source.indexOf(signature);
  expect(start, signature).toBeGreaterThan(-1);
  return closureBodies(source.slice(start), signature)[0] ?? "";
}

describe("App Group file locks", () => {
  it("takes every native file lock only through DayframeSharedFileLock", () => {
    const primitives = /\bflock\(|\blockf\(|F_SETLKW?\b|O_EXLOCK|O_SHLOCK|NSFileCoordinator|sqlite3_open/;
    const offenders = nativeRoots
      .flatMap((root) => nativeSources(`${mobileRoot}${root}`))
      .map((path) => relative(mobileRoot, path))
      .filter((path) => path !== lockHelper && primitives.test(read(path)));

    expect(offenders).toEqual([]);
  });

  it("holds the lock only inside a granted, finite background assertion with a bounded wait", () => {
    const helper = functionBody(read(lockHelper), "static func withExclusiveLock");
    const assertion = helper.indexOf("guard let assertion = beginAssertion(name) else");
    const endsAssertion = helper.indexOf("defer { assertion.end() }");
    const holds = helper.indexOf("guard assertion.hold() else");
    const releasesHold = helper.indexOf("defer { assertion.releaseHold() }");
    const opens = helper.indexOf("open(lockURL.path");
    const unlocks = helper.indexOf("defer { flock(descriptor, LOCK_UN) }");

    expect(assertion).toBeGreaterThan(-1);
    expect(endsAssertion).toBeGreaterThan(assertion);
    // Deferred calls run in reverse: unlock, then the hold an expiry waits for, then the assertion.
    expect(holds).toBeGreaterThan(endsAssertion);
    expect(releasesHold).toBeGreaterThan(holds);
    expect(opens).toBeGreaterThan(releasesHold);
    expect(unlocks).toBeGreaterThan(opens);
    // An expiry stops the wait and is checked again once the lock is held (Codex r1 on #524).
    expect(helper).toContain("stop: { assertion.isExpired }");
    expect(helper.indexOf("guard !assertion.isExpired else")).toBeGreaterThan(unlocks);
    expect(read(lockHelper)).toContain("flock(descriptor, LOCK_EX | LOCK_NB)");
    expect(read(lockHelper)).not.toMatch(/flock\(descriptor, LOCK_EX\)/);
  });

  it("installs the app's UIKit background task before React Native starts", () => {
    const appDelegate = read("ios/Dayframe/AppDelegate.swift");
    const install = appDelegate.indexOf("DayframeSharedFileLock.install(DayframeSharedFileLockBackgroundTask.begin)");

    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(appDelegate.indexOf("factory.startReactNative"));
    expect(appDelegate).toContain("guard granted != .invalid else");
    expect(appDelegate).toContain("beginBackgroundTask(withName: name) { assertion.expire() }");
  });

  it("does only file I/O while the shortcut queue's lock is held", () => {
    const storage = read("ios/Dayframe/DayframeSharedStorage.swift");
    const lockedBodies = closureBodies(storage, "withSharedQueueLock");

    expect(lockedBodies.length).toBeGreaterThanOrEqual(3);
    for (const body of lockedBodies) {
      expect(body).not.toMatch(/UserDefaults|clearLegacyEvents|legacyEvents\(\)|appendLegacy|removeLegacy/);
    }
  });

  it("reads the shortcut queue without the lock unless a legacy queue needs migrating", () => {
    const storage = read("ios/Dayframe/DayframeSharedStorage.swift");
    const pending = functionBody(storage, "static func pendingDictionaries()");

    expect(pending.indexOf("if !legacy.isEmpty")).toBeGreaterThan(-1);
    expect(pending.indexOf("if !legacy.isEmpty")).toBeLessThan(pending.indexOf("withSharedQueueLock"));
    expect(functionBody(storage, "private static func clearLegacyEvents()")).toContain(
      "guard UserDefaults.standard.object(forKey: legacyKey) != nil else { return }"
    );
  });

  it("never loads React Native's Settings module, which forwards every UserDefaults change to JS", () => {
    const sources = ["src", "app"]
      .flatMap((root) => readdirSync(`${mobileRoot}${root}`, { recursive: true }).map((name) => `${root}/${String(name)}`))
      .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path));
    const offenders = sources.filter((path) =>
      /import\s*\{[^}]*\bSettings\b[^}]*\}\s*from\s*"react-native"|NativeModules\.SettingsManager/.test(read(path))
    );

    expect(offenders).toEqual([]);
    expect(functionBody(read("ios/Dayframe/DayframeShortcuts.swift"), "static func set(_ value: String)")).toContain(
      "guard UserDefaults.standard.string(forKey: key) != value else { return }"
    );
  });

  it("keeps the app's SQLite databases out of the App Group container", () => {
    const scripts = readdirSync(`${mobileRoot}src/lib`, { recursive: true })
      .map(String)
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name));
    for (const name of scripts) {
      const source = readFileSync(`${mobileRoot}src/lib/${name}`, "utf8");
      expect(source, name).not.toMatch(/appleSharedContainers|forSecurityApplicationGroupIdentifier/);
    }
  });
});
