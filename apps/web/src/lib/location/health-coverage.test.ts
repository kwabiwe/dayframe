import { describe, expect, it } from "vitest";
import { healthWorkoutCoversMove, healthWorkoutKind } from "./health-coverage";

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
});
