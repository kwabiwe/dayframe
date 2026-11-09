import { describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./reviewPresentationClient", () => ({ fetchReviewPresentationPage: client.fetch }));

import { lookupReviewLinkItem } from "./reviewLinkLookup";

const ID = "30000000-0000-4000-8000-000000000001";
const OWNER = { backendId: "b", workspaceId: "w", userId: "u" };
const record = (extra: Record<string, unknown>) => ({ kind: "review", reviewItemId: ID, status: "open", eventType: "unknown_stay",
  interval: { start: "2026-10-12T22:30:00.000Z", end: "2026-10-13T06:00:00.000Z" }, ...extra });

describe("lookupReviewLinkItem (Codex r1 and r4 on #615)", () => {
  it("reads one item through the owner-scoped presentation lookup, with its times and whether it still asks", async () => {
    client.fetch.mockResolvedValueOnce({ lookup: { reviewItems: [record({})], entries: [] } });
    await expect(lookupReviewLinkItem(OWNER, ID, "Europe/London"))
      .resolves.toEqual({ startedAt: "2026-10-12T22:30:00.000Z", stoppedAt: "2026-10-13T06:00:00.000Z", open: true });
    expect(client.fetch).toHaveBeenCalledWith({
      owner: OWNER,
      request: { version: 1, mode: "lookup", timeZone: "Europe/London", reviewItemIds: [ID], limit: 1 },
      signal: undefined
    });
  });

  it("says a decided item no longer asks, and a block that ran into a trip still does (on its block)", async () => {
    client.fetch.mockResolvedValueOnce({ lookup: { reviewItems: [record({ status: "accepted" })], entries: [] } });
    await expect(lookupReviewLinkItem(OWNER, ID, "Europe/London")).resolves.toMatchObject({ open: false });
    client.fetch.mockResolvedValueOnce({ lookup: { reviewItems: [record({ eventType: "timer_trip_clash" })], entries: [] } });
    await expect(lookupReviewLinkItem(OWNER, ID, "Europe/London")).resolves.toMatchObject({ open: true });
  });

  it("returns null for a missing item, and lets a failed read fail", async () => {
    client.fetch.mockResolvedValueOnce({ lookup: { reviewItems: [{ kind: "missing_review", reviewItemId: ID }], entries: [] } });
    await expect(lookupReviewLinkItem(OWNER, ID, "Europe/London")).resolves.toBeNull();
    client.fetch.mockRejectedValueOnce(new Error("offline"));
    await expect(lookupReviewLinkItem(OWNER, ID, "Europe/London")).rejects.toThrow("offline");
  });
});
