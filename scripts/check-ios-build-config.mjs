import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const mobileRoot = resolve(repositoryRoot, "apps/mobile");
const iosRoot = resolve(mobileRoot, "ios");
const project = readFileSync(resolve(iosRoot, "Dayframe.xcodeproj/project.pbxproj"), "utf8");
const hostEntitlements = readFileSync(resolve(iosRoot, "Dayframe/Dayframe.entitlements"), "utf8");
const extensionEntitlements = readFileSync(
  resolve(iosRoot, "DayframeLiveActivity/DayframeLiveActivity.entitlements"),
  "utf8"
);
const hostInfo = readFileSync(resolve(iosRoot, "Dayframe/Info.plist"), "utf8");
const extensionInfo = readFileSync(resolve(iosRoot, "DayframeLiveActivity/Info.plist"), "utf8");
const eas = JSON.parse(readFileSync(resolve(mobileRoot, "eas.json"), "utf8"));
const app = JSON.parse(readFileSync(resolve(mobileRoot, "app.json"), "utf8"));

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const appConfiguration = (name) => {
  const blocks = [...project.matchAll(
    new RegExp(`\\n\\t\\t[^\\n]+ /\\* ${name} \\*/ = \\{[\\s\\S]*?\\n\\t\\t\\};`, "g")
  )].map((match) => match[0]);
  return blocks.find((block) => block.includes("PRODUCT_BUNDLE_IDENTIFIER = com.layereight.dayframe;")) ?? "";
};

const staging = appConfiguration("Staging");
const release = appConfiguration("Release");
expect(staging.includes("APS_ENVIRONMENT = development;"), "Staging app configuration must use APNs development.");
expect(release.includes("APS_ENVIRONMENT = production;"), "Release app configuration must use APNs production.");
expect(eas.build?.preview?.ios?.buildConfiguration === "Release", "EAS preview must explicitly use Release.");
expect(eas.build?.production?.ios?.buildConfiguration === "Release", "EAS production must explicitly use Release.");
expect(
  eas.build?.preview?.env?.EXPO_PUBLIC_DAYFRAME_API_BASE === "https://dayframe-staging.vercel.app",
  "EAS preview must target the staging Dayframe API."
);
expect(
  eas.build?.production?.env?.EXPO_PUBLIC_DAYFRAME_API_BASE === "https://dayframe-web.vercel.app",
  "EAS production must target the production Dayframe API."
);

for (const [label, contents] of [
  ["host entitlements", hostEntitlements],
  ["extension entitlements", extensionEntitlements]
]) {
  expect(contents.includes("com.apple.security.application-groups"), `${label} must declare App Groups.`);
  expect(contents.includes("group.com.layereight.dayframe"), `${label} must use the Dayframe App Group.`);
  expect(contents.includes("keychain-access-groups"), `${label} must declare Keychain Sharing.`);
  expect(
    contents.includes("$(AppIdentifierPrefix)com.layereight.dayframe.shared"),
    `${label} must use the shared Dayframe Keychain group.`
  );
}
for (const [label, contents] of [["host Info.plist", hostInfo], ["extension Info.plist", extensionInfo]]) {
  expect(
    contents.includes("DayframeSharedKeychainAccessGroup") &&
      contents.includes("$(AppIdentifierPrefix)com.layereight.dayframe.shared"),
    `${label} must expose the resolved shared Keychain group to native code.`
  );
}
expect(
  app.expo?.ios?.entitlements?.["com.apple.security.application-groups"]?.includes("group.com.layereight.dayframe"),
  "Expo host config must declare the Dayframe App Group."
);
expect(
  app.expo?.ios?.entitlements?.["keychain-access-groups"]?.includes(
    "$(AppIdentifierPrefix)com.layereight.dayframe.shared"
  ),
  "Expo host config must declare the shared Dayframe Keychain group."
);
expect(
  app.expo?.extra?.eas?.build?.experimental?.ios?.appExtensions?.some(
    (extension) => extension.targetName === "DayframeLiveActivity" &&
      extension.entitlements?.["com.apple.security.application-groups"]?.includes("group.com.layereight.dayframe") &&
      extension.entitlements?.["keychain-access-groups"]?.includes(
        "$(AppIdentifierPrefix)com.layereight.dayframe.shared"
      )
  ),
  "Expo EAS config must declare the Live Activity extension capabilities."
);

const signedAppArgumentIndex = process.argv.indexOf("--signed-app");
if (signedAppArgumentIndex >= 0) {
  const signedApp = resolve(process.argv[signedAppArgumentIndex + 1] ?? "");
  expect(existsSync(signedApp), `Signed app does not exist: ${signedApp}`);
  if (existsSync(signedApp)) verifySignedProducts(signedApp);
}

if (failures.length) {
  console.error("iOS build configuration check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("iOS build configuration check passed.");

function verifySignedProducts(signedApp) {
  const extension = resolve(signedApp, "PlugIns/DayframeLiveActivity.appex");
  expect(existsSync(extension), "Signed app must embed DayframeLiveActivity.appex.");
  if (!existsSync(extension)) return;

  const hostSigned = signedEntitlements(signedApp);
  const extensionSigned = signedEntitlements(extension);
  const infoEnvironment = plistValue(resolve(signedApp, "Info.plist"), "DayframeAPNSEnvironment");
  const signedEnvironment = plistValueFromText(hostSigned, "aps-environment");
  expect(
    signedEnvironment === infoEnvironment,
    `Signed aps-environment (${signedEnvironment}) must match DayframeAPNSEnvironment (${infoEnvironment}).`
  );
  const hostAppGroups = plistArrayFromText(hostSigned, "com.apple.security.application-groups");
  const extensionAppGroups = plistArrayFromText(extensionSigned, "com.apple.security.application-groups");
  const hostKeychainGroups = plistArrayFromText(hostSigned, "keychain-access-groups");
  const extensionKeychainGroups = plistArrayFromText(extensionSigned, "keychain-access-groups");
  for (const [label, groups] of [
    ["signed host", hostAppGroups],
    ["signed extension", extensionAppGroups]
  ]) {
    expect(groups.includes("group.com.layereight.dayframe"), `${label} is missing the Dayframe App Group.`);
  }
  const expectedKeychainSuffix = ".com.layereight.dayframe.shared";
  const hostSharedKeychain = hostKeychainGroups.find((group) => group.endsWith(expectedKeychainSuffix));
  const extensionSharedKeychain = extensionKeychainGroups.find((group) => group.endsWith(expectedKeychainSuffix));
  expect(Boolean(hostSharedKeychain), "Signed host is missing the shared Keychain group.");
  expect(Boolean(extensionSharedKeychain), "Signed extension is missing the shared Keychain group.");
  expect(
    Boolean(hostSharedKeychain) && hostSharedKeychain === extensionSharedKeychain,
    "Signed host and extension must resolve to the same shared Keychain group."
  );
}

function signedEntitlements(productPath) {
  try {
    return execFileSync("codesign", ["-d", "--entitlements", ":-", productPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    failures.push(`Unable to read signed entitlements for ${productPath}: ${error.status ?? "unknown error"}`);
    return "";
  }
}

function plistValue(plistPath, key) {
  try {
    return execFileSync("plutil", ["-extract", key, "raw", "-o", "-", plistPath], { encoding: "utf8" }).trim();
  } catch {
    failures.push(`Unable to read ${key} from ${plistPath}.`);
    return "";
  }
}

function plistValueFromText(plist, key) {
  const match = plist.match(new RegExp(`<key>${key}<\\/key>\\s*<string>([^<]+)<\\/string>`));
  return match?.[1] ?? "";
}

function plistArrayFromText(plist, key) {
  const match = plist.match(new RegExp(`<key>${key}<\\/key>\\s*<array>([\\s\\S]*?)<\\/array>`));
  if (!match) return [];
  return [...match[1].matchAll(/<string>([^<]+)<\/string>/g)].map((item) => item[1]);
}
