import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { closuresAfter, codeOnly } from "./swiftSourceScan";

// Synchronous calls that must never run on a main-thread native path. The TestFlight 125 report showed
// the main thread blocked in a synchronous locationd XPC call: `DayframeLocationVisitService.status()`
// built a throwaway `CLLocationManager` and read its state on every durable-work refresh, and every
// CoreLocation callback rewrote the whole native signal journal on main (stability audit 22 Oct 2026,
// finding 11 and test gap 5). Location state comes from the long-lived manager's delegate callback;
// `locationServicesEnabled()` (which Apple documents as blocking) runs on a background queue; journal
// appends never wait for the store's queue.

const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(`${mobileRoot}${path}`, "utf8");
const visitServicePath = "modules/dayframe-location-visits/ios/DayframeLocationVisitService.swift";
const visitModulePath = "modules/dayframe-location-visits/ios/DayframeLocationVisitsModule.swift";
const signalStorePath = "modules/dayframe-location-visits/ios/DayframeLocationSignalStore.swift";

function swiftSources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "Tests" || name === "node_modules" ? [] : swiftSources(path);
    return name.endsWith(".swift") ? [path] : [];
  });
}

const sources = ["ios/Dayframe", "modules"]
  .flatMap((root) => swiftSources(`${mobileRoot}${root}`))
  .map((path) => ({ path: relative(mobileRoot, path), code: codeOnly(readFileSync(path, "utf8")) }));

/** Body of the first function declared as `func name(`. */
function functionBody(source: string, name: string) {
  const [body] = closuresAfter(source, new RegExp(`func ${name}\\([^{]*\\{`));
  if (!body) throw new Error(`func ${name} not found`);
  return body;
}

/** Bodies of closures handed to a non-main queue's `async`. */
function backgroundQueueClosures(source: string) {
  return closuresAfter(source, /\b[\w.]+\.async\s*\{/).filter((_, index) => {
    const receivers = [...codeOnly(source).matchAll(/\b([\w.]+)\.async\s*\{/g)].map((match) => match[1]!);
    return !/(^|\.)main$/.test(receivers[index]!);
  });
}

function occurrences(code: string, pattern: RegExp) {
  return [...code.matchAll(new RegExp(pattern, "g"))].length;
}

// Throwaway managers make a synchronous locationd round trip on whichever thread builds them. Only
// the listed, once-per-process paths may build one; each needs a reason.
const throwawayManagerAllowlist: Record<string, string> = {
  "modules/dayframe-tracking-notice/ios/DayframeTrackingNoticeService.swift":
    "applicationWillTerminate: once, as the process exits; never a refresh path"
};

describe("native main-thread blocking guard", () => {
  it("builds one long-lived CLLocationManager; no throwaway managers on refresh paths", () => {
    const builders = sources.filter(({ code }) => /\bCLLocationManager\(\)/.test(code));
    const visitService = codeOnly(read(visitServicePath));
    expect(occurrences(visitService, /\bCLLocationManager\(\)/)).toBe(1);
    expect(functionBody(read(visitServicePath), "configuredManager")).toMatch(/\bCLLocationManager\(\)/);
    expect(builders.map(({ path }) => path).filter((path) => path !== visitServicePath && !throwawayManagerAllowlist[path]))
      .toEqual([]);
  });

  it("asks CLLocationManager.locationServicesEnabled() only on a background queue", () => {
    const offenders = sources.filter(({ code }) => {
      const calls = occurrences(code, /\.locationServicesEnabled\(\)/);
      const backgrounded = backgroundQueueClosures(code).reduce(
        (total, body) => total + occurrences(body, /\.locationServicesEnabled\(\)/), 0
      );
      return calls !== backgrounded;
    });
    expect(offenders.map(({ path }) => path)).toEqual([]);
  });

  it("reads authorisation and accuracy only inside the delegate callback", () => {
    const source = read(visitServicePath);
    const reads = /\.(authorizationStatus|accuracyAuthorization)\b/;
    const callback = functionBody(source, "locationManagerDidChangeAuthorization");
    expect(occurrences(codeOnly(source), reads)).toBe(occurrences(callback, reads));
    expect(occurrences(callback, reads)).toBe(2);
  });

  it("answers status() from cached state, without locationd or the journal", () => {
    const status = functionBody(read(visitServicePath), "status");
    for (const banned of [
      /\bCLLocationManager\b/, /\bmanager\??\./, /\.locationServicesEnabled\(\)/,
      /significantLocationChangeMonitoringAvailable/, /DayframeLocationSignalStore/, /\.sync\b/
    ]) {
      expect(status, String(banned)).not.toMatch(banned);
    }
  });

  it("only appends to the journal from the main actor", () => {
    const visitService = codeOnly(read(visitServicePath));
    const storeCalls = [...visitService.matchAll(/DayframeLocationSignalStore\.shared\.(\w+)/g)].map((match) => match[1]);
    expect(storeCalls).toEqual(["append"]);
    // The module reads the journal in its own (non-main-actor) async closures, never on the main actor.
    expect(codeOnly(read(visitModulePath))).not.toMatch(/MainActor|requiresMainActor|DispatchQueue\.main/);
  });

  it("appends a journal record without waiting for the store or rewriting the journal", () => {
    const source = read(signalStorePath);
    const append = functionBody(source, "append");
    expect(append).toMatch(/\bqueue\.async\s*\{/);
    expect(append).not.toMatch(/\.sync\b|persistUnlocked|\.atomic|Data\(contentsOf/);
    const appendUnlocked = functionBody(source, "appendUnlocked");
    expect(appendUnlocked).toMatch(/seekToEnd\(\)/);
    // A full rewrite on append happens only to compact an expired journal or a passed cap.
    expect(occurrences(appendUnlocked, /persistUnlocked\(/)).toBe(2);
    expect(appendUnlocked).toMatch(/if expiredOldestRecordUnlocked\(\) \{\s*persistUnlocked/);
  });
});
