// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Codex r4 on #625: Alt+← / Alt+→ load a period before moving the URL. A Calendar nav tap while that load waits wins:
// the URL stays on today, and the shell's data goes back to it.

const navigation = vi.hoisted(() => ({ search: "" }));
const runtime = vi.hoisted(() => ({
  data: null as unknown,
  loadDate: vi.fn(),
  refresh: vi.fn(async () => undefined),
  openManualEntry: vi.fn(),
  startTimer: vi.fn(),
  toggleTimer: vi.fn(),
  setProjectedEnds: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/timeline",
  useSearchParams: () => new URLSearchParams(navigation.search)
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => <a href={href} {...props}>{children}</a>
}));
vi.mock("@/components/AppShellRuntime", () => ({
  AppShellRuntimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAppShellRuntime: () => runtime
}));
vi.mock("@/components/PersistentTimerBar", () => ({ PersistentTimerBar: () => null }));
vi.mock("@/components/blocks/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/location/useClashesBeyondCap", () => ({ useClashesBeyondCap: () => [] }));
vi.mock("@/components/location/ListChecks", () => ({
  CheckDecisionsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useEndedBlocks: () => new Map(),
  useProjectedReviewItems: (items: unknown) => items
}));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: vi.fn(async () => ({ ok: false, json: async () => ({}) })) }));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })
  });
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { disconnect() {} observe() {} unobserve() {} } });
});
afterEach(() => cleanup());

describe("Alt+← with a Calendar tap while its period loads (Codex r4 on #625)", () => {
  it("stays on today: the late load never moves the URL, and the data goes back to today", async () => {
    // Today's Grid, by day.
    navigation.search = "date=2026-10-29&scope=day&view=calendar";
    window.history.replaceState(null, "", `/timeline?${navigation.search}`);
    let finish: (outcome: { ok: true }) => void = () => undefined;
    runtime.loadDate.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    runtime.refresh.mockClear();
    const { AppShell } = await import("./AppShell");
    const { getAllByRole } = render(<AppShell><p>Calendar</p></AppShell>);
    await act(async () => undefined);

    // Alt+←: the 28th starts loading.
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true })); });
    expect(runtime.loadDate).toHaveBeenCalledWith("2026-10-28");
    // Calendar is tapped while it loads (the test's browser doesn't follow the link), then the load finishes.
    const stay = (event: Event) => event.preventDefault();
    document.addEventListener("click", stay);
    await userEvent.setup().click(getAllByRole("link", { name: /^Calendar/ })[0]);
    document.removeEventListener("click", stay);
    await act(async () => { finish({ ok: true }); await Promise.resolve(); });
    expect(new URLSearchParams(window.location.search).get("date")).toBe("2026-10-29");
    expect(runtime.refresh).toHaveBeenCalled();
  });

  it("still moves to the previous day when nothing interrupts it", async () => {
    navigation.search = "date=2026-10-29&scope=day&view=calendar";
    window.history.replaceState(null, "", `/timeline?${navigation.search}`);
    runtime.loadDate.mockImplementation(async () => ({ ok: true }));
    const { AppShell } = await import("./AppShell");
    render(<AppShell><p>Calendar</p></AppShell>);
    await act(async () => undefined);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true }));
      await Promise.resolve();
    });
    expect(new URLSearchParams(window.location.search).get("date")).toBe("2026-10-28");
  });
});
