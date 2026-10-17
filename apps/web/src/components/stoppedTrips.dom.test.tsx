// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: mocks.fetch }));

const { StoppedTripsSection } = await import("./StoppedTripsSection");

afterEach(() => {
  cleanup();
  mocks.fetch.mockReset();
});

describe("Places › Trips (PRD D19, A4)", () => {
  it("lists the trips the person stopped logging and logs one automatically again", async () => {
    mocks.fetch.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? new Response(JSON.stringify({ ok: true }), { status: 200 })
      : new Response(JSON.stringify({ trips: [{ patternKey: "key-1", label: "Synthetic A → Synthetic B", stoppedAt: "2026-10-17T07:00:00.000Z" }] }), { status: 200 }));
    render(<StoppedTripsSection />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Trips you log yourself" })).toBeTruthy());
    expect(screen.getByText("Synthetic A → Synthetic B")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Log automatically again" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("logs itself again"));
    expect(screen.queryByText("Synthetic A → Synthetic B", { selector: "h3" })).toBeNull();
    expect(mocks.fetch).toHaveBeenLastCalledWith("/api/location/name-patterns", expect.objectContaining({
      method: "POST", body: JSON.stringify({ action: "resume_trips", patternKey: "key-1" }) }));
  });

  it("shows nothing when no trip is stopped, or when offline", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ trips: [] }), { status: 200 }));
    const { container, unmount } = render(<StoppedTripsSection />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    unmount();
    mocks.fetch.mockRejectedValueOnce(new TypeError("Network request failed"));
    const offline = render(<StoppedTripsSection />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(offline.container.textContent).toBe("");
  });

  it("keeps keyboard focus on the next trip, or the heading, after logging one again (Codex r1 on #463)", async () => {
    const trips = [
      { patternKey: "key-1", label: "Synthetic A → Synthetic B", stoppedAt: "2026-10-17T07:00:00.000Z" },
      { patternKey: "key-2", label: "Synthetic C → Synthetic D", stoppedAt: "2026-10-16T07:00:00.000Z" }
    ];
    mocks.fetch.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? new Response(JSON.stringify({ ok: true }), { status: 200 })
      : new Response(JSON.stringify({ trips }), { status: 200 }));
    render(<StoppedTripsSection />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Log automatically again" })).toHaveLength(2));
    const user = userEvent.setup();
    screen.getAllByRole("button", { name: "Log automatically again" })[0].focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Log automatically again" })).toHaveLength(1));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Log automatically again" }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Log automatically again" })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Trips you log yourself" }));
  });
});
