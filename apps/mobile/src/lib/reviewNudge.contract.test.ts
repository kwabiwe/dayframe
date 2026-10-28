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
    // Counted in cards, an outing once (PR 12c): the replay, evidence and event replies alike.
    expect(locationStore).toContain("[REVIEW_COUNT_REQUEST_HEADER]: REVIEW_COUNT_CARDS,");
    expect(api).toContain("[REVIEW_COUNT_REQUEST_HEADER]: REVIEW_COUNT_CARDS");
    const reply = { ok: true, replayVersion: "v", rolloutMode: "v2_review", clientAcknowledgedMode: true, finalisedSegmentCount: 0, semanticSegmentCount: 0, warnings: [] };
    expect(LocationReplayResponseSchema.safeParse({ ...reply, reviewCount: 2 }).success).toBe(true);
    expect(LocationReplayResponseSchema.safeParse(reply).success).toBe(true);
  });

  it("takes its count from the Dashboard's 7-day \"?\" only, and cancels at sign-out", () => {
    // Owner item 13 (28 Oct 2026): the reminder counts what the Calendar badge counts; replies' Review counts never feed it.
    expect(dashboard).toContain("noteReviewCount(owner, askingChecks.length)");
    expect(api).not.toContain("noteReviewCount");
    expect(locationStore).not.toContain("noteReviewCount");
    expect(locationStore).not.toContain("noteLocationReviewCount");
    expect(api).toContain("cancelReviewNudgeForLogout()");
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
    expect(nudge).toMatch(/things? to check from the last 7 days\./);
    expect(nudge).not.toMatch(/placeName|place\.name|latitude|longitude/);
  });

  it("lives under Settings › Automatic tracking (PRD D5)", () => {
    const tracking = settings.slice(settings.indexOf('title="Automatic tracking"'), settings.indexOf('title="Apple Health"'));
    expect(tracking).toContain('title="Evening reminder"');
    expect(tracking).toContain('title="Time"');
  });
});
