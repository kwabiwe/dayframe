import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewPresentationResponseSchema } from "@dayframe/shared";
import { syntheticId, syntheticReviewBootstrap } from "../../../../../scripts/fixtures/review-performance";
import { projectTodayReviewPresentation } from "../../lib/todayReviewPresentation";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});

const mocks = vi.hoisted(() => ({
  context: null as any,
  donutProps: null as any,
  open: vi.fn()
}));

vi.mock("expo-sqlite", () => ({ openDatabaseAsync: mocks.open }));
vi.mock("../../lib/secure-session", () => ({
  invalidateMobileSessionIfCurrent: vi.fn(),
  isAuthenticatedSessionSnapshotCurrent: vi.fn(() => true),
  readOwnedAuthenticatedSessionSnapshot: vi.fn()
}));
vi.mock("../../lib/config", () => ({ DAYFRAME_API_BASE: "https://local-fixture.invalid" }));
vi.mock("../../lib/mobile-network", () => ({
  MobileRequestTimeoutError: class extends Error {},
  StaleMobileSessionResponseError: class extends Error {},
  isMobileTransportFailure: () => false,
  mobileJsonRequest: vi.fn()
}));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View" }));
vi.mock("@/lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("@/lib/mobileTheme", () => ({
  pressable: (base: unknown) => base,
  useMobileTheme: () => ({
    styles: {
      buttonPressed: "pressed",
      todayReviewAwaiting: "awaiting",
      todayReviewOpenButton: "open",
      todayReviewOpenMeta: "openMeta",
      todayReviewOpenTitle: "openTitle",
      todayReviewSaved: "saved",
      todayReviewSummary: "summary"
    },
    theme: { textPrimary: "primary" }
  })
}));
vi.mock("@/lib/motion", () => ({
  useResolvedReduceMotionPreference: () => ({ reduceMotion: false, resolved: true })
}));
vi.mock("./TodayReviewPresentationContext", () => ({
  useTodayReviewPresentationContext: () => mocks.context
}));
vi.mock("./TodayReviewDonut", () => ({
  TodayReviewDonut: (props: unknown) => {
    mocks.donutProps = props;
    return null;
  }
}));

import { TodayReviewSummary } from "./TodayReviewSummary";

let db: DatabaseSync;
let directory: string;
let store: typeof import("../../lib/reviewSyncStore");

function adapter() {
  const value = {
    execAsync: async (sql: string) => { db.exec(sql); },
    getFirstAsync: async (sql: string, ...args: never[]) => db.prepare(sql).get(...args) ?? null,
    getAllAsync: async (sql: string, ...args: never[]) => db.prepare(sql).all(...args),
    runAsync: async (sql: string, ...args: never[]) => db.prepare(sql).run(...args),
    withExclusiveTransactionAsync: async (work: (transaction: unknown) => Promise<void>) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        await work(value);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  };
  return value;
}

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.context = null;
  mocks.donutProps = null;
  directory = mkdtempSync(join(tmpdir(), "dayframe-today-presentation-test-"));
  db = new DatabaseSync(join(directory, "review.db"));
  mocks.open.mockImplementation(async () => adapter());
  vi.resetModules();
  store = await import("../../lib/reviewSyncStore");
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("Today presentation cache rendering", () => {
  it("caches an actual valid response through the mobile schema before rendering the Today summary", async () => {
    const bootstrap = syntheticReviewBootstrap(1);
    const owner = {
      backendId: "dayframe-staging",
      workspaceId: bootstrap.workspace.id,
      userId: bootstrap.user.id
    };
    await store.processReviewBootstrap(bootstrap);

    const response = ReviewPresentationResponseSchema.parse({
      version: 1,
      scope: {
        mode: "window",
        timeZone: "Etc/UTC",
        window: { start: "2026-07-15T00:00:00.000Z", end: "2026-09-13T00:00:00.000Z" },
        today: { start: "2026-09-12T00:00:00.000Z", end: "2026-09-13T00:00:00.000Z" }
      },
      snapshotToken: "actual-response-through-sqlite",
      capturedAt: "2026-09-12T12:00:00.000Z",
      nextCursor: null,
      completeness: {
        records: true,
        outstandingCounts: true,
        completedToday: true,
        partialReason: null
      },
      outstanding: { globalCount: 0, todayCount: 0, openReviewItemIds: [] },
      records: [{
        kind: "completed_entry",
        entryId: syntheticId(9_000),
        eventId: null,
        title: "Cached completed walk",
        category: { id: null, name: null, color: null },
        place: { id: null, label: null },
        interval: { start: "2026-09-12T09:00:00.000Z", end: "2026-09-12T09:30:00.000Z" },
        confidence: "high",
        reviewStatus: "confirmed",
        updatedAt: "2026-09-12T09:30:00.000Z",
        source: "manual_app"
      }],
      links: [],
      lookup: { reviewItems: [], entries: [] }
    });

    expect(await store.cacheReviewPresentation({ owner, response })).toBe(true);
    const cached = await store.readReviewPresentationSnapshot({ owner, response });
    expect(cached?.response).toEqual(response);

    const presentation = projectTodayReviewPresentation({
      ownerKey: `${owner.backendId}:${owner.workspaceId}:${owner.userId}`,
      snapshotOwnerKey: `${owner.backendId}:${owner.workspaceId}:${owner.userId}`,
      response: cached!.response,
      effects: cached!.effects,
      dashboardEntries: [],
      manualProjectedEntries: [],
      day: {
        key: "2026-09-12",
        startMs: Date.parse("2026-09-12T00:00:00.000Z"),
        endMs: Date.parse("2026-09-13T00:00:00.000Z")
      },
      nowMs: Date.parse("2026-09-12T12:00:00.000Z")
    });
    mocks.context = {
      error: null,
      errorKind: null,
      isSummaryAvailable: true,
      openActivity: vi.fn(),
      openReview: vi.fn(),
      owner,
      presentation
    };

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TodayReviewSummary isFocused />);
    });

    expect(tree.root.findByProps({ testID: "today-review-summary" })).toBeTruthy();
    expect(mocks.donutProps).toMatchObject({ completedLoggedMs: 30 * 60_000 });
  });
});
