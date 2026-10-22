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
  type Context =
    | { kind: "code"; interpolation: boolean; depth: number }
    | { kind: "string"; quote: string; hashes: string };
  const stack: Context[] = [{ kind: "code", interpolation: false, depth: 0 }];
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  let out = "";
  let index = 0;
  while (index < source.length) {
    const top = stack[stack.length - 1]!;
    if (top.kind === "string") {
      // Inside a literal: `\(` (or `\#(` in a raw string) opens interpolated code, an escape covers the
      // next character, the matching quote and #s close it; everything else is blanked.
      const escape = "\\" + top.hashes;
      if (source.startsWith(escape + "(", index)) {
        out += blank(escape + "(");
        index += escape.length + 1;
        stack.push({ kind: "code", interpolation: true, depth: 0 });
      } else if (source.startsWith(escape, index)) {
        out += blank(source.slice(index, index + escape.length + 1));
        index += escape.length + 1;
      } else if (source.startsWith(top.quote + top.hashes, index)) {
        out += blank(top.quote + top.hashes);
        index += top.quote.length + top.hashes.length;
        stack.pop();
      } else {
        out += blank(source[index]!);
        index += 1;
      }
      continue;
    }
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      out += blank(source.slice(index, stop));
      index = stop;
      continue;
    }
    if (source.startsWith("/*", index)) {
      // Swift block comments nest.
      let depth = 0;
      let cursor = index;
      while (cursor < source.length) {
        if (source.startsWith("/*", cursor)) { depth += 1; cursor += 2; continue; }
        if (source.startsWith("*/", cursor)) { depth -= 1; cursor += 2; if (depth === 0) break; continue; }
        cursor += 1;
      }
      out += blank(source.slice(index, cursor));
      index = cursor;
      continue;
    }
    const literal = /^(#*)("""|")/.exec(source.slice(index, index + 64));
    if (literal) {
      out += blank(literal[0]);
      index += literal[0].length;
      stack.push({ kind: "string", quote: literal[2]!, hashes: literal[1]! });
      continue;
    }
    if (top.interpolation && source[index] === "(") top.depth += 1;
    if (top.interpolation && source[index] === ")") {
      if (top.depth === 0) {
        // The interpolation ends: back inside its string.
        out += " ";
        index += 1;
        stack.pop();
        continue;
      }
      top.depth -= 1;
    }
    out += source[index];
    index += 1;
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
    // Nested block comments and raw strings (Codex r2 on #530).
    for (const decoy of [
      "/* outer /* inner */ } */", 'let _ = #"" } ""#', 'let _ = #"\\" } "#', 'let _ = ##"""\n } "\n"""##',
      // Interpolation with a nested literal (Codex r3 on #530), and one nested twice.
      'let _ = "\\("}")"', 'let _ = "a \\(f("\\(")")")) b }"', 'let _ = #"\\#("}")"#'
    ]) {
      const [handler] = closuresAfter(`beginBackgroundTask(withName: "a") {\n  ${decoy}\n  DispatchQueue.main.async { end() }\n}`, /beginBackgroundTask\(/);
      expect(handler, decoy).toContain("DispatchQueue.main.async");
    }
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
