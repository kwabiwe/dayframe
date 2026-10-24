// Applies patches/ to node_modules after every install (patch-package). A patched package that is
// installed must take its patch, or the install fails (--error-on-fail); an install without the
// mobile workspace's native packages (a web-only install) has nothing to patch and says so.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const patches = existsSync(resolve(root, "patches")) ? readdirSync(resolve(root, "patches")).filter((name) => name.endsWith(".patch")) : [];
// "expo-location+56.0.23.patch" → "expo-location" (scoped packages use "@scope+name+version").
const packageOf = (file) => file.replace(/\+[^+]+\.patch$/, "").replace("+", "/");
const missing = patches.filter((file) => !existsSync(resolve(root, "node_modules", packageOf(file))));
if (missing.length === patches.length) {
  if (patches.length) console.log(`patch-package: skipped, none of ${patches.map(packageOf).join(", ")} is installed here.`);
} else {
  if (missing.length) console.log(`patch-package: ${missing.map(packageOf).join(", ")} not installed here; patching the rest.`);
  execFileSync("npx", ["--no-install", "patch-package", "--error-on-fail"], { cwd: root, stdio: "inherit" });
}
