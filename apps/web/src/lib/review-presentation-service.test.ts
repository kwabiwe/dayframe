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
  it.each(["backlog", "lookup"] as const)("hashes raw suggested IDs when display joins miss (%s)", async (mode) => {
    const raw = {
      ...reviewRow(reviewId),
      suggestedCategoryId: "60000000-0000-4000-8000-000000000001",
      suggestedPlaceId: "60000000-0000-4000-8000-000000000002"
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("current_setting")) return { rows: [{ transaction_timeout: null }] };
      if (sql.includes("with open_reviews")) return { rows: [{ globalCount: 1, todayCount: 1, openReviewItemIds: [reviewId] }] };
      if (sql.includes("from time_entries te")) return { rows: [] };
      if (sql.includes("from review_items ri")) {
        expect(sql).toContain('ri.suggested_category_id as "suggestedCategoryId"');
        expect(sql).toContain('ri.suggested_place_id as "suggestedPlaceId"');
        return { rows: [raw] };
      }
      return { rows: [] };
    });
    mocks.connect.mockResolvedValue({ query, release: vi.fn() });
    const result = await getReviewPresentation(session, {
      version: 1, mode, timeZone: "Etc/UTC", limit: 100,
      ...(mode === "lookup" ? { reviewItemIds: [reviewId] } : {})
    });
    const record = mode === "lookup" ? result.lookup.reviewItems[0] : result.records[0];
    expect(record).toMatchObject({
      category: { id: null, name: null }, place: { id: null, label: null },
      proposalHash: reviewProposalHash({
        reviewItemId: reviewId, eventId: raw.eventId, locationSegmentId: raw.locationSegmentId,
        sourceKind: "generic", title: raw.title,
        categoryId: raw.suggestedCategoryId, placeId: raw.suggestedPlaceId,
        startedAt: raw.startedAt, stoppedAt: raw.stoppedAt, confidence: raw.confidence,
        eventSource: raw.eventSource, eventType: raw.eventType, semanticRevision: raw.semanticRevision
      })
    });
  });
  it("uses one bounded read-only snapshot, scoped lookup IDs, and no mutation locks", async () => {
    const query = vi.fn(async (statement: string, values?: unknown[]) => {
      void values;
      if (statement.startsWith("begin isolation level repeatable read read only")) return { rows: [] };
      if (statement.includes("current_setting")) return { rows: [{ transaction_timeout: null }] };
      if (statement.includes("set_config")) return { rows: [] };
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
          suggestedCategoryId: null,
          suggestedPlaceId: null,
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
    expect(String(query.mock.calls[0]?.[0])).toMatch(/^begin isolation level repeatable read read only;/i);
    expect(query.mock.calls.some(([statement]) => String(statement) === "set transaction isolation level repeatable read")).toBe(false);
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
      if (statement.startsWith("begin isolation level repeatable read read only")) return { rows: [] };
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

  it("keeps 501 loaded Review rows page-linked within the response bound", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => reviewRow(
      `30000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`
    ));
    const query = vi.fn(async (statement: string) => {
      if (statement.startsWith("begin isolation level repeatable read read only")) return { rows: [] };
      if (statement.includes("current_setting")) return { rows: [{ transaction_timeout: null }] };
      if (statement.includes("set_config") || statement === "commit") return { rows: [] };
      if (statement.includes("with open_reviews")) {
        return { rows: [{ globalCount: rows.length, todayCount: rows.length, openReviewItemIds: rows.map((row) => row.id) }] };
      }
      if (statement.includes("from time_entries te")) return { rows: [] };
      if (statement.includes("from review_items ri")) return { rows };
      return { rows: [] };
    });
    mocks.connect.mockResolvedValue({ query, release: vi.fn() });

    const presentation = await getReviewPresentation(session, {
      version: 1,
      mode: "backlog",
      timeZone: "Europe/London",
      limit: 200
    });

    expect(presentation.records).toHaveLength(200);
    expect(presentation.nextCursor).not.toBeNull();
    expect(presentation.links).toHaveLength(200);
    expect(presentation.links.map((link) => link.reviewItemId).sort())
      .toEqual(presentation.records.flatMap((record) => record.kind === "review" ? [record.reviewItemId] : []).sort());
  });
});

function reviewRow(id: string) {
  return {
    suggestedCategoryId: null,
    suggestedPlaceId: null,
    id,
    eventId: null,
    locationSegmentId: null,
    type: "health",
    title: "Synthetic Review",
    status: "open" as const,
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
    eventSource: null,
    eventType: null,
    canonicalEntryIds: []
  };
}
