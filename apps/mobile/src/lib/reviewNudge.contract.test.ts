/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LocationReplayResponseSchema } from "@dayframe/shared";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const nudge = read("./reviewNudge.ts");
const nativeSource = read("./reviewNudgeNative.ts");
const api = read("./api.ts");
const locationStore = read("./location/store.ts");
const settings = read("../../app/settings.tsx");
const dashboard = read("../components/DayframeDashboard.tsx");

describe("evening Review reminder contract (Blocks 8-0)", () => {
  it("keeps expo-notifications behind one lazily loaded file", () => {
    expect(nativeSource).toContain('from "expo-notifications"');
    for (const source of [nudge, api, locationStore, settings, dashboard]) {
      expect(source).not.toMatch(/from "expo-notifications"/);
    }
    expect(dashboard).toContain('import("@/lib/reviewNudgeNative")');
  });

  it("asks for the replay count with a header, because older builds parse the replay reply strictly", () => {
    expect(locationStore).toContain('[REVIEW_COUNT_REQUEST_HEADER]: "1"');
    const reply = { ok: true, replayVersion: "v", rolloutMode: "v2_review", clientAcknowledgedMode: true, finalisedSegmentCount: 0, semanticSegmentCount: 0, warnings: [] };
    expect(LocationReplayResponseSchema.safeParse({ ...reply, reviewCount: 2 }).success).toBe(true);
    expect(LocationReplayResponseSchema.safeParse(reply).success).toBe(true);
  });

  it("feeds counts from bootstrap, the event queue and location replies, and cancels at sign-out", () => {
    expect(api).toContain("noteReviewCountQuietly(owner, bootstrap.stats?.reviewCount)");
    expect(api).toContain("noteReviewCountQuietly(owner, (payload as { reviewCount?: unknown }).reviewCount)");
    expect(api).toContain("cancelReviewNudgeForLogout()");
    expect(locationStore).toContain("noteLocationReviewCount(owner, payload.reviewCount)");
    // Any end of the session (expiry, revocation), not only Sign out.
    expect(api).toMatch(/subscribeAuthenticatedSession\(\(\) => \{\n  void readAuthenticatedSessionSnapshot\(\)/);
    // Settings never feeds its cached count back as new.
    expect(settings).not.toContain("noteReviewCount");
  });

  it("shows the reminder while Dayframe is open, only for the signed-in account", () => {
    expect(dashboard).toContain("installReviewNudgeForegroundHandler(isCurrentAccount)");
    expect(nativeSource).toContain("Notifications.setNotificationHandler");
  });

  it("never puts places in the reminder", () => {
    expect(nudge).toMatch(/suggestions? (is|are) ready to review\./);
    expect(nudge).not.toMatch(/placeName|place\.name|latitude|longitude/);
  });

  it("lives under Settings › Automatic tracking (PRD D5)", () => {
    const tracking = settings.slice(settings.indexOf('title="Automatic tracking"'), settings.indexOf('title="Apple Health"'));
    expect(tracking).toContain('title="Evening reminder"');
    expect(tracking).toContain('title="Time"');
  });
});
