#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iosDir = join(repoRoot, "apps/mobile/ios");
const xcodebuildPath = "/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild";
const bundleId = process.env.DAYFRAME_IOS_BUNDLE_ID ?? "com.layereight.dayframe";
const teamId = process.env.DAYFRAME_APPLE_TEAM_ID ?? "65M773ZG6M";
const ascEnvPath =
  process.env.DAYFRAME_ASC_ENV ?? join(repoRoot, ".codex-dayframe-qa/testflight/appstoreconnect/appstoreconnect.env");

const issues = [];
const warnings = [];

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });
  } catch (error) {
    return error.stdout?.toString() ?? "";
  }
}

function pass(message) {
  console.log(`OK  ${message}`);
}

function fail(message, detail) {
  issues.push(detail ? `${message}: ${detail}` : message);
  console.log(`ERR ${message}`);
  if (detail) console.log(`    ${detail}`);
}

function warn(message) {
  warnings.push(message);
  console.log(`WARN ${message}`);
}

function plistValue(plistPath, keyPath) {
  try {
    return execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print ${keyPath}`, plistPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

const buildSettingsCache = new Map();

function xcodeBuildSettings(target, configuration = "Release") {
  const cacheKey = `${target}:${configuration}`;
  if (buildSettingsCache.has(cacheKey)) return buildSettingsCache.get(cacheKey);
  const settings = {};
  const output = run(xcodebuildPath, [
    "-project",
    join(iosDir, "Dayframe.xcodeproj"),
    "-target",
    target,
    "-configuration",
    configuration,
    "-showBuildSettings"
  ]);
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) settings[match[1]] = match[2].trim();
  }
  buildSettingsCache.set(cacheKey, settings);
  return settings;
}

function resolveBuildSettingTokens(value, target) {
  if (!value) return value;
  const settings = xcodeBuildSettings(target);
  return value.replace(/\$\(([^)]+)\)/g, (token, key) => settings[key] ?? token);
}

function parseEnvFile(path) {
  if (!existsSync(path)) return null;
  const env = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function decodeProvisioningProfile(profilePath) {
  const tempDir = mkdtempSync(join(tmpdir(), "dayframe-profile-"));
  const plistPath = join(tempDir, "profile.plist");
  try {
    const decoded = execFileSync("security", ["cms", "-D", "-i", profilePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    execFileSync("/usr/bin/plutil", ["-convert", "xml1", "-o", plistPath, "-"], {
      input: decoded,
      stdio: ["pipe", "ignore", "ignore"]
    });
    const hasDevices = plistValue(plistPath, ":ProvisionedDevices:0") !== null;
    return {
      name: plistValue(plistPath, ":Name"),
      uuid: plistValue(plistPath, ":UUID"),
      team: plistValue(plistPath, ":TeamIdentifier:0"),
      applicationIdentifier: plistValue(plistPath, ":Entitlements:application-identifier"),
      getTaskAllow: plistValue(plistPath, ":Entitlements:get-task-allow"),
      hasDevices,
      expirationDate: plistValue(plistPath, ":ExpirationDate")
    };
  } catch {
    return null;
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function findProvisioningProfiles() {
  const dirs = [
    join(process.env.HOME ?? "", "Library/Developer/Xcode/UserData/Provisioning Profiles"),
    join(process.env.HOME ?? "", "Library/MobileDevice/Provisioning Profiles")
  ];
  const profiles = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const listing = run("/usr/bin/find", [dir, "-maxdepth", "1", "-type", "f", "-name", "*.mobileprovision"]);
    for (const filePath of listing.split(/\r?\n/).filter(Boolean)) {
      const profile = decodeProvisioningProfile(filePath);
      if (profile) profiles.push({ path: filePath, ...profile });
    }
  }
  return profiles;
}

console.log("Dayframe TestFlight preflight");
console.log(`Bundle: ${bundleId}`);
console.log(`Team:   ${teamId}`);
console.log("");

if (existsSync(xcodebuildPath)) {
  const version = run(xcodebuildPath, ["-version"])
    .split(/\r?\n/)
    .filter(Boolean)
    .join(", ");
  pass(`Xcode installed (${version})`);
} else {
  fail("Xcode is not installed at /Applications/Xcode.app");
}

const activeDeveloperDir = run("/usr/bin/xcode-select", ["-p"]).trim();
if (activeDeveloperDir === "/Applications/Xcode.app/Contents/Developer") {
  pass("xcode-select points at full Xcode");
} else {
  warn(`xcode-select points at ${activeDeveloperDir || "unknown"}; release commands should set DEVELOPER_DIR to Xcode`);
}

const infoPlist = join(iosDir, "Dayframe/Info.plist");
const version = resolveBuildSettingTokens(plistValue(infoPlist, ":CFBundleShortVersionString"), "Dayframe");
const build = resolveBuildSettingTokens(plistValue(infoPlist, ":CFBundleVersion"), "Dayframe");
if (version && build) pass(`iOS bundle version is ${version} (${build})`);
else fail("Unable to read iOS bundle version/build", infoPlist);

const podfileLock = join(iosDir, "Podfile.lock");
const manifestLock = join(iosDir, "Pods/Manifest.lock");
if (!existsSync(podfileLock) || !existsSync(manifestLock)) {
  fail("CocoaPods lock files are missing", "Run pod install from apps/mobile/ios before archiving.");
} else {
  const diff = run("/usr/bin/diff", ["-q", podfileLock, manifestLock]);
  if (diff.trim()) fail("CocoaPods sandbox is out of sync", "Run pod install from apps/mobile/ios, then restore checksum-only churn if it is local noise.");
  else pass("CocoaPods sandbox matches Podfile.lock");
}

const identities = run("security", ["find-identity", "-v", "-p", "codesigning"]);
if (/(Apple Distribution|iPhone Distribution):/.test(identities)) {
  pass("Apple Distribution signing identity is installed in Keychain");
} else {
  fail(
    "Apple Distribution signing identity is missing",
    "Install an Apple Distribution certificate/private key for the Dayframe team in the login keychain. App Store provisioning profiles alone are not enough."
  );
}

const appStoreProfile = findProvisioningProfiles().find(
  (profile) =>
    profile.team === teamId &&
    profile.applicationIdentifier === `${teamId}.${bundleId}` &&
    profile.getTaskAllow === "false" &&
    !profile.hasDevices
);
if (appStoreProfile) {
  pass(`Dayframe App Store provisioning profile is installed (${appStoreProfile.name}, expires ${appStoreProfile.expirationDate})`);
} else {
  fail(
    "Dayframe App Store provisioning profile is missing",
    `Expected a non-development profile for ${teamId}.${bundleId}. Use Xcode Download Manual Profiles or Developer portal profiles.`
  );
}

const ascEnv = parseEnvFile(ascEnvPath);
if (!ascEnv) {
  fail("App Store Connect API env file is missing", ascEnvPath);
} else {
  const requiredKeys = ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_PATH"];
  const missing = requiredKeys.filter((key) => !ascEnv[key]);
  if (missing.length) {
    fail("App Store Connect API env file is incomplete", `Missing ${missing.join(", ")}`);
  } else {
    const keyPath = resolve(repoRoot, ascEnv.ASC_KEY_PATH);
    if (!existsSync(keyPath)) {
      fail("App Store Connect API private key file is missing", keyPath);
    } else {
      const mode = statSync(keyPath).mode & 0o777;
      if (mode !== 0o600) warn(`App Store Connect private key permissions are ${mode.toString(8)}; expected 600`);
      pass("App Store Connect API key config is present");
    }
  }
}

console.log("");
if (issues.length) {
  console.log("Preflight failed:");
  for (const issue of issues) console.log(`- ${issue}`);
  console.log("");
  console.log("Do not start a TestFlight archive/export until these are fixed.");
  process.exitCode = 1;
} else {
  for (const warning of warnings) console.log(`Warning: ${warning}`);
  console.log("Preflight passed. It is safe to start the archive/export/upload flow.");
}
