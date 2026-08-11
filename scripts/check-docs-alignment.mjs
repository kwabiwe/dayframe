import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const markdownFiles = [
  resolve(root, "README.md"),
  resolve(root, "AGENTS.md"),
  ...walkMarkdown(resolve(root, "docs")),
  ...walkMarkdown(resolve(root, ".codex/reference"))
];

for (const file of markdownFiles) {
  checkMarkdownLinks(file);
  checkDocumentedScripts(file);
  checkMigrationReferences(file);
}

const requiredCanonicalFiles = [
  "docs/PRD.md",
  "docs/architecture.md",
  "docs/feature-fix-tracker.md",
  "docs/documentation-governance.md",
  "docs/brand-style-guide.md",
  "docs/dayframe-regression-checklist.md",
  "docs/vercel-supabase-hosting.md",
  ".codex/reference/validation-matrix.md",
  ".codex/reference/release-and-testflight.md"
];

for (const file of requiredCanonicalFiles) {
  if (!existsSync(resolve(root, file))) errors.push(`Missing canonical document: ${file}`);
}

const stableSnapshotFiles = [
  "README.md",
  "AGENTS.md",
  "docs/PRD.md",
  "docs/architecture.md",
  "docs/documentation-governance.md",
  "docs/production-readiness.md",
  ...readdirSync(resolve(root, ".codex/reference"))
    .filter((name) => name.endsWith(".md") && name !== "release-and-testflight.md")
    .map((name) => `.codex/reference/${name}`)
];

const staleSnapshotPatterns = [
  /Current reality as of/i,
  /Current state as of internal TestFlight/i,
  /Latest verified build/i,
  /all 12 colou?r choices/i,
  /Calendar drag(?:\/drop| and resize).*not implemented/i,
  /Review split\/merge.*not fully implemented/i
];

for (const file of stableSnapshotFiles) {
  const text = readFileSync(resolve(root, file), "utf8");
  for (const pattern of staleSnapshotPatterns) {
    if (pattern.test(text)) errors.push(`${file}: stale snapshot/contract phrase matches ${pattern}`);
  }
}

const hostedEnvironmentKeys = [
  "DATABASE_URL",
  "DAYFRAME_AUTH_MODE",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "DAYFRAME_ALLOWED_SIGNUP_EMAILS",
  "DAYFRAME_SIGNUPS_ENABLED",
  "DAYFRAME_SESSION_TTL_SECONDS",
  "NEXT_PUBLIC_DAYFRAME_DEPLOYMENT_ENV",
  "GEOAPIFY_API_KEY",
  "DAYFRAME_LOCATION_ROLLOUT_MODE",
  "CRON_SECRET",
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "APNS_PRIVATE_KEY",
  "APNS_BUNDLE_ID"
];

for (const file of [".env.example", "apps/web/.env.example"]) {
  const text = readFileSync(resolve(root, file), "utf8");
  for (const key of hostedEnvironmentKeys) {
    if (!new RegExp(`^\\s*#?\\s*${key}=`, "m").test(text)) {
      errors.push(`${file}: missing hosted environment key ${key}`);
    }
  }
}

const hostingGuide = readFileSync(resolve(root, "docs/vercel-supabase-hosting.md"), "utf8");
for (const key of hostedEnvironmentKeys) {
  if (!hostingGuide.includes(key)) {
    errors.push(`docs/vercel-supabase-hosting.md: missing hosted environment key ${key}`);
  }
}

if (errors.length > 0) {
  console.error("Documentation alignment check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Documentation alignment check passed (${markdownFiles.length} Markdown files).`);

function walkMarkdown(directory) {
  const result = [];
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name);
    const stats = statSync(path);
    if (stats.isDirectory()) result.push(...walkMarkdown(path));
    else if (name.endsWith(".md")) result.push(path);
  }
  return result;
}

function checkMarkdownLinks(file) {
  const text = readFileSync(file, "utf8");
  const pattern = /!?\[[^\]]*\]\(([^)\n]+)\)/g;
  for (const match of text.matchAll(pattern)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    else target = target.split(/\s+(?=["'])/, 1)[0];
    if (/^(?:https?:|mailto:|data:|app:|#)/i.test(target)) continue;
    const localTarget = decodeURIComponent(target.split("#", 1)[0]);
    if (!localTarget) continue;
    const resolvedTarget = resolve(dirname(file), localTarget);
    if (!existsSync(resolvedTarget)) {
      errors.push(`${display(file)}: broken local link ${target}`);
    }
  }
}

function checkDocumentedScripts(file) {
  const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const availableScripts = new Set(Object.keys(rootPackage.scripts ?? {}));
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) {
    if (!availableScripts.has(match[1])) {
      errors.push(`${display(file)}: documents missing root npm script ${match[1]}`);
    }
  }
}

function checkMigrationReferences(file) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/`((?:supabase|packages\/db)\/migrations\/[^`]+\.sql)`/g)) {
    if (!existsSync(resolve(root, match[1]))) {
      errors.push(`${display(file)}: references missing migration ${match[1]}`);
    }
  }
}

function display(file) {
  return relative(root, file);
}
