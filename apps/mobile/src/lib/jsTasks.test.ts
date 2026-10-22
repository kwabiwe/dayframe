import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetJsTasksForTests, runningJsTasks, setJsTaskSink, withJsTask } from "./jsTasks";

describe("labelled JS tasks for the freeze watchdog", () => {
  afterEach(() => __resetJsTasksForTests());

  it("names every running task and the one that started last, and clears them when they end", async () => {
    const sink = vi.fn();
    setJsTaskSink(sink);
    let releaseSync!: () => void;
    const sync = withJsTask("sync-queue", () => new Promise<void>((resolve) => { releaseSync = resolve; }));
    let releaseReplay!: () => void;
    const replay = withJsTask("location-replay", () => new Promise<void>((resolve) => { releaseReplay = resolve; }));

    expect(runningJsTasks()).toEqual({ running: ["location-replay", "sync-queue"], last: "location-replay" });
    releaseReplay();
    await replay;
    expect(runningJsTasks()).toEqual({ running: ["sync-queue"], last: "sync-queue" });
    releaseSync();
    await sync;
    expect(runningJsTasks()).toEqual({ running: [], last: null });
    expect(sink).toHaveBeenLastCalledWith([], null);
  });

  it("counts overlapping runs of one label and ends them on failure too", async () => {
    const first = withJsTask("bootstrap", async () => undefined);
    let fail!: (error: Error) => void;
    const second = withJsTask("bootstrap", () => new Promise<void>((_resolve, reject) => { fail = reject; }));
    const settled = expect(second).rejects.toThrow("offline");
    await first;
    expect(runningJsTasks().running).toEqual(["bootstrap"]);
    fail(new Error("offline"));
    await settled;
    expect(runningJsTasks()).toEqual({ running: [], last: null });
  });

  it("never lets a failing sink break the work", async () => {
    setJsTaskSink(() => { throw new Error("native gone"); });
    await expect(withJsTask("health-wake", async () => 7)).resolves.toBe(7);
  });
});
