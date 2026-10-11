// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(async () => new Response("{}", { status: 200 })),
  refresh: vi.fn(async () => null),
  routerRefresh: vi.fn()
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.routerRefresh }) }));
vi.mock("@/components/AppShellRuntime", () => ({ useAppShellRuntime: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: mocks.fetch }));

const { GoalSettings } = await import("./GoalSettings");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.fetch.mockClear();
});

describe("Settings › Your day steppers (UIA-309)", () => {
  it("changes at once, saves the latest goals once after the last tap, with no Save button", async () => {
    vi.useFakeTimers();
    const view = render(<GoalSettings dailyGoalMinutes={480} weeklyGoalMinutes={2520} />);
    expect(view.queryByRole("button", { name: /save/i })).toBeNull();
    expect(view.getByRole("group", { name: "Daily goal: 8h" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    // 42 h a week steps to the 5-hour grid.
    fireEvent.click(view.getByRole("button", { name: "Increase weekly goal" }));
    expect(view.getByRole("group", { name: "Daily goal: 10h" })).toBeTruthy();
    expect(view.getByRole("group", { name: "Weekly goal: 45h" })).toBeTruthy();
    expect(mocks.fetch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((mocks.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)))
      .toEqual({ dailyGoalMinutes: 600, weeklyGoalMinutes: 2700 });
  });

  it("disables a step past the limits, and a failed save shows the account's goal again", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const view = render(<GoalSettings dailyGoalMinutes={60} weeklyGoalMinutes={2400} />);
    expect((view.getByRole("button", { name: "Decrease daily goal" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(view.getByRole("alert").textContent).toContain("not saved");
    expect(view.getByRole("group", { name: "Daily goal: 1h" })).toBeTruthy();
  });

  it("leaving the page saves a pending change at once", async () => {
    vi.useFakeTimers();
    const view = render(<GoalSettings dailyGoalMinutes={480} weeklyGoalMinutes={2400} />);
    fireEvent.click(view.getByRole("button", { name: "Decrease daily goal" }));
    view.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
