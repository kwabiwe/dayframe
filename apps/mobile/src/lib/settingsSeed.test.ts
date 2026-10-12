import { describe, expect, it } from "vitest";
import type { MobileBootstrap } from "./api";
import { publishMobileSignedOut } from "./mobileSessionTransition";
import { publishTodayBootstrapForSettings, readTodayBootstrapForSettings } from "./settingsSeed";

const bootstrap = { user: { id: "u1" }, workspace: { id: "w1" } } as unknown as MobileBootstrap;

describe("Today's bootstrap as Settings' first frame", () => {
  it("is handed out only to the account it belongs to", () => {
    publishTodayBootstrapForSettings(bootstrap);
    expect(readTodayBootstrapForSettings({ userId: "u1", workspaceId: "w1" })).toBe(bootstrap);
    expect(readTodayBootstrapForSettings({ userId: "u1", workspaceId: "w2" })).toBeNull();
    expect(readTodayBootstrapForSettings({ userId: "u2", workspaceId: "w1" })).toBeNull();
    expect(readTodayBootstrapForSettings(null)).toBeNull();
  });

  it("is dropped on sign-out", () => {
    publishTodayBootstrapForSettings(bootstrap);
    publishMobileSignedOut();
    expect(readTodayBootstrapForSettings({ userId: "u1", workspaceId: "w1" })).toBeNull();
  });
});
