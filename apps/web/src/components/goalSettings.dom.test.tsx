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
    expect(mocks.refresh).toHaveBeenCalledWith({ force: true, freshOnly: true });
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

  it("a later visit saves only the goal it changed, never undoing the earlier visit's (Codex r4)", async () => {
    vi.useFakeTimers();
    const first = render(<GoalSettings dailyGoalMinutes={480} userId="user-1" weeklyGoalMinutes={2400} />);
    fireEvent.click(first.getByRole("button", { name: "Increase daily goal" }));
    first.unmount(); // leaving Settings sends 9h
    // Back again before the page data caught up (still 8h / 40h).
    const second = render(<GoalSettings dailyGoalMinutes={480} userId="user-1" weeklyGoalMinutes={2400} />);
    fireEvent.click(second.getByRole("button", { name: "Increase weekly goal" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    const bodies = mocks.fetch.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect(bodies).toEqual([
      { dailyGoalMinutes: 540, expectedUserId: "user-1" },
      { weeklyGoalMinutes: 2700, expectedUserId: "user-1" }
    ]);
  });

  it("keeps tapped goals on screen until fresh data arrives after the last save (Codex r5)", async () => {
    vi.useFakeTimers();
    const view = render(<GoalSettings dailyGoalMinutes={480} userId="user-1" weeklyGoalMinutes={2400} />);
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    // The refresh after the save only had cached data (null): the tapped 9h stays.
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    view.rerender(<GoalSettings dailyGoalMinutes={480} userId="user-1" weeklyGoalMinutes={2400} />);
    expect(view.getByRole("group", { name: "Daily goal: 9h" })).toBeTruthy();
    // Next time the refresh is fresh: the page's data shows from then on.
    mocks.refresh.mockResolvedValueOnce({} as never);
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    view.rerender(<GoalSettings dailyGoalMinutes={600} userId="user-1" weeklyGoalMinutes={2400} />);
    expect(view.getByRole("group", { name: "Daily goal: 10h" })).toBeTruthy();
    view.rerender(<GoalSettings dailyGoalMinutes={720} userId="user-1" weeklyGoalMinutes={2400} />);
    expect(view.getByRole("group", { name: "Daily goal: 12h" })).toBeTruthy();
  });

  it("a page refresh while saving never takes back a newer tap (Codex r5)", async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    mocks.fetch.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(new Response("{}", { status: 200 })); }));
    const view = render(<GoalSettings dailyGoalMinutes={480} userId="user-1" weeklyGoalMinutes={2400} />);
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" })); // 9h, in flight
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" })); // 10h, pending
    // Data from an earlier refresh arrives meanwhile: the taps stay.
    view.rerender(<GoalSettings dailyGoalMinutes={540} userId="user-1" weeklyGoalMinutes={2400} />);
    expect(view.getByRole("group", { name: "Daily goal: 10h" })).toBeTruthy();
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(600); });
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    expect(view.getByRole("group", { name: "Daily goal: 11h" })).toBeTruthy();
  });

  it("a failed save takes back the goals it carried; the app reloads once everything is done (Codex r4–r5)", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation(async () => new Response("{}", { status: 500 }));
    const view = render(<GoalSettings dailyGoalMinutes={480} userId="user-1" weeklyGoalMinutes={2400} />);
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    fireEvent.click(view.getByRole("button", { name: "Increase weekly goal" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    // One save carried both and failed: both go back; one reload when idle.
    expect(view.getByRole("alert").textContent).toContain("not saved");
    expect(view.getByRole("group", { name: "Daily goal: 8h" })).toBeTruthy();
    expect(view.getByRole("group", { name: "Weekly goal: 40h" })).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    mocks.fetch.mockImplementation(async () => new Response("{}", { status: 200 }));
  });

  it("a failed newer save of the same goal falls back to the value the account accepted (Codex r6)", async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    mocks.fetch
      .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(new Response("{}", { status: 200 })); }))
      .mockImplementationOnce(async () => new Response("{}", { status: 500 }));
    const view = render(<GoalSettings dailyGoalMinutes={480} userId="user-1" weeklyGoalMinutes={2400} />);
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" })); // 9h, held in flight
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" })); // 10h, queued
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(600); }); // 9h accepted, 10h rejected
    expect(view.getByRole("alert").textContent).toContain("not saved");
    // The account holds 9h, not the page's cached 8h.
    expect(view.getByRole("group", { name: "Daily goal: 9h" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    expect(view.getByRole("group", { name: "Daily goal: 10h" })).toBeTruthy();
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
