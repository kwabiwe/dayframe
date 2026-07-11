import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

async function read(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

async function readBinary(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const paths = {
  symbol: "logos/dayframe-colour-logo-transparent.svg",
  outlined: "logos/dayframe-wordmark-outlined.svg",
  light: "logos/dayframe-wordmark-light.svg",
  dark: "logos/dayframe-wordmark-dark.svg"
};

const [symbol, outlined, light, dark] = await Promise.all(Object.values(paths).map(read));
const mobileBrand = await read("apps/mobile/src/components/brand/DayframeBrand.tsx");

assert(symbol.includes('viewBox="0 0 1024 1024"'), "Symbol viewBox changed");
assert((symbol.match(/<linearGradient\b/g) ?? []).length === 6, "Symbol must contain six gradients");
assert((symbol.match(/<stop\b/g) ?? []).length === 12, "Symbol must contain twelve gradient stops");
assert((symbol.match(/<rect\b/g) ?? []).length === 6, "Symbol must contain six geometric blocks");
assert(!symbol.includes('<rect width="1024" height="1024"'), "Transparent symbol gained a background");
assert(!/\bfilter=/.test(symbol), "Symbol must not use a filter");

for (const color of [
  "#DDE0E8", "#BFC3CF", "#7B3DFF", "#8B20F8", "#00CFA8", "#18E6BD",
  "#FF6249", "#FF4B33", "#FFB400", "#FFC62A", "#2388F5", "#3D96F6"
]) {
  assert(symbol.includes(`stop-color="${color}"`), `Symbol colour ${color} changed or is missing`);
}

assert(outlined.includes('viewBox="0 0 1091 243"'), "Wordmark viewBox changed");
assert((outlined.match(/<path\b/g) ?? []).length === 8, "Canonical wordmark must contain eight paths");
assert((outlined.match(/fill="#1D1E22"/g) ?? []).length === 1, "Canonical wordmark fill changed");
assert(!/<rect\b/.test(outlined), "Canonical wordmark gained a background");
assert(!/\bfilter=/.test(outlined), "Canonical wordmark must not use a filter");

assert(
  light === outlined.replace('fill="#1D1E22"', 'fill="#F7F8FB"'),
  "Light wordmark must differ from the canonical wordmark only by its #F7F8FB fill"
);
assert(
  dark === outlined.replace('fill="#1D1E22"', 'fill="#111827"'),
  "Dark wordmark must differ from the canonical wordmark only by its #111827 fill"
);

for (const [name, canonical] of Object.entries({ symbol, outlined, light, dark })) {
  const publicAsset = await read(`apps/web/public/logos/dayframe-${
    name === "symbol" ? "colour-logo-transparent" : `wordmark-${name}`
  }.svg`);
  assert(publicAsset === canonical, `Public ${name} asset does not match its root source`);
}

assert(await read("apps/web/public/favicon.svg") === symbol, "Favicon must use the canonical symbol geometry");

const canonicalPaths = [...outlined.matchAll(/<path d="([^"]+)" transform="([^"]+)"/g)]
  .map((match) => `${match[1]}|${match[2]}`);
const mobilePaths = [...mobileBrand.matchAll(/<Path d="([^"]+)" transform="([^"]+)"/g)]
  .map((match) => `${match[1]}|${match[2]}`);
assert(
  JSON.stringify(mobilePaths) === JSON.stringify(canonicalPaths),
  "Mobile wordmark paths or transforms drifted from the canonical SVG"
);
assert(mobileBrand.includes('viewBox="0 0 1024 1024"'), "Mobile symbol viewBox changed");
assert(mobileBrand.includes('viewBox="0 0 1091 243"'), "Mobile wordmark viewBox changed");
assert((mobileBrand.match(/<LinearGradient\b/g) ?? []).length === 6, "Mobile symbol must contain six gradients");
assert(
  (mobileBrand.match(/x1="0" y1="0" x2="1" y2="1"/g) ?? []).length === 6,
  "Mobile symbol gradient directions changed"
);
assert((mobileBrand.match(/<Rect\b/g) ?? []).length === 6, "Mobile symbol must contain six geometric blocks");
const canonicalGradients = [...symbol.matchAll(/<linearGradient id="([^"]+)" x1="0" y1="0" x2="1" y2="1">\s*<stop offset="0%" stop-color="([^"]+)"\/>\s*<stop offset="100%" stop-color="([^"]+)"\/>/g)]
  .map((match) => match.slice(1).join(","));
const mobileGradients = [...mobileBrand.matchAll(/<LinearGradient id="dayframe-([^"]+)" x1="0" y1="0" x2="1" y2="1">\s*<Stop offset="0" stopColor="([^"]+)" \/>\s*<Stop offset="1" stopColor="([^"]+)" \/>/g)]
  .map((match) => match.slice(1).join(","));
assert(
  JSON.stringify(mobileGradients) === JSON.stringify(canonicalGradients),
  "Mobile symbol gradient names, order, or colour pairings drifted from the canonical SVG"
);
const canonicalRects = [...symbol.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" rx="(\d+)" fill="url\(#([^\)]+)\)"/g)]
  .map((match) => match.slice(1).join(","));
const mobileRects = [...mobileBrand.matchAll(/<Rect x=\{(\d+)\} y=\{(\d+)\} width=\{(\d+)\} height=\{(\d+)\} rx=\{(\d+)\} fill="url\(#dayframe-([^\)]+)\)"/g)]
  .map((match) => match.slice(1).join(","));
assert(
  JSON.stringify(mobileRects) === JSON.stringify(canonicalRects),
  "Mobile symbol block geometry, order, or gradient assignment drifted from the canonical SVG"
);
for (const color of [
  "#DDE0E8", "#BFC3CF", "#7B3DFF", "#8B20F8", "#00CFA8", "#18E6BD",
  "#FF6249", "#FF4B33", "#FFB400", "#FFC62A", "#2388F5", "#3D96F6"
]) {
  assert(mobileBrand.includes(`stopColor="${color}"`), `Mobile symbol colour ${color} changed or is missing`);
}

const mobileIconPath = "apps/mobile/assets/dayframe_app_icon.png";
const nativeIconPath = "apps/mobile/ios/Dayframe/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png";
const [mobileIcon, nativeIcon] = await Promise.all([
  readBinary(mobileIconPath),
  readBinary(nativeIconPath)
]);
assert(mobileIcon.equals(nativeIcon), "Expo and native iOS app icons must match");
assert(
  mobileIcon.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
  "iOS app icon must be a PNG"
);
assert(
  mobileIcon.readUInt32BE(16) === 1024 && mobileIcon.readUInt32BE(20) === 1024,
  "iOS app icon must be 1024 by 1024 pixels"
);
assert(mobileIcon[24] === 8, "iOS app icon must use 8-bit colour");
assert(mobileIcon[25] === 2, "iOS app icon must be opaque RGB without an alpha channel");
assert(
  createHash("sha256").update(mobileIcon).digest("hex") ===
    "f6526ac99480105da6f63c03bad0831bfb7b3c4a6c61df910c7483017fb92a5b",
  "iOS app icon pixels changed; regenerate deliberately from the canonical symbol"
);

const mobileConfig = JSON.parse(await read("apps/mobile/app.json"));
assert(mobileConfig.expo?.ios?.icon === "./assets/dayframe_app_icon.png", "Expo iOS icon path changed");

console.log("Brand asset contract OK");
