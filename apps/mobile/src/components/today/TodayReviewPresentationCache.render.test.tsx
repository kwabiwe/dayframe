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
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style },
  Text: "Text",
  View: "View"
}));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: () => null }));
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" } }));
vi.mock("../../lib/motion", () => ({ localPresenceEntering: () => "entering", localPresenceExiting: () => "exiting" }));
vi.mock("./TodayReviewPresentationContext", () => ({
  useTodayReviewPresentationContext: () => mocks.context
}));

import { TodayReviewNudge } from "./TodayReviewNudge";

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
  it("caches an actual valid response through the mobile schema before rendering the Today nudge", async () => {
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

    expect(presentation.completedLoggedMs).toBe(30 * 60_000);
    expect(presentation.globalReviewCount).toEqual({ value: 0, exact: true });

    // An exact cached zero with nothing in the bootstrap either: no nudge.
    const theme = { mode: "dark", surface: "surface", surfaceMuted: "muted", textPrimary: "primary", textSecondary: "secondary" } as never;
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TodayReviewNudge fallback={{ value: 0, exact: true }} onOpenReview={vi.fn()} reduceMotion={false} theme={theme} />);
    });
    expect(tree.toJSON()).toBeNull();

    // Without a usable presentation the bootstrap count still opens Review.
    mocks.context = { ...mocks.context, isSummaryAvailable: false };
    const onOpenReview = vi.fn();
    act(() => {
      tree.update(<TodayReviewNudge fallback={{ value: 3, exact: true }} onOpenReview={onOpenReview} reduceMotion={false} theme={theme} />);
    });
    const nudge = tree.root.findByProps({ testID: "today-review-nudge" });
    expect(nudge.props.accessibilityLabel).toBe("3 moments to review. Dayframe found time you didn't track.");
    act(() => nudge.props.onPress());
    expect(onOpenReview).toHaveBeenCalledTimes(1);
  });
});
