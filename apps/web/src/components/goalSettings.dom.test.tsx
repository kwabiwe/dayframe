// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(async () => new Response("{}", { status: 200 })),
  refresh: vi.fn(async () => null),
  routerRefresh: vi.fn()
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.routerRefresh }) }));
vi.mock("@/components/AppShellRuntime", () => ({ useAppShellRuntime: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: mocks.fetch }));

const { GoalSettings } = await import("./GoalSettings");
const { __resetGoalSaveQueueForTests } = await import("@/lib/goal-stepper");

afterEach(async () => {
  cleanup();
  // A test's unmount flush settles before the next test starts counting.
  await act(async () => { await vi.runAllTimersAsync().catch(() => undefined); });
  vi.useRealTimers();
});

beforeEach(() => {
  __resetGoalSaveQueueForTests();
  mocks.fetch.mockClear();
  mocks.refresh.mockClear();
  mocks.routerRefresh.mockClear();
});

describe("Settings › Your day steppers (UIA-309)", () => {
  it("changes at once, saves the latest goals once after the last tap, with no Save button", async () => {
    vi.useFakeTimers();
    const view = render(<GoalSettings dailyGoalMinutes={480} userId="user-1" weeklyGoalMinutes={2520} />);
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
      .toEqual({ dailyGoalMinutes: 600, weeklyGoalMinutes: 2700, expectedUserId: "user-1" });
    expect((mocks.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].keepalive).toBe(true);
  });

  it("disables a step past the limits, and a failed save shows the account's goal again", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const view = render(<GoalSettings dailyGoalMinutes={60} userId="user-1" weeklyGoalMinutes={2400} />);
    expect((view.getByRole("button", { name: "Decrease daily goal" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(view.getByRole("alert").textContent).toContain("not saved");
    expect(view.getByRole("group", { name: "Daily goal: 1h" })).toBeTruthy();
  });

  it("a save made just before leaving still updates the app (Today, Reports) after Settings closes (Codex r1)", async () => {
    vi.useFakeTimers();
    const view = render(<GoalSettings dailyGoalMinutes={480} userId="user-1" weeklyGoalMinutes={2400} />);
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    view.unmount();
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledWith({ force: true });
    expect(mocks.routerRefresh).toHaveBeenCalled();
  });

  it("an older save's refresh never erases a newer tap (Codex r1)", async () => {
    vi.useFakeTimers();
    let finishRefresh: () => void = () => undefined;
    mocks.refresh.mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = () => resolve(null); }));
    const view = render(<GoalSettings dailyGoalMinutes={480} userId="user-1" weeklyGoalMinutes={2400} />);
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" })); // 9h
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" })); // 10h while 9h's refresh waits
    await act(async () => { finishRefresh(); await Promise.resolve(); await Promise.resolve(); });
    expect(view.getByRole("group", { name: "Daily goal: 10h" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    expect(view.getByRole("group", { name: "Daily goal: 11h" })).toBeTruthy();
  });

  it("keeps a saved goal on screen when the refresh falls back to cached data, and follows newer data (Codex r2)", async () => {
    vi.useFakeTimers();
    const view = render(<GoalSettings dailyGoalMinutes={480} userId="user-1" weeklyGoalMinutes={2400} />);
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    // The page still has the old data (the refresh used its cache): the saved 9h stays.
    view.rerender(<GoalSettings dailyGoalMinutes={480} userId="user-1" weeklyGoalMinutes={2400} />);
    expect(view.getByRole("group", { name: "Daily goal: 9h" })).toBeTruthy();
    // Fresh data, then a change made elsewhere: the page follows its data.
    view.rerender(<GoalSettings dailyGoalMinutes={540} userId="user-1" weeklyGoalMinutes={2400} />);
    expect(view.getByRole("group", { name: "Daily goal: 9h" })).toBeTruthy();
    view.rerender(<GoalSettings dailyGoalMinutes={720} userId="user-1" weeklyGoalMinutes={2400} />);
    expect(view.getByRole("group", { name: "Daily goal: 12h" })).toBeTruthy();
    // And back to an older value elsewhere: the page follows its data, not an old save (Codex r3).
    view.rerender(<GoalSettings dailyGoalMinutes={480} userId="user-1" weeklyGoalMinutes={2400} />);
    expect(view.getByRole("group", { name: "Daily goal: 8h" })).toBeTruthy();
  });

  it("a failed later save keeps an earlier accepted one on screen (Codex r3)", async () => {
    vi.useFakeTimers();
    let call = 0;
    mocks.fetch.mockImplementation(async () => new Response("{}", { status: ++call === 1 ? 200 : 500 }));
    const view = render(<GoalSettings dailyGoalMinutes={480} userId="user-1" weeklyGoalMinutes={2400} />);
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" })); // 9h, saved
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    fireEvent.click(view.getByRole("button", { name: "Increase weekly goal" })); // 45h, fails
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(view.getByRole("alert").textContent).toContain("not saved");
    expect(view.getByRole("group", { name: "Daily goal: 9h" })).toBeTruthy();
    expect(view.getByRole("group", { name: "Weekly goal: 40h" })).toBeTruthy();
    mocks.fetch.mockImplementation(async () => new Response("{}", { status: 200 }));
  });

  it("leaving the page saves a pending change at once", async () => {
    vi.useFakeTimers();
    const view = render(<GoalSettings dailyGoalMinutes={480} userId="user-1" weeklyGoalMinutes={2400} />);
    fireEvent.click(view.getByRole("button", { name: "Decrease daily goal" }));
    view.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
