// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A fake account: each accepted save applies its goals and bumps the revision, and the reply
 * carries the goals as stored (like PATCH /api/profile).
 */
const server = { dailyGoalMinutes: 480, weeklyGoalMinutes: 2400, goalsRevision: 1 };
function accept(init?: RequestInit) {
  const body = JSON.parse(String(init?.body ?? "{}")) as Partial<typeof server>;
  if (body.dailyGoalMinutes !== undefined) server.dailyGoalMinutes = body.dailyGoalMinutes;
  if (body.weeklyGoalMinutes !== undefined) server.weeklyGoalMinutes = body.weeklyGoalMinutes;
  server.goalsRevision += 1;
  return new Response(JSON.stringify({ ok: true, goals: { ...server } }), { status: 200 });
}

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(async (_url: string, init?: RequestInit) => accept(init)),
  refresh: vi.fn(async () => null),
  routerRefresh: vi.fn()
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.routerRefresh }) }));
vi.mock("@/components/AppShellRuntime", () => ({ useAppShellRuntime: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: mocks.fetch }));

const { GoalSettings } = await import("./GoalSettings");
const { __resetGoalDraftsForTests, __resetGoalSaveQueueForTests } = await import("@/lib/goal-stepper");

/** The page's data: goals with the server revision they were read at. */
const page = (daily: number, weekly: number, revision: number) => (
  <GoalSettings dailyGoalMinutes={daily} goalsRevision={revision} userId="user-1" weeklyGoalMinutes={weekly} />
);
const held = () => {
  let release: () => void = () => undefined;
  mocks.fetch.mockImplementationOnce((_url: string, init?: RequestInit) => new Promise((resolve) => {
    // The server applies the write now; only its reply is held back.
    const reply = accept(init);
    release = () => resolve(reply);
  }));
  return () => release();
};
const failOnce = () => mocks.fetch.mockImplementationOnce(async () => new Response("{}", { status: 500 }));

afterEach(async () => {
  cleanup();
  // A test's unmount flush settles before the next test starts counting.
  await act(async () => { await vi.runAllTimersAsync().catch(() => undefined); });
  vi.useRealTimers();
});

beforeEach(() => {
  __resetGoalSaveQueueForTests();
  __resetGoalDraftsForTests();
  Object.assign(server, { dailyGoalMinutes: 480, weeklyGoalMinutes: 2400, goalsRevision: 1 });
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async (_url: string, init?: RequestInit) => accept(init));
  mocks.refresh.mockClear();
  mocks.routerRefresh.mockClear();
});

describe("Settings › Your day steppers (UIA-309)", () => {
  it("changes at once, saves the latest goals once after the last tap, with no Save button", async () => {
    vi.useFakeTimers();
    const view = render(page(480, 2520, 1));
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
    failOnce();
    const view = render(page(60, 2400, 1));
    expect((view.getByRole("button", { name: "Decrease daily goal" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(view.getByRole("alert").textContent).toContain("not saved");
    expect(view.getByRole("group", { name: "Daily goal: 1h" })).toBeTruthy();
  });

  it("a save made just before leaving still updates the app (Today, Reports) after Settings closes (Codex r1)", async () => {
    vi.useFakeTimers();
    const view = render(page(480, 2400, 1));
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
    const view = render(page(480, 2400, 1));
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
    mocks.fetch.mockImplementationOnce(async (_url: string, init?: RequestInit) => accept(init));
    failOnce();
    const view = render(page(480, 2400, 1));
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" })); // 9h, saved
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    fireEvent.click(view.getByRole("button", { name: "Increase weekly goal" })); // 45h, fails
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(view.getByRole("alert").textContent).toContain("not saved");
    expect(view.getByRole("group", { name: "Daily goal: 9h" })).toBeTruthy();
    expect(view.getByRole("group", { name: "Weekly goal: 40h" })).toBeTruthy();
  });

  it("a later visit saves only the goal it changed, never undoing the earlier visit's (Codex r4)", async () => {
    vi.useFakeTimers();
    const first = render(page(480, 2400, 1));
    fireEvent.click(first.getByRole("button", { name: "Increase daily goal" }));
    first.unmount(); // leaving Settings sends 9h
    // Back again before the page data caught up (still 8h / 40h).
    const second = render(page(480, 2400, 1));
    fireEvent.click(second.getByRole("button", { name: "Increase weekly goal" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    const bodies = mocks.fetch.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect(bodies).toEqual([
      { dailyGoalMinutes: 540, expectedUserId: "user-1" },
      { weeklyGoalMinutes: 2700, expectedUserId: "user-1" }
    ]);
  });

  it("shows the accepted goal over an older page, and a newer page's goal once it arrives (Codex r5–r7)", async () => {
    vi.useFakeTimers();
    const view = render(page(480, 2400, 1));
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); }); // 9h accepted at revision 2
    // The page still has 8h from revision 1.
    view.rerender(page(480, 2400, 1));
    expect(view.getByRole("group", { name: "Daily goal: 9h" })).toBeTruthy();
    // A later load from the server (12h, changed elsewhere since) shows from then on.
    view.rerender(page(720, 2400, 3));
    expect(view.getByRole("group", { name: "Daily goal: 12h" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    expect(view.getByRole("group", { name: "Daily goal: 13h" })).toBeTruthy();
  });

  it("an older snapshot shown again after fresh data never brings back the old goal (Codex r8)", async () => {
    vi.useFakeTimers();
    const view = render(page(480, 2400, 1));
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); }); // 9h accepted at revision 2
    view.rerender(page(540, 2400, 2));
    view.rerender(page(480, 2400, 1)); // a late period load, a rollback, server-rendered
    expect(view.getByRole("group", { name: "Daily goal: 9h" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    expect(view.getByRole("group", { name: "Daily goal: 10h" })).toBeTruthy();
  });

  it("a stale snapshot after a newer change made elsewhere keeps the newest goal (Codex r9)", async () => {
    vi.useFakeTimers();
    const view = render(page(480, 2400, 1));
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); }); // 9h at revision 2
    view.rerender(page(720, 2400, 3)); // 12h set elsewhere
    view.rerender(page(480, 2400, 1)); // stale 8h hydrates
    expect(view.getByRole("group", { name: "Daily goal: 12h" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    const body = JSON.parse(String((mocks.fetch.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body));
    expect(body.dailyGoalMinutes).toBe(780);
  });

  it("a delayed reply never hides a change made elsewhere after the save (Codex r9)", async () => {
    vi.useFakeTimers();
    const release = held();
    const view = render(page(480, 2400, 1));
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); }); // server stores 9h at revision 2; reply held
    // Meanwhile 12h is set elsewhere (revision 3) and a refresh shows it.
    Object.assign(server, { dailyGoalMinutes: 720, goalsRevision: 3 });
    view.rerender(page(720, 2400, 3));
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    expect(view.getByRole("group", { name: "Daily goal: 12h" })).toBeTruthy();
    expect(view.queryByText("Saved")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    expect(view.getByRole("group", { name: "Daily goal: 13h" })).toBeTruthy();
  });

  it("remembers an accepted goal across visits to Settings (Codex r7)", async () => {
    vi.useFakeTimers();
    const release = held();
    failOnce();
    const first = render(page(480, 2400, 1));
    fireEvent.click(first.getByRole("button", { name: "Increase daily goal" })); // 9h
    first.unmount(); // sends 9h, held in flight
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const second = render(page(480, 2400, 1));
    expect(second.getByRole("group", { name: "Daily goal: 9h" })).toBeTruthy();
    fireEvent.click(second.getByRole("button", { name: "Decrease daily goal" })); // 8h, queued
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(600); }); // 9h accepted, 8h rejected
    expect(second.getByRole("alert").textContent).toContain("not saved");
    // The account holds 9h (revision 2); the page's data (8h) is revision 1.
    expect(second.getByRole("group", { name: "Daily goal: 9h" })).toBeTruthy();
  });

  it("a page refresh while saving never takes back a newer tap (Codex r5)", async () => {
    vi.useFakeTimers();
    const release = held();
    const view = render(page(480, 2400, 1));
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" })); // 9h, in flight
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" })); // 10h, pending
    // Data from an earlier refresh arrives meanwhile: the taps stay.
    view.rerender(page(540, 2400, 2));
    expect(view.getByRole("group", { name: "Daily goal: 10h" })).toBeTruthy();
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(600); });
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    expect(view.getByRole("group", { name: "Daily goal: 11h" })).toBeTruthy();
  });

  it("a failed save takes back the goals it carried; the app reloads once everything is done (Codex r4–r5)", async () => {
    vi.useFakeTimers();
    failOnce();
    const view = render(page(480, 2400, 1));
    fireEvent.click(view.getByRole("button", { name: "Increase daily goal" }));
    fireEvent.click(view.getByRole("button", { name: "Increase weekly goal" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    // One save carried both and failed: both go back; one reload when idle.
    expect(view.getByRole("alert").textContent).toContain("not saved");
    expect(view.getByRole("group", { name: "Daily goal: 8h" })).toBeTruthy();
    expect(view.getByRole("group", { name: "Weekly goal: 40h" })).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("a failed newer save of the same goal falls back to the value the account accepted (Codex r6)", async () => {
    vi.useFakeTimers();
    const release = held();
    failOnce();
    const view = render(page(480, 2400, 1));
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
    const view = render(page(480, 2400, 1));
    fireEvent.click(view.getByRole("button", { name: "Decrease daily goal" }));
    view.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
