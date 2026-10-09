import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Motion & Fitness native contract", () => {
  it("explains Motion & Fitness in Dayframe's own words in both the config and the built Info.plist", () => {
    const appJson = JSON.parse(read("../../../app.json"));
    const copy = appJson.expo.ios.infoPlist.NSMotionUsageDescription as string;
    expect(copy).toMatch(/^Dayframe reads Motion & Fitness activity/);
    expect(copy).toContain("never logs time by itself");
    expect(read("../../../ios/Dayframe/Info.plist")).toContain(copy.replace("&", "&amp;"));
  });

  it("links CoreMotion only in its own module, which reads history and never networks", () => {
    const podspec = read("../../../modules/dayframe-motion-activity/ios/DayframeMotionActivity.podspec");
    expect(podspec).toContain("s.frameworks = 'CoreMotion'");
    const module = read("../../../modules/dayframe-motion-activity/ios/DayframeMotionActivityModule.swift");
    expect(module).toContain("queryActivityStarting");
    expect(module).not.toMatch(/URLSession|startActivityUpdates|CLLocation/);
  });

  it("offers Motion & Fitness in Settings beside Location, re-reading it when the app returns", () => {
    const settings = read("../../../app/settings.tsx");
    expect(settings).toContain('title="Motion & Fitness"');
    expect(settings).toContain("motionFitnessPresentation(");
    expect(settings).toContain("Linking.openSettings()");
    expect(settings).toMatch(/AppState\.addEventListener\("change"/);
  });
});
