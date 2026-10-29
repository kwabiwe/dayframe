import { describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./reviewPresentationClient", () => ({ fetchReviewPresentationPage: client.fetch }));

import { lookupReviewItemStart } from "./reviewLinkLookup";

const ID = "30000000-0000-4000-8000-000000000001";
const OWNER = { backendId: "b", workspaceId: "w", userId: "u" };

describe("lookupReviewItemStart (Codex r1 on #615)", () => {
  it("reads one item through the owner-scoped presentation lookup, decided or open, and returns its start", async () => {
    client.fetch.mockResolvedValueOnce({ lookup: { reviewItems: [{ kind: "review", reviewItemId: ID, status: "accepted", interval: { start: "2026-10-12T22:30:00.000Z", end: null } }], entries: [] } });
    await expect(lookupReviewItemStart(OWNER, ID, "Europe/London")).resolves.toBe("2026-10-12T22:30:00.000Z");
    expect(client.fetch).toHaveBeenCalledWith({
      owner: OWNER,
      request: { version: 1, mode: "lookup", timeZone: "Europe/London", reviewItemIds: [ID], limit: 1 },
      signal: undefined
    });
  });

  it("returns null for a missing item, and lets a failed read fail", async () => {
    client.fetch.mockResolvedValueOnce({ lookup: { reviewItems: [{ kind: "missing_review", reviewItemId: ID }], entries: [] } });
    await expect(lookupReviewItemStart(OWNER, ID, "Europe/London")).resolves.toBeNull();
    client.fetch.mockRejectedValueOnce(new Error("offline"));
    await expect(lookupReviewItemStart(OWNER, ID, "Europe/London")).rejects.toThrow("offline");
  });
});
