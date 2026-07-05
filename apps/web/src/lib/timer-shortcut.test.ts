import { describe, expect, it, vi } from "vitest";
import type { BootstrapData } from "@/lib/queries";
import { toggleTimerFromFreshBootstrap } from "./timer-shortcut";

describe("toggleTimerFromFreshBootstrap", () => {
  it("stops a freshly fetched active timer on the first shortcut press", async () => {
    const activeData = bootstrapData({ activeEntry: { id: "entry-1" } });
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.startsWith("/api/bootstrap")) {
        return jsonResponse(activeData);
      }
      if (input === "/api/time-entries") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ mode: "stop" });
        return jsonResponse({ ok: true }, 201);
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    const refresh = vi.fn(async () => undefined);
    const setData = vi.fn();

    const result = await toggleTimerFromFreshBootstrap({
      fallbackData: bootstrapData({ activeEntry: null }),
      fetcher,
      refresh,
      selectedDate: "2026-07-05",
      setData
    });

    expect(result).toBe("stopped");
    expect(fetcher).toHaveBeenCalledWith("/api/bootstrap?date=2026-07-05", { cache: "no-store" });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/time-entries",
      expect.objectContaining({
        body: JSON.stringify({ mode: "stop" }),
        method: "POST"
      })
    );
    expect(setData).toHaveBeenCalledWith(activeData);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("focuses timer input instead of starting a blank timer when no active timer exists", async () => {
    const idleData = bootstrapData({ activeEntry: null });
    const fetcher = vi.fn(async (input: string) => {
      if (input.startsWith("/api/bootstrap")) return jsonResponse(idleData);
      throw new Error(`Unexpected request: ${input}`);
    });
    const focusTimerInput = vi.fn();

    const result = await toggleTimerFromFreshBootstrap({
      fallbackData: idleData,
      fetcher,
      focusTimerInput,
      refresh: vi.fn(async () => undefined),
      selectedDate: "2026-07-05"
    });

    expect(result).toBe("focused");
    expect(focusTimerInput).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" }
    })
  );
}

function bootstrapData({
  activeEntry
}: {
  activeEntry: BootstrapData["activeEntry"] | { id: string } | null;
}) {
  return {
    activeEntry,
    categories: [],
    dateRange: { selectedDate: "2026-07-05" },
    workspace: { id: "workspace-1", name: "Personal" },
    workspaces: [{ id: "workspace-1", name: "Personal" }]
  } as unknown as BootstrapData;
}
