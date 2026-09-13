import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock("./db", () => ({ pool: { connect: mocks.connect } }));

const { getReviewPresentation } = await import("./review-presentation-service");
const { reviewProposalHash } = await import("./review-proposal-hash");

const session = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  authMode: "provider" as const,
  scopes: ["app:read"]
};
const reviewId = "30000000-0000-4000-8000-000000000001";
const entryId = "40000000-0000-4000-8000-000000000001";

describe("getReviewPresentation", () => {
  it("uses one bounded read-only snapshot, scoped lookup IDs, and no mutation locks", async () => {
    const query = vi.fn(async (statement: string, values?: unknown[]) => {
      void values;
      if (statement.startsWith("begin read only")) return { rows: [] };
      if (statement.includes("current_setting")) return { rows: [{ transaction_timeout: null }] };
      if (statement.includes("set_config")) return { rows: [] };
      if (statement.includes("set transaction isolation level repeatable read")) return { rows: [] };
      if (statement.includes("with open_reviews")) {
        return { rows: [{ globalCount: 1, todayCount: 0, openReviewItemIds: [reviewId] }] };
      }
      if (statement.includes("from review_items ri")) {
        return { rows: [{
          id: reviewId,
          eventId: "50000000-0000-4000-8000-000000000001",
          locationSegmentId: null,
          type: "health",
          title: "Morning walk",
          status: "open",
          categoryId: null,
          categoryName: null,
          categoryColor: null,
          placeId: null,
          placeLabel: null,
          startedAt: "2026-09-12T08:00:00.000Z",
          stoppedAt: "2026-09-12T08:30:00.000Z",
          confidence: "medium",
          createdAt: "2026-09-12T08:31:00.000Z",
          semanticRevision: "2026-09-12T08:31:00.000Z",
          eventSource: "healthkit",
          eventType: "workout",
          canonicalEntryIds: [entryId]
        }] };
      }
      if (statement.includes("from time_entries te")) {
        return { rows: [{
          id: entryId,
          eventId: "50000000-0000-4000-8000-000000000001",
          title: "Morning walk",
          categoryId: null,
          categoryName: null,
          categoryColor: null,
          placeId: null,
          placeLabel: null,
          startedAt: "2026-09-12T08:00:00.000Z",
          stoppedAt: "2026-09-12T08:30:00.000Z",
          confidence: "medium",
          reviewStatus: "confirmed",
          updatedAt: "2026-09-12T08:31:00.000Z",
          source: "healthkit"
        }] };
      }
      if (statement === "commit") return { rows: [] };
      return { rows: [] };
    });
    mocks.connect.mockResolvedValue({ query, release: vi.fn() });

    const presentation = await getReviewPresentation(session, {
      version: 1,
      mode: "lookup",
      timeZone: "Europe/London",
      reviewItemIds: [reviewId],
      entryIds: [entryId],
      limit: 100
    });

    expect(presentation.lookup.reviewItems).toMatchObject([{ kind: "review", reviewItemId: reviewId }]);
    expect(presentation.lookup.entries).toMatchObject([{ kind: "completed_entry", entryId }]);
    expect(presentation.links).toEqual([{ reviewItemId: reviewId, entryIds: [entryId], status: "open" }]);
    expect(query.mock.calls.some(([statement]) => String(statement).includes("pg_try_advisory"))).toBe(false);
    const lookupQuery = query.mock.calls.find(([statement]) => String(statement).includes("ri.id = any"));
    expect(lookupQuery?.[1]).toEqual([session.workspaceId, session.userId, [reviewId]]);
    expect(String(lookupQuery?.[0])).toContain("review_mutation_receipts");
    expect(query.mock.calls.some(([statement]) => String(statement).includes("repeatable read"))).toBe(true);
    expect(presentation.lookup.reviewItems[0]).toMatchObject({
      proposalHash: reviewProposalHash({
        reviewItemId: reviewId,
        eventId: "50000000-0000-4000-8000-000000000001",
        locationSegmentId: null,
        sourceKind: "generic",
        title: "Morning walk",
        categoryId: null,
        placeId: null,
        startedAt: "2026-09-12T08:00:00.000Z",
        stoppedAt: "2026-09-12T08:30:00.000Z",
        confidence: "medium",
        eventSource: "healthkit",
        eventType: "workout",
        semanticRevision: "2026-09-12T08:31:00.000Z"
      })
    });
  });

  it("returns an exact legacy target with actual editor fields rather than a synthetic entry", async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.startsWith("begin read only")) return { rows: [] };
      if (statement.includes("current_setting")) return { rows: [{ transaction_timeout: null }] };
      if (statement.includes("set_config") || statement.includes("repeatable read") || statement === "commit") return { rows: [] };
      if (statement.includes("with open_reviews")) {
        return { rows: [{ globalCount: 1, todayCount: 0, openReviewItemIds: [] }] };
      }
      if (statement.includes("te.review_status = 'needs_review'")) {
        return { rows: [{
          id: entryId,
          eventId: null,
          projectId: null,
          projectName: null,
          projectColor: null,
          clientName: null,
          title: "Imported walk",
          categoryId: null,
          categoryName: "Health",
          categoryColor: "moss",
          placeId: null,
          placeLabel: null,
          placeKind: null,
          startedAt: "2026-09-12T08:00:00.000Z",
          stoppedAt: "2026-09-12T08:30:00.000Z",
          confidence: "medium",
          updatedAt: "2026-09-12T08:31:00.000Z",
          source: "healthkit",
          description: "Imported walk",
          durationSeconds: 1800,
          tagNames: ["Synthetic"],
          linkedReviewItemId: null
        }] };
      }
      if (statement.includes("from time_entries te")) return { rows: [] };
      return { rows: [] };
    });
    mocks.connect.mockResolvedValue({ query, release: vi.fn() });

    const presentation = await getReviewPresentation(session, {
      version: 1,
      mode: "lookup",
      timeZone: "Europe/London",
      entryIds: [entryId],
      limit: 100
    });

    expect(presentation.scope.entryIds).toEqual([entryId]);
    expect(presentation.lookup.entries).toMatchObject([{
      kind: "legacy_review_entry",
      entryId,
      editor: { description: "Imported walk", durationSeconds: 1800, tagNames: ["Synthetic"] }
    }]);
  });
});
