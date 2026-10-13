import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  reanimated?: { staticFeatureFlags?: Record<string, boolean> };
};
const podfileLock = readFileSync("ios/Podfile.lock", "utf8");

// Time Profiler on the iPhone 17 (13 Oct): with a block running on Today, Reanimated committed the whole
// view tree every frame for an opacity loop and the rolling digits (about 40 % of a main-thread core).
describe("Reanimated static feature flags", () => {
  it("applies opacity and transform updates straight to the view on iOS", () => {
    expect(packageJson.reanimated?.staticFeatureFlags?.IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS).toBe(true);
  });
  it("keeps the RNReanimated pod checksum that this flag set produces (pod install)", () => {
    expect(podfileLock).toContain("RNReanimated: db3eaa66b2222d8f10582f5c34ce38969ba2d960");
  });
});
