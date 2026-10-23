#!/usr/bin/env node
// Builds Dayframe's single icon geometry from lucide-react (ISC) plus Dayframe-drawn glyphs.
//
//   node scripts/generate-icons.mjs          write packages/shared/src/iconGlyphs.ts, the iOS tab-bar PNGs and the native Calendar glyph PNGs
//   node scripts/generate-icons.mjs --check  fail if either is stale (no rendering needed)
//
// Add a glyph by listing it in GLYPHS (or CUSTOM_GLYPHS) and re-running the script.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "apps/web/package.json"));
const lucideDir = join(dirname(require.resolve("lucide-react/package.json")), "dist/esm/icons");
const lucideVersion = JSON.parse(readFileSync(require.resolve("lucide-react/package.json"), "utf8")).version;
const registryPath = join(root, "packages/shared/src/iconGlyphs.ts");
const tabIconDir = join(root, "apps/mobile/assets/tab-icons");
const tabManifestPath = join(tabIconDir, "manifest.json");

// Lucide glyphs used anywhere in Dayframe: activities, navigation, actions, sources and sync state.
const GLYPHS = [
  "arrow-left", "baby", "bell", "bike", "book-open", "brain", "briefcase", "building-2", "bus", "calendar-days", "camera",
  "car", "chart-column", "check", "chef-hat", "chevron-right", "circle-dot", "circle-user-round", "cloud-alert", "cloud-check",
  "cloud-off", "code-xml", "coffee", "download", "dumbbell", "ellipsis", "flame", "flower-2", "folder", "footprints", "funnel", "gamepad-2",
  "git-merge", "graduation-cap", "guitar", "hand-heart", "heart", "heart-pulse", "house", "inbox", "languages",
  "laptop", "library", "list", "list-checks", "log-out", "mail", "map-pin", "message-circle", "minus", "moon", "mountain", "music", "palette",
  "party-popper", "paw-print", "pen-line", "pencil", "person-standing", "phone", "pill", "pin", "plane", "play",
  "plus", "presentation", "refresh-cw", "rotate-ccw", "route", "scissors", "search", "settings", "ship", "shirt", "shopping-bag",
  "shield", "shopping-cart", "sprout", "square", "stethoscope", "sun", "tag", "tent", "timer", "train-front", "trash-2", "tv",
  "undo-2", "user-round", "users", "utensils", "wallet", "wrench", "x", "zap"
];

// Dayframe-drawn glyphs on Lucide's grid: 24 x 24, 2-point round strokes, outline only.
const CUSTOM_GLYPHS = {
  // Lucide has no swimmer. Head, reaching arm and body over the wave from Lucide's water icons.
  swimmer: [
    ["circle", { cx: "18", cy: "10", r: "1" }],
    ["path", { d: "M3 13.5c2.5-1 4.5-1.5 7-1l5-1.5" }],
    ["path", { d: "M8 12.5c0-3.5 2-6 5.5-6.5" }],
    ["path", { d: "M2 18q2.5 2 5 0t5 0 5 0 5 0" }]
  ]
};

// Native iOS tab bar icons, rendered as template images so UIKit tints them inside Liquid Glass.
const TAB_ICONS = { today: "sun", calendar: "calendar-days", reports: "chart-column", orb: "play" };
const TAB_POINTS = 26;

// Native Calendar glyphs (SwiftUI module), template images at the registry's 24-point grid, bundled
// with the DayframeCalendar pod and tinted by SwiftUI. Swift scales them to the text they sit beside.
const calendarGlyphDir = join(root, "apps/mobile/modules/dayframe-calendar/ios/Glyphs");
const calendarManifestPath = join(calendarGlyphDir, "manifest.json");
// Every activity glyph too (location v4 C6): a Calendar column under 34 points wide shows its
// activity's icon alone. Read from the shared registry so a new activity icon is never missed.
const activityIconsSource = readFileSync(join(root, "packages/shared/src/icons.ts"), "utf8");
const ACTIVITY_GLYPHS = [...new Set([
  ...[...activityIconsSource.matchAll(/glyph: "([a-z0-9-]+)"/g)].map((match) => match[1]),
  ...[...activityIconsSource.matchAll(/DAYFRAME_ACTIVITY_ICON_FALLBACK_GLYPH\b[^=]*= "([a-z0-9-]+)"/g)].map((match) => match[1])
])].sort();
const CALENDAR_ICONS = {
  place: "map-pin",
  tag: "tag",
  "zoom-in": "plus",
  "zoom-out": "minus",
  ...Object.fromEntries(ACTIVITY_GLYPHS.map((glyph) => [`activity-${glyph}`, glyph]))
};
const CALENDAR_POINTS = 24;

async function lucideNodes(name) {
  const file = join(lucideDir, `${name}.mjs`);
  if (!existsSync(file)) throw new Error(`lucide-react ${lucideVersion} has no icon "${name}" (renamed or removed?)`);
  // Each icon module exports its node list; alias modules (for example home -> house) re-export
  // only the component, so they are rejected rather than silently followed.
  const { __iconNode } = await import(pathToFileURL(file).href);
  if (!Array.isArray(__iconNode)) throw new Error(`lucide-react "${name}" is an alias; list the canonical icon name instead`);
  return __iconNode.map(([tag, attrs]) => {
    const { key: _key, ...rest } = attrs;
    return [tag, rest];
  });
}

// Code-unit order, so the output never depends on the machine's locale.
const byCodeUnit = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

async function buildGlyphs() {
  const glyphs = {};
  for (const name of GLYPHS) glyphs[name] = await lucideNodes(name);
  for (const [name, nodes] of Object.entries(CUSTOM_GLYPHS)) {
    if (glyphs[name]) throw new Error(`Custom glyph "${name}" collides with a Lucide glyph`);
    glyphs[name] = nodes;
  }
  return Object.fromEntries(Object.entries(glyphs).sort(byCodeUnit));
}

function registrySource(glyphs) {
  const body = Object.entries(glyphs)
    .map(([name, nodes]) => `  ${JSON.stringify(name)}: ${JSON.stringify(nodes)}`)
    .join(",\n");
  const licence = readFileSync(join(dirname(lucideDir), "../../LICENSE"), "utf8").trim();
  if (licence.includes("*/")) throw new Error("lucide-react LICENSE contains */ and cannot be embedded in a block comment");
  const notice = licence.split("\n").map((line) => ` * ${line}`.trimEnd()).join("\n");
  return `// Generated by scripts/generate-icons.mjs from lucide-react ${lucideVersion} (https://lucide.dev)
// plus Dayframe-drawn glyphs in the same geometry. Do not edit by hand.

/*
 * Glyph geometry copied from lucide-react is distributed under the notices below.
 *
${notice}
 */

export type DayframeGlyphElement = "circle" | "ellipse" | "line" | "path" | "polygon" | "polyline" | "rect";
export type DayframeGlyphNode = readonly [DayframeGlyphElement, Readonly<Record<string, string>>];

export const DAYFRAME_GLYPHS = {
${body}
} as const satisfies Record<string, readonly DayframeGlyphNode[]>;

export type DayframeGlyph = keyof typeof DAYFRAME_GLYPHS;
`;
}

function glyphSvg(nodes, { size, padding = 0, color = "#000000" }) {
  const box = 24 + padding * 2;
  const children = nodes
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(" ")}/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-padding} ${-padding} ${box} ${box}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
}

function tabSvg(glyphs, glyph, size) {
  return glyphSvg(glyphs[glyph], { size, padding: (TAB_POINTS - 24) / 2 });
}

function calendarSvg(glyphs, glyph, size) {
  return glyphSvg(glyphs[glyph], { size });
}

// One icon family of template PNGs: icons maps file stem -> glyph, svgFor(glyphs, glyph, pixels).
const ICON_SETS = [
  { label: "tab icon", dir: tabIconDir, manifestPath: tabManifestPath, icons: TAB_ICONS, points: TAB_POINTS, svgFor: tabSvg },
  {
    label: "Calendar glyph",
    dir: calendarGlyphDir,
    manifestPath: calendarManifestPath,
    icons: CALENDAR_ICONS,
    points: CALENDAR_POINTS,
    svgFor: calendarSvg
  }
];

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const TAB_SCALES = [["", 1], ["@2x", 2], ["@3x", 3]];

// The manifest records the SVG each image comes from and the bytes of every PNG, so --check can
// catch a glyph change that was not regenerated and images that were not committed.
async function renderIconSet(glyphs, set) {
  let sharp;
  try {
    // sharp arrives with Next.js; it is only needed to write images, never for --check.
    sharp = require("sharp");
  } catch {
    throw new Error("Rendering icons needs sharp. Run npm ci (with optional dependencies) and retry.");
  }
  const manifest = {};
  const files = {};
  for (const [name, glyph] of Object.entries(set.icons)) {
    const images = {};
    for (const [suffix, scale] of TAB_SCALES) {
      const png = await sharp(Buffer.from(set.svgFor(glyphs, glyph, set.points * scale))).png().toBuffer();
      files[`${name}${suffix}.png`] = png;
      images[`${name}${suffix}.png`] = sha256(png);
    }
    manifest[name] = { glyph, points: set.points, svgSha256: sha256(set.svgFor(glyphs, glyph, set.points)), images };
  }
  return { manifest, files };
}

const glyphs = await buildGlyphs();
const registry = registrySource(glyphs);

if (process.argv.includes("--check")) {
  const problems = [];
  if (!existsSync(registryPath) || readFileSync(registryPath, "utf8") !== registry) {
    problems.push("packages/shared/src/iconGlyphs.ts is stale");
  }
  for (const set of ICON_SETS) {
    const manifest = existsSync(set.manifestPath) ? JSON.parse(readFileSync(set.manifestPath, "utf8")) : {};
    for (const [name, glyph] of Object.entries(set.icons)) {
      const entry = manifest[name];
      if (!entry || entry.glyph !== glyph || entry.svgSha256 !== sha256(set.svgFor(glyphs, glyph, set.points))) {
        problems.push(`${set.label} "${name}" does not match the ${glyph} glyph`);
        continue;
      }
      for (const [suffix] of TAB_SCALES) {
        const file = `${name}${suffix}.png`;
        const path = join(set.dir, file);
        if (!existsSync(path)) problems.push(`missing ${set.label} ${file}`);
        else if (sha256(readFileSync(path)) !== entry.images?.[file]) problems.push(`${set.label} ${file} differs from the generated image`);
      }
    }
  }
  if (problems.length) {
    console.error(`${problems.join("\n")}\nRun: npm run generate:icons`);
    process.exit(1);
  }
  console.log(`Icon registry, tab icons and Calendar glyphs are current (${Object.keys(glyphs).length} glyphs).`);
} else {
  writeFileSync(registryPath, registry);
  for (const set of ICON_SETS) {
    const { manifest, files } = await renderIconSet(glyphs, set);
    mkdirSync(set.dir, { recursive: true });
    for (const [name, png] of Object.entries(files)) writeFileSync(join(set.dir, name), png);
    writeFileSync(set.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  console.log(`Wrote ${Object.keys(glyphs).length} glyphs, ${Object.keys(TAB_ICONS).length} tab icons and ${Object.keys(CALENDAR_ICONS).length} Calendar glyphs.`);
}
