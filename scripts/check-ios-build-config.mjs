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

const appConfiguration = (name, bundleIdentifier) => {
  const blocks = [...project.matchAll(
    new RegExp(`\\n\\t\\t[^\\n]+ /\\* ${name} \\*/ = \\{[\\s\\S]*?\\n\\t\\t\\};`, "g")
  )].map((match) => match[0]);
  return blocks.find((block) => block.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${bundleIdentifier};`)) ?? "";
};

const staging = appConfiguration("Staging", "com.layereight.dayframe.staging");
const release = appConfiguration("Release", "com.layereight.dayframe");
expect(staging.includes("APS_ENVIRONMENT = development;"), "Staging app configuration must use APNs development.");
expect(release.includes("APS_ENVIRONMENT = production;"), "Release app configuration must use APNs production.");
// Check every host/extension pair, including Debug's existing production identity.
for (const [configuration, identity] of [
  ["Debug", "com.layereight.dayframe"],
  ["Release", "com.layereight.dayframe"],
  ["Staging", "com.layereight.dayframe.staging"]
]) {
  for (const [bundle, folder] of [[identity, "Dayframe"], [`${identity}.DayframeLiveActivity`, "DayframeLiveActivity"]]) {
    const settings = appConfiguration(configuration, bundle);
    expect(settings.includes(`DAYFRAME_APP_GROUP = group.${identity};`), `${configuration} ${bundle} must select only its own App Group.`);
    expect(settings.includes(`DAYFRAME_KEYCHAIN_GROUP = ${identity}.shared;`), `${configuration} ${bundle} must select its own Keychain group.`);
    expect(settings.includes(`INFOPLIST_FILE = ${folder}/Info.plist;`), `${configuration} ${bundle} must use the validated Info.plist.`);
    expect(settings.includes(`CODE_SIGN_ENTITLEMENTS = ${folder}/${folder}.entitlements;`), `${configuration} ${bundle} must use the validated entitlements.`);
  }
}
expect(eas.build?.preview?.ios?.buildConfiguration === "Staging", "EAS preview must explicitly use Staging.");
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
  const groups = plistArrayFromText(contents, "com.apple.security.application-groups");
  expect(
    groups.length === 1 && groups[0] === "$(DAYFRAME_APP_GROUP)",
    `${label} must resolve exactly its environment-specific App Group.`
  );
  expect(contents.includes("keychain-access-groups"), `${label} must declare Keychain Sharing.`);
  expect(
    contents.includes("$(AppIdentifierPrefix)$(DAYFRAME_KEYCHAIN_GROUP)"),
    `${label} must resolve its environment-specific Keychain group.`
  );
}
for (const [label, contents] of [["host Info.plist", hostInfo], ["extension Info.plist", extensionInfo]]) {
  expect(
    plistValueFromText(contents, "DayframeSharedAppGroupIdentifier") === "$(DAYFRAME_APP_GROUP)",
    `${label} must expose the same App Group build setting as its entitlement.`
  );
  expect(
    contents.includes("DayframeSharedKeychainAccessGroup") &&
      contents.includes("$(AppIdentifierPrefix)$(DAYFRAME_KEYCHAIN_GROUP)"),
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

const builtAppArgumentIndex = process.argv.indexOf("--built-app");
if (builtAppArgumentIndex >= 0) verifyBuiltProducts(resolve(process.argv[builtAppArgumentIndex + 1] ?? ""));

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

function verifyBuiltProducts(appPath) {
  const hostInfoPath = resolve(appPath, "Info.plist");
  const identity = plistValue(hostInfoPath, "CFBundleIdentifier");
  if (!["com.layereight.dayframe", "com.layereight.dayframe.staging"].includes(identity)) {
    failures.push(`Unrecognized built host identity: ${identity}`);
    return null;
  }
  for (const [label, infoPath, bundle] of [
    ["host", hostInfoPath, identity],
    ["extension", resolve(appPath, "PlugIns/DayframeLiveActivity.appex/Info.plist"), `${identity}.DayframeLiveActivity`]
  ]) {
    expect(plistValue(infoPath, "CFBundleIdentifier") === bundle, `Built ${label} bundle must match its host lane.`);
    expect(plistValue(infoPath, "DayframeSharedAppGroupIdentifier") === `group.${identity}`, `Built ${label} must resolve its lane's App Group.`);
  }
  return identity;
}

function verifySignedProducts(signedApp) {
  const identity = verifyBuiltProducts(signedApp);
  if (!identity) return;
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
    expect(groups.length === 1 && groups[0] === `group.${identity}`, `${label} must authorize exactly its baked App Group.`);
  }
  const expectedKeychainSuffix = `.${identity}.shared`;
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
