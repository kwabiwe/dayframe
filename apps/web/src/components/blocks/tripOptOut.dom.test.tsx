// @vitest-environment jsdom

import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: mocks.fetch }));

const { BlocksToast } = await import("./BlocksToast");
const { useTripOptOut } = await import("./useTripOptOut");

afterEach(() => {
  cleanup();
  mocks.fetch.mockReset();
});

describe("Don't log trips like this (PRD D19, A4)", () => {
  it("offers nothing for a block that is not an automatic Move", () => {
    const { result } = renderHook(() => useTripOptOut(null, 1));
    expect(result.current).toBeNull();
  });

  it("stops the trip's pattern from its Move's event and says so in the same row, keeping Undo", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const undo = vi.fn();
    function Harness() {
      const secondary = useTripOptOut("00000000-0000-4000-8000-0000000000e1", 7);
      return <BlocksToast actionLabel="Undo" message="“Commute” deleted" onAction={undo} secondary={secondary} />;
    }
    render(<Harness />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Don’t log trips like this" }));
    await waitFor(() => expect(screen.getByText("Trips like this will wait in Review.")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Don’t log trips like this" })).toBeNull();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(mocks.fetch).toHaveBeenCalledWith("/api/location/name-patterns", expect.objectContaining({
      method: "POST", body: JSON.stringify({ action: "stop_trips", eventId: "00000000-0000-4000-8000-0000000000e1" }) }));
    expect(undo).not.toHaveBeenCalled();
  });

  it("says when it could not save, and a newer toast starts fresh", async () => {
    mocks.fetch.mockRejectedValue(new TypeError("Network request failed"));
    const { result, rerender } = renderHook(({ token }) => useTripOptOut("00000000-0000-4000-8000-0000000000e1", token), { initialProps: { token: 1 } });
    await act(async () => { result.current!.onAction(); });
    await waitFor(() => expect(result.current?.done).toMatch(/Couldn’t save that/));
    rerender({ token: 2 });
    expect(result.current).toMatchObject({ busy: false, done: null });
  });

  it("moves focus to Undo when its focused action is replaced by the outcome (Codex r1 on #463)", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    function Harness() {
      const secondary = useTripOptOut("00000000-0000-4000-8000-0000000000e1", 9);
      return <BlocksToast actionLabel="Undo" message="“Commute” deleted" onAction={vi.fn()} secondary={secondary} />;
    }
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Don’t log trips like this" });
    button.focus();
    await userEvent.setup().keyboard("{Enter}");
    await waitFor(() => expect(screen.getByText("Trips like this will wait in Review.")).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Undo" }));
  });
});
