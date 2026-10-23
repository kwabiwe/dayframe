import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { runPreparedExport } from "./preparedExport";

describe("prepared Settings exports (Share location details, stability audit location-3; Codex r1 on #537)", () => {
  it("shows Preparing and lets a frame paint before the blocking work starts", async () => {
    const events: string[] = [];
    let paint!: () => void;
    const work = vi.fn(async () => { events.push("work"); });
    const run = runPreparedExport({ current: false }, (preparing) => events.push(`preparing:${preparing}`), work,
      () => new Promise<void>((resolve) => { paint = () => { events.push("painted"); resolve(); }; }));
    await Promise.resolve();
    // Still waiting for the frame: Preparing is set and nothing blocking has run.
    expect(events).toEqual(["preparing:true"]);
    expect(work).not.toHaveBeenCalled();
    paint();
    await expect(run).resolves.toBe(true);
    expect(events).toEqual(["preparing:true", "painted", "work", "preparing:false"]);
  });

  it("ignores a second press while one export runs, and allows the next once it ends, even after a failure", async () => {
    const guard = { current: false };
    let finish!: () => void;
    const setPreparing = vi.fn();
    const work = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = runPreparedExport(guard, setPreparing, work, async () => undefined);
    await expect(runPreparedExport(guard, setPreparing, work, async () => undefined)).resolves.toBe(false);
    await vi.waitFor(() => expect(work).toHaveBeenCalledOnce());
    finish();
    await expect(first).resolves.toBe(true);
    const failing = vi.fn(async () => { throw new Error("synthetic share failure"); });
    await expect(runPreparedExport(guard, setPreparing, failing, async () => undefined)).rejects.toThrow("synthetic share failure");
    expect(guard.current).toBe(false);
    expect(setPreparing).toHaveBeenLastCalledWith(false);
    await expect(runPreparedExport(guard, setPreparing, async () => undefined, async () => undefined)).resolves.toBe(true);
  });

  it("Share location details goes through it and its row reads Preparing… and is disabled meanwhile", () => {
    const settings = readFileSync(fileURLToPath(new URL("../../app/settings.tsx", import.meta.url)), "utf8");
    expect(settings).toContain("runPreparedExport(locationDiagnosticsExport, setPreparingLocationDiagnostics, shareLocationDiagnosticsNow)");
    const row = settings.slice(settings.lastIndexOf("<SettingsBlockRow", settings.indexOf('testID="sync-help-location"')), settings.indexOf('testID="sync-help-location"'));
    expect(row).toContain("disabled={preparingLocationDiagnostics}");
    expect(row).toContain('preparingLocationDiagnostics ? "Preparing…"');
    expect(row).toContain("onPress={() => void shareLocationDiagnostics()}");
    // Only the guarded entry point runs the replay.
    expect(settings.match(/shareLocationDiagnosticsNow/g)).toHaveLength(2);
  });
});
