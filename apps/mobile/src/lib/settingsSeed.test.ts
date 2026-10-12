import { describe, expect, it, vi } from "vitest";
import type { MobileBootstrap } from "./api";
import { publishMobileSignedOut } from "./mobileSessionTransition";
const session = vi.hoisted(() => ({ generation: 0 }));
// secure-session bumps its generation on every sign-in, sign-out and invalidation.
vi.mock("./secure-session", () => ({ currentSessionGeneration: () => session.generation }));

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

  it("belongs to the session it was read in: a later session (another sign-in, A→B→A) never sees it (Codex r2)", () => {
    publishTodayBootstrapForSettings(bootstrap, captureSettingsSeedGeneration());
    expect(readTodayBootstrapForSettings(owner)).toBe(bootstrap);
    // Signing in again (setSessionToken) bumps the generation.
    const beforeReplacement = captureSettingsSeedGeneration();
    session.generation += 1;
    expect(readTodayBootstrapForSettings(owner)).toBeNull();
    publishTodayBootstrapForSettings(bootstrap, beforeReplacement);
    expect(readTodayBootstrapForSettings(owner)).toBeNull();
  });

  it("is never refilled by a read that started before a sign-out (Codex r1)", () => {
    const beforeSignOut = captureSettingsSeedGeneration();
    session.generation += 1;
    publishMobileSignedOut();
    // The same account signs back in; the departed session's late read lands.
    publishTodayBootstrapForSettings(bootstrap, beforeSignOut);
    expect(readTodayBootstrapForSettings(owner)).toBeNull();
    publishTodayBootstrapForSettings(bootstrap, captureSettingsSeedGeneration());
    expect(readTodayBootstrapForSettings(owner)).toBe(bootstrap);
  });
});
