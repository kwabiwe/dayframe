// Applies patches/ to node_modules after every install (patch-package). A patched package that is
// installed must take its patch, or the install fails (--error-on-fail). Patches for packages this
// install does not have (a web-only install has no mobile native packages) are left out, never failed.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const patchDir = resolve(root, "patches");
const patches = existsSync(patchDir) ? readdirSync(patchDir).filter((name) => name.endsWith(".patch")) : [];
// "expo-location+56.0.23.patch" → "expo-location"; "@scope+name+1.0.0.patch" → "@scope/name".
const packageOf = (file) => file.replace(/\+[^+]+\.patch$/, "").replace("+", "/");
const present = patches.filter((file) => existsSync(resolve(root, "node_modules", packageOf(file))));
const absent = patches.filter((file) => !present.includes(file));
if (absent.length) console.log(`patch-package: ${absent.map(packageOf).join(", ")} not installed here; left unpatched.`);
if (present.length) {
  let dir = patchDir;
  if (absent.length) {
    // Only the patches whose packages are installed, from a scratch directory under node_modules.
    dir = resolve(root, "node_modules/.cache/dayframe-patches");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const file of present) copyFileSync(resolve(patchDir, file), resolve(dir, file));
  }
  execFileSync("npx", ["--no-install", "patch-package", "--error-on-fail", "--patch-dir", relative(root, dir)], { cwd: root, stdio: "inherit" });
}
