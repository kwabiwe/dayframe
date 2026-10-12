import { describe, expect, it } from "vitest";
import type { MobileBootstrap } from "./api";
import { publishMobileSignedOut } from "./mobileSessionTransition";
import { captureSettingsSeedGeneration, publishTodayBootstrapForSettings, readTodayBootstrapForSettings } from "./settingsSeed";

const bootstrap = { user: { id: "u1" }, workspace: { id: "w1" } } as unknown as MobileBootstrap;
const owner = { userId: "u1", workspaceId: "w1" };

describe("Today's bootstrap as Settings' first frame", () => {
  it("is handed out only to the account it belongs to", () => {
    publishTodayBootstrapForSettings(bootstrap, captureSettingsSeedGeneration());
    expect(readTodayBootstrapForSettings(owner)).toBe(bootstrap);
    expect(readTodayBootstrapForSettings({ userId: "u1", workspaceId: "w2" })).toBeNull();
    expect(readTodayBootstrapForSettings({ userId: "u2", workspaceId: "w1" })).toBeNull();
    expect(readTodayBootstrapForSettings(null)).toBeNull();
  });

  it("is dropped on sign-out", () => {
    publishTodayBootstrapForSettings(bootstrap, captureSettingsSeedGeneration());
    publishMobileSignedOut();
    expect(readTodayBootstrapForSettings(owner)).toBeNull();
  });

  it("is never refilled by a read that started before a sign-out (Codex r1)", () => {
    const beforeSignOut = captureSettingsSeedGeneration();
    publishMobileSignedOut();
    // The same account signs back in; the departed session's late read lands.
    publishTodayBootstrapForSettings(bootstrap, beforeSignOut);
    expect(readTodayBootstrapForSettings(owner)).toBeNull();
    publishTodayBootstrapForSettings(bootstrap, captureSettingsSeedGeneration());
    expect(readTodayBootstrapForSettings(owner)).toBe(bootstrap);
  });
});
