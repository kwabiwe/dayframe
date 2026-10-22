import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// iOS kills an app whose background task outlives its allowance. UIKit calls a background task's
// expiration handler on the main thread and needs the task ended before the handler returns; a
// BGTask's handler must complete it promptly. A hop to a later main-actor turn or queue tick let a
// busy main thread overrun the assertion (stability audit 22 Oct 2026, iphone-native-1).

const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));

function swiftSources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "Tests" || name === "node_modules" ? [] : swiftSources(path);
    return name.endsWith(".swift") ? [path] : [];
  });
}

/**
 * Swift source with comments and string literals blanked to spaces (positions kept), so a brace or a
 * hop inside either never changes which closure is checked (Codex r1 on #530).
 */
export function codeOnly(source: string) {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index, index + 3);
    if (rest.startsWith("//")) {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      out += " ".repeat(stop - index);
      index = stop;
    } else if (rest.startsWith("/*")) {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(index, stop).replace(/[^\n]/g, " ");
      index = stop;
    } else if (rest === '"""' || source[index] === '"') {
      const quote = rest === '"""' ? '"""' : '"';
      let cursor = index + quote.length;
      while (cursor < source.length && !source.startsWith(quote, cursor)) cursor += source[cursor] === "\\" ? 2 : 1;
      const stop = Math.min(source.length, cursor + quote.length);
      out += source.slice(index, stop).replace(/[^\n]/g, " ");
      index = stop;
    } else {
      out += source[index];
      index += 1;
    }
  }
  return out;
}

/** Each closure that follows `marker`, found by matching braces in code only. */
function closuresAfter(original: string, marker: RegExp) {
  const source = codeOnly(original);
  const bodies: string[] = [];
  for (const match of source.matchAll(new RegExp(marker, "g"))) {
    const open = source.indexOf("{", match.index! + match[0].length - 1);
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

describe("expiry handler scanning", () => {
  it("ignores braces and hops inside comments and strings", () => {
    const tricky = [
      "beginBackgroundTask(withName: \"a } b\") {",
      "  // }",
      "  /* } */ Task { @MainActor in expire() }",
      "}"
    ].join("\n");
    const [body] = closuresAfter(tricky, /beginBackgroundTask\(/);
    expect(body).toContain("Task {");
    expect(codeOnly('let x = "Task { }" // DispatchQueue.main.async')).not.toMatch(/Task|DispatchQueue/);
  });
});

describe("background task expiry handlers", () => {
  const files = ["ios/Dayframe", "modules"].flatMap((root) => swiftSources(`${mobileRoot}${root}`));
  const deferred = /\bTask\s*(\(|\{)|DispatchQueue\.main\.async|\.asyncAfter\(|await\b/;

  it("end a UIKit background task before the expiration handler returns", () => {
    const handlers = files.flatMap((path) =>
      closuresAfter(readFileSync(path, "utf8"), /beginBackgroundTask\(/)
        .map((body) => ({ path: relative(mobileRoot, path), body }))
    );

    expect(handlers.length).toBeGreaterThanOrEqual(2);
    expect(handlers.filter((handler) => deferred.test(handler.body))).toEqual([]);
  });

  it("complete a BGTask inside its expiration handler", () => {
    const handlers = files.flatMap((path) =>
      closuresAfter(readFileSync(path, "utf8"), /\.expirationHandler\s*=\s*\{/)
        .map((body) => ({ path: relative(mobileRoot, path), body }))
    );

    expect(handlers.length).toBeGreaterThanOrEqual(1);
    expect(handlers.filter((handler) => deferred.test(handler.body))).toEqual([]);
  });
});
