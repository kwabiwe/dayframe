import { describe, expect, it, vi } from "vitest";
import { healthWorkoutCoversMove, healthWorkoutKind, reconcileHealthCoveredMoveCardsNow } from "./health-coverage";

const session = { workspaceId: "00000000-0000-4000-8000-000000000010", userId: "00000000-0000-4000-8000-000000000001" } as never;

const at = (minute: number) => new Date(Date.parse("2026-10-16T12:00:00Z") + minute * 60_000).toISOString();
const move = (from: number, to: number, travelMode: "walking" | "running" | "cycling" | "automotive" | null = "walking") =>
  ({ startedAt: at(from), stoppedAt: at(to), travelMode });
const workout = (from: number, to: number, workoutType: unknown = "walking") => ({ startedAt: at(from), stoppedAt: at(to), workoutType });

describe("Health walks win (PRD D19)", () => {
  it("lets a walk, run or ride workout cover a Move of its kind by at least half", () => {
    expect(healthWorkoutCoversMove(move(0, 30), workout(10, 40))).toBe(true);
    expect(healthWorkoutCoversMove(move(0, 30, "running"), workout(10, 40, "running"))).toBe(true);
    expect(healthWorkoutCoversMove(move(0, 30, "cycling"), workout(14, 60, "cycling"))).toBe(true);
    expect(healthWorkoutCoversMove(move(0, 30), workout(16, 60))).toBe(false);
  });

  it("covers a Move inside the workout give or take five minutes, whatever its share", () => {
    expect(healthWorkoutCoversMove(move(-4, 34), workout(0, 30))).toBe(true);
    expect(healthWorkoutCoversMove(move(-6, 20), workout(0, 30, "walking"))).toBe(true);
  });

  it("never lets a workout of another kind, or a non-travel workout, cover a Move", () => {
    expect(healthWorkoutCoversMove(move(0, 30, "automotive"), workout(0, 30))).toBe(false);
    expect(healthWorkoutCoversMove(move(0, 30, "running"), workout(0, 30, "walking"))).toBe(false);
    expect(healthWorkoutCoversMove(move(0, 30), workout(0, 30, "strength_training"))).toBe(false);
    expect(healthWorkoutCoversMove(move(0, 30), workout(0, 30, "other"))).toBe(false);
  });

  it("covers a Move without a mode only when it lies inside the workout", () => {
    expect(healthWorkoutCoversMove(move(2, 20, null), workout(0, 30))).toBe(true);
    expect(healthWorkoutCoversMove(move(0, 40, null), workout(0, 30))).toBe(false);
  });

  it("ignores impossible windows", () => {
    expect(healthWorkoutCoversMove(move(10, 10), workout(0, 30))).toBe(false);
    expect(healthWorkoutCoversMove({ startedAt: "nope", stoppedAt: at(1), travelMode: "walking" }, workout(0, 30))).toBe(false);
  });

  it("reads a workout's kind hint by hint, past JSON null or an unrecognised hint (Codex r1 on #457)", () => {
    expect(healthWorkoutKind([null, "Walk"])).toBe("walking");
    expect(healthWorkoutKind(["other", null, "running"])).toBe("running");
    expect(healthWorkoutKind([52])).toBe("walking");
    expect(healthWorkoutKind([null, undefined])).toBe("other");
    expect(healthWorkoutCoversMove(move(0, 30), workout(0, 30, ["other", null, "walking"]))).toBe(true);
  });

  it("commits each reconcile page on its own, so a later page running out of time keeps the earlier ones (Codex r5 on #457)", async () => {
    const statements: string[] = [];
    let pages = 0;
    const moves = Array.from({ length: 250 }, (_, index) => ({
      reviewId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      startedAt: new Date("2026-10-16T12:00:00.000Z"), stoppedAt: new Date("2026-10-16T12:10:00.000Z"), travelMode: "walking"
    }));
    const client = {
      on: vi.fn(), removeListener: vi.fn(), release: vi.fn(),
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        const text = sql.trim();
        if (/^(commit|rollback)$/.test(text)) statements.push(text);
        if (text.includes("current_setting('transaction_timeout'")) return { rows: [{ transaction_timeout: null }] };
        if (text.includes("pg_try_advisory_xact_lock")) return { rows: [{ acquired: true }] };
        if (text.startsWith('select ri.id as "reviewId"')) {
          pages += 1;
          if (pages === 2) throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
          return { rows: moves };
        }
        if (text.includes("jsonb_to_recordset")) {
          return { rows: moves.map((move) => ({ key: move.reviewId, startedAt: move.startedAt, stoppedAt: move.stoppedAt,
            storedType: "walking", payloadType: null, label: null, activity: null })) };
        }
        if (text.startsWith("update review_items")) return { rows: (params?.[2] as string[]).map((id) => ({ eventId: id })) };
        return { rows: [] };
      })
    };
    const databasePool = { connect: vi.fn(async () => client) } as never;
    expect(await reconcileHealthCoveredMoveCardsNow(session, { now: "2026-10-16T13:00:00.000Z", databasePool })).toBe(250);
    expect(statements).toEqual(["commit", "rollback"]);
  });

  it("does nothing while a replay holds the location owner lock", async () => {
    const client = {
      on: vi.fn(), removeListener: vi.fn(), release: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes("pg_try_advisory_xact_lock") ? { rows: [{ acquired: false }] }
        : sql.includes("current_setting") ? { rows: [{ transaction_timeout: null }] } : { rows: [] })
    };
    expect(await reconcileHealthCoveredMoveCardsNow(session, { databasePool: { connect: vi.fn(async () => client) } as never })).toBeNull();
    expect(client.query.mock.calls.some(([sql]) => String(sql).startsWith('select ri.id as "reviewId"'))).toBe(false);
  });
});
