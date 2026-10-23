import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { closuresAfter, codeOnly } from "./swiftSourceScan";

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
      'let _ = "\\("}")"', 'let _ = "a \\(f("\\(")")")) b }"', 'let _ = #"\\#("}")"#',
      // Extended regex literals (Codex r4 on #530).
      "let _ = #/}/#", "let _ = ##/ } /# } /##"
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
