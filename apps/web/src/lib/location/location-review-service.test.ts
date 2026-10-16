import { describe, expect, it, vi } from "vitest";
import {
  confirmedLocationCategoryId,
  confirmedLocationDescription,
  resolveLocationReviewActionWithClient
} from "./location-review-service";
import type { RequestSession } from "../session";

vi.mock("../db", () => ({
  pool: { connect: vi.fn() },
  isLockNotAvailableError: vi.fn(() => false),
  isStatementTimeoutError: vi.fn(() => false)
}));
vi.mock("../tag-service", () => ({
  syncTimeEntryTags: vi.fn()
}));

const session: RequestSession = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  authMode: "dev",
  scopes: []
};

function categoryClient() {
  return {
    query: vi.fn(async (statement: string) => {
      if (statement.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (statement.includes("from categories")) return { rows: [] };
      if (statement.includes("insert into categories")) {
        return { rows: [{ id: "created-commute" }] };
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    })
  } as unknown as import("pg").PoolClient;
}

describe("location review confirmation semantics", () => {
  it("keeps generated commute titles out of confirmed descriptions", () => {
    expect(confirmedLocationDescription("commute", "Commute", undefined)).toBeNull();
    expect(
      confirmedLocationDescription("commute", "Commute", { description: "  Train home  " })
    ).toBe("Train home");
    expect(
      confirmedLocationDescription("commute", "Commute", { description: "   " })
    ).toBeNull();
  });

  it("keeps current visit-title fallback semantics", () => {
    expect(confirmedLocationDescription("stay", "Visit the library", undefined)).toBe(
      "Visit the library"
    );
    expect(
      confirmedLocationDescription("stay", "Visit the library", { description: "   " })
    ).toBe("Visit the library");
  });

  it("self-heals a legacy null-category commute", async () => {
    await expect(
      confirmedLocationCategoryId(categoryClient(), session, "commute", null, undefined)
    ).resolves.toBe("created-commute");
  });

  it("confirms legacy time away with the user's category only, and like every Move keeps no generated description", async () => {
    const client = categoryClient();
    await expect(confirmedLocationCategoryId(client, session, "time_away", null, undefined)).resolves.toBeNull();
    await expect(confirmedLocationCategoryId(client, session, "time_away", null, {
      categoryId: "30000000-0000-4000-8000-000000000002"
    })).resolves.toBe("30000000-0000-4000-8000-000000000002");
    expect(vi.mocked(client.query)).not.toHaveBeenCalled();
    // PRD D19: time away is a round-trip Move; only words the person typed become its description.
    expect(confirmedLocationDescription("time_away", "Trip", undefined)).toBeNull();
    expect(confirmedLocationDescription("time_away", "Time away from Home", { description: "Groceries" })).toBe("Groceries");
  });

  it("preserves stored and explicitly edited categories", async () => {
    const client = categoryClient();

    await expect(
      confirmedLocationCategoryId(client, session, "commute", "stored-category", undefined)
    ).resolves.toBe("stored-category");
    await expect(
      confirmedLocationCategoryId(client, session, "commute", null, {
        categoryId: "30000000-0000-4000-8000-000000000001"
      })
    ).resolves.toBe("30000000-0000-4000-8000-000000000001");
    await expect(
      confirmedLocationCategoryId(client, session, "commute", null, { categoryId: null })
    ).resolves.toBeNull();
    expect(vi.mocked(client.query)).not.toHaveBeenCalled();
  });

  it("confirms a location Review item without querying for an overlap conflict", async () => {
    const client = {
      query: vi.fn(async (statement: string) => {
        if (statement.includes("for update of ri, ae nowait")) {
          return {
            rows: [{
              id: "review-1",
              eventId: "event-1",
              status: "open",
              title: "Visit library",
              confidence: "high",
              suggestedCategoryId: null,
              suggestedPlaceId: null,
              suggestedStartedAt: "2026-07-27T10:00:00.000Z",
              suggestedStoppedAt: "2026-07-27T11:00:00.000Z",
              segmentId: "segment-1",
              segmentKind: "stay",
              segmentStatus: "review",
              deviceId: "device-1",
              algorithmVersion: "location-v2.0",
              learnedPlaceId: null,
              placeMatchKind: null,
              centreLatitude: null,
              centreLongitude: null
            }]
          };
        }
        if (statement.includes("from stay_segments") && statement.includes("for update nowait")) {
          return { rows: [{ id: "segment-1" }] };
        }
        if (statement.includes("insert into time_entries")) {
          return { rows: [{ id: "overlapping-location-entry" }] };
        }
        return { rows: [] };
      })
    } as unknown as import("pg").PoolClient & { query: ReturnType<typeof vi.fn> };

    await expect(resolveLocationReviewActionWithClient(
      client,
      "review-1",
      { action: "confirm" },
      session
    )).resolves.toMatchObject({
      entryId: "overlapping-location-entry",
      status: "accepted"
    });

    const statements = client.query.mock.calls.map(([statement]) => String(statement));
    expect(statements.some((statement) => statement.includes("insert into time_entries"))).toBe(true);
    expect(statements.some((statement) => (
      statement.includes("started_at <") && statement.includes("coalesce(stopped_at")
    ))).toBe(false);
  });

  it("rejects a changed guarded Location proposal after the source lock and before its effect", async () => {
    const client = {
      query: vi.fn(async (statement: string) => {
        if (statement.includes("for update of ri, ae nowait")) {
          return { rows: [{
            id: "review-guarded",
            eventId: "event-guarded",
            status: "open",
            title: "Visit library",
            confidence: "high",
            suggestedCategoryId: null,
            suggestedPlaceId: null,
            suggestedStartedAt: "2026-07-27T10:00:00.000Z",
            suggestedStoppedAt: "2026-07-27T11:00:00.000Z",
            segmentId: "segment-guarded",
            segmentKind: "stay",
            segmentStatus: "review",
            deviceId: "device-1",
            algorithmVersion: "location-v2.0",
            learnedPlaceId: null,
            placeMatchKind: null,
            centreLatitude: null,
            centreLongitude: null,
            eventSource: "location_learning",
            eventType: "stay_detected",
            semanticRevision: "2026-07-27T11:01:00.000Z"
          }] };
        }
        return { rows: [] };
      })
    } as unknown as import("pg").PoolClient & { query: ReturnType<typeof vi.fn> };

    await expect(resolveLocationReviewActionWithClient(
      client,
      "review-guarded",
      { action: "confirm" },
      session,
      { expectedProposalHash: "0".repeat(64) }
    )).rejects.toMatchObject({ code: "proposal_changed", status: 409 });
    const statements = client.query.mock.calls.map(([statement]) => String(statement));
    expect(statements.some((statement) => statement.includes("from stay_segments") && statement.includes("for update nowait"))).toBe(false);
    expect(statements.some((statement) => statement.includes("insert into time_entries"))).toBe(false);
  });

  it("commits a saved-place correction and entry edits through one transaction owner", async () => {
    const placeId = "30000000-0000-4000-8000-000000000003";
    const categoryId = "40000000-0000-4000-8000-000000000004";
    const client = {
      query: vi.fn(async (statement: string) => {
        if (statement.includes("for update of ri, ae nowait")) {
          return {
            rows: [{
              id: "review-1",
              eventId: "event-1",
              status: "open",
              title: "Visit sports centre",
              confidence: "high",
              suggestedCategoryId: null,
              suggestedPlaceId: null,
              suggestedStartedAt: "2026-08-12T08:08:23.126Z",
              suggestedStoppedAt: "2026-08-12T08:22:30.004Z",
              segmentId: "segment-1",
              segmentKind: "stay",
              segmentStatus: "review",
              deviceId: "device-1",
              algorithmVersion: "location-v2.0",
              learnedPlaceId: null,
              placeMatchKind: null,
              centreLatitude: 51.73,
              centreLongitude: 0.47
            }]
          };
        }
        if (statement.includes("from stay_segments") && statement.includes("for update nowait")) {
          return { rows: [{ id: "segment-1" }] };
        }
        if (statement.includes("select 1 from categories")) return { rows: [{ ok: true }] };
        if (statement.includes("select 1 from places")) return { rows: [{ ok: true }] };
        if (statement.includes("insert into time_entries")) return { rows: [{ id: "entry-1" }] };
        return { rows: [] };
      })
    } as unknown as import("pg").PoolClient & { query: ReturnType<typeof vi.fn> };

    await expect(resolveLocationReviewActionWithClient(
      client,
      "review-1",
      {
        action: "change_place_and_confirm",
        placeId,
        learnedPlaceId: null,
        edit: {
          categoryId,
          description: "Training",
          startedAt: "2026-08-12T08:10:23.126Z",
          stoppedAt: "2026-08-12T08:25:30.004Z"
        }
      },
      session
    )).resolves.toMatchObject({ status: "accepted", entryId: "entry-1" });

    const insert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into time_entries")
    );
    expect(insert?.[1]).toEqual([
      session.workspaceId,
      session.userId,
      categoryId,
      placeId,
      null,
      "high",
      "Training",
      "2026-08-12T08:10:23.126Z",
      "2026-08-12T08:25:30.004Z",
      "event-1"
    ]);
  });

  it("records a POI name once without provider metadata or a saved place", async () => {
    const client = {
      query: vi.fn(async (statement: string) => {
        if (statement.includes("for update of ri, ae nowait")) {
          return { rows: [lockedStay()] };
        }
        if (statement.includes("from stay_segments") && statement.includes("for update nowait")) {
          return { rows: [{ id: "segment-1" }] };
        }
        if (statement.includes("insert into time_entries")) return { rows: [{ id: "entry-poi" }] };
        return { rows: [] };
      })
    } as unknown as import("pg").PoolClient & { query: ReturnType<typeof vi.fn> };

    await expect(resolveLocationReviewActionWithClient(
      client,
      "review-1",
      { action: "record_poi_once", name: "  Wagamama  " },
      session
    )).resolves.toMatchObject({ action: "record_poi_once", entryId: "entry-poi" });

    const insert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into time_entries")
    );
    expect(String(insert?.[0])).toContain("place_id, place_label");
    expect(insert?.[1]).toEqual([
      session.workspaceId,
      session.userId,
      null,
      null,
      "Wagamama",
      "high",
      "Visit unknown place",
      "2026-08-12T08:08:23.126Z",
      "2026-08-12T08:22:30.004Z",
      "event-1"
    ]);
    expect(JSON.stringify(insert?.[1])).not.toContain("latitude");
  });

  it("treats a repeated one-time POI action as equivalent", async () => {
    const client = {
      query: vi.fn(async (statement: string) => {
        if (statement.includes("for update of ri, ae nowait")) {
          return { rows: [{ ...lockedStay(), status: "accepted" }] };
        }
        if (statement.includes("from time_entries")) {
          return { rows: [{
            id: "entry-poi",
            categoryId: null,
            placeId: null,
            placeLabel: "Wagamama",
            description: "Visit unknown place",
            startedAt: "2026-08-12T08:08:23.126Z",
            stoppedAt: "2026-08-12T08:22:30.004Z"
          }] };
        }
        if (statement.includes("from time_entry_tags")) return { rows: [] };
        return { rows: [] };
      })
    } as unknown as import("pg").PoolClient;

    await expect(resolveLocationReviewActionWithClient(
      client,
      "review-1",
      { action: "record_poi_once", name: "Wagamama" },
      session
    )).resolves.toMatchObject({ alreadyResolved: true, equivalent: true });
  });

  it("rejects a one-time POI for a commute", async () => {
    const client = {
      query: vi.fn(async (statement: string) => {
        if (statement.includes("for update of ri, ae nowait")) {
          return { rows: [{ ...lockedStay(), segmentKind: "commute" }] };
        }
        if (statement.includes("from commute_segments") && statement.includes("for update nowait")) {
          return { rows: [{ id: "segment-1" }] };
        }
        return { rows: [] };
      })
    } as unknown as import("pg").PoolClient;

    await expect(resolveLocationReviewActionWithClient(
      client,
      "review-1",
      { action: "record_poi_once", name: "Station" },
      session
    )).rejects.toMatchObject({ code: "invalid_action" });
  });
});

function lockedStay() {
  return {
    id: "review-1",
    eventId: "event-1",
    status: "open",
    title: "Visit unknown place",
    confidence: "high",
    suggestedCategoryId: null,
    suggestedPlaceId: null,
    suggestedStartedAt: "2026-08-12T08:08:23.126Z",
    suggestedStoppedAt: "2026-08-12T08:22:30.004Z",
    segmentId: "segment-1",
    segmentKind: "stay",
    segmentStatus: "review",
    deviceId: "device-1",
    algorithmVersion: "location-v2.0",
    learnedPlaceId: null,
    placeMatchKind: null,
    centreLatitude: 51.73,
    centreLongitude: 0.47
  };
}

describe("owner-authored Review signal through the Review service (E1, Codex r4)", () => {
  function reviewClient(title: string, history: string[] | null = null) {
    return {
      query: vi.fn(async (statement: string) => {
        if (statement.includes("for update of ri, ae nowait")) {
          return {
            rows: [{
              id: "review-1",
              eventId: "event-1",
              status: "open",
              title,
              confidence: "high",
              suggestedCategoryId: null,
              suggestedPlaceId: null,
              suggestedStartedAt: "2026-07-27T10:00:00.000Z",
              suggestedStoppedAt: "2026-07-27T11:00:00.000Z",
              segmentId: "segment-1",
              segmentKind: "stay",
              timeAway: false,
              segmentStatus: "review",
              deviceId: "device-1",
              algorithmVersion: "location-v2.0",
              learnedPlaceId: null,
              placeMatchKind: null,
              centreLatitude: null,
              centreLongitude: null,
              reviewSuggestedTitles: history,
              correctionEvent: false
            }]
          };
        }
        if (statement.includes("from stay_segments") && statement.includes("for update nowait")) {
          return { rows: [{ id: "segment-1" }] };
        }
        if (statement.includes("insert into time_entries")) return { rows: [{ id: "entry-1" }] };
        return { rows: [] };
      })
    } as unknown as import("pg").PoolClient & { query: ReturnType<typeof vi.fn> };
  }

  async function marked(title: string, description: string, history: string[] | null = null) {
    const client = reviewClient(title, history);
    await expect(resolveLocationReviewActionWithClient(
      client,
      "review-1",
      { action: "edit_and_confirm", edit: { description } },
      session
    )).resolves.toMatchObject({ entryId: "entry-1", status: "accepted" });
    return client.query.mock.calls.some(([statement, values]) =>
      String(statement).includes("update activity_events") &&
      Array.isArray(values) &&
      values.includes("dayframeReviewDecision")
    );
  }

  it.each([
    ["sharp s and SS", "Visit Weißensee", "VISIT WEISSENSEE"],
    ["capital sharp s", "Visit ẞtraße", "visit sstrasse"],
    ["NFC and NFD accents", "Visit Café Exemple".normalize("NFC"), "visit café exemple".normalize("NFD")],
    ["fullwidth letters", "Visit Example", "Ｖｉｓｉｔ　Ｅｘａｍｐｌｅ"],
    ["the fi ligature", "Visit Sample Field", "visit sample ﬁeld"],
    ["the dotted capital I", "Visit İzmir Park", "visit izmir park"],
    ["the dotless i", "Visit Izmir Park", "VISIT ızmir park"]
  ])("never marks a suggested title edited only by %s", async (_label, title, description) => {
    expect(await marked(title, description)).toBe(false);
  });

  it("folds the replay title history the same way", async () => {
    // Replay retitled the item; the stale editor submits a case variant of the older title.
    expect(await marked("Visit New Park", "VISIT WEISSENSEE", ["Visit Weißensee", "Visit New Park"])).toBe(false);
  });

  it("marks the owner's own words, non-ASCII included", async () => {
    expect(await marked("Visit Weißensee", "Schwimmen im Weißensee")).toBe(true);
  });
});
