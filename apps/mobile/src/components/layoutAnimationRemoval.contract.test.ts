import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// LayoutAnimation is inert in this app (Reanimated 4 replaces the UIManager animation delegate;
// .codex/reference/motion.md). Nothing may rely on it; Reanimated layout/entering/exiting own motion.
describe("no inert LayoutAnimation", () => {
  it("has no LayoutAnimation, Keyboard.scheduleLayoutAnimation or scheduleLayoutTransition in app code", () => {
    const forbidden = [
      /\bLayoutAnimation\.(configureNext|create|Presets|Types|Properties|easeInEaseOut|linear|spring|setEnabled)\b/,
      /\bscheduleLayoutAnimation\(/,
      /\bscheduleLayoutTransition\(/,
      /import\s*\{[^}]*\bLayoutAnimation\b[^}]*\}\s*from\s*["']react-native["']/,
    ];
    const offenders = ["app", "src", "modules", "scripts"]
      .flatMap((folder) => sources(join(mobileRoot, folder)))
      .filter((path) => {
        // Comments may name the API; only code that uses it is forbidden.
        const code = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
        return forbidden.some((pattern) => pattern.test(code));
      });
    expect(offenders).toEqual([]);
  });

  it("gives the Sync troubleshooting disclosure the shared Reanimated presence", () => {
    const settings = readFileSync(join(mobileRoot, "app/settings.tsx"), "utf8");
    expect(settings).toMatch(/\{showQueueDetails \? \(\s*<Reanimated\.View\s+entering=\{localPresenceEntering\(reduceMotion\)\}\s+exiting=\{localPresenceExiting\(reduceMotion\)\}\s+layout=\{localLayoutTransition\(reduceMotion\)\}\s+style=\{styles\.queueDiagnosticCard\}/);
  });
});
